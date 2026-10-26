import { Component, Suspense, lazy, useEffect, useState } from "react";
import type { ComponentType, ErrorInfo, LazyExoticComponent, ReactNode } from "react";
import {
  BookOpen,
  ChartColumn,
  ChartLine,
  CircuitBoard,
  Database,
  Fingerprint,
  FlaskConical,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Microscope,
  Orbit,
  Presentation,
  ScanSearch,
  SlidersHorizontal,
  Target,
  Accessibility,
} from "lucide-react";
import { href, useRoute } from "./lib/router";
import { get } from "./lib/api";
import { Loading } from "./components/ui";
import { Presenter } from "./components/Presenter";

type Page = LazyExoticComponent<ComponentType<{ query: URLSearchParams }>>;
const page = (loader: () => Promise<{ default: ComponentType<{ query: URLSearchParams }> }>): Page => lazy(loader);

const PAGES: Record<string, Page> = {
  "/": page(() => import("./pages/Home")),
  "/lab": page(() => import("./pages/QecLab")),
  "/message": page(() => import("./pages/MessageLab")),
  "/circuit": page(() => import("./pages/CircuitInspector")),
  "/explainer": page(() => import("./pages/DecoderExplainer")),
  "/optimizer": page(() => import("./pages/ResourceOptimizer")),
  "/sim-benchmarks": page(() => import("./pages/SimBenchmarks")),
  "/dataset": page(() => import("./pages/DatasetExplorer")),
  "/shots": page(() => import("./pages/ShotExplorer")),
  "/hw-benchmarks": page(() => import("./pages/HardwareBenchmarks")),
  "/failures": page(() => import("./pages/FailureInvestigator")),
  "/advisor": page(() => import("./pages/ConfigAdvisor")),
  "/methodology": page(() => import("./pages/Methodology")),
  "/sources": page(() => import("./pages/Sources")),
};

interface NavItem { path: string; label: string; icon: ComponentType<{ className?: string }> }
const NAV: { section: string; tone?: string; module?: 1 | 2; items: NavItem[] }[] = [
  { section: "Overview", items: [{ path: "/", label: "Project overview", icon: LayoutDashboard }] },
  {
    section: "Module 1 · Interactive Studio", tone: "var(--cyan)", module: 1,
    items: [
      { path: "/lab", label: "QEC Lab", icon: FlaskConical },
      { path: "/message", label: "Message Lab", icon: MessageSquareText },
      { path: "/circuit", label: "Circuit Inspector", icon: CircuitBoard },
      { path: "/explainer", label: "Decoder Explainer", icon: Microscope },
      { path: "/optimizer", label: "Resource Optimizer", icon: SlidersHorizontal },
      { path: "/sim-benchmarks", label: "Simulation Benchmarks", icon: ChartLine },
    ],
  },
  {
    section: "Module 2 · Google Hardware", tone: "var(--teal)", module: 2,
    items: [
      { path: "/dataset", label: "Dataset Explorer", icon: Database },
      { path: "/shots", label: "Real Shot Explorer", icon: Orbit },
      { path: "/hw-benchmarks", label: "Decoder Benchmarks", icon: ChartColumn },
      { path: "/failures", label: "Failure Investigator", icon: ScanSearch },
      { path: "/advisor", label: "Configuration Advisor", icon: Target },
    ],
  },
  {
    section: "Evidence", items: [
      { path: "/methodology", label: "Methodology & provenance", icon: Fingerprint },
      { path: "/sources", label: "Sources & limitations", icon: BookOpen },
    ],
  },
];

class PageBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page render failed", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="callout err" role="alert">
          <div><b>This page failed to render.</b> {this.state.error.message} — no fallback values are shown. Reload the page or open another one.</div>
        </div>
      );
    return this.props.children;
  }
}

function titleFor(path: string) {
  for (const s of NAV) for (const i of s.items) if (i.path === path) return { section: s.section, label: i.label };
  return { section: "QRecall AutoQEC", label: "Not found" };
}

function Brand() {
  return (
    <a className="brand" href={href("/")}>
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#0c1424" stroke="#26365a" />
        <path d="M6 18h20" stroke="#26365a" strokeWidth="1.6" />
        <path d="M11 12l3 3-3 3-3-3z" fill="#a58bff" />
        <path d="M21 12l3 3-3 3-3-3z" fill="#a58bff" />
        <circle cx="6.5" cy="18" r="2.6" fill="#5ad8ef" />
        <circle cx="16" cy="18" r="2.6" fill="#5ad8ef" />
        <circle cx="25.5" cy="18" r="2.6" fill="#5ad8ef" />
        <circle cx="16" cy="25" r="1.6" fill="#3fd0b0" />
      </svg>
      <div>
        <div className="brand-name">QRecall AutoQEC</div>
        <div className="brand-sub">Explainable QEC · real hardware</div>
      </div>
    </a>
  );
}

