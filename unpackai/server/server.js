import express from "express";
import cors from "cors";
import helmet from "helmet";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { activeProvider, analyzeAssignment, mapProviderError } from "./Ai.js";
import { DocumentError, extractDocumentText, fetchPublicDocument } from "./documents.js";
import {
  authProviders,
  createSession,
  deleteSession,
  describeError,
  ensureSettings,
  findSession,
  getAuthUser,
  getHistory,
  googleAuthorizeUrl,
  insert,
  isAuthConfigured,
  isDatabaseConfigured,
  mapHistoryItem,
  mapSettings,
  patch,
  remove,
  sanitizeUser,
  select,
  sendPhoneCode,
  verifyPhoneCode,
} from "./db.js";
import { hashPassword, needsRehash, verifyPassword } from "./security.js";

const { appName, limits, options, defaultSettings, isProduction, security } = config;

const app = express();

if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
app.disable("x-powered-by");

/* =====================================================================
   Middleware
   ===================================================================== */

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // same-origin and server-to-server calls
      if (config.clientOrigins.includes(origin)) return callback(null, true);
      // With no CLIENT_ORIGIN set, only development is open. Production is closed.
      return callback(null, !isProduction && config.clientOrigins.length === 0);
    },
  }),
);

app.use(express.json({ limit: limits.jsonBodyLimit }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.maxUploadBytes } });

function limiter(max, message) {
  return rateLimit({
    windowMs: security.rateLimits.windowMinutes * 60 * 1000,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

const tooMany = "Too many requests. Please wait a few minutes and try again.";
const limits_ = {
  general: limiter(security.rateLimits.general, tooMany),
  auth: limiter(security.rateLimits.auth, "Too many sign-in attempts. Please wait a few minutes and try again."),
  analysis: limiter(security.rateLimits.analysis, tooMany),
  documents: limiter(security.rateLimits.documents, tooMany),
};

app.use("/api", limits_.general);

/* =====================================================================
   Helpers
   ===================================================================== */

// Express 4 doesn't catch errors thrown in async handlers. This does.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Logs the real cause. Shows it to the client only outside production.
function sendError(res, status, message, error) {
  if (error) console.error(`[${new Date().toISOString()}] ${message}`, describeError(error));
  const body = { error: message };
  if (error && !isProduction) body.details = describeError(error);
  return res.status(status).json(body);
}

const cleanText = (value) => String(value ?? "").trim();
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const pickOption = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const bearerToken = (req) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

const requireDatabase = (req, res, next) =>
  isDatabaseConfigured() ? next() : sendError(res, 503, "Accounts aren't available right now.");

const requireAuthConfig = (req, res, next) =>
  isAuthConfigured() ? next() : sendError(res, 503, "This sign-in method isn't available right now.");

const requireSession = handle(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });

  const found = await findSession(token);
  if (!found) return res.status(401).json({ error: "Your session has expired. Please sign in again." });

  req.auth = found;
  req.token = token;
  return next();
});

// Analysis and document routes cost money, so they sit behind sign-in unless
// REQUIRE_AUTH_FOR_ANALYSIS=false.
const analysisGate = security.requireAuthForAnalysis ? [requireDatabase, requireSession] : [];

/* =====================================================================
   Status and public config
   ===================================================================== */

app.get("/", (req, res) => res.send(`${appName} backend running`));

app.get("/health", (req, res) => {
  const body = { ok: true, service: appName, provider: activeProvider() };
  if (!isProduction) {
    body.debug = { database: isDatabaseConfigured(), auth: isAuthConfigured(), authProviders: authProviders() };
  }
  res.json(body);
});

// Everything the front end needs to build its forms. Change a value in .env
// and the app picks it up, with no front-end rebuild.
app.get("/api/config", (req, res) => {
  const providers = authProviders();
  res.json({
    brand: { name: appName, tagline: config.appTagline },
    options,
    defaults: { settings: defaultSettings },
    limits: {
      maxBriefChars: limits.maxBriefChars,
      minBriefChars: limits.minBriefChars,
      minPasswordLength: limits.minPasswordLength,
      historyItems: limits.historyItems,
    },
    documents: { extensions: config.documents.extensions },
    features: { googleLogin: providers.google, phoneLogin: providers.phone },
  });
});

app.get("/api/auth/providers", (req, res) => {
  res.json({ providers: authProviders(), googleUrl: googleAuthorizeUrl() });
});

/* =====================================================================
   Sign in
   ===================================================================== */

async function appSessionFor(user) {
  const [session, settings, history] = await Promise.all([createSession(user.id), ensureSettings(user.id), getHistory(user.id)]);
  return { token: session.token, user: sanitizeUser(user), settings, history };
}

