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
  Map,
  PanelLeft,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
} from "lucide-react";
import logo from "./assets/unpack-logo.jpeg";
import referenceImage from "./assets/interface-reference.png";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
const HISTORY_KEY = "unpackai.analysisHistory.v1";

const sampleAssignment =
  "Discuss how artificial intelligence can improve academic support for South African university students. Your essay should identify the main challenges students face, explain relevant AI tools, evaluate ethical concerns, and propose practical recommendations. Use at least five academic sources and follow Harvard referencing.";

function App() {
  const [assignment, setAssignment] = useState("");
  const [breakdown, setBreakdown] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState(() => loadHistory());
  const [health, setHealth] = useState({ state: "checking", label: "Checking provider..." });
  const [showStatus, setShowStatus] = useState(false);
  const [toast, setToast] = useState("");
  const workspaceRef = useRef(null);
  const briefRef = useRef(null);
  const tasksRef = useRef(null);
  const roadmapRef = useRef(null);

  const wordCount = useMemo(() => {
    return assignment.trim() ? assignment.trim().split(/\s+/).length : 0;
  }, [assignment]);

  useEffect(() => {
    checkHealth();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  }, [history]);

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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assignment: trimmed }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not analyze the assignment.");
      }

      setBreakdown(data);
      setHistory((items) => [
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          assignment: trimmed,
          breakdown: data,
        },
        ...items,
      ].slice(0, 8));
      showToast("Breakdown created");
    } catch (requestError) {
      setBreakdown(null);
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
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
    scrollTo(workspaceRef);
    showToast("History item loaded");
  }

  function clearHistory() {
    setHistory([]);
    showToast("History cleared");
  }

  function scrollTo(ref) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showToast(message) {
    setToast(message);
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(""), 2200);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#08142e] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(68,84,170,0.34),transparent_30%),linear-gradient(145deg,#08142e_0%,#121735_48%,#08142e_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: `url(${referenceImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />

      <div className="relative flex min-h-screen">
        <SideRail
          onBrief={() => scrollTo(briefRef)}
          onRoadmap={() => scrollTo(roadmapRef)}
          onTasks={() => scrollTo(tasksRef)}
          onWorkspace={() => scrollTo(workspaceRef)}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <TopBar
            health={health}
            onHistory={() => scrollTo(briefRef)}
            onRefreshHealth={checkHealth}
            onToggleStatus={() => setShowStatus((value) => !value)}
            showStatus={showStatus}
          />

          <div className="grid flex-1 grid-cols-1 border-t border-white/10 lg:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="border-r border-white/10 bg-[#111832]/78 px-5 py-6 backdrop-blur-xl" ref={briefRef}>
              <BrandCard />
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
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg border border-cyan-300/30 bg-[#151d3c] px-4 py-3 text-sm text-cyan-50 shadow-glow">
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function SideRail({ onBrief, onRoadmap, onTasks, onWorkspace }) {
  const items = [
    { icon: PanelLeft, label: "Workspace", onClick: onWorkspace },
    { icon: FileText, label: "Brief", onClick: onBrief },
    { icon: ClipboardList, label: "Tasks", onClick: onTasks },
    { icon: Map, label: "Roadmap", onClick: onRoadmap },
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
        {items.map((item, index) => (
          <button
            key={item.label}
            className={`grid size-10 place-items-center rounded-lg border transition ${
              index === 0
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

function TopBar({ health, onHistory, onRefreshHealth, onToggleStatus, showStatus }) {
  const online = health.state === "online";

  return (
    <header className="relative flex min-h-16 items-center justify-between bg-[#111832]/82 px-5 py-3 backdrop-blur-xl sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <img className="size-11 rounded-lg object-cover shadow-glow" src={logo} alt="Unpack.ai logo" />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold tracking-normal text-white">Unpack.ai</p>
          <p className="truncate text-xs uppercase tracking-[0.18em] text-cyan-200/75">
            AI-powered academic assistant
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
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
        <button
          className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
          onClick={onToggleStatus}
          title="Provider status"
          type="button"
        >
          <Bell size={18} />
        </button>
        <button
          className="grid size-10 place-items-center rounded-full border border-white/15 bg-gradient-to-br from-cyan-300 to-violet-500 text-sm font-bold text-white"
          onClick={onHistory}
          title="Go to history"
          type="button"
        >
          U
        </button>
      </div>

      {showStatus ? <StatusPopover health={health} onRefresh={onRefreshHealth} /> : null}
    </header>
  );
}

function StatusPopover({ health, onRefresh }) {
  const data = health.data || {};

  return (
    <div className="absolute right-5 top-16 z-40 w-[min(360px,calc(100vw-32px))] rounded-lg border border-white/12 bg-[#151d3c] p-4 shadow-glow">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">System Status</p>
          <p className="text-xs text-slate-400">{health.label}</p>
        </div>
        <button className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-200" onClick={onRefresh} type="button">
          <RotateCcw size={16} />
        </button>
      </div>
      <div className="grid gap-2 text-xs text-slate-300">
        <StatusRow label="Provider" value={data.provider || "unknown"} />
        <StatusRow label="Gemini" value={data.hasGeminiKey ? data.geminiModel : "not configured"} />
        <StatusRow label="OpenAI" value={data.hasOpenAIKey ? data.openAIModel : "not configured"} />
        <StatusRow label="Hugging Face" value={data.hasHuggingFaceToken ? data.huggingFaceModel : "not configured"} />
      </div>
    </div>
  );
}

function StatusRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-white/5 px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-100">{value}</span>
    </div>
  );
}

function BrandCard() {
  return (
    <section className="mb-6 rounded-lg border border-cyan-300/40 bg-gradient-to-br from-cyan-400/18 via-blue-500/12 to-violet-500/18 p-5 shadow-glow">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Main Topic</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight text-white">Assignment Breakdown Workspace</h1>
        </div>
        <BrainCircuit className="shrink-0 text-cyan-100/80" size={42} />
      </div>
      <p className="text-sm leading-6 text-slate-200/86">
        Paste or upload a brief and Unpack.ai will extract the academic target, tasks, structure, and roadmap.
      </p>
    </section>
  );
}

function AssignmentForm({ assignment, error, isLoading, onAnalyze, onChange, onClear, onToast, onUseSample, wordCount }) {
  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!/\.(txt|md)$/i.test(file.name)) {
      onToast("Upload a .txt or .md file");
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
          <label className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300" htmlFor="assignment">
            Assignment Text
          </label>
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            {wordCount} words
          </span>
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
        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white shadow-violet transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
          disabled={isLoading}
          type="submit"
        >
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
        <button className="text-xs text-slate-400 hover:text-white" onClick={onClear} type="button">
          Clear
        </button>
      </div>
      <div className="space-y-2">
        {history.length ? (
          history.map((item) => (
            <button
              className="w-full rounded-lg border border-white/8 bg-white/5 px-3 py-3 text-left text-sm transition hover:border-cyan-300/30 hover:bg-cyan-400/8"
              key={item.id}
              onClick={() => onLoad(item)}
              type="button"
            >
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

    const markdown = createMarkdown(breakdown);
    await navigator.clipboard.writeText(markdown);
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
            <span
              className={`rounded-full px-4 py-2 text-sm text-white ${
                gradient
                  ? "bg-gradient-to-r from-violet-500 to-cyan-500 shadow-violet"
                  : "border border-cyan-300/25 bg-cyan-400/10"
              }`}
              key={item}
            >
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
            <label
              className="flex cursor-pointer gap-3 rounded-lg border border-white/8 bg-white/5 p-3 text-sm text-slate-100 transition hover:border-cyan-300/25"
              key={item}
            >
              <input
                checked={Boolean(completed[item])}
                className="mt-1 size-4 accent-cyan-300"
                onChange={(event) => setCompleted((state) => ({ ...state, [item]: event.target.checked }))}
                type="checkbox"
              />
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-cyan-300/25 text-xs text-cyan-100">
                {index + 1}
              </span>
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
              <span className="z-10 grid size-7 shrink-0 place-items-center rounded-full border border-cyan-200/50 bg-[#111832] text-xs font-bold text-cyan-100">
                {index + 1}
              </span>
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
            <div className="rounded-lg border border-white/8 bg-white/5 px-4 py-3 text-sm text-slate-200" key={item}>
              {item}
            </div>
          ))
        ) : (
          <EmptyText />
        )}
      </div>
    </section>
  );
}

function IconButton({ icon: Icon, label, onClick }) {
  return (
    <button
      className="grid h-12 w-12 place-items-center rounded-lg border border-white/12 bg-white/6 text-cyan-100 transition hover:bg-white/10"
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon size={18} />
    </button>
  );
}

function ActionButton({ disabled = false, icon: Icon, label, onClick }) {
  return (
    <button
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/6 px-3 text-sm text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
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
  try {
    const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

createRoot(document.getElementById("root")).render(<App />);