export default function App() {
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [engine, setEngine] = useState<"checking" | "ok" | "down">("checking");
  const [dataset, setDataset] = useState<string>("");
  const [reduced, setReduced] = useState(() => {
    try {
      return localStorage.getItem("autoqec-reduced-motion") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", reduced);
    try {
      localStorage.setItem("autoqec-reduced-motion", reduced ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [reduced]);
  useEffect(() => {
    let alive = true;
    const check = () =>
      get<{ status: string }>("/health")
        .then(() => alive && setEngine("ok"))
        .catch(() => alive && setEngine("down"));
    check();
    get<{ active_layout: string | null; subset?: { experiment_count: number } }>("/google/status")
      .then((s) => alive && setDataset(s.active_layout === "full" ? "Full Google archive (131 experiments)" : s.active_layout === "subset" ? "Google data subset (real shots)" : "Google data not installed"))
      .catch(() => alive && setDataset(""));
    const t = window.setInterval(check, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  useEffect(() => setMenu(false), [route.path]);
  const Page = PAGES[route.path];
  const t = titleFor(route.path);
  const module = NAV.find((s) => s.items.some((i) => i.path === route.path))?.module;
  return (
    <div className="shell">
      <nav className={`sidebar ${menu ? "open" : ""}`} aria-label="Primary">
        <Brand />
        {NAV.map((s) => (
          <div key={s.section} className="nav-section">
            <div className="nav-label">{s.tone && <span className="dot" style={{ background: s.tone }} />}{s.section}</div>
            {s.items.map((i) => {
              const Icon = i.icon;
              return (
                <a key={i.path} href={href(i.path)} className={`nav-item ${s.module === 2 ? "m2" : ""} ${route.path === i.path ? "active" : ""}`}
                  aria-current={route.path === i.path ? "page" : undefined}>
                  <Icon />{i.label}
                </a>
              );
            })}
          </div>
        ))}
        <div className="sidebar-footer">
          <button className="btn primary full" onClick={() => setPresenting(true)}><Presentation />Present demo</button>
          <div className="status-pill" title="Scientific engine status">
            <span className={`led ${engine === "ok" ? "ok" : engine === "down" ? "err" : "warn"}`} />
            {engine === "ok" ? "Scientific engine online" : engine === "down" ? "Engine offline — run npm run dev" : "Connecting to engine…"}
          </div>
          {dataset && <div className="status-pill"><span className={`led ${dataset.startsWith("Google data not") ? "warn" : "ok"}`} />{dataset}</div>}
          <button className={`toggle ${reduced ? "on" : ""}`} onClick={() => setReduced(!reduced)} role="switch" aria-checked={reduced} style={{ padding: "4px 6px" }}>
            <span className="switch" /><Accessibility style={{ width: 14, height: 14 }} />Reduce motion
          </button>
          <a className="page-link" href="/legacy.html" style={{ fontSize: 12 }}><History />Legacy memory lab (original QRecall)</a>
        </div>
      </nav>
      {menu && <div className="drawer-backdrop" style={{ zIndex: 25 }} onClick={() => setMenu(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn icon menu-btn" onClick={() => setMenu(true)} aria-label="Open navigation"><Menu /></button>
          <div className="crumbs">
            <span>{t.section}</span><span>/</span><b>{t.label}</b>
          </div>
          <div className="topbar-actions">
            {module === 1 && <span className="badge sim">Module 1 · simulation</span>}
            {module === 2 && <span className="badge hw">Module 2 · real Google data</span>}
            <button className="btn sm" onClick={() => setPresenting(true)}><Presentation />Demo mode</button>
          </div>
        </header>
        <main className="content" id="main">
          {engine === "down" && (
            <div className="callout err" style={{ marginBottom: 16 }}>
              <div>
                <b>The scientific engine is offline.</b> Every number on these pages comes from the FastAPI backend; nothing is
                faked when it is unavailable. Start it with <code>npm run dev</code> (or the container) and the page will reconnect.
              </div>
            </div>
          )}
          <PageBoundary resetKey={route.path}>
            <Suspense fallback={<Loading label="Loading page…" />}>
              {Page ? <Page query={route.query} /> : (
                <div className="state-box"><b>Page not found.</b><a href={href("/")}>Back to the overview</a></div>
              )}
            </Suspense>
          </PageBoundary>
        </main>
      </div>
      {presenting && <Presenter onExit={() => setPresenting(false)} />}
    </div>
  );
}
