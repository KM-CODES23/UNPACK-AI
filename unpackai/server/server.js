import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;
const AI_PROVIDER = (process.env.AI_PROVIDER || "auto").toLowerCase();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_API_URL = process.env.OPENAI_API_URL || "https://api.openai.com/v1/responses";
const HF_TOKEN = process.env.HF_TOKEN;
const HF_MODEL = process.env.HF_MODEL || "google/flan-t5-large";
const HF_API_URL =
  process.env.HF_API_URL || `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_REST_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1` : "";
const MAX_ASSIGNMENT_LENGTH = 12000;
const MIN_ASSIGNMENT_LENGTH = 10;

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || true,
  })
);
app.use(express.json({ limit: "150kb" }));

const emptyBreakdown = {
  mainTopic: "",
  keyConcepts: [],
  keywords: [],
  requiredTasks: [],
  suggestedStructure: [],
  completionPlan: [],
  summary: "",
  rawText: "",
};

app.get("/", (req, res) => {
  res.send("Unpack.ai backend running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "unpack.ai-backend",
    provider: AI_PROVIDER,
    geminiModel: GEMINI_MODEL,
    openAIModel: OPENAI_MODEL,
    huggingFaceModel: HF_MODEL,
    hasGeminiKey: Boolean(GEMINI_API_KEY),
    hasOpenAIKey: Boolean(OPENAI_API_KEY),
    hasHuggingFaceToken: Boolean(HF_TOKEN),
    hasDatabase: isSupabaseConfigured(),
  });
});

app.post("/api/auth/signup", async (req, res) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: "Supabase is not configured on the server." });
  }

  const name = cleanText(req.body?.name);
  const email = cleanText(req.body?.email).toLowerCase();
  const password = String(req.body?.password || "");

  if (!name || !email || password.length < 6) {
    return res.status(400).json({ error: "Name, valid email, and 6+ character password are required." });
  }

  try {
    const existing = await supabaseSelect("app_users", `select=id&email=eq.${encodeURIComponent(email)}&limit=1`);

    if (existing.length) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = hashPassword(password);
    const [user] = await supabaseInsert("app_users", {
      name,
      email,
      password_hash: passwordHash,
      institution: "",
      course: "",
    });
    const settings = await ensureSettings(user.id);
    const session = await createSession(user.id);

    return res.status(201).json({
      token: session.token,
      user: sanitizeUser(user),
      settings,
      history: [],
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create account.", details: getSupabaseError(error) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: "Supabase is not configured on the server." });
  }

  const email = cleanText(req.body?.email).toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const [user] = await supabaseSelect("app_users", `select=*&email=eq.${encodeURIComponent(email)}&limit=1`);

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const settings = await ensureSettings(user.id);
    const history = await getHistory(user.id);
    const session = await createSession(user.id);

    return res.json({
      token: session.token,
      user: sanitizeUser(user),
      settings,
      history,
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to sign in.", details: getSupabaseError(error) });
  }
});

app.get("/api/me", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const settings = await ensureSettings(auth.user.id);
  const history = await getHistory(auth.user.id);

  return res.json({
    user: sanitizeUser(auth.user),
    settings,
    history,
  });
});

app.put("/api/profile", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const updates = {
    name: cleanText(req.body?.name) || auth.user.name,
    email: cleanText(req.body?.email).toLowerCase() || auth.user.email,
    institution: cleanText(req.body?.institution),
    course: cleanText(req.body?.course),
  };

  try {
    const [user] = await supabasePatch("app_users", `id=eq.${auth.user.id}`, updates);
    return res.json({ user: sanitizeUser(user) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update profile.", details: getSupabaseError(error) });
  }
});

app.put("/api/settings", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const nextSettings = {
    academic_level: cleanText(req.body?.academicLevel) || "University",
    referencing_style: cleanText(req.body?.referencingStyle) || "Harvard",
    language: cleanText(req.body?.language) || "English",
    save_history: Boolean(req.body?.saveHistory),
    compact_mode: Boolean(req.body?.compactMode),
  };

  try {
    const [settings] = await supabasePatch("user_settings", `user_id=eq.${auth.user.id}`, nextSettings);
    return res.json({ settings: mapSettings(settings) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to update settings.", details: getSupabaseError(error) });
  }
});

app.get("/api/history", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  return res.json({ history: await getHistory(auth.user.id) });
});

app.post("/api/history", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  try {
    const [item] = await supabaseInsert("assignment_analyses", {
      user_id: auth.user.id,
      assignment: String(req.body?.assignment || "").slice(0, 12000),
      breakdown: req.body?.breakdown || {},
    });

    return res.status(201).json({ item: mapHistoryItem(item) });
  } catch (error) {
    return res.status(500).json({ error: "Failed to save analysis.", details: getSupabaseError(error) });
  }
});

