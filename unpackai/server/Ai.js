import axios from "axios";
import { config } from "./config.js";

const { ai, limits } = config;

/* =====================================================================
   One definition of the breakdown shape. The prompt, the OpenAI schema,
   the Gemini schema and the parser are all generated from this list.
   ===================================================================== */

const FIELDS = [
  { key: "mainTopic", type: "string", hint: "short topic title" },
  { key: "keyConcepts", type: "list", hint: "concept" },
  { key: "keywords", type: "list", hint: "keyword" },
  { key: "requiredTasks", type: "list", hint: "task" },
  { key: "suggestedStructure", type: "list", hint: "section" },
  { key: "completionPlan", type: "list", hint: "step" },
  { key: "summary", type: "string", hint: "short student-friendly summary" },
];
const LIST_KEYS = FIELDS.filter((field) => field.type === "list").map((field) => field.key);

function exampleShape() {
  const shape = {};
  for (const field of FIELDS) {
    shape[field.key] = field.type === "list" ? [1, 2, 3].map((n) => `${field.hint} ${n}`) : field.hint;
  }
  return JSON.stringify(shape, null, 2);
}

function jsonSchema(dialect) {
  const t = (name) => (dialect === "gemini" ? name.toUpperCase() : name);
  const properties = {};

  for (const field of FIELDS) {
    properties[field.key] =
      field.type === "list" ? { type: t("array"), items: { type: t("string") } } : { type: t("string") };
  }

  const schema = { type: t("object"), properties, required: FIELDS.map((field) => field.key) };
  return dialect === "gemini" ? schema : { ...schema, additionalProperties: false };
}

export function buildPrompt(assignment) {
  return `${ai.persona}
${ai.guardrails}

Return ONLY valid JSON with this exact shape:
${exampleShape()}

Assignment:
${assignment}`.trim();
}

/* =====================================================================
   Providers
   ===================================================================== */

const PROVIDERS = {
  gemini: {
    isConfigured: () => Boolean(ai.gemini.apiKey),
    call: (prompt) =>
      axios.post(
        ai.gemini.url,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: jsonSchema("gemini"),
            temperature: ai.temperature,
            maxOutputTokens: ai.gemini.maxOutputTokens,
          },
        },
        { timeout: ai.timeoutMs, headers: { "x-goog-api-key": ai.gemini.apiKey, "Content-Type": "application/json" } },
      ),
    extract: (payload) => {
      const parts = payload?.candidates?.[0]?.content?.parts || [];
      return parts.map((part) => part?.text || "").filter(Boolean).join("\n").trim();
    },
  },

  openai: {
    isConfigured: () => Boolean(ai.openai.apiKey),
    call: (prompt) =>
      axios.post(
        ai.openai.url,
        {
          model: ai.openai.model,
          input: prompt,
          text: { format: { type: "json_schema", name: "assignment_breakdown", strict: true, schema: jsonSchema("openai") } },
          max_output_tokens: ai.openai.maxOutputTokens,
          store: false,
        },
        { timeout: ai.timeoutMs, headers: { Authorization: `Bearer ${ai.openai.apiKey}`, "Content-Type": "application/json" } },
      ),
    extract: (payload) => {
      if (typeof payload?.output_text === "string") return payload.output_text.trim();
      return asArray(payload?.output)
        .flatMap((item) => item?.content || [])
        .map((content) => content?.text || content?.output_text || "")
        .filter(Boolean)
        .join("\n")
        .trim();
    },
  },

  huggingface: {
    isConfigured: () => Boolean(ai.huggingface.apiKey),
    call: (prompt) =>
      axios.post(
        ai.huggingface.url,
        {
          inputs: prompt,
          parameters: { max_new_tokens: ai.huggingface.maxNewTokens, return_full_text: false },
          options: { wait_for_model: true },
        },
        { timeout: ai.timeoutMs, headers: { Authorization: `Bearer ${ai.huggingface.apiKey}`, "Content-Type": "application/json" } },
      ),
    extract: (payload) => {
      if (typeof payload === "string") return payload.trim();
      if (Array.isArray(payload)) {
        return payload.map((item) => item?.generated_text || item?.summary_text || "").filter(Boolean).join("\n").trim();
      }
      return String(payload?.generated_text || payload?.summary_text || "").trim();
    },
  },
};

const PROVIDER_ALIASES = { google: "gemini", googleai: "gemini" };

