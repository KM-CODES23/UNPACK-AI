import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  FileText,
  GraduationCap,
  Loader2,
  Map,
  PanelLeft,
  Search,
  Send,
  Sparkles,
  Target,
} from "lucide-react";
import logo from "./assets/unpack-logo.jpeg";
import referenceImage from "./assets/interface-reference.png";
import "./styles.css";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const sampleAssignment =
  "Discuss how artificial intelligence can improve academic support for South African university students. Your essay should identify the main challenges students face, explain relevant AI tools, evaluate ethical concerns, and propose practical recommendations. Use at least five academic sources and follow Harvard referencing.";

function App() {
  const [assignment, setAssignment] = useState("");
  const [breakdown, setBreakdown] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const wordCount = useMemo(() => {
    return assignment.trim() ? assignment.trim().split(/\s+/).length : 0;
  }, [assignment]);

  async function analyzeAssignment(event) {
    event.preventDefault();

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
        body: JSON.stringify({
          assignment: trimmed,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not analyze the assignment.");
      }

      setBreakdown(data);
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
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#08142e] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(68,84,170,0.34),transparent_30%),linear-gradient(145deg,#08142e_0%,#121735_48%,#08142e_100%)]" />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: `url(${referenceImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />

      <div className="relative flex min-h-screen">
        <SideRail />

        <section className="flex min-w-0 flex-1 flex-col">
          <TopBar />

          <div className="grid flex-1 grid-cols-1 border-t border-white/10 lg:grid-cols-[390px_minmax(0,1fr)]">
            <aside className="border-r border-white/10 bg-[#111832]/78 px-5 py-6 backdrop-blur-xl">
              <BrandCard />
              <AssignmentForm
                assignment={assignment}
                error={error}
                isLoading={isLoading}
                onAnalyze={analyzeAssignment}
                onChange={setAssignment}
                onUseSample={useSample}
                wordCount={wordCount}
              />
            </aside>

            <ResultsWorkspace breakdown={breakdown} isLoading={isLoading} />
          </div>
        </section>
      </div>
    </main>
  );
}

function SideRail() {
  const items = [
    { icon: PanelLeft, label: "Workspace", active: true },
    { icon: FileText, label: "Brief" },
    { icon: ClipboardList, label: "Tasks" },
    { icon: Map, label: "Roadmap" },
  ];

  return (
    <nav className="hidden w-16 shrink-0 border-r border-white/10 bg-[#0b1230]/88 px-3 py-5 backdrop-blur-xl sm:block">
      <div className="mb-8 grid size-10 place-items-center rounded-lg border border-cyan-300/35 bg-cyan-400/10 text-cyan-200 shadow-glow">
        <GraduationCap size={22} />
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <button
            key={item.label}
            className={`grid size-10 place-items-center rounded-lg border transition ${
              item.active
                ? "border-cyan-300/35 bg-cyan-400/14 text-cyan-100"
                : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/7 hover:text-white"
            }`}
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

function TopBar() {
  return (
    <header className="flex h-17 items-center justify-between bg-[#111832]/82 px-5 backdrop-blur-xl sm:px-7">
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
        <button className="grid size-10 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300" type="button">
          <Bell size={18} />
        </button>
        <div className="size-10 rounded-full border border-white/15 bg-gradient-to-br from-slate-300 to-slate-600" />
      </div>
    </header>
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
        Paste a brief and Unpack.ai will extract the academic target, research concepts, tasks, structure, and a clear
        completion plan.
      </p>
    </section>
  );
}

function AssignmentForm({ assignment, error, isLoading, onAnalyze, onChange, onUseSample, wordCount }) {
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

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <button
          className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-400 px-5 text-sm font-bold text-white shadow-violet transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
          disabled={isLoading}
          type="submit"
        >
          {isLoading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          Analyze
        </button>
        <button
          className="grid h-12 w-12 place-items-center rounded-lg border border-white/12 bg-white/6 text-cyan-100 transition hover:bg-white/10"
          onClick={onUseSample}
          title="Load sample"
          type="button"
        >
          <Sparkles size={18} />
        </button>
      </div>
    </form>
  );
}

function ResultsWorkspace({ breakdown, isLoading }) {
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
    <section className="relative min-w-0 bg-[#101733]/68 p-5 backdrop-blur-xl sm:p-7">
      {isLoading ? <LoadingOverlay /> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <TopicPanel topic={data.mainTopic} summary={data.summary} />
          <ChipPanel title="Key Concepts" icon={BookOpenCheck} items={data.keyConcepts} />
          <ChipPanel title="Key Keywords" icon={Search} items={data.keywords} gradient />
          <TaskPanel items={data.requiredTasks} />
        </div>

        <div className="space-y-5">
          <RoadmapPanel items={data.completionPlan} />
          <StructurePanel items={data.suggestedStructure} />
        </div>
      </div>
    </section>
  );
}

function TopicPanel({ topic, summary }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#171f42]/82 p-5 shadow-glow">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200/75">Main Topic</p>
          <h2 className="mt-2 text-2xl font-bold leading-tight text-white">{topic || "Untitled assignment"}</h2>
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
  return (
    <section className="rounded-lg border border-white/10 bg-[#151d3c]/82 p-5">
      <div className="mb-4 flex items-center gap-2 text-slate-200">
        <ClipboardList size={18} className="text-cyan-200" />
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em]">Required Tasks</h3>
      </div>
      <div className="space-y-3">
        {items.length ? (
          items.map((item, index) => (
            <div className="flex gap-3 rounded-lg border border-white/8 bg-white/5 p-3 text-sm text-slate-100" key={item}>
              <span className="grid size-6 shrink-0 place-items-center rounded-md border border-cyan-300/25 text-xs text-cyan-100">
                {index + 1}
              </span>
              <p className="leading-6">{item}</p>
            </div>
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

createRoot(document.getElementById("root")).render(<App />);
