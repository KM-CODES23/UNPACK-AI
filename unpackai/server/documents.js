import axios from "axios";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { config } from "./config.js";
import { isPrivateAddress } from "./security.js";

const { limits, documents } = config;

// Errors with a message that is safe to show to the user.
export class DocumentError extends Error {}

const BLOCKED = "That link isn't allowed. Use a public document link.";

/* ---------- Parsers (keys must match SUPPORTED_DOCUMENT_TYPES) ---------- */

const asText = async (buffer) => buffer.toString("utf8");

const parsers = {
  pdf: async (buffer) => {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text || "";
    } finally {
      await parser.destroy();
    }
  },
  docx: async (buffer) => (await mammoth.extractRawText({ buffer })).value || "",
  txt: asText,
  md: asText,
  csv: asText,
};

const MIME_TO_TYPE = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
};

function detectType(name = "", mimetype = "") {
  const extension = name.split("?")[0].split(".").pop()?.toLowerCase();
  const fromMime = MIME_TO_TYPE[String(mimetype).split(";")[0].trim().toLowerCase()];
  const type = documents.extensions.includes(extension) ? extension : fromMime;
  return documents.extensions.includes(type) ? type : null;
}

export async function extractDocumentText({ name, mimetype, buffer }) {
  const type = detectType(name, mimetype);

  if (!type) {
    throw new DocumentError(`Supported formats: ${documents.extensions.join(", ").toUpperCase()}.`);
  }

  const text = (await parsers[type](buffer)).trim();

  if (!text) {
    throw new DocumentError("No readable text was found in that document.");
  }

  return text.slice(0, limits.maxBriefChars);
}

/* ---------- Fetching a document from a link, without SSRF ---------- */
// Without these checks, anyone could point this endpoint at localhost or at
// a cloud provider's metadata address and read back what it returns.

function safeLookup(hostname, options, callback) {
  const done = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options || {};

  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return done(error);
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      return done(new DocumentError(BLOCKED));
    }
    if (opts.all) return done(null, addresses);
    return done(null, addresses[0].address, addresses[0].family);
  });
}

// Validation happens inside the connection itself, so a hostname can't pass a
// check and then resolve to a different (private) address when we connect.
const httpAgent = new http.Agent({ lookup: safeLookup });
const httpsAgent = new https.Agent({ lookup: safeLookup });

function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new DocumentError("Enter a full link starting with http:// or https://.");
  }

  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new DocumentError(BLOCKED);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const internalName = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");

  if (internalName || (net.isIP(host) && isPrivateAddress(host))) {
    throw new DocumentError(BLOCKED);
  }

  return url;
}

export async function fetchPublicDocument(rawUrl) {
  let current = rawUrl;

  // Redirects are followed by hand so every hop is checked again.
  for (let hop = 0; hop <= limits.importMaxRedirects; hop += 1) {
    const url = assertPublicUrl(current);
    let response;
    try {
      response = await axios.get(url.href, {
        responseType: "arraybuffer",
        timeout: limits.importTimeoutMs,
        maxContentLength: limits.maxUploadBytes,
        maxRedirects: 0,
        validateStatus: (status) => status >= 200 && status < 400,
        httpAgent,
        httpsAgent,
      });
    } catch (error) {
      // axios wraps errors raised inside the connection, so unwrap ours.
      if (error instanceof DocumentError || error.cause instanceof DocumentError || error.message === BLOCKED) {
        throw new DocumentError(BLOCKED);
      }
      if (error.code === "ECONNABORTED") throw new DocumentError("That link took too long to respond.");
      if (error.response) throw new DocumentError(`That link returned an error (${error.response.status}).`);
      if (error.code === "ENOTFOUND") throw new DocumentError("That link's address couldn't be found.");
      throw error;
    }

    if (response.status >= 300) {
      const location = response.headers.location;
      if (!location) throw new DocumentError("That link redirected without a destination.");
      current = new URL(location, url).href;
      continue;
    }

    const lastSegment = url.pathname.split("/").filter(Boolean).pop() || "document";
    let name = lastSegment;
    try {
      name = decodeURIComponent(lastSegment);
    } catch {
      // keep the raw segment
    }
    return {
      name,
      mimetype: response.headers["content-type"] || "",
      buffer: Buffer.from(response.data),
    };
  }

  throw new DocumentError("That link redirected too many times.");
}