app.delete("/api/history", async (req, res) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  try {
    await supabaseDelete("assignment_analyses", `user_id=eq.${auth.user.id}`);
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to clear history.", details: getSupabaseError(error) });
  }
});

app.post("/api/breakdown", async (req, res) => {
  const validation = validateAssignment(req.body?.assignment);

  if (!validation.ok) {
    return res.status(400).json({
      error: validation.error,
    });
  }

  try {
    const aiResult = await generateBreakdownWithProviders(validation.assignment);
    const breakdown = normalizeBreakdown(aiResult.rawText);

    return res.json({
      ...breakdown,
      provider: aiResult.provider,
      rawText: aiResult.rawText,
    });
  } catch (error) {
    if (shouldUseLocalFallback(error) || error.code === "NO_AI_PROVIDER") {
      return res.json(createLocalBreakdown(validation.assignment, error));
    }

    const mapped = mapProviderError(error);

    return res.status(mapped.status).json({
      error: mapped.message,
      details: mapped.details,
    });
  }
});

app.post("/breakdown", (req, res, next) => {
  req.url = "/api/breakdown";
  app.handle(req, res, next);
});

function validateAssignment(value) {
  if (typeof value !== "string") {
    return {
      ok: false,
      error: "Assignment text is required.",
    };
  }

  const assignment = value.trim();

  if (!assignment) {
    return {
      ok: false,
      error: "Assignment text cannot be empty.",
    };
  }

  if (assignment.length < MIN_ASSIGNMENT_LENGTH) {
    return {
      ok: false,
      error: `Assignment text must be at least ${MIN_ASSIGNMENT_LENGTH} characters.`,
    };
  }

  if (assignment.length > MAX_ASSIGNMENT_LENGTH) {
    return {
      ok: false,
      error: `Assignment text must be ${MAX_ASSIGNMENT_LENGTH} characters or fewer.`,
    };
  }

  return {
    ok: true,
    assignment,
  };
}

async function generateBreakdownWithProviders(assignment) {
  const prompt = buildPrompt(assignment);
  const providers = getProviderOrder();
  const errors = [];

  for (const provider of providers) {
    try {
      if (provider === "gemini") {
        const response = await callGemini(prompt);
        return {
          provider: "gemini",
          rawText: extractGeminiText(response.data),
        };
      }

      if (provider === "openai") {
        const response = await callOpenAI(prompt);
        return {
          provider: "openai",
          rawText: extractOpenAIText(response.data),
        };
      }

      if (provider === "huggingface") {
        const response = await callHuggingFace(prompt);
        return {
          provider: "huggingface",
          rawText: extractGeneratedText(response.data),
        };
      }
    } catch (error) {
      errors.push(error);

      if (!shouldTryNextProvider(error)) {
        throw error;
      }
    }
  }

  const fallbackError = errors.at(-1) || new Error("No AI provider is configured.");
  fallbackError.code = fallbackError.code || "NO_AI_PROVIDER";
  throw fallbackError;
}

function getProviderOrder() {
  if (AI_PROVIDER === "gemini" || AI_PROVIDER === "google" || AI_PROVIDER === "googleai") {
    return GEMINI_API_KEY ? ["gemini"] : [];
  }

  if (AI_PROVIDER === "openai") {
    return OPENAI_API_KEY ? ["openai"] : [];
  }

  if (AI_PROVIDER === "huggingface") {
    return HF_TOKEN ? ["huggingface"] : [];
  }

  const providers = [];

  if (GEMINI_API_KEY) {
    providers.push("gemini");
  }

  if (OPENAI_API_KEY) {
    providers.push("openai");
  }

  if (HF_TOKEN) {
    providers.push("huggingface");
  }

  return providers;
}

