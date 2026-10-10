import { config } from "./config";

const { apiBaseUrl, copy } = config;

/* ---------- API ---------- */

export async function apiRequest(path, { token, headers, body, ...options } = {}) {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...options,
      body,
      headers: {
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
    });
  } catch {
    const networkError = new Error(copy.errors.network);
    networkError.network = true;
    throw networkError;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestError = new Error(data.error || copy.errors.generic);
    requestError.status = response.status;
    throw requestError;
  }

  return data;
}

/* ---------- Browser storage (never throws) ---------- */

export function loadJson(key, fallback) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "null");
    return stored ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Storage can be full or blocked (private mode). The app keeps working.
  }
}

export function removeKeys(keys) {
  try {
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

/* ---------- Small utilities ---------- */

// crypto.randomUUID only exists on secure pages (https or localhost). Opening
// the dev server through its Network address (http://192.168...) would crash.
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const asArray = (value) => (Array.isArray(value) ? value : []);

export function acceptAttribute(extensions) {
  return extensions.map((ext) => `.${ext}`).join(",");
}

export function hasAllowedExtension(fileName, extensions) {
  const ext = String(fileName).split(".").pop()?.toLowerCase();
  return extensions.includes(ext);
}

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function initials(name = "") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

// Derives a stable avatar colour from the name instead of hardcoding one.
export function nameToHue(name = "") {
  let hue = 0;
  for (const char of name) hue = (hue * 31 + char.charCodeAt(0)) % 360;
  return hue;
}

export function formatDate(value) {
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

export function slugify(text = "") {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/* ---------- Analysis helpers ---------- */

export function buildContextualAssignment(assignment, settings) {
  return `${assignment}

Student context:
- Academic level: ${settings.academicLevel}
- Referencing style: ${settings.referencingStyle}
- Preferred output language: ${settings.language}`;
}

export function createMarkdown(breakdown) {
  const { sections } = copy;
  const list = (items = []) => asArray(items).map((item) => `- ${item}`).join("\n");

  return `# ${breakdown.mainTopic || config.brand.name}
${breakdown.provider ? `\nGenerated with ${breakdown.provider}\n` : ""}
${breakdown.summary || ""}

## ${sections.concepts}
${list(breakdown.keyConcepts)}

## ${sections.keywords}
${list(breakdown.keywords)}

## ${sections.tasks}
${list(breakdown.requiredTasks)}

## ${sections.structure}
${list(breakdown.suggestedStructure)}

## ${sections.plan}
${list(breakdown.completionPlan)}
`;
}