async function findOrCreateUser({ name, email }) {
  const [existing] = await select("app_users", `select=*&email=eq.${encodeURIComponent(email)}&limit=1`);
  if (existing) return existing;
  const [created] = await insert("app_users", { name, email, password_hash: "supabase-auth", institution: "", course: "" });
  return created;
}

async function sessionFromSupabaseUser(supabaseUser) {
  const email = (supabaseUser.email || "").toLowerCase();
  const phone = supabaseUser.phone || "";
  const name =
    supabaseUser.user_metadata?.full_name || supabaseUser.user_metadata?.name || email.split("@")[0] || phone || `${appName} user`;
  const lookupEmail = email || `${supabaseUser.id}@${config.auth.phoneEmailDomain}`.toLowerCase();

  return appSessionFor(await findOrCreateUser({ name, email: lookupEmail }));
}

app.post("/api/auth/signup", limits_.auth, requireDatabase, handle(async (req, res) => {
  const name = cleanText(req.body?.name).slice(0, limits.profileFieldMax);
  const email = cleanText(req.body?.email).toLowerCase();
  const password = String(req.body?.password || "");

  if (!name || !isEmail(email) || password.length < limits.minPasswordLength) {
    return res.status(400).json({
      error: `Enter your name, a valid email, and a password of at least ${limits.minPasswordLength} characters.`,
    });
  }

  const [existing] = await select("app_users", `select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
  if (existing) return res.status(409).json({ error: "An account with that email already exists." });

  const [user] = await insert("app_users", { name, email, password_hash: await hashPassword(password), institution: "", course: "" });
  return res.status(201).json({ ...(await appSessionFor(user)), history: [] });
}));

app.post("/api/auth/login", limits_.auth, requireDatabase, handle(async (req, res) => {
  const email = cleanText(req.body?.email).toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const [user] = await select("app_users", `select=*&email=eq.${encodeURIComponent(email)}&limit=1`);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  if (needsRehash(user.password_hash)) {
    // Upgrade old hashes quietly. A failure here must never block the login.
    hashPassword(password)
      .then((hash) => patch("app_users", `id=eq.${user.id}`, { password_hash: hash }))
      .catch((error) => console.warn("Could not upgrade password hash:", describeError(error)));
  }

  return res.json(await appSessionFor(user));
}));

app.post("/api/auth/logout", requireDatabase, requireSession, handle(async (req, res) => {
  await deleteSession(req.token);
  res.json({ ok: true });
}));

app.post("/api/auth/phone/start", limits_.auth, requireAuthConfig, handle(async (req, res) => {
  const phone = cleanText(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "Phone number is required." });

  try {
    await sendPhoneCode(phone);
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, 502, "Could not send the verification code.", error);
  }
}));

app.post("/api/auth/phone/verify", limits_.auth, requireAuthConfig, requireDatabase, handle(async (req, res) => {
  const phone = cleanText(req.body?.phone);
  const token = cleanText(req.body?.token);
  if (!phone || !token) return res.status(400).json({ error: "Phone number and code are required." });

  let verified;
  try {
    verified = await verifyPhoneCode(phone, token);
  } catch (error) {
    return sendError(res, 401, "That code is invalid or has expired.", error);
  }
  return res.json(await sessionFromSupabaseUser(verified.user));
}));

app.post("/api/auth/supabase-session", limits_.auth, requireAuthConfig, requireDatabase, handle(async (req, res) => {
  const accessToken = cleanText(req.body?.accessToken);
  if (!accessToken) return res.status(400).json({ error: "Access token is required." });

  let supabaseUser;
  try {
    supabaseUser = await getAuthUser(accessToken);
  } catch (error) {
    return sendError(res, 401, "That sign-in link is invalid or has expired.", error);
  }
  return res.json(await sessionFromSupabaseUser(supabaseUser));
}));

/* =====================================================================
   Account
   ===================================================================== */

app.get("/api/me", requireDatabase, requireSession, handle(async (req, res) => {
  const [settings, history] = await Promise.all([ensureSettings(req.auth.user.id), getHistory(req.auth.user.id)]);
  res.json({ user: sanitizeUser(req.auth.user), settings, history });
}));

app.put("/api/profile", requireDatabase, requireSession, handle(async (req, res) => {
  const { user } = req.auth;
  const max = limits.profileFieldMax;
  const email = cleanText(req.body?.email).toLowerCase() || user.email;

  if (!isEmail(email) && email !== user.email) return res.status(400).json({ error: "Enter a valid email address." });

  if (email !== user.email) {
    const [taken] = await select("app_users", `select=id&email=eq.${encodeURIComponent(email)}&id=neq.${user.id}&limit=1`);
    if (taken) return res.status(409).json({ error: "That email is already used by another account." });
  }

  const [updated] = await patch("app_users", `id=eq.${user.id}`, {
    name: cleanText(req.body?.name).slice(0, max) || user.name,
    email,
    institution: cleanText(req.body?.institution).slice(0, max),
    course: cleanText(req.body?.course).slice(0, max),
  });
  res.json({ user: sanitizeUser(updated) });
}));

app.put("/api/settings", requireDatabase, requireSession, handle(async (req, res) => {
  const body = req.body || {};
  const [updated] = await patch("user_settings", `user_id=eq.${req.auth.user.id}`, {
    academic_level: pickOption(body.academicLevel, options.academicLevels, defaultSettings.academicLevel),
    referencing_style: pickOption(body.referencingStyle, options.referencingStyles, defaultSettings.referencingStyle),
    language: pickOption(body.language, options.languages, defaultSettings.language),
    save_history: Boolean(body.saveHistory),
    compact_mode: Boolean(body.compactMode),
  });
  res.json({ settings: mapSettings(updated) });
}));

app.get("/api/history", requireDatabase, requireSession, handle(async (req, res) => {
  res.json({ history: await getHistory(req.auth.user.id) });
}));

app.post("/api/history", requireDatabase, requireSession, handle(async (req, res) => {
  const breakdown = req.body?.breakdown;
  if (!breakdown || typeof breakdown !== "object" || Array.isArray(breakdown)) {
    return res.status(400).json({ error: "A breakdown is required." });
  }

  const [item] = await insert("assignment_analyses", {
    user_id: req.auth.user.id,
    assignment: cleanText(req.body?.assignment).slice(0, limits.maxBriefChars),
    breakdown,
  });
  res.status(201).json({ item: mapHistoryItem(item) });
}));

app.delete("/api/history", requireDatabase, requireSession, handle(async (req, res) => {
  await remove("assignment_analyses", `user_id=eq.${req.auth.user.id}`);
  res.json({ ok: true });
}));

/* =====================================================================
   Documents
   ===================================================================== */

app.post("/api/documents/extract", limits_.documents, ...analysisGate, upload.single("document"), handle(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });

  try {
    const text = await extractDocumentText({
      name: req.file.originalname,
      mimetype: req.file.mimetype,
      buffer: req.file.buffer,
    });
    return res.json({ name: req.file.originalname, size: req.file.size, text });
  } catch (error) {
    if (error instanceof DocumentError) return res.status(400).json({ error: error.message });
    return sendError(res, 400, "Could not read that document.", error);
  }
}));

app.post("/api/documents/import-url", limits_.documents, ...analysisGate, handle(async (req, res) => {
  const url = cleanText(req.body?.url);
  if (!url) return res.status(400).json({ error: "Paste a link to a document." });

  try {
    const file = await fetchPublicDocument(url);
    const text = await extractDocumentText(file);
    return res.json({ name: file.name, size: file.buffer.length, text });
  } catch (error) {
    if (error instanceof DocumentError) return res.status(400).json({ error: error.message });
    return sendError(res, 400, "Could not import that document.", error);
  }
}));

/* =====================================================================
   Analysis
   ===================================================================== */

function validateAssignment(value) {
  if (typeof value !== "string" || !value.trim()) return { error: "Assignment text is required." };
  const assignment = value.trim();
  if (assignment.length < limits.minBriefChars) {
    return { error: `Assignment text must be at least ${limits.minBriefChars} characters.` };
  }
  if (assignment.length > limits.maxBriefChars) {
    return { error: `Assignment text must be ${limits.maxBriefChars} characters or fewer.` };
  }
  return { assignment };
}

const analyze = handle(async (req, res) => {
  const { assignment, error } = validateAssignment(req.body?.assignment);
  if (error) return res.status(400).json({ error });

  try {
    return res.json(await analyzeAssignment(assignment));
  } catch (providerError) {
    const mapped = mapProviderError(providerError);
    return sendError(res, mapped.status, mapped.message, providerError);
  }
});

// "/breakdown" is kept so older links to the API keep working.
app.post(["/api/breakdown", "/breakdown"], limits_.analysis, ...analysisGate, analyze);

/* =====================================================================
   Fallbacks
   ===================================================================== */

app.use((req, res) => res.status(404).json({ error: "Route not found." }));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && "body" in error) return res.status(400).json({ error: "Invalid JSON request body." });
  if (error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `That file is too large. The limit is ${Math.round(limits.maxUploadBytes / 1024 / 1024)} MB.` });
  }
  return sendError(res, 500, "Unexpected server error.", error);
});

app.listen(config.port, () => {
  console.log(`${appName} backend running on port ${config.port}`);
  if (isProduction && config.clientOrigins.length === 0) {
    console.warn("CLIENT_ORIGIN is not set. Browsers on other domains will be blocked, and Google sign-in is disabled.");
  }
  if (!isDatabaseConfigured()) {
    console.warn("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Accounts and analysis are unavailable.");
  }
});