function buildPrompt(assignment) {
  return `
You are Unpack.ai, an ethical academic assistant for South African students.
Do not write the assignment for the student. Help them understand requirements, plan research, and organize their work.

Return ONLY valid JSON with this exact shape:
{
  "mainTopic": "short topic title",
  "keyConcepts": ["concept 1", "concept 2", "concept 3"],
  "keywords": ["keyword 1", "keyword 2", "keyword 3"],
  "requiredTasks": ["task 1", "task 2", "task 3"],
  "suggestedStructure": ["section 1", "section 2", "section 3"],
  "completionPlan": ["step 1", "step 2", "step 3"],
  "summary": "short student-friendly summary"
}

Assignment:
${assignment}
`.trim();
}

async function callOpenAI(prompt) {
  return axios.post(
    OPENAI_API_URL,
    {
      model: OPENAI_MODEL,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "assignment_breakdown",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              mainTopic: { type: "string" },
              keyConcepts: {
                type: "array",
                items: { type: "string" },
              },
              keywords: {
                type: "array",
                items: { type: "string" },
              },
              requiredTasks: {
                type: "array",
                items: { type: "string" },
              },
              suggestedStructure: {
                type: "array",
                items: { type: "string" },
              },
              completionPlan: {
                type: "array",
                items: { type: "string" },
              },
              summary: { type: "string" },
            },
            required: [
              "mainTopic",
              "keyConcepts",
              "keywords",
              "requiredTasks",
              "suggestedStructure",
              "completionPlan",
              "summary",
            ],
          },
        },
      },
      max_output_tokens: 900,
      store: false,
    },
    {
      timeout: 45000,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
}

async function callGemini(prompt) {
  return axios.post(
    GEMINI_API_URL,
    {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            mainTopic: { type: "STRING" },
            keyConcepts: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            keywords: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            requiredTasks: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            suggestedStructure: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            completionPlan: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            summary: { type: "STRING" },
          },
          required: [
            "mainTopic",
            "keyConcepts",
            "keywords",
            "requiredTasks",
            "suggestedStructure",
            "completionPlan",
            "summary",
          ],
        },
        temperature: 0.4,
        maxOutputTokens: 2048,
      },
    },
    {
      timeout: 45000,
      headers: {
        "x-goog-api-key": GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
}

async function callHuggingFace(prompt) {
  return axios.post(
    HF_API_URL,
    {
      inputs: prompt,
      parameters: {
        max_new_tokens: 700,
        return_full_text: false,
      },
      options: {
        wait_for_model: true,
      },
    },
    {
      timeout: 45000,
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part?.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (text) {
    return text;
  }

  return JSON.stringify(payload || {});
}

function extractOpenAIText(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text.trim();
  }

  if (Array.isArray(payload.output)) {
    const text = payload.output
      .flatMap((item) => item?.content || [])
      .map((content) => content?.text || content?.output_text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (text) {
      return text;
    }
  }

  return JSON.stringify(payload);
}

function extractGeneratedText(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload === "string") {
    return payload.trim();
  }

  if (Array.isArray(payload)) {
    return payload
      .map((item) => item?.generated_text || item?.summary_text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof payload.generated_text === "string") {
    return payload.generated_text.trim();
  }

  if (typeof payload.summary_text === "string") {
    return payload.summary_text.trim();
  }

  return JSON.stringify(payload);
}

function normalizeBreakdown(rawText) {
  const parsedJson = parseJsonFromText(rawText);

  if (parsedJson) {
    return {
      mainTopic: toStringValue(parsedJson.mainTopic),
      keyConcepts: toStringArray(parsedJson.keyConcepts),
      keywords: toStringArray(parsedJson.keywords),
      requiredTasks: toStringArray(parsedJson.requiredTasks),
      suggestedStructure: toStringArray(parsedJson.suggestedStructure),
      completionPlan: toStringArray(parsedJson.completionPlan),
      summary: toStringValue(parsedJson.summary),
      rawText,
    };
  }

  if (looksLikeIncompleteJson(rawText)) {
    const error = new Error("AI returned incomplete JSON.");
    return createLocalBreakdown(rawText, error);
  }

  return parsePlainTextBreakdown(rawText);
}

function looksLikeIncompleteJson(text) {
  if (!text) {
    return false;
  }

  const trimmed = text.trim();
  return trimmed.startsWith("{") && !trimmed.endsWith("}");
}

function parseJsonFromText(text) {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```json/i, "").replace(/```$/i, "").trim(),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function parsePlainTextBreakdown(rawText) {
  const text = rawText || "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fallback = {
    ...emptyBreakdown,
    rawText: text,
    summary: lines.slice(0, 3).join(" "),
  };

  const sectionMap = [
    ["mainTopic", /main\s*topic|topic/i],
    ["keyConcepts", /key\s*concepts?|concepts?/i],
    ["keywords", /important\s*keywords?|keywords?/i],
    ["requiredTasks", /required\s*tasks?|tasks?|requirements?/i],
    ["suggestedStructure", /suggested\s*structure|structure|outline/i],
    ["completionPlan", /completion\s*plan|step-by-step|steps?|roadmap/i],
    ["summary", /summary|overview/i],
  ];
  let activeKey = null;

  for (const line of lines) {
    const heading = sectionMap.find(([, pattern]) => pattern.test(line.replace(/[:\-].*$/, "")));

    if (heading && /[:\-]?\s*$/.test(line.replace(heading[1], ""))) {
      activeKey = heading[0];
      continue;
    }

    const inlineHeading = sectionMap.find(([, pattern]) => pattern.test(line.split(/[:\-]/)[0]));

    if (inlineHeading && /[:\-]/.test(line)) {
      activeKey = inlineHeading[0];
      const value = cleanListItem(line.split(/[:\-]/).slice(1).join(":"));
      addParsedValue(fallback, activeKey, value);
      continue;
    }

    if (activeKey) {
      addParsedValue(fallback, activeKey, cleanListItem(line));
    }
  }

  if (!fallback.mainTopic) {
    fallback.mainTopic = inferTopic(lines);
  }

  if (!fallback.keywords.length) {
    fallback.keywords = inferKeywords(text);
  }

  if (!fallback.requiredTasks.length) {
    fallback.requiredTasks = [
      "Identify the assignment requirements",
      "Research the key concepts",
      "Create a clear structure before writing",
    ];
  }

  if (!fallback.completionPlan.length) {
    fallback.completionPlan = [
      "Read the brief carefully and highlight action words",
      "Collect credible sources for each key concept",
      "Draft, review, reference, and proofread before submission",
    ];
  }

  return fallback;
}

function addParsedValue(target, key, value) {
  if (!value) {
    return;
  }

  if (key === "mainTopic" || key === "summary") {
    target[key] = target[key] ? `${target[key]} ${value}` : value;
    return;
  }

  target[key].push(value);
}

function cleanListItem(value) {
  return value
    .replace(/^[-*\d.)\s]+/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
}

function inferTopic(lines) {
  const firstUsefulLine = lines.find((line) => line.length > 10) || "";
  return firstUsefulLine.slice(0, 90);
}

function inferKeywords(text) {
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "and",
    "are",
    "assignment",
    "before",
    "from",
    "have",
    "into",
    "must",
    "that",
    "the",
    "their",
    "this",
    "with",
    "your",
  ]);
  const words = text.toLowerCase().match(/[a-z][a-z-]{3,}/g);

  if (!words) {
    return [];
  }

  const counts = new Map();

  for (const word of words) {
    if (!stopWords.has(word)) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.replace(/^\w/, (letter) => letter.toUpperCase()));
}