// Providers to try, in order. "auto" tries every configured one.
export function getProviderOrder() {
  const wanted = PROVIDER_ALIASES[ai.provider] || ai.provider;
  if (PROVIDERS[wanted]) return PROVIDERS[wanted].isConfigured() ? [wanted] : [];
  return Object.keys(PROVIDERS).filter((name) => PROVIDERS[name].isConfigured());
}

export const activeProvider = () => getProviderOrder()[0] || "local";

/* =====================================================================
   Running an analysis
   ===================================================================== */

export async function analyzeAssignment(assignment) {
  const prompt = buildPrompt(assignment);

  for (const provider of getProviderOrder()) {
    try {
      const response = await PROVIDERS[provider].call(prompt);
      const rawText = PROVIDERS[provider].extract(response.data);
      return normalizeBreakdown(rawText, assignment, provider);
    } catch (error) {
      error.provider = provider;
      if (!isRecoverable(error)) throw error;
      console.warn(`[ai] ${provider} failed, trying the next option: ${errorSummary(error)}`);
    }
  }

  // Nothing is configured, or every provider failed in a recoverable way.
  return createLocalBreakdown(assignment);
}

// Problems another provider (or the local outline) can work around.
// Bad credentials are not one of them: those should be fixed, not hidden.
function isRecoverable(error) {
  if (error.code === "ECONNABORTED" || !error.response) return true;
  const status = error.response.status;
  if (status === 401 || status === 403) return false;
  const message = errorSummary(error).toLowerCase();
  return (
    [400, 404, 429, 503].includes(status) ||
    ["not supported", "not found", "quota", "rate limit", "loading", "model"].some((phrase) => message.includes(phrase))
  );
}

export function errorSummary(error) {
  const data = error.response?.data;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.error?.message === "string") return data.error.message;
  if (typeof data === "string") return data;
  return error.message || "Unknown error";
}

// Maps a provider failure to a status and a message that is safe to show.
// The exact cause (bad key, wrong model...) goes to the server log only.
export function mapProviderError(error) {
  if (error.code === "ECONNABORTED") {
    return { status: 504, message: "The analysis took too long. Please try again." };
  }
  if (!error.response) {
    return { status: 502, message: "Could not reach the analysis service. Please try again shortly." };
  }

  const status = error.response.status;
  if (status === 401 || status === 403) {
    return { status: 502, message: "The analysis service is not set up correctly. Please try again later." };
  }
  if (status === 429) {
    return { status: 429, message: "The analysis service is busy right now. Wait a moment and try again." };
  }
  return { status: 502, message: "Something went wrong while analyzing the brief. Please try again." };
}

/* =====================================================================
   Turning model output into a breakdown
   ===================================================================== */

const asArray = (value) => (Array.isArray(value) ? value : []);

const toStringValue = (value) => (value == null ? "" : String(value).trim());

function toStringArray(value) {
  if (Array.isArray(value)) return value.map(toStringValue).filter(Boolean);
  if (typeof value === "string") return value.split(/\n|;|,/).map(cleanListItem).filter(Boolean);
  return [];
}

