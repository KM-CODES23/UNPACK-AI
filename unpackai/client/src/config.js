// Single source of truth for everything that used to be hardcoded.
// Every value can be overridden with a VITE_* variable (see .env.example),
// so you can change branding, limits, dropdown options and feature flags
// without touching component code.

const env = import.meta.env;

const list = (value, fallback) => {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
};

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const flag = (value, fallback = true) => {
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "off", "no"].includes(String(value).toLowerCase());
};

const prefix = env.VITE_STORAGE_PREFIX || "unpackai";

const options = {
  academicLevels: list(env.VITE_ACADEMIC_LEVELS, ["College", "University", "Honours", "Masters"]),
  referencingStyles: list(env.VITE_REFERENCING_STYLES, ["Harvard", "APA", "MLA", "IEEE", "Chicago"]),
  languages: list(env.VITE_LANGUAGES, ["English", "Zulu", "Xhosa", "Afrikaans", "Sesotho"]),
};

export const config = {
  brand: {
    name: env.VITE_APP_NAME || "Unpack.ai",
    tagline: env.VITE_APP_TAGLINE || "Assignment briefs, broken down",
  },

  // Empty string = same origin as the page (works behind a reverse proxy).
  // Set VITE_API_BASE_URL for local dev, e.g. http://localhost:5000
  apiBaseUrl: (env.VITE_API_BASE_URL || "").replace(/\/+$/, ""),

  storageKeys: {
    history: `${prefix}.analysisHistory.v1`,
    settings: `${prefix}.settings.v1`,
    notifications: `${prefix}.notifications.v1`,
    session: `${prefix}.session.v2`,
  },
  // Removed on load. The old build kept accounts, including plain-text
  // passwords, in the browser. Those are wiped so they don't linger.
  legacyStorageKeys: [`${prefix}.users.v1`, `${prefix}.session.v1`],

  limits: {
    maxBriefChars: number(env.VITE_MAX_BRIEF_CHARS, 12000),
    minBriefChars: number(env.VITE_MIN_BRIEF_CHARS, 10),
    minPasswordLength: number(env.VITE_MIN_PASSWORD_LENGTH, 6),
    historyItems: number(env.VITE_HISTORY_ITEMS, 8),
    notificationItems: number(env.VITE_NOTIFICATION_ITEMS, 20),
    toastMs: number(env.VITE_TOAST_MS, 2800),
  },

  documents: {
    extensions: list(env.VITE_DOCUMENT_TYPES, ["txt", "md", "pdf", "docx", "csv"]),
  },

  options,

  defaultSettings: {
    academicLevel: env.VITE_DEFAULT_LEVEL || "University",
    referencingStyle: env.VITE_DEFAULT_REFERENCING || "Harvard",
    language: env.VITE_DEFAULT_LANGUAGE || "English",
    saveHistory: true,
    compactMode: false,
  },

  features: {
    googleLogin: flag(env.VITE_ENABLE_GOOGLE_LOGIN),
    phoneLogin: flag(env.VITE_ENABLE_PHONE_LOGIN),
  },

  // Leave VITE_SAMPLE_BRIEF empty to hide the "Try an example" button.
  sampleBrief:
    env.VITE_SAMPLE_BRIEF ??
    "Discuss how artificial intelligence can improve academic support for South African university students. Your essay should identify the main challenges students face, explain relevant AI tools, evaluate ethical concerns, and propose practical recommendations. Use at least five academic sources and follow Harvard referencing.",

  copy: {
    auth: {
      headline: "Turn any assignment brief into a plan you can start on.",
      subline:
        "Paste your brief or upload the document. You get the topic, the tasks, a suggested structure and a step-by-step plan.",
      phonePlaceholder: "Phone number with country code",
    },
    workspace: {
      greeting: (name) => `Hi ${name}`,
      briefLabel: "Your assignment brief",
      briefPlaceholder: "Paste your assignment question or brief here",
      analyze: "Analyze brief",
    },
    working: {
      title: "Reading your brief",
      text: "Pulling out the topic, the tasks and a plan.",
    },
    empty: {
      title: "Your breakdown will show up here",
      text: "It takes a few seconds.",
      steps: [
        "Paste your brief, or upload the document.",
        "Select Analyze brief.",
        "Work through the task list and the plan.",
      ],
    },
    sections: {
      concepts: "Key concepts",
      keywords: "Keywords",
      tasks: "What you need to do",
      structure: "Suggested structure",
      plan: "Plan",
    },
    history: {
      title: "Recent breakdowns",
      empty: "Breakdowns you run are saved here.",
    },
    local: {
      title: "This is a basic outline",
      text: "The analysis service wasn't available, so this outline is built from the words in your brief. Run it again in a few minutes for a full breakdown.",
    },
    errors: {
      network: "Can't reach the server. Check your connection and try again.",
      generic: "Something went wrong. Try again.",
      analyze: "Could not analyze the brief.",
      readDocument: "Could not read that document.",
      briefTooShort: (min) => `Paste at least ${min} characters of your brief.`,
      fileType: (types) => `Upload one of these file types: ${types.join(", ").toUpperCase()}.`,
      signupFields: (min) => `Enter your name, an email and a password of at least ${min} characters.`,
      googleUnavailable: "Google sign-in isn't available right now.",
    },
  },
};

// The server owns the dropdown options, limits and sign-in methods, so they
// only ever need changing in one place (its .env). Values are applied in
// place so every module that already imported `config` sees them.
export function applyRemoteConfig(remote) {
  if (!remote || typeof remote !== "object") return;

  if (remote.brand?.name) config.brand.name = remote.brand.name;
  if (remote.brand?.tagline) config.brand.tagline = remote.brand.tagline;

  for (const key of Object.keys(config.options)) {
    const incoming = remote.options?.[key];
    if (Array.isArray(incoming) && incoming.length) config.options[key] = incoming;
  }

  for (const key of Object.keys(config.limits)) {
    const incoming = remote.limits?.[key];
    if (Number.isFinite(incoming) && incoming > 0) config.limits[key] = incoming;
  }

  const settings = remote.defaults?.settings;
  if (settings && typeof settings === "object") {
    for (const key of Object.keys(config.defaultSettings)) {
      if (typeof settings[key] === typeof config.defaultSettings[key]) config.defaultSettings[key] = settings[key];
    }
  }

  const extensions = remote.documents?.extensions;
  if (Array.isArray(extensions) && extensions.length) config.documents.extensions = extensions;

  // A sign-in method shows only if the server offers it AND it isn't switched off here.
  if (remote.features) {
    config.features.googleLogin = config.features.googleLogin && Boolean(remote.features.googleLogin);
    config.features.phoneLogin = config.features.phoneLogin && Boolean(remote.features.phoneLogin);
  }
}