function createLocalBreakdown(assignment, error) {
  const sentences = assignment
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const keywords = inferKeywords(assignment);
  const actionWords = extractActionWords(assignment);
  const mainTopic = inferLocalTopic(assignment, keywords);
  const keyConcepts = keywords.slice(0, 5);

  return {
    mainTopic,
    keyConcepts: keyConcepts.length ? keyConcepts : ["Academic research", "Assignment planning", "Structured writing"],
    keywords,
    requiredTasks: buildRequiredTasks(actionWords),
    suggestedStructure: [
      "Introduction: define the topic and explain the assignment focus",
      "Context and background: describe the main academic issues",
      "Analysis: discuss key concepts, evidence, and examples",
      "Evaluation: compare strengths, limitations, and ethical concerns",
      "Conclusion and recommendations: summarize findings and next steps",
      "References: list all sources in the required referencing style",
    ],
    completionPlan: [
      "Rewrite the question in simple language and highlight instruction words",
      "Create a research list from the extracted keywords and key concepts",
      "Find credible academic sources for each major section",
      "Draft the structure before writing full paragraphs",
      "Review the draft against the assignment brief and marking criteria",
      "Proofread, format references, and prepare the final submission",
    ],
    summary:
      sentences[0] ||
      "This assignment should be approached by identifying the topic, researching the key concepts, and following a clear academic structure.",
    provider: "local",
    rawText: `Local fallback used because the AI provider was unavailable: ${getErrorSummary(error)}`,
  };
}

