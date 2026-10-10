import crypto from "node:crypto";
import net from "node:net";
import { promisify } from "node:util";
import { config } from "./config.js";

const pbkdf2 = promisify(crypto.pbkdf2);

// Hashes created by the first version of this app used this many rounds and
// had no iteration count stored in them. They still verify, and are upgraded
// to the current setting the next time that user signs in.
const LEGACY_ITERATIONS = 120000;
const KEY_LENGTH = 32;

/* ---------- Passwords (async so a login never blocks the server) ---------- */

export async function hashPassword(password) {
  const iterations = config.auth.passwordIterations;
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = (await pbkdf2(password, salt, iterations, KEY_LENGTH, "sha256")).toString("hex");
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

function parseStoredHash(stored = "") {
  const parts = String(stored).split(":");
  if (parts[0] !== "pbkdf2") return null;
  if (parts.length === 3) return { iterations: LEGACY_ITERATIONS, salt: parts[1], hash: parts[2], legacy: true };
  if (parts.length === 4) return { iterations: Number(parts[1]), salt: parts[2], hash: parts[3], legacy: false };
  return null;
}

export async function verifyPassword(password, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed || !Number.isInteger(parsed.iterations) || !parsed.salt || !parsed.hash) return false;

  const attempted = await pbkdf2(password, parsed.salt, parsed.iterations, KEY_LENGTH, "sha256");
  const expected = Buffer.from(parsed.hash, "hex");
  return expected.length === attempted.length && crypto.timingSafeEqual(expected, attempted);
}

export function needsRehash(stored) {
  const parsed = parseStoredHash(stored);
  return Boolean(parsed) && (parsed.legacy || parsed.iterations < config.auth.passwordIterations);
}

/* ---------- Session tokens ---------- */
// The browser gets the raw token. The database only ever stores its hash, so
// a leaked database can't be used to impersonate anyone.

export const newSessionToken = () => crypto.randomBytes(32).toString("hex");
export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/* ---------- Private network detection (used to block SSRF) ---------- */

function isPrivateIPv4(address) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, includes cloud metadata services
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast and reserved
  );
}

function isPrivateIPv6(address) {
  const lower = address.toLowerCase();

  // IPv4 addresses wrapped in IPv6, in dotted or hex form.
  if (lower.startsWith("::ffff:")) {
    const rest = lower.slice(7);
    if (rest.includes(".")) return isPrivateIPv4(rest);
    const [high, low] = rest.split(":").map((part) => Number.parseInt(part, 16));
    if (Number.isNaN(high) || Number.isNaN(low)) return true;
    return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }

  if (lower.startsWith("::") || lower.startsWith("64:ff9b:")) return true; // unspecified, loopback, NAT64
  const first = lower.split(":")[0];
  if (/^f[cd]/.test(first)) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(first)) return true; // link-local fe80::/10
  if (first.startsWith("ff")) return true; // multicast
  return false;
}

export function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // anything we can't classify is treated as unsafe
}