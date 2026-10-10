import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bell, Check, Copy, Download, FileUp, Link2, Loader2, LogOut, Phone, RotateCcw, Trash2, X } from "lucide-react";
import logo from "./assets/unpack-logo.jpeg";
import { applyRemoteConfig, config } from "./config";
import {
  acceptAttribute,
  apiRequest,
  asArray,
  buildContextualAssignment,
  countWords,
  createMarkdown,
  formatDate,
  hasAllowedExtension,
  initials,
  loadJson,
  nameToHue,
  removeKeys,
  saveJson,
  slugify,
  uid,
} from "./lib";
import "./styles.css";

const { brand, copy, defaultSettings, documents, features, limits, options, sampleBrief, storageKeys } = config;

const NAV = [
  { id: "workspace", label: "Workspace" },
  { id: "profile", label: "Profile" },
  { id: "settings", label: "Settings" },
];

function App() {
  const [session, setSession] = useState(() => loadJson(storageKeys.session, null));
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...loadJson(storageKeys.settings, {}) }));
  const [history, setHistory] = useState(() => asArray(loadJson(storageKeys.history, [])));
  const [notifications, setNotifications] = useState(() => asArray(loadJson(storageKeys.notifications, [])));
  const [assignment, setAssignment] = useState("");
  const [breakdown, setBreakdown] = useState(null);
  const [resultId, setResultId] = useState(0);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [health, setHealth] = useState({ state: "checking", provider: "" });
  const [view, setView] = useState("workspace");
  const [showNotifications, setShowNotifications] = useState(false);
  const [toast, setToast] = useState(null);
  const [, setConfigVersion] = useState(0);
  const [booting, setBooting] = useState(Boolean(session?.token && !session?.user));
  const toastTimer = useRef(null);

  const token = session?.token;
  const user = session?.user;
  const unreadCount = notifications.filter((item) => !item.read).length;

  /* ---------- persistence ---------- */
  useEffect(() => saveJson(storageKeys.session, session), [session]);
  useEffect(() => saveJson(storageKeys.settings, settings), [settings]);
  useEffect(() => saveJson(storageKeys.history, history.slice(0, limits.historyItems)), [history]);
  useEffect(() => saveJson(storageKeys.notifications, notifications.slice(0, limits.notificationItems)), [notifications]);

  /* ---------- startup ---------- */
  useEffect(() => {
    removeKeys(config.legacyStorageKeys);
    loadRemoteConfig();
    checkHealth();
    restoreSession();

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    if (accessToken) {
      handleOAuthToken(accessToken);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showNotifications) return undefined;
    const onKey = (event) => event.key === "Escape" && setShowNotifications(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNotifications]);

  /* ---------- small helpers ---------- */
  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), limits.toastMs);
  }, []);

  function addNotification(title, message, type = "info") {
    setNotifications((items) =>
      [{ id: uid(), title, message, type, read: false, createdAt: new Date().toISOString() }, ...items].slice(
        0,
        limits.notificationItems,
      ),
    );
  }

  function showResult(data) {
    setBreakdown(data);
    setResultId((value) => value + 1);
  }

  function applyAccount(data) {
    setSettings({ ...defaultSettings, ...(data.settings || {}) });
    setHistory(asArray(data.history));
  }

  function signIn(data) {
    setSession({ token: data.token, user: data.user });
    applyAccount(data);
    addNotification("Signed in", `Welcome back, ${data.user.name}.`);
    showToast(data.databaseWarning || "Signed in");
  }

  /* ---------- server status + session ---------- */
  async function loadRemoteConfig() {
    try {
      applyRemoteConfig(await apiRequest("/api/config"));
      document.title = brand.name;
      setConfigVersion((value) => value + 1);
    } catch {
      // The defaults from config.js and .env stay in place.
    }
  }

  async function checkHealth() {
    setHealth((current) => ({ ...current, state: "checking" }));
    try {
      const data = await apiRequest("/health");
      setHealth({ state: "online", provider: data.provider || "", data });
    } catch {
      setHealth({ state: "offline", provider: "" });
    }
  }

  async function restoreSession() {
    if (!session?.token) return;
    try {
      const data = await apiRequest("/api/me", { token: session.token });
      setSession((current) => (current ? { ...current, user: data.user } : current));
      if (data.settings) setSettings({ ...defaultSettings, ...data.settings });
      if (data.history) setHistory(asArray(data.history));
    } catch (requestError) {
      // Only drop the session when the server says it's invalid.
      // If the server is just unreachable, keep the cached user.
      if (requestError.status === 401 || requestError.status === 403) setSession(null);
    } finally {
      setBooting(false);
    }
  }

  /* ---------- auth ---------- */
  async function handleOAuthToken(accessToken) {
    try {
      signIn(await apiRequest("/api/auth/supabase-session", { method: "POST", body: JSON.stringify({ accessToken }) }));
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  async function handleLogin({ email, password }) {
    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password: password.trim() }),
      });
      signIn(data);
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  async function handleSignup({ name, email, password }) {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanName || !cleanEmail || cleanPassword.length < limits.minPasswordLength) {
      showToast(copy.errors.signupFields(limits.minPasswordLength), "error");
      return;
    }

    try {
      const data = await apiRequest("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name: cleanName, email: cleanEmail, password: cleanPassword }),
      });
      signIn(data);
      addNotification(`Welcome to ${brand.name}`, "Your account is ready.");
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  async function handleGoogle() {
    try {
      const data = await apiRequest("/api/auth/providers");
      if (!data.googleUrl) {
        showToast(copy.errors.googleUnavailable, "error");
        return;
      }
      window.location.href = data.googleUrl;
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  async function handlePhoneStart(phone) {
    try {
      await apiRequest("/api/auth/phone/start", { method: "POST", body: JSON.stringify({ phone }) });
      showToast("Verification code sent");
      return true;
    } catch (requestError) {
      showToast(requestError.message, "error");
      return false;
    }
  }

  async function handlePhoneVerify(phone, code) {
    try {
      signIn(await apiRequest("/api/auth/phone/verify", { method: "POST", body: JSON.stringify({ phone, token: code }) }));
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  function logout() {
    if (token) apiRequest("/api/auth/logout", { method: "POST", token }).catch(() => {});
    setSession(null);
    setHistory([]);
    setNotifications([]);
    setAssignment("");
    setBreakdown(null);
    setError("");
    setShowNotifications(false);
    setView("workspace");
    showToast("Signed out");
  }

  /* ---------- analysis ---------- */
  async function analyze(event) {
    event?.preventDefault();
    const trimmed = assignment.trim();

    if (trimmed.length < limits.minBriefChars) {
      setError(copy.errors.briefTooShort(limits.minBriefChars));
      setBreakdown(null);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const data = await apiRequest("/api/breakdown", {
        method: "POST",
        token,
        body: JSON.stringify({ assignment: buildContextualAssignment(trimmed, settings) }),
      });
      showResult(data);

      if (settings.saveHistory) {
        const item = { id: uid(), createdAt: new Date().toISOString(), assignment: trimmed, breakdown: data };
        setHistory((items) => [item, ...items].slice(0, limits.historyItems));

        if (token) {
          apiRequest("/api/history", { method: "POST", token, body: JSON.stringify({ assignment: trimmed, breakdown: data }) })
            .then((saved) => {
              if (saved.item) {
                setHistory((items) => [saved.item, ...items.filter((entry) => entry.id !== item.id)].slice(0, limits.historyItems));
              }
            })
            .catch(() => {});
        }
      }

      addNotification("Breakdown ready", data.mainTopic || "Your brief was analyzed.");
    } catch (requestError) {
      if (requestError.status === 401) setSession(null);
      setBreakdown(null);
      setError(requestError.message || copy.errors.analyze);
      addNotification("Analysis failed", requestError.message, "error");
    } finally {
      setIsLoading(false);
    }
  }

  function clearWorkspace() {
    setAssignment("");
    setBreakdown(null);
    setError("");
  }

  function loadHistoryItem(item) {
    setAssignment(item.assignment);
    showResult(item.breakdown);
    setError("");
    setView("workspace");
  }

  function clearHistory() {
    setHistory([]);
    if (token) apiRequest("/api/history", { method: "DELETE", token }).catch(() => {});
    showToast("History cleared");
  }

  /* ---------- profile + settings ---------- */
  async function saveProfile(form) {
    try {
      const data = await apiRequest("/api/profile", { method: "PUT", token, body: JSON.stringify(form) });
      setSession((current) => ({ ...current, user: data.user }));
      showToast("Profile saved");
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  async function saveSettings(form) {
    try {
      const data = await apiRequest("/api/settings", { method: "PUT", token, body: JSON.stringify(form) });
      setSettings({ ...defaultSettings, ...data.settings });
      showToast("Settings saved");
    } catch (requestError) {
      showToast(requestError.message, "error");
    }
  }

  /* ---------- notifications ---------- */
  function toggleNotifications() {
    setShowNotifications((open) => !open);
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
  }

  /* ---------- render ---------- */
  if (booting) {
    return (
      <div className="splash" role="status">
        <Loader2 className="spin" size={24} aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthScreen
          onGoogle={handleGoogle}
          onLogin={handleLogin}
          onPhoneStart={handlePhoneStart}
          onPhoneVerify={handlePhoneVerify}
          onSignup={handleSignup}
        />
        <Toast toast={toast} />
      </>
    );
  }

  return (
    <div className={`app${settings.compactMode ? " is-compact" : ""}`}>
      <Header
        health={health}
        notifications={notifications}
        onClearNotifications={() => setNotifications([])}
        onCloseNotifications={() => setShowNotifications(false)}
        onNavigate={setView}
        onRefreshHealth={checkHealth}
        onToggleNotifications={toggleNotifications}
        showNotifications={showNotifications}
        unreadCount={unreadCount}
        user={user}
        view={view}
      />

      <main className="page">
        {view === "workspace" ? (
          <Workspace
            assignment={assignment}
            breakdown={breakdown}
            error={error}
            history={history}
            isLoading={isLoading}
            onAnalyze={analyze}
            onChange={setAssignment}
            onClear={clearWorkspace}
            onClearHistory={clearHistory}
            onLoadHistory={loadHistoryItem}
            onToast={showToast}
            resultId={resultId}
            token={token}
            user={user}
          />
        ) : null}
        {view === "profile" ? <ProfilePage history={history} onLogout={logout} onSave={saveProfile} user={user} /> : null}
        {view === "settings" ? <SettingsPage health={health} onRefreshHealth={checkHealth} onSave={saveSettings} settings={settings} /> : null}
      </main>

      <Toast toast={toast} />
    </div>
  );
}

/* =====================================================================
   Layout
   ===================================================================== */

function Logo({ size = 40 }) {
  return (
    <span className="logo" style={{ width: size, height: size }}>
      <img alt={brand.name} src={logo} />
    </span>
  );
}

function Header({
  health,
  notifications,
  onClearNotifications,
  onCloseNotifications,
  onNavigate,
  onRefreshHealth,
  onToggleNotifications,
  showNotifications,
  unreadCount,
  user,
  view,
}) {
  const offline = health.state === "offline";

  return (
    <header className="header">
      <div className="header-inner">
        <div className="brand">
          <Logo />
          <div>
            <p className="brand-name">{brand.name}</p>
            <p className="brand-tagline">{brand.tagline}</p>
          </div>
        </div>

        <nav aria-label="Main" className="nav">
          {NAV.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className="nav-link"
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-tools">
          <button
            className={`status status-${health.state}`}
            onClick={onRefreshHealth}
            title={offline ? "Server unreachable. Select to retry." : health.state === "checking" ? "Connecting" : "Connected"}
            type="button"
          >
            <span aria-hidden="true" className="status-dot" />
            <span className={offline ? "" : "sr-only"}>
              {offline ? "Server offline, retry" : health.state === "checking" ? "Connecting" : "Connected"}
            </span>
          </button>

          <div className="popover-anchor">
            <button
              aria-expanded={showNotifications}
              aria-label="Notifications"
              className="icon-btn"
              onClick={onToggleNotifications}
              type="button"
            >
              <Bell size={18} />
              {unreadCount ? <span className="badge">{unreadCount}</span> : null}
            </button>
            {showNotifications ? (
              <NotificationsPanel items={notifications} onClear={onClearNotifications} onClose={onCloseNotifications} />
            ) : null}
          </div>

          <button aria-label="Open profile" className="avatar-btn" onClick={() => onNavigate("profile")} type="button">
            <Avatar name={user.name} size={32} />
            <span className="avatar-name">{user.name}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function NotificationsPanel({ items, onClear, onClose }) {
  return (
    <div className="popover" role="dialog" aria-label="Notifications">
      <div className="popover-head">
        <h2>Notifications</h2>
        <button aria-label="Close notifications" className="icon-btn icon-btn-sm" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>
      {items.length ? (
        <ul className="notice-list">
          {items.map((item) => (
            <li className={`notice${item.type === "error" ? " is-error" : ""}`} key={item.id}>
              <p className="notice-title">{item.title}</p>
              <p className="notice-text">{item.message}</p>
              <p className="notice-time">{formatDate(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing new.</p>
      )}
      {items.length ? (
        <button className="btn btn-quiet btn-sm" onClick={onClear} type="button">
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function Avatar({ name, size = 40 }) {
  return (
    <span
      aria-hidden="true"
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${nameToHue(name)} 42% 36%)` }}
    >
      {initials(name)}
    </span>
  );
}

function Toast({ toast }) {
  return (
    <div aria-live="polite" className="toast-region" role="status">
      {toast ? <div className={`toast${toast.type === "error" ? " is-error" : ""}`}>{toast.message}</div> : null}
    </div>
  );
}

/* =====================================================================
   Sign in
   ===================================================================== */

function AuthScreen({ onGoogle, onLogin, onPhoneStart, onPhoneVerify, onSignup }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", code: "" });
  const [phoneStage, setPhoneStage] = useState("number");
  const [busy, setBusy] = useState(false);

  const setField = (field) => (event) => setForm((state) => ({ ...state, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    await (mode === "signup" ? onSignup(form) : onLogin(form));
    setBusy(false);
  }

  async function submitPhone() {
    setBusy(true);
    if (phoneStage === "number") {
      if (await onPhoneStart(form.phone)) setPhoneStage("code");
    } else {
      await onPhoneVerify(form.phone, form.code);
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <section className="auth-intro">
        <Logo size={56} />
        <h1>{copy.auth.headline}</h1>
        <p>{copy.auth.subline}</p>
      </section>

      <section className="auth-panel">
        <div aria-label="Account" className="segmented" role="tablist">
          <button aria-selected={mode === "login"} onClick={() => setMode("login")} role="tab" type="button">
            Log in
          </button>
          <button aria-selected={mode === "signup"} onClick={() => setMode("signup")} role="tab" type="button">
            Sign up
          </button>
        </div>

        <form className="stack" onSubmit={submit}>
          {mode === "signup" ? <Field autoComplete="name" label="Full name" onChange={setField("name")} value={form.name} /> : null}
          <Field autoComplete="email" label="Email" onChange={setField("email")} type="email" value={form.email} />
          <Field
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            label="Password"
            onChange={setField("password")}
            type="password"
            value={form.password}
          />
          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? <Loader2 className="spin" size={16} /> : null}
            {mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        {features.googleLogin || features.phoneLogin ? <p className="divider">or</p> : null}

        <div className="stack">
          {features.googleLogin ? (
            <button className="btn btn-outline btn-block" onClick={onGoogle} type="button">
              Continue with Google
            </button>
          ) : null}

          {features.phoneLogin ? (
            <details className="disclosure">
              <summary>Use a phone number</summary>
              <div className="stack">
                <div className="row">
                  <input
                    aria-label="Phone number"
                    autoComplete="tel"
                    className="input"
                    onChange={setField("phone")}
                    placeholder={copy.auth.phonePlaceholder}
                    type="tel"
                    value={form.phone}
                  />
                  <button className="btn btn-outline" disabled={busy || !form.phone.trim()} onClick={submitPhone} type="button">
                    <Phone size={16} />
                    {phoneStage === "number" ? "Send code" : "Verify"}
                  </button>
                </div>
                {phoneStage === "code" ? (
                  <input
                    aria-label="Verification code"
                    autoComplete="one-time-code"
                    className="input"
                    inputMode="numeric"
                    onChange={setField("code")}
                    placeholder="Code from your SMS"
                    value={form.code}
                  />
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* =====================================================================
   Workspace
   ===================================================================== */

function Workspace({
  assignment,
  breakdown,
  error,
  history,
  isLoading,
  onAnalyze,
  onChange,
  onClear,
  onClearHistory,
  onLoadHistory,
  onToast,
  resultId,
  token,
  user,
}) {
  return (
    <div className="workspace">
      <aside className="brief">
        <BriefForm
          assignment={assignment}
          error={error}
          isLoading={isLoading}
          onAnalyze={onAnalyze}
          onChange={onChange}
          onClear={onClear}
          onToast={onToast}
          token={token}
          user={user}
        />
        <History history={history} onClear={onClearHistory} onLoad={onLoadHistory} />
      </aside>

      <section aria-live="polite" className="result">
        {isLoading ? <Working /> : breakdown ? <Breakdown breakdown={breakdown} key={resultId} onRetry={onAnalyze} onToast={onToast} /> : <EmptyState />}
      </section>
    </div>
  );
}

function BriefForm({ assignment, error, isLoading, onAnalyze, onChange, onClear, onToast, token, user }) {
  const [linkUrl, setLinkUrl] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const words = countWords(assignment);
  const firstName = (user.name || "").split(" ")[0];

  async function handleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!hasAllowedExtension(file.name, documents.extensions)) {
      onToast(copy.errors.fileType(documents.extensions), "error");
      return;
    }

    setIsImporting(true);
    try {
      const body = new FormData();
      body.append("document", file);
      const data = await apiRequest("/api/documents/extract", { method: "POST", token, body });
      onChange(data.text || "");
      onToast(`${data.name || file.name} imported`);
    } catch (requestError) {
      onToast(requestError.message || copy.errors.readDocument, "error");
    } finally {
      setIsImporting(false);
    }
  }

  async function importLink() {
    if (!linkUrl.trim()) {
      onToast("Paste a public document link first", "error");
      return;
    }
    setIsImporting(true);
    try {
      const data = await apiRequest("/api/documents/import-url", { method: "POST", token, body: JSON.stringify({ url: linkUrl.trim() }) });
      onChange(data.text || "");
      setLinkUrl("");
      onToast(`${data.name || "Document"} imported`);
    } catch (requestError) {
      onToast(requestError.message || copy.errors.readDocument, "error");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <form className="brief-form" onSubmit={onAnalyze}>
      <p className="greeting">{copy.workspace.greeting(firstName)}</p>

      <div className="label-row">
        <label htmlFor="assignment">{copy.workspace.briefLabel}</label>
        <span className="count">{words} words</span>
      </div>
      <textarea
        className="textarea"
        id="assignment"
        maxLength={limits.maxBriefChars}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onAnalyze(event);
        }}
        placeholder={copy.workspace.briefPlaceholder}
        rows={12}
        value={assignment}
      />

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button className="btn btn-primary" disabled={isLoading || isImporting} type="submit">
          {isLoading ? <Loader2 className="spin" size={16} /> : null}
          {copy.workspace.analyze}
        </button>
        <label className="btn btn-outline">
          {isImporting ? <Loader2 className="spin" size={16} /> : <FileUp size={16} />}
          Upload file
          <input accept={acceptAttribute(documents.extensions)} className="sr-only" onChange={handleFile} type="file" />
        </label>
        {sampleBrief ? (
          <button className="btn btn-quiet" onClick={() => onChange(sampleBrief)} type="button">
            Try an example
          </button>
        ) : null}
        <button aria-label="Clear brief and results" className="icon-btn" onClick={onClear} title="Clear" type="button">
          <Trash2 size={18} />
        </button>
      </div>

      <details className="disclosure">
        <summary>
          <Link2 size={15} />
          Import from a link
        </summary>
        <div className="row">
          <input
            aria-label="Document link"
            className="input"
            onChange={(event) => setLinkUrl(event.target.value)}
            placeholder="Public Google Drive, OneDrive or PDF link"
            type="url"
            value={linkUrl}
          />
          <button className="btn btn-outline" disabled={isImporting} onClick={importLink} type="button">
            Import
          </button>
        </div>
      </details>
    </form>
  );
}

function History({ history, onClear, onLoad }) {
  return (
    <section className="history">
      <div className="label-row">
        <h2>{copy.history.title}</h2>
        {history.length ? (
          <button className="link-btn" onClick={onClear} type="button">
            Clear
          </button>
        ) : null}
      </div>
      {history.length ? (
        <ul className="history-list">
          {history.map((item) => (
            <li key={item.id}>
              <button className="history-item" onClick={() => onLoad(item)} type="button">
                <span className="history-title">{item.breakdown?.mainTopic || item.assignment}</span>
                <span className="history-time">{formatDate(item.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{copy.history.empty}</p>
      )}
    </section>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h1>{copy.empty.title}</h1>
      <p className="lede">{copy.empty.text}</p>
      <ol className="steps">
        {copy.empty.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function Working() {
  return (
    <div className="empty" role="status">
      <h1>{copy.working.title}</h1>
      <p className="lede">{copy.working.text}</p>
      <div aria-hidden="true" className="skeleton">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

/* =====================================================================
   Breakdown
   ===================================================================== */

function Breakdown({ breakdown, onRetry, onToast }) {
  const { sections } = copy;

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(createMarkdown(breakdown));
      onToast("Copied to clipboard");
    } catch {
      onToast("Copying isn't allowed in this browser", "error");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([createMarkdown(breakdown)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(breakdown.mainTopic) || slugify(brand.name) || "breakdown"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const concepts = asArray(breakdown.keyConcepts);
  const keywords = asArray(breakdown.keywords);
  const tasks = asArray(breakdown.requiredTasks);
  const structure = asArray(breakdown.suggestedStructure);
  const plan = asArray(breakdown.completionPlan);

  return (
    <article className="doc">
      <header className="doc-head">
        <h1>
          <span className="mark sweep">{breakdown.mainTopic || "Untitled assignment"}</span>
        </h1>
        <div className="doc-actions">
          <button className="btn btn-outline btn-sm" onClick={copyMarkdown} type="button">
            <Copy size={15} />
            Copy
          </button>
          <button className="btn btn-outline btn-sm" onClick={downloadMarkdown} type="button">
            <Download size={15} />
            Download
          </button>
          <button className="btn btn-quiet btn-sm" onClick={onRetry} type="button">
            <RotateCcw size={15} />
            Run again
          </button>
        </div>
      </header>

      {breakdown.provider === "local" ? (
        <aside className="notice-bar" role="note">
          <strong>{copy.local.title}</strong>
          <span>{copy.local.text}</span>
        </aside>
      ) : null}

      {breakdown.summary ? <p className="lede">{breakdown.summary}</p> : null}

      {concepts.length ? (
        <section className="doc-section">
          <h2>{sections.concepts}</h2>
          <ul className="chips">
            {concepts.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {keywords.length ? (
        <section className="doc-section">
          <h2>{sections.keywords}</h2>
          <ul className="chips chips-soft">
            {keywords.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {tasks.length ? <Checklist items={tasks} title={sections.tasks} /> : null}

      {structure.length ? (
        <section className="doc-section">
          <h2>{sections.structure}</h2>
          <ul className="outline">
            {structure.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.length ? (
        <section className="doc-section">
          <h2>{sections.plan}</h2>
          <ol className="steps steps-line">
            {plan.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}

function Checklist({ items, title }) {
  const [done, setDone] = useState({});
  const finished = items.filter((_, index) => done[index]).length;

  return (
    <section className="doc-section">
      <div className="label-row">
        <h2>{title}</h2>
        <span className="count">
          {finished} of {items.length} done
        </span>
      </div>
      <ul className="checklist">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>
            <label className={done[index] ? "is-done" : ""}>
              <input checked={Boolean(done[index])} onChange={(event) => setDone((state) => ({ ...state, [index]: event.target.checked }))} type="checkbox" />
              <span aria-hidden="true" className="box">
                <Check size={14} strokeWidth={3} />
              </span>
              <span className="check-text">{item}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* =====================================================================
   Profile + settings
   ===================================================================== */

function ProfilePage({ history, onLogout, onSave, user }) {
  const [form, setForm] = useState({
    name: user.name || "",
    email: user.email || "",
    institution: user.institution || "",
    course: user.course || "",
  });
  const setField = (field) => (event) => setForm((state) => ({ ...state, [field]: event.target.value }));

  return (
    <div className="narrow">
      <header className="page-head">
        <Avatar name={user.name} size={64} />
        <div>
          <h1>{user.name}</h1>
          <p className="hint">{user.email}</p>
        </div>
      </header>

      <form
        className="stack stack-lg"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <div className="grid-2">
          <Field autoComplete="name" label="Full name" onChange={setField("name")} value={form.name} />
          <Field autoComplete="email" label="Email" onChange={setField("email")} type="email" value={form.email} />
          <Field label="Institution" onChange={setField("institution")} value={form.institution} />
          <Field label="Course or module" onChange={setField("course")} value={form.course} />
        </div>
        <div className="actions">
          <button className="btn btn-primary" type="submit">
            Save profile
          </button>
          <button className="btn btn-quiet" onClick={onLogout} type="button">
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </form>

      <dl className="facts">
        <div>
          <dt>Saved breakdowns</dt>
          <dd>{history.length}</dd>
        </div>
      </dl>
    </div>
  );
}

function SettingsPage({ health, onRefreshHealth, onSave, settings }) {
  const [form, setForm] = useState(settings);
  const setValue = (field) => (event) =>
    setForm((state) => ({ ...state, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  return (
    <div className="narrow">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="hint">These shape how your briefs are analyzed.</p>
        </div>
      </header>

      <form
        className="stack stack-lg"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form);
        }}
      >
        <div className="grid-2">
          <SelectField label="Academic level" onChange={setValue("academicLevel")} options={options.academicLevels} value={form.academicLevel} />
          <SelectField label="Referencing style" onChange={setValue("referencingStyle")} options={options.referencingStyles} value={form.referencingStyle} />
          <SelectField label="Output language" onChange={setValue("language")} options={options.languages} value={form.language} />
        </div>

        <div className="stack">
          <Toggle checked={form.saveHistory} label="Keep my recent breakdowns" onChange={setValue("saveHistory")} />
          <Toggle checked={form.compactMode} label="Use a tighter layout" onChange={setValue("compactMode")} />
        </div>

        <div className="actions">
          <button className="btn btn-primary" type="submit">
            Save settings
          </button>
        </div>
      </form>

      <dl className="facts">
        <div>
          <dt>Server</dt>
          <dd>
            {health.state === "online" ? "Connected" : health.state === "checking" ? "Connecting" : "Offline"}
            <button className="link-btn" onClick={onRefreshHealth} type="button">
              Check again
            </button>
          </dd>
        </div>
        {health.provider ? (
          <div>
            <dt>Analysis provider</dt>
            <dd>{health.provider}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

/* =====================================================================
   Form fields
   ===================================================================== */

function Field({ label, onChange, type = "text", value, ...rest }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" onChange={onChange} type={type} value={value} {...rest} />
    </label>
  );
}

function SelectField({ label, onChange, options: choices, value }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" onChange={onChange} value={value}>
        {choices.map((choice) => (
          <option key={choice}>{choice}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ checked, label, onChange }) {
  return (
    <label className="toggle">
      <input checked={checked} onChange={onChange} type="checkbox" />
      <span aria-hidden="true" className="toggle-track" />
      <span>{label}</span>
    </label>
  );
}

/* =====================================================================
   Crash screen: shows the real error instead of a blank page
   ===================================================================== */

class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("The app crashed:", error, info?.componentStack);
  }

  resetAndReload = () => {
    removeKeys(Object.values(storageKeys));
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p className="hint">The page hit an error. Reloading usually fixes it. If it keeps happening, reset the saved data in this browser.</p>
        <pre>{String(this.state.error?.message || this.state.error)}</pre>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => window.location.reload()} type="button">
            Reload
          </button>
          <button className="btn btn-outline" onClick={this.resetAndReload} type="button">
            Reset saved data and reload
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);