function extractActionWords(text) {
  const actions = [
    "analyze",
    "compare",
    "contrast",
    "define",
    "describe",
    "discuss",
    "evaluate",
    "explain",
    "identify",
    "justify",
    "propose",
    "recommend",
    "reflect",
    "summarize",
  ];
  const lowerText = text.toLowerCase();

  return actions.filter((action) => lowerText.includes(action));
}

function inferLocalTopic(assignment, keywords) {
  const firstSentence = assignment.split(/[.!?]/)[0]?.trim();

  if (firstSentence && firstSentence.length <= 110) {
    return firstSentence;
  }

  if (keywords.length) {
    return keywords.slice(0, 4).join(", ");
  }

  return "Academic assignment breakdown";
}

function buildRequiredTasks(actionWords) {
  const taskMap = {
    analyze: "Analyze the main issue using academic evidence",
    compare: "Compare the relevant ideas, cases, or approaches",
    contrast: "Contrast differences between the main concepts",
    define: "Define important terms before using them in the discussion",
    describe: "Describe the background and context clearly",
    discuss: "Discuss the topic from more than one academic perspective",
    evaluate: "Evaluate strengths, weaknesses, and implications",
    explain: "Explain how the key concepts connect to the assignment question",
    identify: "Identify the main requirements and research areas",
    justify: "Justify arguments with credible academic sources",
    propose: "Propose practical recommendations or solutions",
    recommend: "Recommend clear next steps based on the analysis",
    reflect: "Reflect on the meaning or impact of the topic",
    summarize: "Summarize the findings in a focused conclusion",
  };
  const tasks = actionWords.map((word) => taskMap[word]).filter(Boolean);

  return tasks.length
    ? [...new Set(tasks)]
    : [
        "Identify the assignment requirements",
        "Research the key concepts using credible sources",
        "Build a clear argument before drafting",
        "Write, reference, review, and proofread the final submission",
      ];
}

function toStringValue(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map(toStringValue).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|;|,/)
      .map(cleanListItem)
      .filter(Boolean);
  }

  return [];
}

function mapProviderError(error) {
  if (error.code === "ECONNABORTED") {
    return {
      status: 504,
      message: "The AI service took too long to respond. Please try again.",
      details: "Request timed out.",
    };
  }

  if (!error.response) {
    return {
      status: 502,
      message: "Could not reach the AI service. Check your internet connection and try again.",
      details: error.message,
    };
  }

  const status = error.response.status;
  const data = error.response.data;
  const apiError = typeof data?.error === "string" ? data.error : undefined;
  const nestedApiError = typeof data?.error?.message === "string" ? data.error.message : undefined;

  if (status === 401 || status === 403) {
    return mapAuthenticationError(error);
  }

  if (status === 404) {
    return {
      status: 502,
      message: "The configured AI model or endpoint was not found.",
      details: apiError || nestedApiError || "Model not found.",
    };
  }

  if (status === 429) {
    return {
      status: 429,
      message: "The AI service is rate-limited right now. Please wait a moment and try again.",
      details: apiError || nestedApiError || "Rate limit reached.",
    };
  }

  if ((apiError || nestedApiError || "").toLowerCase().includes("loading")) {
    return {
      status: 503,
      message: "The AI model is still loading. Please try again shortly.",
      details: apiError || nestedApiError,
    };
  }

  return {
    status: 502,
    message: "Failed to process the assignment with the AI service.",
    details: apiError || nestedApiError || data || error.message,
  };
}

function mapAuthenticationError(error) {
  const url = error.config?.url || "";
  const isGemini = url.includes("generativelanguage.googleapis.com");
  const isOpenAI = url.includes("api.openai.com");

  return {
    status: 502,
    message: isGemini
      ? "Gemini rejected the server API key. Check GEMINI_API_KEY in .env."
      : isOpenAI
        ? "OpenAI rejected the server API key. Check OPENAI_API_KEY in .env."
        : "Hugging Face rejected the server token. Check HF_TOKEN in .env.",
    details: "AI provider authentication failed.",
  };
}

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseSelect(table, query = "select=*") {
  const response = await axios.get(`${SUPABASE_REST_URL}/${table}?${query}`, {
    headers: supabaseHeaders(),
    timeout: 15000,
  });
  return response.data || [];
}

