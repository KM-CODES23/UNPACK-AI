import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FileText,
  GraduationCap,
  History,
  Loader2,
  LogOut,
  Map,
  PanelLeft,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trash2,
  Upload,
  User,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import logo from "./assets/unpack-logo.jpeg";
import referenceImage from "./assets/interface-reference.png";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const HISTORY_KEY = "unpackai.analysisHistory.v1";
const USERS_KEY = "unpackai.users.v1";
const SESSION_KEY = "unpackai.session.v1";
const SETTINGS_KEY = "unpackai.settings.v1";
const NOTIFICATIONS_KEY = "unpackai.notifications.v1";

const defaultSettings = {
  academicLevel: "University",
  referencingStyle: "Harvard",
  language: "English",
  saveHistory: true,
  compactMode: false,
};

const sampleAssignment =
  "Discuss how artificial intelligence can improve academic support for South African university students. Your essay should identify the main challenges students face, explain relevant AI tools, evaluate ethical concerns, and propose practical recommendations. Use at least five academic sources and follow Harvard referencing.";

function App() {
  const [session, setSession] = useState(() => loadJson(SESSION_KEY, null));
  const [users, setUsers] = useState(() => loadJson(USERS_KEY, []));
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...loadJson(SETTINGS_KEY, {}) }));
  const [assignment, setAssignment] = useState("");
  const [breakdown, setBreakdown] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState(() => loadHistory());
  const [health, setHealth] = useState({ state: "checking", label: "Checking provider..." });
  const [activeView, setActiveView] = useState("workspace");
  const [notifications, setNotifications] = useState(() => loadJson(NOTIFICATIONS_KEY, []));
  const [showNotifications, setShowNotifications] = useState(false);
  const [toast, setToast] = useState("");
  const workspaceRef = useRef(null);
  const briefRef = useRef(null);
  const tasksRef = useRef(null);
  const roadmapRef = useRef(null);

  const currentUser = users.find((user) => user.id === session?.userId) || null;
  const unreadCount = notifications.filter((item) => !item.read).length;
  const wordCount = useMemo(() => (assignment.trim() ? assignment.trim().split(/\s+/).length : 0), [assignment]);

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    restoreSession();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }, [session]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  }, [history]);

  useEffect(() => {
    window.localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications.slice(0, 20)));
  }, [notifications]);

  if (!currentUser) {
    return (
      <AppShell>
        <AuthScreen
          onLogin={handleLogin}
          onSignup={handleSignup}
          toast={toast}
        />
      </AppShell>
    );
  }

  async function checkHealth() {
    setHealth({ state: "checking", label: "Checking provider..." });

    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error("Backend health check failed.");
      }

      setHealth({
        state: "online",
        label: `${data.provider || "AI"} ready`,
        data,
      });
    } catch (healthError) {
      setHealth({
        state: "offline",
        label: "Backend offline",
        data: { error: healthError.message },
      });
    }
  }

  async function restoreSession() {
    if (!session?.token) {
      return;
    }

    try {
      const data = await apiRequest("/api/me", {
        headers: authHeaders(session.token),
      });
      setUsers((items) => upsertUser(items, data.user));
      setSettings({ ...defaultSettings, ...data.settings });
      setHistory(data.history || []);
    } catch {
      // Keep the local session fallback for offline demos.
    }
  }

  async function handleSignup(details) {
    const name = details.name.trim();
    const email = details.email.trim().toLowerCase();
    const password = details.password.trim();

    if (!name || !email || password.length < 6) {
      showToast("Enter a name, email, and 6+ character password", "error");
      return;
    }

    try {
      const data = await apiRequest("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      setUsers((items) => upsertUser(items, data.user));
      setSettings({ ...defaultSettings, ...data.settings });
      setHistory(data.history || []);
      setSession({ userId: data.user.id, token: data.token, signedInAt: new Date().toISOString() });
      addNotification("Welcome to Unpack.ai", "Your Supabase account is ready.");
      showToast("Account created");
      return;
    } catch (apiError) {
      if (!isDatabaseUnavailable(apiError)) {
        showToast(apiError.message, "error");
        return;
      }
    }

    if (users.some((user) => user.email === email)) {
      showToast("An account with that email already exists", "error");
      return;
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      password,
      institution: "",
      course: "",
      avatarColor: "from-cyan-300 to-violet-500",
      createdAt: new Date().toISOString(),
    };

    setUsers((items) => [...items, user]);
    setSession({ userId: user.id, signedInAt: new Date().toISOString() });
    addNotification("Local account created", "Supabase is not configured, so this account is stored in this browser.");
    showToast("Account created");
  }

  async function handleLogin(details) {
    const email = details.email.trim().toLowerCase();
    const password = details.password.trim();

    try {
      const data = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setUsers((items) => upsertUser(items, data.user));
      setSettings({ ...defaultSettings, ...data.settings });
      setHistory(data.history || []);
      setSession({ userId: data.user.id, token: data.token, signedInAt: new Date().toISOString() });
      addNotification("Signed in", `Welcome back, ${data.user.name}.`);
      showToast("Signed in");
      return;
    } catch (apiError) {
      if (!isDatabaseUnavailable(apiError)) {
        showToast(apiError.message, "error");
        return;
      }
    }

    const user = users.find((item) => item.email === email && item.password === password);

    if (!user) {
      showToast("Invalid email or password", "error");
      return;
    }

    setSession({ userId: user.id, signedInAt: new Date().toISOString() });
    addNotification("Signed in", `Welcome back, ${user.name}.`);
    showToast("Signed in");
  }

  function logout() {
    setSession(null);
    setActiveView("workspace");
    showToast("Signed out");
  }

  async function analyzeAssignment(event) {
    event?.preventDefault();

    const trimmed = assignment.trim();

    if (trimmed.length < 10) {
      setError("Paste at least 10 characters from your assignment brief.");
      setBreakdown(null);
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/breakdown`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment: buildContextualAssignment(trimmed, settings),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not analyze the assignment.");
      }

      setBreakdown(data);

      if (settings.saveHistory) {
        const historyItem = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            assignment: trimmed,
            breakdown: data,
        };
        setHistory((items) => [historyItem, ...items].slice(0, 8));

        if (session?.token) {
          apiRequest("/api/history", {
            method: "POST",
            headers: authHeaders(session.token),
            body: JSON.stringify({ assignment: trimmed, breakdown: data }),
          })
            .then((saved) => {
              if (saved.item) {
                setHistory((items) => [saved.item, ...items.filter((item) => item.id !== historyItem.id)].slice(0, 8));
              }
            })
            .catch(() => {});
        }
      }

      addNotification("Breakdown complete", data.mainTopic || "Your assignment was analyzed.");
      showToast("Breakdown created");
    } catch (requestError) {
      setBreakdown(null);
      setError(requestError.message);
      addNotification("Analysis failed", requestError.message, "error");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateProfile(nextUser) {
    if (session?.token) {
      try {
        const data = await apiRequest("/api/profile", {
          method: "PUT",
          headers: authHeaders(session.token),
          body: JSON.stringify(nextUser),
        });
        setUsers((items) => upsertUser(items, data.user));
        addNotification("Profile updated", "Your Supabase profile changes were saved.");
        showToast("Profile saved");
        return;
      } catch (apiError) {
        showToast(apiError.message, "error");
        return;
      }
    }

    setUsers((items) => items.map((item) => (item.id === currentUser.id ? { ...item, ...nextUser } : item)));
    addNotification("Profile updated", "Your profile changes were saved.");
    showToast("Profile saved");
  }

  async function updateSettings(nextSettings) {
    if (session?.token) {
      try {
        const data = await apiRequest("/api/settings", {
          method: "PUT",
          headers: authHeaders(session.token),
          body: JSON.stringify(nextSettings),
        });
        setSettings({ ...defaultSettings, ...data.settings });
        addNotification("Settings updated", "Your Supabase workspace preferences were saved.");
        showToast("Settings saved");
        return;
      } catch (apiError) {
        showToast(apiError.message, "error");
        return;
      }
    }

    setSettings(nextSettings);
    addNotification("Settings updated", "Your workspace preferences were saved.");
    showToast("Settings saved");
  }

  function useSample() {
    setAssignment(sampleAssignment);
    setError("");
    showToast("Sample loaded");
  }

  function clearWorkspace() {
    setAssignment("");
    setBreakdown(null);
    setError("");
    showToast("Workspace cleared");
  }

  function loadHistoryItem(item) {
    setAssignment(item.assignment);
    setBreakdown(item.breakdown);
    setError("");
    setActiveView("workspace");
    scrollTo(workspaceRef);
    showToast("History item loaded");
  }

  function clearHistory() {
    setHistory([]);
    if (session?.token) {
      apiRequest("/api/history", {
        method: "DELETE",
        headers: authHeaders(session.token),
      }).catch(() => {});
    }
    addNotification("History cleared", "Saved analyses were removed from this browser.");
    showToast("History cleared");
  }

  function markNotificationsRead() {
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
  }

  function clearNotifications() {
    setNotifications([]);
    showToast("Notifications cleared");
  }

  function addNotification(title, message, type = "info") {
    setNotifications((items) => [
      {
        id: crypto.randomUUID(),
        title,
        message,
        type,
        read: false,
        createdAt: new Date().toISOString(),
      },
      ...items,
    ].slice(0, 20));
  }

  function scrollTo(ref) {
    setActiveView("workspace");
    window.setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function showToast(message, type = "info") {
    setToast({ message, type });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2400);
  }

  return (
    <AppShell toast={toast}>
      <div className="relative flex min-h-screen">
        <SideRail
          activeView={activeView}
          onBrief={() => scrollTo(briefRef)}
          onProfile={() => setActiveView("profile")}
          onRoadmap={() => scrollTo(roadmapRef)}
          onSettings={() => setActiveView("settings")}
          onTasks={() => scrollTo(tasksRef)}
          onWorkspace={() => setActiveView("workspace")}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <TopBar
            currentUser={currentUser}
            health={health}
            notifications={notifications}
            onClearNotifications={clearNotifications}
            onLogout={logout}
            onMarkRead={markNotificationsRead}
            onProfile={() => setActiveView("profile")}
            onRefreshHealth={checkHealth}
            onSettings={() => setActiveView("settings")}
            onToggleNotifications={() => setShowNotifications((value) => !value)}
            showNotifications={showNotifications}
            unreadCount={unreadCount}
          />

          {activeView === "profile" ? (
            <ProfilePage currentUser={currentUser} history={history} onSave={updateProfile} onWorkspace={() => setActiveView("workspace")} />
          ) : null}

          {activeView === "settings" ? (
            <SettingsPage
              health={health}
              onRefreshHealth={checkHealth}
              onSave={updateSettings}
              onWorkspace={() => setActiveView("workspace")}
              settings={settings}
            />
          ) : null}

          {activeView === "workspace" ? (
            <div className={`grid flex-1 grid-cols-1 border-t border-white/10 ${settings.compactMode ? "lg:grid-cols-[340px_minmax(0,1fr)]" : "lg:grid-cols-[390px_minmax(0,1fr)]"}`}>
              <aside className="border-r border-white/10 bg-[#111832]/78 px-5 py-6 backdrop-blur-xl" ref={briefRef}>
                <BrandCard currentUser={currentUser} />
                <AssignmentForm
                  assignment={assignment}
                  error={error}
                  isLoading={isLoading}
                  onAnalyze={analyzeAssignment}
                  onChange={setAssignment}
                  onClear={clearWorkspace}
                  onToast={showToast}
                  onUseSample={useSample}
                  wordCount={wordCount}
                />
                <HistoryPanel history={history} onClear={clearHistory} onLoad={loadHistoryItem} />
              </aside>

              <ResultsWorkspace
                breakdown={breakdown}
                isLoading={isLoading}
                onCopy={showToast}
                onRetry={analyzeAssignment}
                roadmapRef={roadmapRef}
                tasksRef={tasksRef}
                workspaceRef={workspaceRef}
              />
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function AppShell({ children, toast }) {
  return (
    <main className="min-h-screen overflow-hidden bg-[#08142e] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(68,84,170,0.34),transparent_30%),linear-gradient(145deg,#08142e_0%,#121735_48%,#08142e_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: `url(${referenceImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      {children}
      {toast ? (
        <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-3 text-sm shadow-glow ${
          toast.type === "error" ? "border-rose-300/30 bg-rose-500/15 text-rose-50" : "border-cyan-300/30 bg-[#151d3c] text-cyan-50"
        }`}>
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

function AuthScreen({ onLogin, onSignup, toast }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  function updateField(field, value) {
    setForm((state) => ({ ...state, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (mode === "signup") {
      onSignup(form);
    } else {
      onLogin(form);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center px-5 py-10">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-lg border border-white/12 bg-[#111832]/90 shadow-glow backdrop-blur-xl lg:grid-cols-[1fr_430px]">
        <div className="hidden min-h-[560px] flex-col justify-between border-r border-white/10 bg-gradient-to-br from-cyan-400/16 via-blue-500/8 to-violet-500/18 p-8 lg:flex">
          <div>
            <img className="mb-6 size-20 rounded-2xl object-cover shadow-glow" src={logo} alt="Unpack.ai logo" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/80">Student workspace</p>
            <h1 className="mt-4 max-w-xl text-4xl font-bold leading-tight text-white">Break down assignments before they break your week.</h1>
          </div>
          <div className="grid gap-3 text-sm text-slate-200">
            <AuthFeature icon={BrainCircuit} text="AI assignment analysis with Gemini" />
            <AuthFeature icon={History} text="Saved analysis history in this browser" />
            <AuthFeature icon={Shield} text="Private API keys stay on the backend" />
          </div>
        </div>

        <form className="p-6 sm:p-8" onSubmit={submit}>
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/80">Unpack.ai</p>
              <h2 className="mt-2 text-2xl font-bold text-white">{mode === "login" ? "Welcome back" : "Create account"}</h2>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-1">
              <button className={`rounded-md px-3 py-2 text-sm ${mode === "login" ? "bg-cyan-400/20 text-cyan-50" : "text-slate-400"}`} onClick={() => setMode("login")} type="button">
                Login
              </button>
              <button className={`rounded-md px-3 py-2 text-sm ${mode === "signup" ? "bg-cyan-400/20 text-cyan-50" : "text-slate-400"}`} onClick={() => setMode("signup")} type="button">
                Sign up
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {mode === "signup" ? <TextField label="Full name" onChange={(value) => updateField("name", value)} value={form.name} /> : null}
            <TextField label="Email" onChange={(value) => updateField("email", value)} type="email" value={form.email} />
            <TextField label="Password" onChange={(value) => updateField("password", value)} type="password" value={form.password} />
          </div>

          <button className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white shadow-violet transition hover:brightness-110" type="submit">
            {mode === "login" ? "Login" : "Create account"}
          </button>

          <p className="mt-5 text-sm leading-6 text-slate-400">
            This demo account system is stored locally in your browser. Use it for the project interface; add a real database before production deployment.
          </p>
        </form>
      </section>
      {toast ? (
        <div className={`fixed bottom-5 right-5 z-50 rounded-lg border px-4 py-3 text-sm shadow-glow ${
          toast.type === "error" ? "border-rose-300/30 bg-rose-500/15 text-rose-50" : "border-cyan-300/30 bg-[#151d3c] text-cyan-50"
        }`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function AuthFeature({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <Icon className="text-cyan-200" size={18} />
      <span>{text}</span>
    </div>
  );
}

function SideRail({ activeView, onBrief, onProfile, onRoadmap, onSettings, onTasks, onWorkspace }) {
  const items = [
    { icon: PanelLeft, label: "Workspace", onClick: onWorkspace, active: activeView === "workspace" },
    { icon: FileText, label: "Brief", onClick: onBrief, active: false },
    { icon: ClipboardList, label: "Tasks", onClick: onTasks, active: false },
    { icon: Map, label: "Roadmap", onClick: onRoadmap, active: false },
    { icon: User, label: "Profile", onClick: onProfile, active: activeView === "profile" },
    { icon: Settings, label: "Settings", onClick: onSettings, active: activeView === "settings" },
  ];

  return (
    <nav className="hidden w-16 shrink-0 border-r border-white/10 bg-[#0b1230]/88 px-3 py-5 backdrop-blur-xl sm:block">
      <button
        className="mb-8 grid size-10 place-items-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 text-cyan-200 shadow-glow"
        onClick={onWorkspace}
        title="Go to workspace"
        type="button"
      >
        <GraduationCap size={22} />
      </button>
      <div className="space-y-3">
        {items.map((item) => (
          <button
            key={item.label}
            className={`grid size-10 place-items-center rounded-lg border transition ${
              item.active
                ? "border-cyan-300/35 bg-cyan-400/14 text-cyan-100"
                : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/7 hover:text-white"
            }`}
            onClick={item.onClick}
            title={item.label}
            type="button"
          >
            <item.icon size={20} />
          </button>
        ))}
      </div>
    </nav>
  );
}

function TopBar({
  currentUser,
  health,
  notifications,
  onClearNotifications,
  onLogout,
  onMarkRead,
  onProfile,
  onRefreshHealth,
  onSettings,
  onToggleNotifications,
  showNotifications,
  unreadCount,
}) {
  const online = health.state === "online";

  return (
    <header className="relative flex min-h-16 items-center justify-between bg-[#111832]/82 px-5 py-3 backdrop-blur-xl sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <img className="size-11 rounded-lg object-cover shadow-glow" src={logo} alt="Unpack.ai logo" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-normal text-white">Unpack.ai</p>
          <p className="truncate text-xs uppercase tracking-[0.18em] text-cyan-200/75">AI-powered academic assistant</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          className={`hidden items-center gap-2 rounded-lg border px-3 py-2 text-xs sm:inline-flex ${
            online ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-rose-300/25 bg-rose-400/10 text-rose-100"
          }`}
          onClick={onRefreshHealth}
          type="button"
        >
          {online ? <Wifi size={16} /> : <WifiOff size={16} />}
          {health.label}
        </button>
        <button className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10" onClick={onSettings} title="Settings" type="button">
          <Settings size={18} />
        </button>
        <button
          className="relative grid size-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
          onClick={() => {
            onToggleNotifications();
            onMarkRead();
          }}
          title="Notifications"
          type="button"
        >
          <Bell size={18} />
          {unreadCount ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-cyan-300 px-1 text-[11px] font-bold text-[#08142e]">{unreadCount}</span> : null}
        </button>
        <button className="flex h-10 items-center gap-2 rounded-full border border-white/15 bg-white/5 pl-2 pr-3 text-sm text-white" onClick={onProfile} type="button">
          <Avatar name={currentUser.name} small />
          <span className="hidden max-w-28 truncate sm:inline">{currentUser.name}</span>
        </button>
      </div>

      {showNotifications ? (
        <NotificationsPanel
          health={health}
          notifications={notifications}
          onClear={onClearNotifications}
          onClose={onToggleNotifications}
          onLogout={onLogout}
          onRefreshHealth={onRefreshHealth}
        />
      ) : null}
    </header>
  );
}

function NotificationsPanel({ health, notifications, onClear, onClose, onLogout, onRefreshHealth }) {
  const data = health.data || {};
  const online = health.state === "online";

  return (
    <div className="absolute right-4 top-16 z-40 w-[min(420px,calc(100vw-32px))] rounded-lg border border-white/12 bg-[#151d3c] p-4 shadow-glow">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-base font-bold text-white">Notifications</p>
          <p className="text-xs text-slate-400">System updates and recent workspace activity</p>
        </div>
        <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200" onClick={onClose} type="button">
          <X size={16} />
        </button>
      </div>

      <div className={`mb-4 rounded-lg border p-3 ${online ? "border-emerald-300/25 bg-emerald-400/10" : "border-rose-300/25 bg-rose-400/10"}`}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}
            {health.label}
          </div>
          <button className="text-xs text-slate-200 hover:text-white" onClick={onRefreshHealth} type="button">
            Refresh
          </button>
        </div>
        <div className="grid gap-1 text-xs text-slate-300">
          <span>Gemini: {data.hasGeminiKey ? data.geminiModel : "not configured"}</span>
          <span>OpenAI: {data.hasOpenAIKey ? data.openAIModel : "not configured"}</span>
          <span>Hugging Face: {data.hasHuggingFaceToken ? data.huggingFaceModel : "not configured"}</span>
        </div>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
        {notifications.length ? (
          notifications.map((item) => (
            <article className={`rounded-lg border p-3 ${item.type === "error" ? "border-rose-300/25 bg-rose-500/10" : "border-white/10 bg-white/5"}`} key={item.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-300">{item.message}</p>
                </div>
                {!item.read ? <span className="mt-1 size-2 shrink-0 rounded-full bg-cyan-300" /> : null}
              </div>
              <p className="mt-2 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
            </article>
          ))
        ) : (
          <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No notifications yet.</p>
        )}
      </div>

      <div className="mt-4 flex justify-between gap-3">
        <button className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200" onClick={onClear} type="button">
          Clear all
        </button>
        <button className="inline-flex items-center gap-2 rounded-lg border border-rose-300/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" onClick={onLogout} type="button">
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}

function BrandCard({ currentUser }) {
  return (
    <section className="mb-6 rounded-lg border border-cyan-300/40 bg-gradient-to-br from-cyan-400/18 via-blue-500/12 to-violet-500/18 p-5 shadow-glow">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Main Topic</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-white">Welcome, {currentUser.name.split(" ")[0]}</h1>
        </div>
        <BrainCircuit className="shrink-0 text-cyan-100/80" size={42} />
      </div>
      <p className="text-sm leading-6 text-slate-200/86">Paste or upload a brief and Unpack.ai will extract the academic target, tasks, structure, and roadmap.</p>
    </section>
  );
}

function AssignmentForm({ assignment, error, isLoading, onAnalyze, onChange, onClear, onToast, onUseSample, wordCount }) {
  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (!/\.(txt|md)$/i.test(file.name)) {
      onToast("Upload a .txt or .md file", "error");
      return;
    }

    const text = await file.text();
    onChange(text.slice(0, 12000));
    onToast("Brief uploaded");
  }

  return (
    <form className="space-y-5" onSubmit={onAnalyze}>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <label className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="assignment">Assignment Text</label>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{wordCount} words</span>
        </div>
        <textarea
          className="min-h-64 w-full resize-y rounded-lg border border-white/12 bg-[#0c1430]/88 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/80 focus:shadow-glow"
          id="assignment"
          maxLength={12000}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste your assignment question or brief here..."
          value={assignment}
        />
      </div>

      {error ? (
        <div className="flex gap-3 rounded-lg border border-rose-300/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <p>{error}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3">
        <button className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white shadow-violet transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65" disabled={isLoading} type="submit">
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          Analyze
        </button>
        <IconButton icon={Sparkles} label="Load sample" onClick={onUseSample} />
        <label className="grid h-12 w-12 cursor-pointer place-items-center rounded-lg border border-white/12 bg-white/6 text-cyan-100 transition hover:bg-white/10" title="Upload .txt or .md">
          <Upload size={18} />
          <input accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={handleFileUpload} type="file" />
        </label>
        <IconButton icon={Trash2} label="Clear workspace" onClick={onClear} />
      </div>
    </form>
  );
}

function HistoryPanel({ history, onClear, onLoad }) {
  return (
    <section className="mt-6 rounded-lg border border-white/10 bg-[#151d3c]/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="text-cyan-200" size={18} />
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-200">History</h2>
        </div>
        <button className="text-xs text-slate-400 hover:text-white" onClick={onClear} type="button">Clear</button>
      </div>
      <div className="space-y-2">
        {history.length ? (
          history.map((item) => (
            <button className="w-full rounded-lg border border-white/8 bg-white/5 px-3 py-3 text-left text-sm transition hover:border-cyan-300/30 hover:bg-cyan-400/8" key={item.id} onClick={() => onLoad(item)} type="button">
              <p className="line-clamp-2 font-medium text-slate-100">{item.breakdown.mainTopic || item.assignment}</p>
              <p className="mt-1 text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
            </button>
          ))
        ) : (
          <p className="text-sm text-slate-400">No saved analyses yet.</p>
        )}
      </div>
    </section>
  );
}

function ResultsWorkspace({ breakdown, isLoading, onCopy, onRetry, roadmapRef, tasksRef, workspaceRef }) {
  const data = breakdown || {
    mainTopic: "Ready to unpack your assignment",
    keyConcepts: ["Academic focus", "Research direction", "Student planning"],
    keywords: ["Main topic", "Keywords", "Tasks", "Roadmap"],
    requiredTasks: ["Paste an assignment brief", "Click Analyze", "Review the structured guide"],
    suggestedStructure: ["Introduction", "Body sections", "Conclusion", "References"],
    completionPlan: ["Understand the question", "Plan research", "Draft and refine"],
    summary: "Your structured breakdown will appear here after analysis.",
  };

  return (
    <section className="relative min-w-0 bg-[#101733]/68 p-5 backdrop-blur-xl sm:p-7" ref={workspaceRef}>
      {isLoading ? <LoadingOverlay /> : null}
      <ResultActions breakdown={breakdown} onCopy={onCopy} onRetry={onRetry} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <TopicPanel provider={breakdown?.provider} summary={data.summary} topic={data.mainTopic} />
          <ChipPanel title="Key Concepts" icon={BookOpenCheck} items={data.keyConcepts} />
          <ChipPanel title="Key Keywords" icon={Search} items={data.keywords} gradient />
          <div ref={tasksRef}>
            <TaskPanel items={data.requiredTasks} />
          </div>
        </div>
        <div className="space-y-5" ref={roadmapRef}>
          <RoadmapPanel items={data.completionPlan} />
          <StructurePanel items={data.suggestedStructure} />
        </div>
      </div>
    </section>
  );
}

function ResultActions({ breakdown, onCopy, onRetry }) {
  const disabled = !breakdown;

  async function copyMarkdown() {
    if (!breakdown) {
      onCopy("Analyze a brief first");
      return;
    }
    await navigator.clipboard.writeText(createMarkdown(breakdown));
    onCopy("Result copied");
  }

  function downloadMarkdown() {
    if (!breakdown) {
      onCopy("Analyze a brief first");
      return;
    }
    const blob = new Blob([createMarkdown(breakdown)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "unpack-ai-breakdown.md";
    anchor.click();
    URL.revokeObjectURL(url);
    onCopy("Markdown downloaded");
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#151d3c]/70 p-3">
      <p className="text-sm text-slate-300">Export, copy, or retry your latest breakdown.</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={disabled} icon={Copy} label="Copy" onClick={copyMarkdown} />
        <ActionButton disabled={disabled} icon={Download} label="Download" onClick={downloadMarkdown} />
        <ActionButton icon={RotateCcw} label="Retry" onClick={onRetry} />
      </div>
    </div>
  );
}

function ProfilePage({ currentUser, history, onSave, onWorkspace }) {
  const [form, setForm] = useState(currentUser);

  return (
    <PageShell title="Profile" subtitle="Manage your student details and workspace identity" onBack={onWorkspace}>
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
          <Avatar name={currentUser.name} large />
          <h2 className="mt-4 text-2xl font-bold text-white">{currentUser.name}</h2>
          <p className="mt-1 text-sm text-slate-400">{currentUser.email}</p>
          <div className="mt-5 grid gap-3 text-sm">
            <ProfileStat label="Saved analyses" value={history.length} />
            <ProfileStat label="Institution" value={currentUser.institution || "Not set"} />
            <ProfileStat label="Course" value={currentUser.course || "Not set"} />
          </div>
        </section>
        <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" onChange={(value) => setForm((state) => ({ ...state, name: value }))} value={form.name} />
            <TextField label="Email" onChange={(value) => setForm((state) => ({ ...state, email: value }))} type="email" value={form.email} />
            <TextField label="Institution" onChange={(value) => setForm((state) => ({ ...state, institution: value }))} value={form.institution || ""} />
            <TextField label="Course / Module" onChange={(value) => setForm((state) => ({ ...state, course: value }))} value={form.course || ""} />
          </div>
          <button className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white" onClick={() => onSave(form)} type="button">
            <Save size={16} />
            Save profile
          </button>
        </section>
      </div>
    </PageShell>
  );
}

function SettingsPage({ health, onRefreshHealth, onSave, onWorkspace, settings }) {
  const [form, setForm] = useState(settings);

  return (
    <PageShell title="Settings" subtitle="Tune outputs for your academic context" onBack={onWorkspace}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Academic level" onChange={(value) => setForm((state) => ({ ...state, academicLevel: value }))} options={["College", "University", "Honours", "Masters"]} value={form.academicLevel} />
            <SelectField label="Referencing style" onChange={(value) => setForm((state) => ({ ...state, referencingStyle: value }))} options={["Harvard", "APA", "MLA", "IEEE", "Chicago"]} value={form.referencingStyle} />
            <SelectField label="Output language" onChange={(value) => setForm((state) => ({ ...state, language: value }))} options={["English", "Zulu", "Xhosa", "Afrikaans", "Sesotho"]} value={form.language} />
          </div>
          <div className="mt-5 grid gap-3">
            <ToggleField checked={form.saveHistory} label="Save analysis history on this browser" onChange={(value) => setForm((state) => ({ ...state, saveHistory: value }))} />
            <ToggleField checked={form.compactMode} label="Compact workspace layout" onChange={(value) => setForm((state) => ({ ...state, compactMode: value }))} />
          </div>
          <button className="mt-5 inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white" onClick={() => onSave(form)} type="button">
            <Save size={16} />
            Save settings
          </button>
        </section>
        <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-white">Provider</h2>
              <p className="text-sm text-slate-400">{health.label}</p>
            </div>
            <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200" onClick={onRefreshHealth} type="button">
              <RotateCcw size={16} />
            </button>
          </div>
          <div className="grid gap-2 text-sm">
            <ProfileStat label="Provider" value={health.data?.provider || "unknown"} />
            <ProfileStat label="Gemini" value={health.data?.hasGeminiKey ? health.data.geminiModel : "Not configured"} />
            <ProfileStat label="Backend" value={health.state === "online" ? "Online" : "Offline"} />
          </div>
        </section>
      </div>
    </PageShell>
  );
}

function PageShell({ children, onBack, subtitle, title }) {
  return (
    <section className="flex-1 border-t border-white/10 bg-[#101733]/68 p-5 backdrop-blur-xl sm:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        <button className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-100" onClick={onBack} type="button">
          Back to workspace
        </button>
      </div>
      {children}
    </section>
  );
}

function TopicPanel({ provider, summary, topic }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#171f42]/82 p-5 shadow-glow">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Main Topic</p>
          <h2 className="mt-2 text-2xl font-bold leading-tight text-white">{topic || "Untitled assignment"}</h2>
          {provider ? <p className="mt-2 text-xs text-emerald-200">Generated with {provider}</p> : null}
        </div>
        <Target className="shrink-0 text-cyan-200" size={32} />
      </div>
      <p className="max-w-4xl text-sm leading-7 text-slate-200/86">{summary || "No summary returned yet."}</p>
    </section>
  );
}

function ChipPanel({ title, icon: Icon, items = [], gradient = false }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
      <div className="mb-4 flex items-center gap-2 text-slate-200">
        <Icon size={18} className="text-cyan-200" />
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">{title}</h3>
      </div>
      <div className="flex flex-wrap gap-3">
        {items.length ? (
          items.map((item) => (
            <span className={`rounded-full px-4 py-2 text-sm text-white ${gradient ? "bg-gradient-to-r from-violet-500 to-cyan-500 shadow-violet" : "border border-cyan-300/25 bg-cyan-400/10"}`} key={item}>
              {item}
            </span>
          ))
        ) : (
          <EmptyText />
        )}
      </div>
    </section>
  );
}

function TaskPanel({ items = [] }) {
  const [completed, setCompleted] = useState({});

  useEffect(() => {
    setCompleted({});
  }, [items.join("|")]);

  return (
    <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
      <div className="mb-4 flex items-center gap-2 text-slate-200">
        <ClipboardList size={18} className="text-cyan-200" />
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">Required Tasks</h3>
      </div>
      <div className="space-y-3">
        {items.length ? (
          items.map((item, index) => (
            <label className="flex cursor-pointer gap-3 rounded-lg border border-white/8 bg-white/5 p-3 text-sm text-slate-100 transition hover:border-cyan-300/25" key={item}>
              <input checked={Boolean(completed[item])} className="mt-1 size-4 accent-cyan-300" onChange={(event) => setCompleted((state) => ({ ...state, [item]: event.target.checked }))} type="checkbox" />
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-cyan-300/25 text-xs text-cyan-100">{index + 1}</span>
              <span className={`leading-6 ${completed[item] ? "text-slate-400 line-through" : ""}`}>{item}</span>
            </label>
          ))
        ) : (
          <EmptyText />
        )}
      </div>
    </section>
  );
}

function RoadmapPanel({ items = [] }) {
  return (
    <section className="rounded-lg border border-cyan-300/20 bg-[#151d3c]/88 p-5">
      <div className="mb-5 flex items-center gap-2 text-slate-200">
        <Map size={18} className="text-cyan-200" />
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">Completion Roadmap</h3>
      </div>
      <div className="relative space-y-4">
        <div className="absolute bottom-4 left-3 top-4 w-px bg-cyan-300/25" />
        {items.length ? (
          items.map((item, index) => (
            <div className="relative flex gap-4" key={item}>
              <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full border border-cyan-200/50 bg-[#111832] text-xs font-bold text-cyan-100">{index + 1}</span>
              <p className="pt-0.5 text-sm leading-6 text-slate-200">{item}</p>
            </div>
          ))
        ) : (
          <EmptyText />
        )}
      </div>
    </section>
  );
}

function StructurePanel({ items = [] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
      <div className="mb-4 flex items-center gap-2 text-slate-200">
        <CheckCircle2 size={18} className="text-cyan-200" />
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">Suggested Structure</h3>
      </div>
      <div className="space-y-2">
        {items.length ? (
          items.map((item) => (
            <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200" key={item}>{item}</div>
          ))
        ) : (
          <EmptyText />
        )}
      </div>
    </section>
  );
}

function TextField({ label, onChange, type = "text", value }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <input className="h-11 w-full rounded-lg border border-white/12 bg-[#0c1430]/88 px-3 text-sm text-white outline-none transition focus:border-cyan-300/80" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function SelectField({ label, onChange, options, value }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      <select className="h-11 w-full rounded-lg border border-white/12 bg-[#0c1430]/88 px-3 text-sm text-white outline-none transition focus:border-cyan-300/80" onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ checked, label, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
      <span>{label}</span>
      <input checked={checked} className="size-4 accent-cyan-300" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function ProfileStat({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/5 px-3 py-3">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}

function Avatar({ large = false, name, small = false }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";

  return (
    <div className={`grid shrink-0 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-cyan-300 to-violet-500 font-bold text-white ${large ? "size-24 text-3xl" : small ? "size-8 text-xs" : "size-10 text-sm"}`}>
      {initials}
    </div>
  );
}

function IconButton({ icon: Icon, label, onClick }) {
  return (
    <button className="grid h-12 w-12 place-items-center rounded-lg border border-white/12 bg-white/6 text-cyan-100 transition hover:bg-white/10" onClick={onClick} title={label} type="button">
      <Icon size={18} />
    </button>
  );
}

function ActionButton({ disabled = false, icon: Icon, label, onClick }) {
  return (
    <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/6 px-3 text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45" disabled={disabled} onClick={onClick} type="button">
      <Icon size={16} />
      {label}
    </button>
  );
}

function LoadingOverlay() {
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-[#08142e]/72 backdrop-blur-sm">
      <div className="rounded-lg border border-cyan-300/25 bg-[#151d3c] px-6 py-5 text-center shadow-glow">
        <Loader2 className="mx-auto mb-3 animate-spin text-cyan-200" size={34} />
        <p className="font-semibold text-white">Unpacking the brief</p>
        <p className="mt-1 text-sm text-slate-300">Extracting tasks, concepts, and a roadmap.</p>
      </div>
    </div>
  );
}

function EmptyText() {
  return <p className="text-sm text-slate-400">Waiting for analysis.</p>;
}

function buildContextualAssignment(assignment, settings) {
  return `${assignment}

Student context:
- Academic level: ${settings.academicLevel}
- Referencing style: ${settings.referencingStyle}
- Preferred output language: ${settings.language}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function upsertUser(users, nextUser) {
  const withoutUser = users.filter((user) => user.id !== nextUser.id && user.email !== nextUser.email);
  return [...withoutUser, nextUser];
}

function isDatabaseUnavailable(error) {
  return /supabase is not configured|failed to fetch|networkerror/i.test(error.message || "");
}

function createMarkdown(breakdown) {
  const list = (items = []) => items.map((item) => `- ${item}`).join("\n");

  return `# ${breakdown.mainTopic || "Unpack.ai Breakdown"}

Generated with: ${breakdown.provider || "Unpack.ai"}

## Summary
${breakdown.summary || ""}

## Key Concepts
${list(breakdown.keyConcepts)}

## Keywords
${list(breakdown.keywords)}

## Required Tasks
${list(breakdown.requiredTasks)}

## Suggested Structure
${list(breakdown.suggestedStructure)}

## Completion Plan
${list(breakdown.completionPlan)}
`;
}

function loadHistory() {
  const stored = loadJson(HISTORY_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function loadJson(key, fallback) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) || "null");
    return stored ?? fallback;
  } catch {
    return fallback;
  }
}

createRoot(document.getElementById("root")).render(<App />);