function cleanListItem(value) {
  return value.replace(/^[-*\d.)\s]+/, "").replace(/^["']|["']$/g, "").trim();
}

function emptyBreakdown() {
  const result = {};
  for (const field of FIELDS) result[field.key] = field.type === "list" ? [] : "";
  return result;
}

const hasContent = (breakdown) => Boolean(breakdown.mainTopic || breakdown.summary || LIST_KEYS.some((key) => breakdown[key].length));

function normalizeBreakdown(rawText, assignment, provider) {
  const parsed = parseJsonFromText(rawText);

  if (parsed) {
    const result = emptyBreakdown();
    for (const field of FIELDS) {
      result[field.key] = field.type === "list" ? toStringArray(parsed[field.key]) : toStringValue(parsed[field.key]);
    }
    if (hasContent(result)) return { ...result, provider };
    return createLocalBreakdown(assignment);
  }

  const trimmed = (rawText || "").trim();
  const looksCutOff = trimmed.startsWith("{") && !trimmed.endsWith("}");

  if (!trimmed || looksCutOff) return createLocalBreakdown(assignment);

  const result = parsePlainTextBreakdown(trimmed);
  return hasContent(result) ? { ...result, provider } : createLocalBreakdown(assignment);
}

function parseJsonFromText(text) {
  if (!text) return null;

  const trimmed = text.trim();
  const candidates = [trimmed, trimmed.replace(/^```json/i, "").replace(/```$/i, "").trim()];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/* ---------- Plain-text answers (smaller models ignore the JSON request) ---------- */

const SECTION_PATTERNS = [
  ["mainTopic", /main\s*topic|topic/i],
  ["keyConcepts", /key\s*concepts?|concepts?/i],
  ["keywords", /important\s*keywords?|keywords?/i],
  ["requiredTasks", /required\s*tasks?|tasks?|requirements?/i],
  ["suggestedStructure", /suggested\s*structure|structure|outline/i],
  ["completionPlan", /completion\s*plan|step-by-step|steps?|roadmap/i],
  ["summary", /summary|overview/i],
];

function parsePlainTextBreakdown(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const result = { ...emptyBreakdown(), summary: lines.slice(0, 3).join(" ") };
  let activeKey = null;

  const add = (key, value) => {
    if (!value) return;
    if (LIST_KEYS.includes(key)) result[key].push(value);
    else result[key] = result[key] ? `${result[key]} ${value}` : value;
  };

  for (const line of lines) {
    const heading = SECTION_PATTERNS.find(([, pattern]) => pattern.test(line.replace(/[:\-].*$/, "")));
    if (heading && /[:\-]?\s*$/.test(line.replace(heading[1], ""))) {
      activeKey = heading[0];
      continue;
    }

    const inline = SECTION_PATTERNS.find(([, pattern]) => pattern.test(line.split(/[:\-]/)[0]));
    if (inline && /[:\-]/.test(line)) {
      activeKey = inline[0];
      add(activeKey, cleanListItem(line.split(/[:\-]/).slice(1).join(":")));
      continue;
    }

    if (activeKey) add(activeKey, cleanListItem(line));
  }

  if (!result.mainTopic) result.mainTopic = (lines.find((line) => line.length > 10) || "").slice(0, 90);
  if (!result.keywords.length) result.keywords = inferKeywords(text);
  return result;
}

/* =====================================================================
   Local outline, used only when no AI provider can answer.
   The response is marked provider: "local" so the UI can say so.
   ===================================================================== */

const FALLBACK = {
  concepts: ["Academic research", "Assignment planning", "Structured writing"],
  topic: "Academic assignment breakdown",
  summary:
    "Approach this assignment by identifying the topic, researching the key concepts, and following a clear academic structure.",
  tasks: [
    "Identify the assignment requirements",
    "Research the key concepts using credible sources",
    "Build a clear argument before drafting",
    "Write, reference, review, and proofread the final submission",
  ],
  structure: [
    "Introduction: define the topic and explain the assignment focus",
    "Context and background: describe the main academic issues",
    "Analysis: discuss key concepts, evidence, and examples",
    "Evaluation: compare strengths, limitations, and ethical concerns",
    "Conclusion and recommendations: summarize findings and next steps",
    "References: list all sources in the required referencing style",
  ],
  plan: [
    "Rewrite the question in simple language and highlight instruction words",
    "Create a research list from the extracted keywords and key concepts",
    "Find credible academic sources for each major section",
    "Draft the structure before writing full paragraphs",
    "Review the draft against the assignment brief and marking criteria",
    "Proofread, format references, and prepare the final submission",
  ],
};

const ACTION_TASKS = {
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

const STOP_WORDS = new Set(
  "about after also and are assignment before from have into must that the their this with your".split(" "),
);

function inferKeywords(text) {
  const counts = new Map();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,}/g) || []) {
    if (!STOP_WORDS.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.replace(/^\w/, (letter) => letter.toUpperCase()));
}

export function createLocalBreakdown(assignment) {
  const keywords = inferKeywords(assignment);
  const lower = assignment.toLowerCase();
  const tasks = Object.keys(ACTION_TASKS).filter((action) => lower.includes(action)).map((action) => ACTION_TASKS[action]);
  const firstSentence = assignment.split(/[.!?]/)[0]?.trim();
  const topic =
    firstSentence && firstSentence.length <= 110 ? firstSentence : keywords.slice(0, 4).join(", ") || FALLBACK.topic;

  return {
    mainTopic: topic,
    keyConcepts: keywords.length ? keywords.slice(0, 5) : FALLBACK.concepts,
    keywords,
    requiredTasks: tasks.length ? tasks : FALLBACK.tasks,
    suggestedStructure: FALLBACK.structure,
    completionPlan: FALLBACK.plan,
    summary: firstSentence?.slice(0, limits.maxBriefChars) || FALLBACK.summary,
    provider: "local",
  };
}