async function supabaseInsert(table, payload) {
  const response = await axios.post(`${SUPABASE_REST_URL}/${table}`, payload, {
    headers: supabaseHeaders({ Prefer: "return=representation" }),
    timeout: 15000,
  });
  return response.data || [];
}

async function supabasePatch(table, filter, payload) {
  const response = await axios.patch(`${SUPABASE_REST_URL}/${table}?${filter}`, payload, {
    headers: supabaseHeaders({ Prefer: "return=representation" }),
    timeout: 15000,
  });
  return response.data || [];
}

async function supabaseDelete(table, filter) {
  const response = await axios.delete(`${SUPABASE_REST_URL}/${table}?${filter}`, {
    headers: supabaseHeaders(),
    timeout: 15000,
  });
  return response.data;
}

async function requireSession(req, res) {
  if (!isSupabaseConfigured()) {
    res.status(503).json({ error: "Supabase is not configured on the server." });
    return null;
  }

  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    res.status(401).json({ error: "Authentication token is required." });
    return null;
  }

  try {
    const [session] = await supabaseSelect("app_sessions", `select=*,app_users(*)&token=eq.${encodeURIComponent(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);

    if (!session?.app_users) {
      res.status(401).json({ error: "Session expired or invalid." });
      return null;
    }

    return {
      session,
      user: session.app_users,
    };
  } catch (error) {
    res.status(500).json({ error: "Failed to verify session.", details: getSupabaseError(error) });
    return null;
  }
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
  const [session] = await supabaseInsert("app_sessions", {
    user_id: userId,
    token,
    expires_at: expiresAt,
  });
  return session;
}

async function ensureSettings(userId) {
  const [existing] = await supabaseSelect("user_settings", `select=*&user_id=eq.${userId}&limit=1`);

  if (existing) {
    return mapSettings(existing);
  }

  const [created] = await supabaseInsert("user_settings", {
    user_id: userId,
    academic_level: "University",
    referencing_style: "Harvard",
    language: "English",
    save_history: true,
    compact_mode: false,
  });

  return mapSettings(created);
}

async function getHistory(userId) {
  const rows = await supabaseSelect(
    "assignment_analyses",
    `select=*&user_id=eq.${userId}&order=created_at.desc&limit=8`
  );
  return rows.map(mapHistoryItem);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2:${salt}:${hash}`;
}

function verifyPassword(password, storedHash = "") {
  const [, salt, hash] = storedHash.split(":");

  if (!salt || !hash) {
    return false;
  }

  const attempted = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempted, "hex"));
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    institution: user.institution || "",
    course: user.course || "",
    createdAt: user.created_at,
  };
}

function mapSettings(row) {
  return {
    academicLevel: row.academic_level,
    referencingStyle: row.referencing_style,
    language: row.language,
    saveHistory: row.save_history,
    compactMode: row.compact_mode,
  };
}

function mapHistoryItem(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    assignment: row.assignment,
    breakdown: row.breakdown,
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

function getSupabaseError(error) {
  return error.response?.data?.message || error.response?.data || error.message;
}

function shouldUseLocalFallback(error) {
  if (error.code === "ECONNABORTED" || !error.response) {
    return true;
  }

  const status = error.response.status;
  const message = getErrorSummary(error).toLowerCase();

  if (status === 401 || status === 403) {
    return false;
  }

  return (
    status === 400 ||
    status === 404 ||
    status === 429 ||
    status === 503 ||
    message.includes("not supported") ||
    message.includes("not found") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("loading")
  );
}

function shouldTryNextProvider(error) {
  if (error.code === "ECONNABORTED" || !error.response) {
    return true;
  }

  const status = error.response.status;
  const message = getErrorSummary(error).toLowerCase();

  if (status === 401 || status === 403) {
    return false;
  }

  return (
    status === 400 ||
    status === 404 ||
    status === 429 ||
    status === 503 ||
    message.includes("not supported") ||
    message.includes("not found") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("loading") ||
    message.includes("model")
  );
}

function getErrorSummary(error) {
  const data = error.response?.data;

  if (typeof data?.error === "string") {
    return data.error;
  }

  if (typeof data?.error?.message === "string") {
    return data.error.message;
  }

  if (typeof data === "string") {
    return data;
  }

  return error.message || "Unknown error";
}

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found.",
  });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: "Invalid JSON request body.",
    });
  }

  return res.status(500).json({
    error: "Unexpected server error.",
  });
});

app.listen(PORT, () => {
  console.log(`Unpack.ai backend running on port ${PORT}`);
});
