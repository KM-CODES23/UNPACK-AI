// Single source of truth for server settings. Nothing in the other files
// should contain a model name, URL, limit, timeout or default value.
// Every value below can be overridden from .env (see .env.example).

import dotenv from "dotenv";

dotenv.config();

const env = process.env;

const text = (value, fallback = "") => {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
};

const list = (value, fallback = []) => {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const bool = (value, fallback) => {
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "off", "no"].includes(String(value).toLowerCase());
};

// What the parsers in documents.js can actually read. This is a code
// capability, not a preference. DOCUMENT_TYPES can only narrow it.
export const SUPPORTED_DOCUMENT_TYPES = ["pdf", "docx", "txt", "md", "csv"];

const appName = text(env.APP_NAME, "Unpack.ai");
const supabaseUrl = text(env.SUPABASE_URL || env.VITE_SUPABASE_URL).replace(/\/+$/, "");
const geminiModel = text(env.GEMINI_MODEL, "gemini-2.5-flash");
const hfModel = text(env.HF_MODEL, "google/flan-t5-large");

export const config = {
  appName,
  appTagline: text(env.APP_TAGLINE, "Assignment briefs, broken down"),
  port: int(env.PORT, 5000),
  isProduction: env.NODE_ENV === "production",

  // Comma separated list of front-end origins allowed to call this API.
  // The first one is also where Google sign-in sends the user back to.
  clientOrigins: list(env.CLIENT_ORIGIN),
  // Number of reverse proxies in front of this server (Render, Railway,
  // Nginx...). Needed so rate limits see the real client IP. 0 = none.
  trustProxyHops: int(env.TRUST_PROXY_HOPS, 0),

  ai: {
    provider: text(env.AI_PROVIDER, "auto").toLowerCase(),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45000),
    temperature: Number(env.AI_TEMPERATURE ?? 0.4),
    audience: text(env.AI_AUDIENCE, "South African students"),
    persona: text(
      env.AI_PERSONA,
      `You are ${appName}, an ethical academic assistant for ${text(env.AI_AUDIENCE, "South African students")}.`,
    ),
    guardrails: text(
      env.AI_GUARDRAILS,
      "Do not write the assignment for the student. Help them understand requirements, plan research, and organize their work.",
    ),
    gemini: {
      apiKey: text(env.GEMINI_API_KEY),
      model: geminiModel,
      url: text(
        env.GEMINI_API_URL,
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
      ),
      maxOutputTokens: int(env.GEMINI_MAX_OUTPUT_TOKENS, 2048),
    },
    openai: {
      apiKey: text(env.OPENAI_API_KEY),
      model: text(env.OPENAI_MODEL, "gpt-4.1-mini"),
      url: text(env.OPENAI_API_URL, "https://api.openai.com/v1/responses"),
      maxOutputTokens: int(env.OPENAI_MAX_OUTPUT_TOKENS, 900),
    },
    huggingface: {
      apiKey: text(env.HF_TOKEN),
      model: hfModel,
      url: text(env.HF_API_URL, `https://router.huggingface.co/hf-inference/models/${hfModel}`),
      maxNewTokens: int(env.HF_MAX_NEW_TOKENS, 700),
    },
  },

  supabase: {
    url: supabaseUrl,
    anonKey: text(env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY),
    serviceRoleKey: text(env.SUPABASE_SERVICE_ROLE_KEY),
    restUrl: supabaseUrl ? `${supabaseUrl}/rest/v1` : "",
    authUrl: supabaseUrl ? `${supabaseUrl}/auth/v1` : "",
    timeoutMs: int(env.SUPABASE_TIMEOUT_MS, 15000),
  },

  auth: {
    sessionDays: int(env.SESSION_DAYS, 14),
    // Phone sign-in users have no email, so one is derived for them. Keep
    // this value stable once you have users, or their accounts are orphaned.
    phoneEmailDomain: text(env.PHONE_EMAIL_DOMAIN, "phone.unpack.local").toLowerCase(),
    passwordIterations: int(env.PASSWORD_ITERATIONS, 600000),
  },

  security: {
    // Only signed-in users can run analyses and import documents. This stops
    // strangers from spending your AI credits.
    requireAuthForAnalysis: bool(env.REQUIRE_AUTH_FOR_ANALYSIS, true),
    rateLimits: {
      windowMinutes: int(env.RATE_LIMIT_WINDOW_MINUTES, 15),
      general: int(env.RATE_LIMIT_GENERAL, 300),
      auth: int(env.RATE_LIMIT_AUTH, 20),
      analysis: int(env.RATE_LIMIT_ANALYSIS, 40),
      documents: int(env.RATE_LIMIT_DOCUMENTS, 40),
    },
  },

  limits: {
    maxBriefChars: int(env.MAX_BRIEF_CHARS, 12000),
    minBriefChars: int(env.MIN_BRIEF_CHARS, 10),
    minPasswordLength: int(env.MIN_PASSWORD_LENGTH, 6),
    historyItems: int(env.HISTORY_ITEMS, 8),
    jsonBodyLimit: text(env.JSON_BODY_LIMIT, "150kb"),
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
    importTimeoutMs: int(env.IMPORT_TIMEOUT_MS, 20000),
    importMaxRedirects: int(env.IMPORT_MAX_REDIRECTS, 3),
    profileFieldMax: int(env.PROFILE_FIELD_MAX, 150),
  },

  documents: {
    extensions: list(env.DOCUMENT_TYPES, SUPPORTED_DOCUMENT_TYPES).filter((type) =>
      SUPPORTED_DOCUMENT_TYPES.includes(type),
    ),
  },

  options: {
    academicLevels: list(env.ACADEMIC_LEVELS, ["College", "University", "Honours", "Masters"]),
    referencingStyles: list(env.REFERENCING_STYLES, ["Harvard", "APA", "MLA", "IEEE", "Chicago"]),
    languages: list(env.LANGUAGES, ["English", "Zulu", "Xhosa", "Afrikaans", "Sesotho"]),
  },

  defaultSettings: {
    academicLevel: text(env.DEFAULT_ACADEMIC_LEVEL, "University"),
    referencingStyle: text(env.DEFAULT_REFERENCING_STYLE, "Harvard"),
    language: text(env.DEFAULT_LANGUAGE, "English"),
    saveHistory: true,
    compactMode: false,
  },
};