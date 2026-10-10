import axios from "axios";
import { config } from "./config.js";
import { hashToken, newSessionToken } from "./security.js";

const { supabase, limits, defaultSettings, auth } = config;

export const isDatabaseConfigured = () => Boolean(supabase.url && supabase.serviceRoleKey);
export const isAuthConfigured = () => Boolean(supabase.url && supabase.anonKey);

/* ---------- Low-level REST helpers (service role, server-side only) ---------- */

const serviceHeaders = (extra = {}) => ({
  apikey: supabase.serviceRoleKey,
  Authorization: `Bearer ${supabase.serviceRoleKey}`,
  "Content-Type": "application/json",
  ...extra,
});

const request = (method, path, data, headers) =>
  axios({
    method,
    url: `${supabase.restUrl}/${path}`,
    data,
    headers: serviceHeaders(headers),
    timeout: supabase.timeoutMs,
  }).then((response) => response.data);

const returning = { Prefer: "return=representation" };

export const select = async (table, query = "select=*") => (await request("get", `${table}?${query}`)) || [];
export const insert = async (table, payload) => (await request("post", table, payload, returning)) || [];
export const patch = async (table, filter, payload) => (await request("patch", `${table}?${filter}`, payload, returning)) || [];
export const remove = (table, filter) => request("delete", `${table}?${filter}`);

/* ---------- Supabase Auth (Google and phone sign-in) ---------- */

const anonHeaders = () => ({
  apikey: supabase.anonKey,
  Authorization: `Bearer ${supabase.anonKey}`,
  "Content-Type": "application/json",
});

export const sendPhoneCode = (phone) =>
  axios.post(`${supabase.authUrl}/otp`, { phone, should_create_user: true }, { headers: anonHeaders(), timeout: supabase.timeoutMs });

export const verifyPhoneCode = async (phone, token) =>
  (await axios.post(`${supabase.authUrl}/verify`, { phone, token, type: "sms" }, { headers: anonHeaders(), timeout: supabase.timeoutMs })).data;

export const getAuthUser = async (accessToken) =>
  (
    await axios.get(`${supabase.authUrl}/user`, {
      headers: { apikey: supabase.anonKey, Authorization: `Bearer ${accessToken}` },
      timeout: supabase.timeoutMs,
    })
  ).data;

export function googleAuthorizeUrl() {
  const redirectTo = config.clientOrigins[0];
  if (!isAuthConfigured() || !redirectTo) return "";
  return `${supabase.authUrl}/authorize?${new URLSearchParams({ provider: "google", redirect_to: redirectTo })}`;
}

export function authProviders() {
  return {
    google: isAuthConfigured() && Boolean(config.clientOrigins[0]),
    phone: isAuthConfigured(),
  };
}

/* ---------- Mapping between database rows and API objects ---------- */

export const sanitizeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  institution: user.institution || "",
  course: user.course || "",
  createdAt: user.created_at,
});

export const mapSettings = (row) => ({
  academicLevel: row.academic_level,
  referencingStyle: row.referencing_style,
  language: row.language,
  saveHistory: row.save_history,
  compactMode: row.compact_mode,
});

export const mapHistoryItem = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  assignment: row.assignment,
  breakdown: row.breakdown,
});

/* ---------- Sessions ---------- */

export async function createSession(userId) {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + auth.sessionDays * 24 * 60 * 60 * 1000).toISOString();
  await insert("app_sessions", { user_id: userId, token: hashToken(token), expires_at: expiresAt });
  return { token, expiresAt };
}

export async function findSession(token) {
  const [session] = await select(
    "app_sessions",
    `select=*,app_users(*)&token=eq.${encodeURIComponent(hashToken(token))}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,
  );
  return session?.app_users ? { session, user: session.app_users } : null;
}

export const deleteSession = (token) => remove("app_sessions", `token=eq.${encodeURIComponent(hashToken(token))}`);

/* ---------- Per-user data ---------- */

export async function ensureSettings(userId) {
  const [existing] = await select("user_settings", `select=*&user_id=eq.${userId}&limit=1`);
  if (existing) return mapSettings(existing);

  const [created] = await insert("user_settings", {
    user_id: userId,
    academic_level: defaultSettings.academicLevel,
    referencing_style: defaultSettings.referencingStyle,
    language: defaultSettings.language,
    save_history: defaultSettings.saveHistory,
    compact_mode: defaultSettings.compactMode,
  });
  return mapSettings(created);
}

export async function getHistory(userId) {
  const rows = await select(
    "assignment_analyses",
    `select=*&user_id=eq.${userId}&order=created_at.desc&limit=${limits.historyItems}`,
  );
  return rows.map(mapHistoryItem);
}

/* ---------- Errors ---------- */

// Text for server logs and, outside production only, for the API response.
export function describeError(error) {
  const data = error?.response?.data;
  const value = data?.message || data?.error_description || data?.error || (typeof data === "string" ? data : null) || error?.message || "Unknown error";
  return typeof value === "string" ? value.slice(0, 500) : JSON.stringify(value).slice(0, 500);
}