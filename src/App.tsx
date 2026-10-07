import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FlaskConical,
  Github,
  Grid2X2,
  Layers3,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  SkipBack,
  SlidersHorizontal,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import type { CSSProperties } from "react";
import { chapters, defaultConfig } from "./types";
import type {
  ClassicalEvent,
  Config,
  Evaluation,
  Preset,
  QuantumEvent,
  Result,
  Spin,
  MeasurementEvent,
} from "./types";
import { compute, evaluate, request, isConnectionError } from "./api";
import { usePlayback, responseIsCurrent } from "./playback";
import {
  Circuit,
  Distribution,
  EnergyChart,
  Equation,
  FieldGraph,
  formulas,
  Legend,
  num,
  Pattern,
  WeightMatrix,
} from "./components";
import Scene from "./Scene";
import MathLab from "./MathLab";
const wholeMemories: Spin[][] = [
  [1, 1, 1, -1, -1, 1, -1, -1],
  [1, -1, 1, 1, -1, -1, 1, -1],
  [-1, 1, -1, 1, 1, -1, -1, 1],
];
const labels: Record<string, string> = {
  hopfield: "Hopfield",
  gibbs: "Gibbs sampling",
  quantum: "QAOA",
  nearest_memory: "Nearest memory",
  exact_minimum: "Exact minimum",
  exact_gibbs: "Exact Gibbs",
};
function setting(name: string, fallback: string) {
  try {
    return localStorage.getItem(name) || fallback;
  } catch {
    return fallback;
  }
}
export default function App() {
  const [config, setConfig] = useState<Config>(defaultConfig),
    [target, setTarget] = useState(0),
    [chapter, setChapter] = useState(0),
    [result, setResult] = useState<Result | null>(null),
    [evaluation, setEvaluation] = useState<Evaluation | null>(null),
    [status, setStatus] = useState("computing"),
    [error, setError] = useState(""),
    [connectionLost, setConnectionLost] = useState(false),
    [notice, setNotice] = useState(""),
    [selectedPreset, setSelectedPreset] = useState(""),
    [startingJob, setStartingJob] = useState(false),
    [importing, setImporting] = useState(false),
    [filePreview, setFilePreview] = useState<{
      name: string;
      content: string;
      type: string;
      url?: string;
      error?: string;
    } | null>(null),
    [copyStatus, setCopyStatus] = useState(""),
    [autoplayChapter, setAutoplayChapter] = useState<number | null>(null),
    [pair, setPair] = useState<[number, number]>([1, 2]),
    [selectedState, setSelectedState] = useState(0),
    [allStates, setAllStates] = useState(false),
    [viewReset, setViewReset] = useState(0),
    [explain, setExplain] = useState("Explain"),
    [quality, setQuality] = useState(() => setting("qrecall-quality", "high")),
    [presenter, setPresenter] = useState(false),
    [alternateView, setAlternateView] = useState(false),
    [cinematic, setCinematic] = useState(false),
    [immersive, setImmersive] = useState(false),
    [mathLabOpen, setMathLabOpen] = useState(false),
    [sourcesOpen, setSourcesOpen] = useState(false),
    [presets, setPresets] = useState<Preset[]>([]),
    [job, setJob] = useState<{
      id: string;
      kind: string;
      status: string;
      progress: number;
    } | null>(null),
    [benchmark, setBenchmark] = useState<any>(null),
    [recorded, setRecorded] = useState<any>(null),
    [importError, setImportError] = useState(""),
    [optimization, setOptimization] = useState<NonNullable<
      Result["quantum"]["optimizer_history"]
    > | null>(null);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const corruption = config.cue.filter((s, i) =>
    config.mode === "erasure" ? s === null : s !== config.memories[target]?.[i],
  ).length;
  const revision = useRef(0),
    abort = useRef<AbortController | null>(null),
    fileInput = useRef<HTMLInputElement>(null),
    currentJob = useRef<string | null>(null),
    mathLabAnchor = useRef<HTMLDivElement>(null),
    mathLabToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!mathLabOpen) return;
    const frame = requestAnimationFrame(() => mathLabAnchor.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [mathLabOpen, reduced]);
  const jobPending = useRef(false);
  const update = useCallback(
    (patch: Partial<Config> | ((c: Config) => Config)) => {
      revision.current++;
      setOptimization(null);
      setSelectedPreset("");
      setNotice("");
      setConfig((c) => ({
        ...(typeof patch === "function" ? patch(c) : { ...c, ...patch }),
        revision: revision.current,
      }));
      setEvaluation(null);
      setStatus("computing");
      setError("");
      if (currentJob.current) {
        request(`/jobs/${currentJob.current}`, { method: "DELETE" }).catch(
          () => {},
        );
        currentJob.current = null;
        setJob(null);
      }
    },
    [],
  );
  useEffect(() => {
    const control = new AbortController();
    abort.current?.abort();
    abort.current = control;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const [r, e] = await Promise.all([
          compute(config, control.signal),
          evaluate(config, target, control.signal),
        ]);
        if (active && responseIsCurrent(r.revision, revision.current)) {
          setResult(r);
          setEvaluation(e);
          setStatus("ready");
          setConnectionLost(false);
          setError("");
          setSelectedState(
            r.model.energies.indexOf(Math.min(...r.model.energies)),
          );
        }
      } catch (err) {
        if (
          active &&
          !(err instanceof DOMException && err.name === "AbortError")
        ) {
          setError((err as Error).message);
          setConnectionLost(isConnectionError(err));
          setStatus("error");
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      control.abort();
    };
  }, [config, target]);
  useEffect(() => {
    if (status !== "ready" || (presets.length && recorded)) return;
    request<any>("/presets")
      .then((data) =>
        setPresets(Array.isArray(data) ? data : data.presets || []),
      )
      .catch(() => {});
    request<any>("/benchmarks/recorded")
      .then(setRecorded)
      .catch(() => {});
  }, [status, presets.length, recorded]);
  useEffect(() => {
    if (!connectionLost || status !== "error") return;
    const control = new AbortController();
    let pending = false;
    const reconnect = async () => {
      if (pending) return;
      pending = true;
      try {
        await request("/health", { signal: control.signal });
        if (!control.signal.aborted) update({});
      } catch {
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(reconnect, 3000);
    return () => {
      clearInterval(timer);
      control.abort();
    };
  }, [connectionLost, status, update]);
  useEffect(() => {
    try {
      localStorage.setItem("qrecall-quality", quality);
    } catch {}
  }, [quality]);
  const current = result?.revision === config.revision ? result : null;
  let events: (ClassicalEvent | QuantumEvent | MeasurementEvent)[] = [];
  if (chapter === 2) events = current?.hopfield.trace || [];
  if (chapter === 3) events = current?.gibbs.trace || [];
  if (chapter === 4) events = current?.quantum.trace || [];
  if (chapter === 5) events = current?.quantum.measurement_trace || [];
  if (presenter && chapter === 3) events = events.slice(0, 24);
  const playback = usePlayback(events.length || 1, config.revision, chapter);
  const animatedChapter = chapter >= 2 && chapter <= 5;
  const jobBusy =
    startingJob ||
    (!!job && !["completed", "failed", "cancelled"].includes(job.status));
  useEffect(() => {
    if (autoplayChapter === null || chapter !== autoplayChapter || !current)
      return;
    if (events.length > 1) playback.play();
    setAutoplayChapter(null);
  }, [autoplayChapter, chapter, current, events.length]);
  const runAnimation = () => {
    if (!current) return;
    if (animatedChapter) playback.toggle();
    else {
      setChapter(2);
      setAutoplayChapter(2);
    }
  };
  const event =
    chapter === 2 || chapter === 3
      ? (events[playback.index] as ClassicalEvent | undefined)
      : undefined;
  const quantumEvent =
    chapter === 5
      ? current?.quantum.trace.at(-1)
      : chapter === 4
        ? (events[playback.index] as QuantumEvent | undefined)
        : undefined;
  const measurementEvent =
    chapter === 5
      ? (events[playback.index] as MeasurementEvent | undefined)
      : undefined;
  const state: Spin[] =
    measurementEvent?.output ||
    event?.state_after ||
    (chapter === 5
      ? current?.quantum.output
      : chapter === 1
        ? current?.model.initial_state
        : config.memories[target]) ||
    config.memories[0];
  const go = (next: number) => {
    setAutoplayChapter(null);
    setChapter(Math.max(0, Math.min(7, next)));
  };
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.defaultPrevented || document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        setImmersive(false);
        setPresenter(false);
        setSourcesOpen(false);
        setFilePreview(null);
        return;
      }
      if (sourcesOpen || filePreview) return;
      if ((e.target as HTMLElement)?.matches("input,select,textarea")) return;
      if ((e.target as HTMLElement)?.closest(".equation-math, .circuit-scroll, .math-lab")) return;
      if (e.code === "Space" && (e.target as HTMLElement)?.matches("button"))
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (presenter) go(chapter + 1);
        else playback.step(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (presenter) go(chapter - 1);
        else playback.step(-1);
      }
      if (e.code === "Space") {
        e.preventDefault();
        runAnimation();
      }
      if (/^[1-8]$/.test(e.key)) go(Number(e.key) - 1);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [chapter, presenter, playback, sourcesOpen, filePreview, current]);
  const changeTarget = (i: number) => {
    if (i === target) return;
    setTarget(i);
    update((c) => ({
      ...c,
      cue: c.memories[i].map((s, k) => (c.cue[k] === null ? null : s)),
    }));
  };
  const changeMode = (mode: "erasure" | "noisy") => {
    if (config.mode === mode) return;
    if (mode === "erasure") {
      const d = defaultConfig();
      setTarget(0);
      update(() => ({ ...d, seed: config.seed }));
    } else {
      setTarget(0);
      update(() => ({
        ...defaultConfig(),
        rows: 2,
        cols: 4,
        memories: wholeMemories.map((m) => [...m]),
        mode: "noisy",
        cue: wholeMemories[0].map((s, i) =>
          [2, 6].includes(i) ? (-s as Spin) : s,
        ),
      }));
    }
  };
  const damage = (amount: number) => {
    const n = config.rows * config.cols;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) =>
        ((a * 7 + config.seed * 3) % n) - ((b * 7 + config.seed * 3) % n),
    );
    update({
      observed_mask: null,
      trusted_mask: null,
      cue: config.memories[target].map((s, i) =>
        order.slice(0, amount).includes(i)
          ? config.mode === "erasure"
            ? null
            : (-s as Spin)
          : s,
      ),
    });
  };
  const editCue = (i: number) => {
    const cue = [...config.cue];
    if (config.mode === "erasure") {
      if (cue[i] !== null && cue.filter((s) => s === null).length >= 8) {
        setError(
          "The local quantum demo supports up to 8 unknown pixels. Restore a pixel first.",
        );
        return;
      }
      cue[i] = cue[i] === null ? config.memories[target][i] : null;
    } else cue[i] = cue[i] === null ? 1 : (-cue[i]! as Spin);
    update({ cue, observed_mask: null, trusted_mask: null });
  };
  const beginJob = async (kind: "optimize" | "benchmark") => {
    if (jobPending.current || currentJob.current || !current) return;
    jobPending.current = true;
    setStartingJob(true);
    try {
      setJob(null);
      setError("");
      const requestedRevision = revision.current;
      const j = await request<any>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          kind,
          config,
          evaluation_budget: 36,
          cases: 12,
          benchmark_seed: 20261005,
        }),
      });
      if (requestedRevision !== revision.current) {
        request(`/jobs/${j.id || j.job_id}`, { method: "DELETE" }).catch(
          () => {},
        );
        return;
      }
      currentJob.current = j.id || j.job_id;
      setJob({ id: currentJob.current!, kind, status: "running", progress: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      jobPending.current = false;
      setStartingJob(false);
    }
  };
  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled"].includes(job.status))
      return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await request<any>(`/jobs/${job.id}`);
        if (!active || currentJob.current !== job.id) return;
        const progress =
          typeof response.progress === "number" ? response.progress : 0;
        setJob((j) => (j ? { ...j, status: response.status, progress } : j));
        if (response.status === "completed") {
          currentJob.current = null;
          if (job.kind === "optimize") {
            const r = response.result;
            const angles = r.quantum || r;
            update({ gammas: angles.gammas, betas: angles.betas });
            setOptimization(angles.optimizer_history || null);
            setJob(null);
          } else {
            setBenchmark(response.result);
            setJob(null);
          }
        } else if (response.status === "failed") {
          setError(
            response.error?.message ||
              response.error ||
              "Computation failed. Try a smaller run.",
          );
          currentJob.current = null;
        } else if (response.status === "cancelled") {
          currentJob.current = null;
        } else timer = setTimeout(poll, 600);
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          currentJob.current = null;
          setJob(null);
        }
      }
    };
    timer = setTimeout(poll, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, update]);
  const cancelJob = async () => {
    if (!job) return;
    try {
      await request(`/jobs/${job.id}`, { method: "DELETE" });
      currentJob.current = null;
      setJob({ ...job, status: "cancelled" });
      setNotice("Run cancelled. You can start another computation.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const loadPreset = (id: string) => {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setTarget(preset.target_index || 0);
    update(preset.config);
    setSelectedPreset(id);
    setNotice(
      `${preset.label} loaded. Choose Recall, Thermal, Quantum or Measure, then Play.`,
    );
    playback.reset();
  };
  const startPresenter = () => {
    const easy = presets.find((p) => p.id === "easy");
    if (easy) {
      setTarget(easy.target_index);
      update(easy.config);
    } else {
      setTarget(0);
      update(defaultConfig());
    }
    setChapter(2);
    setAutoplayChapter(2);
    setPresenter(true);
  };
  const doImport = async (file: File) => {
    setImporting(true);
    try {
      if (file.size > 24_000_000)
        throw new Error("Choose an experiment JSON smaller than 24 MB.");
      const value = JSON.parse(await file.text());
      const c = value.config || value.experiment?.config || value;
      if (!c || typeof c !== "object")
        throw new Error("Choose a QRecall configuration object.");
      if (!Array.isArray(c.memories) || !Array.isArray(c.cue))
        throw new Error("This file needs a QRecall experiment configuration.");
      const requestedRevision = revision.current;
      const verified = await compute(
        { ...defaultConfig(), ...c },
        new AbortController().signal,
      );
      if (requestedRevision !== revision.current)
        throw new Error(
          "Your inputs changed during import. Select the file again to replace them.",
        );
      setTarget(0);
      update(() => verified.config);
      setImportError("");
      setNotice(
        "Configuration validated and imported. Your previous inputs were replaced.",
      );
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  };
  const prepareExport = async (
    name: string,
    value: unknown,
    type = "application/json",
  ) => {
    const content =
      typeof value === "string" ? value : JSON.stringify(value);
    setCopyStatus("");
    setFilePreview({ name, content, type });
    try {
      const file = await request<{ url: string }>("/exports", {
        method: "POST",
        body: JSON.stringify({ filename: name, content, media_type: type }),
      });
      setFilePreview((previous) =>
        previous?.content === content
          ? { ...previous, url: file.url }
          : previous,
      );
    } catch (error) {
      setFilePreview((previous) =>
        previous?.content === content
          ? { ...previous, error: (error as Error).message }
          : previous,
      );
    }
  };
  const exportExperiment = () => {
    if (!current) return;
    prepareExport(`qrecall-seed-${config.seed}.json`, {
      schema_version: "1.0",
      exported_at: new Date().toISOString(),
      config,
      optimizer_history: optimization,
      result: current,
      evaluation,
      benchmark,
      source: "QRecall local prototype",
      limitations: [
        "Simulation, not quantum hardware",
        "No demonstrated quantum advantage",
        "Energy optimum need not equal the original memory",
      ],
    });
  };
  const exportCsv = () => {
    if (!benchmark) return;
    prepareExport("qrecall-benchmark.csv", toCsv(benchmark), "text/csv");
  };
  const title = chapters[chapter];
  const accent = title.color;
  return (
    <div
      className={`app ${presenter ? "presenter" : ""} ${immersive ? "immersive" : ""}`}
      data-reduced-motion={reduced}
      style={{ "--accent": accent } as CSSProperties}
    >
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go(0);
          }}
          aria-label="QRecall home"
        >
          <span className="brand-mark">
            <span />
            <span />
            <span />
            <span />
          </span>
          <b>
            QRecall<span className="brand-dot">.</span>
          </b>
        </a>
        <div className="header-center">
          <span className="live-dot" />
          VISUAL QUANTUM MEMORY RECOVERY
          <span className="header-divider" />
          Q-HACK 2026
        </div>
        <div className="header-actions">
          <button
            className="text-button edit-input-button"
            onClick={() => {
              setPresenter(false);
              setExplain("Explain");
              setChapter(1);
              setAutoplayChapter(null);
              playback.pause();
              setNotice(
                config.mode === "erasure"
                  ? "Edit input: click a ? pixel to restore it, then erase another pixel. At most eight can be unknown."
                  : "Edit input: click a pixel to flip its noisy observation. Use Erase to switch to missing pixels.",
              );
            }}
          >
            <SlidersHorizontal size={14} /> Edit input
          </button>
          <button
            className="text-button sources-button"
            onClick={() => setSourcesOpen(true)}
          >
            <CircleHelp size={15} /> About the science
          </button>
          <button
            className="present-button"
            onClick={() => (presenter ? setPresenter(false) : startPresenter())}
          >
            {presenter ? <X size={14} /> : <Play size={13} />}{" "}
            {presenter ? "Exit presentation" : "Present demo"}
          </button>
        </div>
      </header>
      <main className="workspace">
        <nav className="chapter-rail" aria-label="Chapters">
          <div className="rail-label">THE EXPERIMENT</div>
          {chapters.map((c, i) => (
            <button
              key={c.id}
              className={`chapter-link ${chapter === i ? "active" : ""} ${chapter > i ? "visited" : ""}`}
              onClick={() => go(i)}
              aria-current={chapter === i ? "step" : undefined}
              title={`${i + 1}. ${c.label}`}
            >
              <span className="chapter-num">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="chapter-name">{c.label}</span>
              <i />
            </button>
          ))}
          <div className="rail-end">
            <span className="rail-line" />
            <span>
              ONE ENERGY.
              <br />
              THREE PATHS.
            </span>
          </div>
        </nav>
        <div className="main-content">
          <section className="chapter-heading">
            <div className="eyebrow">
              <span className="accent-line" />
              {String(chapter + 1).padStart(2, "0")} /{" "}
              {chapter === 0
                ? "MEMORY ENCODING"
                : chapter === 1
                  ? "CUE CONDITIONING"
                  : chapter === 2
                    ? "DETERMINISTIC DESCENT"
                    : chapter === 3
                      ? "THERMAL EXPLORATION"
                      : chapter === 4
                        ? "QUANTUM INTERFERENCE"
                        : chapter === 5
                          ? "MEASUREMENT & RECOVERY"
                          : chapter === 6
                            ? "REPRODUCIBLE EVALUATION"
                            : "EXPERIMENT PROVENANCE"}
            </div>
            <h1>
              {title.title.split("\n").map((line, i) => (
                <span key={i}>{line}</span>
              ))}
            </h1>
            <p>
              {chapter === 0
                ? `${config.memories.length} stored patterns. One shared energy. Three ways to find your way back.`
                : title.sub}
            </p>
            <div className="chapter-meta">
              <span>
                <i className="mini-square" />
                {config.rows * config.cols} pixels
              </span>
              <span>
                {current?.model.free_indices.length ??
                  config.cue.filter((s) => s === null).length}{" "}
                {config.mode === "noisy" ? "free variables" : "unknown pixels"}
              </span>
              <span className="mono">SEED {config.seed}</span>
            </div>
          </section>
          {error && (
            <div className="error-banner" role="alert">
              <span>
                {error}
                {connectionLost && (
                  <small>
                    {" "}
                    The page will reconnect automatically when the engine is
                    available.
                  </small>
                )}
              </span>
              <button
                onClick={() => {
                  setError("");
                  update({});
                }}
              >
                Retry
              </button>
            </div>
          )}
          {notice && (
            <div className="notice-banner" role="status">
              {notice}
            </div>
          )}
          {chapter === 6 ? (
            <section className="compare-stage">
              <Comparison
                evaluation={evaluation}
                config={config}
                result={current}
              />
              <div className="benchmark-header">
                <div>
                  <h2>Beyond one good example.</h2>
                  <p>
                    12 independently generated cues · seeded protocol · Wilson
                    uncertainty
                  </p>
                </div>
                <div className="benchmark-actions">
                  {recorded && (
                    <button
                      className="text-button"
                      onClick={() => setBenchmark(recorded)}
                    >
                      Load recorded evidence
                    </button>
                  )}
                  <button
                    className="primary-button"
                    disabled={jobBusy || !current}
                    onClick={() => beginJob("benchmark")}
                  >
                    <FlaskConical size={15} /> Run benchmark
                  </button>
                </div>
              </div>
              {benchmark ? (
                <BenchmarkView data={benchmark} onExport={exportCsv} />
              ) : (
                <p className="fine-print">
                  Run the batch to see actual recovery rates and resource
                  counts. A curated demo is not an aggregate result.
                </p>
              )}
            </section>
          ) : chapter === 7 ? (
            <section className="export-stage">
              <div className="export-main">
                <div className="export-glyph">
                  <Layers3 size={60} />
                </div>
                <h2>Carry the evidence with you.</h2>
                <p>
                  Your export contains the input, learned weights, conditioned
                  fields, event traces, actual circuit, counts, seeds and
                  package versions.
                </p>
                <button
                  className="primary-button"
                  disabled={!current}
                  onClick={exportExperiment}
                >
                  <Download size={16} /> Export experiment JSON
                </button>
                <button
                  className="text-button"
                  disabled={importing}
                  onClick={() => fileInput.current?.click()}
                >
                  <ArrowUpRight size={15} />{" "}
                  {importing
                    ? "Validating configuration…"
                    : "Import a saved configuration"}
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.[0]) doImport(e.target.files[0]);
                    e.target.value = "";
                  }}
                />
                {importError && <p className="error-text">{importError}</p>}
              </div>
              <div className="provenance">
                <div className="section-label">EXECUTION RECORD</div>
                <dl>
                  <dt>Engine</dt>
                  <dd>Qiskit + Aer · local simulator</dd>
                  <dt>Configuration</dt>
                  <dd className="mono">
                    {current?.config_hash?.slice(0, 16) || "computing"}
                  </dd>
                  <dt>Execution</dt>
                  <dd>
                    {current?.quantum.execution_mode || "ideal simulation"}
                  </dd>
                  <dt>Seed</dt>
                  <dd>{config.seed}</dd>
                  <dt>Free → global pixels</dt>
                  <dd className="mono">
                    {current?.model.free_indices.join(", ")}
                  </dd>
                  <dt>Versions</dt>
                  <dd>
                    {Object.entries(current?.provenance.versions || {})
                      .map(([name, v]) => `${name} ${v}`)
                      .join(" · ")}
                  </dd>
                </dl>
                <Equation tex={formulas.export} />
                <p className="fine-print">
                  Logical bit order is pixel 0 first. Qiskit count strings are
                  most significant bit first. One tested mapping connects them.
                </p>
                <button
                  className="text-button"
                  onClick={() => setSourcesOpen(true)}
                >
                  Sources and limitations <ArrowUpRight size={14} />
                </button>
              </div>
            </section>
          ) : (
            <section className="instrument">
              <div className="stage">
                <div className="stage-topline">
                  <span>
                    <span className="live-dot" />
                    {status === "computing"
                      ? "RECOMPUTING"
                      : current
                        ? "LIVE COMPUTATION"
                        : "AWAITING ENGINE"}
                  </span>
                  <span className="mono">
                    {chapter < 2
                      ? "W · WEIGHT NETWORK"
                      : chapter < 4
                        ? "E · DISCRETE ENERGY"
                        : chapter === 4
                          ? "ψ · STATE SPACE"
                          : "P · SHOT DISTRIBUTION"}
                  </span>
                </div>
                <div className="explore-toolbar" aria-label="3D exploration controls">
                  <select aria-label="3D visualization" value={alternateView ? "alternate" : "primary"} onChange={e => { setAlternateView(e.target.value === "alternate"); setViewReset(v => v + 1); }}>
                    <option value="primary">{chapter < 2 ? "Pixel network" : chapter < 4 ? "Energy terrain" : "Probability columns"}</option>
                    <option value="alternate">{chapter < 2 ? "Weight sculpture" : chapter < 4 ? "State constellation" : chapter === 4 ? "Phase constellation" : "Measurement constellation"}</option>
                  </select>
                  <button aria-pressed={cinematic} disabled={!current || reduced || quality === "fallback" || (chapter >= 4 && !current.model.free_indices.length)} title={reduced ? "Turn off Reduced motion to enable camera movement" : "Camera orbit follows live playback; dragging pauses the orbit until Reset camera"} onClick={() => {
                    setCinematic(v => !v);
                    setViewReset(v => v + 1);
                    if (!cinematic) {
                      if (animatedChapter && events.length > 1) playback.play();
                      else { setChapter(2); setAutoplayChapter(2); }
                    }
                  }}><Sparkles size={13} />Cinematic</button>
                  <button aria-pressed={immersive} onClick={() => { setImmersive(v => !v); setViewReset(v => v + 1); }}><Square size={13} />{immersive ? "Exit focus" : "Focus 3D"}</button>
                  <button ref={mathLabToggle} aria-pressed={mathLabOpen} aria-expanded={mathLabOpen} aria-controls="math-workbench" disabled={!current} onClick={() => setMathLabOpen(v => !v)}><FlaskConical size={13} />Math lab</button>
                  <button aria-pressed={reduced} onClick={() => setReduced(v => !v)}>{reduced ? "Motion: reduced" : "Motion: full"}</button>
                </div>
                <div className="scene-canvas">
                  <div
                    className="animation-toolbar"
                    aria-label="Live animation"
                  >
                    {animatedChapter && (
                      <button
                        className="icon-button"
                        aria-label="Previous animation step"
                        disabled={!current || playback.index === 0}
                        onClick={() => playback.step(-1)}
                      >
                        <ChevronLeft size={14} />
                      </button>
                    )}
                    <button
                      className="stage-play-button"
                      disabled={
                        !current ||
                        (animatedChapter
                          ? events.length < 2
                          : !current.model.free_indices.length)
                      }
                      aria-label={
                        playback.playing ? "Pause animation" : "Run animation"
                      }
                      onClick={runAnimation}
                    >
                      {playback.playing ? (
                        <Pause size={13} />
                      ) : (
                        <Play size={13} />
                      )}{" "}
                      {playback.playing
                        ? "Pause"
                        : animatedChapter && playback.index >= events.length - 1
                          ? "Replay steps"
                          : animatedChapter
                            ? "Play steps"
                            : "Animate recall"}
                    </button>
                    {animatedChapter && (
                      <button
                        className="icon-button"
                        aria-label="Next animation step"
                        disabled={
                          !current || playback.index >= events.length - 1
                        }
                        onClick={() => playback.step(1)}
                      >
                        <ChevronRight size={14} />
                      </button>
                    )}
                    {events.length > 0 && (
                      <span className="mono">
                        {playback.index + 1} / {events.length}
                      </span>
                    )}
                  </div>
                  {current && chapter >= 4 && !current.model.free_indices.length ? (
                    <div className="fully-observed-stage">
                      <Check size={28} />
                      <Pattern values={current.quantum.output} cols={current.model.cols} large aria="Fully observed reconstruction" />
                      <h3>All pixels are already observed</h3>
                      <p>No circuit gates or measurement shots are needed.</p>
                    </div>
                  ) : current && (
                    <Scene
                      result={current}
                      chapter={chapter}
                      event={event}
                      quantumEvent={quantumEvent}
                      pair={pair}
                      state={state}
                      selectedState={selectedState}
                      onState={setSelectedState}
                      onPair={setPair}
                      reduced={reduced}
                      quality={quality}
                      presenter={presenter}
                      playing={playback.playing}
                      progressRef={playback.progressRef}
                      allStates={allStates}
                      viewReset={viewReset}
                      alternateView={alternateView}
                      cinematic={cinematic}
                      counts={
                        measurementEvent?.counts || current.quantum.counts
                      }
                    />
                  )}{" "}
                  {current && (chapter < 4 || current.model.free_indices.length > 0) && (
                    <div className="scene-data-readout">
                      {chapter < 2 ? (
                        <>
                          <span>SELECTED CONNECTION</span>
                          <b>
                            x{pair[0]} ↔ x{pair[1]} · W ={" "}
                            {num(current.model.weights[pair[0]]?.[pair[1]])}
                          </b>
                        </>
                      ) : chapter < 4 ? (
                        <>
                          <span>CURRENT CONFIGURATION</span>
                          <b>
                            {state.map((s) => (s === 1 ? "0" : "1")).join("")} ·
                            E = {num(event?.energy_after)}
                          </b>
                          <small>
                            Inspected state {selectedState} · E ={" "}
                            {num(current.model.energies[selectedState])}
                          </small>
                        </>
                      ) : (
                        <>
                          <span>SELECTED BASIS STATE</span>
                          <b>
                            {current.model.free_states[selectedState]
                              ?.map((s) => (s === 1 ? "0" : "1"))
                              .join("") || "∅"}{" "}
                            · {chapter === 5 ? "f" : "P"} ={" "}
                            {num(
                              chapter === 5 && measurementEvent
                                ? (measurementEvent.counts[selectedState] ||
                                    0) / measurementEvent.shots
                                : (quantumEvent?.probabilities ||
                                    current.quantum.probabilities)[
                                    selectedState
                                  ],
                              4,
                            )}
                          </b>
                        </>
                      )}
                    </div>
                  )}{" "}
                  {event && current && (
                    <div className="local-field-stage">
                      <div className="section-label">
                        ACTUAL FIELD → PIXEL {event.neuron}
                      </div>
                      <FieldGraph
                        result={current}
                        event={event}
                        playing={playback.playing && !reduced}
                        progressRef={playback.progressRef}
                      />
                    </div>
                  )}
                  {!current && (
                    <div className="stage-loading">
                      <div className="loading-orbit">
                        <Layers3 size={32} />
                      </div>
                      <span>
                        {status === "error"
                          ? "The engine needs attention"
                          : "Computing the shared energy model"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="stage-bottomline">
                  <span>
                    {chapter >= 4 && current && !current.model.free_indices.length
                      ? "Fully observed cue · no circuit or measurement shots"
                      : alternateView
                      ? chapter < 2 ? "Displacement = signed weight · teal positive / amber negative"
                        : chapter < 4 ? "Exact state energies · links join states differing by one free bit · placement is a visual guide"
                        : chapter === 4 ? "Sphere volume = ideal probability · hue = relative phase · placement is a visual guide"
                        : "Sphere volume = measured frequency · amber marks the measured mode · placement is a visual guide"
                      : chapter < 2
                      ? "Solid = positive coupling · dashed = negative"
                      : chapter < 4
                        ? "State height/color = exact energy · surface and motion are visual guides"
                        : chapter === 5
                          ? "Actual Aer shot frequencies · cumulative measurement playback"
                          : `Ideal statevector · ${allStates ? 2 ** (current?.model.free_indices.length || 0) : Math.min(quality === "low" ? 16 : 32, 2 ** (current?.model.free_indices.length || 0))} of ${2 ** (current?.model.free_indices.length || 0)} basis states · ring = relative phase`}
                  </span>
                  <div className="view-controls">
                    <button
                      aria-label="Reset camera view"
                      title="Reset camera view"
                      disabled={quality === "fallback" || !current || (chapter >= 4 && !current.model.free_indices.length)}
                      onClick={() => setViewReset((v) => v + 1)}
                    >
                      <RotateCcw size={12} />
                    </button>
                    <button
                      className={quality === "fallback" ? "active" : ""}
                      onClick={() =>
                        setQuality(quality === "fallback" ? "high" : "fallback")
                      }
                      title="Toggle functional 2D fallback"
                    >
                      <Grid2X2 size={13} />
                      {quality === "fallback" ? "2D" : "3D"}
                    </button>
                    <select
                      value={quality}
                      aria-label="Rendering quality"
                      onChange={(e) => setQuality(e.target.value)}
                    >
                      <option value="high">High</option>
                      <option value="low">Low</option>
                      <option value="fallback">2D</option>
                    </select>
                  </div>
                </div>
                {current && (
                  <SceneStep
                    chapter={chapter}
                    event={event}
                    quantumEvent={quantumEvent}
                    measurementEvent={measurementEvent}
                    index={playback.index}
                    length={events.length}
                    playing={playback.playing}
                    pair={pair}
                    result={current}
                  />
                )}
                {chapter === 4 && current && (
                  <div className="qubit-mapping-strip">
                    <div className="section-label">FREE PIXEL → QUBIT · COMPUTED FIELD</div>
                    <div>
                      {current.model.free_indices.map((pixel, qubit) => (
                        <span key={pixel}><b>q{qubit}</b> ← x{pixel}<small>h = {num(current.model.fields[qubit])}</small></span>
                      ))}
                    </div>
                  </div>
                )}
                {chapter === 4 && current && (
                  <div className="circuit-panel">
                    <div className="section-label">
                      <span>ACTUAL QAOA CIRCUIT</span>
                      <span>
                        {current.model.free_indices.length} qubits · p ={" "}
                        {config.depth}
                      </span>
                    </div>
                    <Circuit result={current} event={quantumEvent} />
                  </div>
                )}
              </div>
              <aside className="inspector">
                <div className="inspector-tabs">
                  {["Explain", "Math", "Circuit"].map((t) => (
                    <button
                      key={t}
                      className={explain === t ? "active" : ""}
                      onClick={() => setExplain(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="inspector-content">
                  {explain === "Math" ? (
                    <MathInspector
                      chapter={chapter}
                      config={config}
                      result={current}
                      event={event}
                    />
                  ) : explain === "Circuit" ? (
                    <>
                      <div className="inspector-kicker">
                        ACTUAL CIRCUIT / PIXEL MAPPING
                      </div>
                      <h2>Inspect every gate.</h2>
                      <p>
                        Each free pixel becomes one qubit. This is the circuit
                        executed by Qiskit for your current inputs.
                      </p>
                      <Equation tex={formulas.hamiltonian} />
                      {current ? (
                        <Circuit result={current} event={quantumEvent} />
                      ) : (
                        <p>
                          Connect the scientific engine to compute the circuit.
                        </p>
                      )}
                      <Equation
                        tex={String.raw`\operatorname{RZZ}(-2\gamma W_{ij}),\quad \operatorname{RZ}(-2\gamma h_i),\quad \operatorname{RX}(2\beta)`}
                      />
                      <p className="fine-print">
                        Scroll the gate diagram horizontally. Play the Quantum
                        chapter to highlight the actual operation and its
                        statevector snapshot.
                      </p>
                    </>
                  ) : chapter === 0 ? (
                    <>
                      <div className="inspector-kicker">
                        01 / LEARNING A RELATIONSHIP
                      </div>
                      <h2>
                        Memory becomes
                        <br />
                        connection.
                      </h2>
                      <p>
                        Pixels that agree reinforce a positive weight. Pixels
                        that disagree contribute a negative one. All memories
                        share the same network.
                      </p>
                      <Equation tex={formulas.store} />
                      {current && (
                        <WeightMatrix
                          result={current}
                          pair={pair}
                          onPair={setPair}
                          memory={target}
                        />
                      )}
                      <p className="fine-print">
                        Select a matrix cell to light up the corresponding pair
                        in the network.
                      </p>
                    </>
                  ) : chapter === 1 ? (
                    <>
                      <div className="inspector-kicker">
                        02 / THE SAME CONDITIONED PROBLEM
                      </div>
                      <h2>
                        A clue, with
                        <br />
                        clear assumptions.
                      </h2>
                      <p>
                        {config.mode === "erasure"
                          ? "Trusted pixels stay fixed. Their influence becomes a local field on each unknown pixel."
                          : "Every observed pixel can change. The noisy cue adds a soft preference to the energy, never a hard clamp."}
                      </p>
                      <Equation
                        tex={
                          config.mode === "erasure"
                            ? formulas.damage
                            : String.raw`E_{\rm cue}(s)=E(s)-\lambda\sum_{i\in O}r_i y_i s_i`
                        }
                      />
                      <Pattern
                        values={config.cue}
                        cols={config.cols}
                        onCell={editCue}
                        clamped={current?.model.trusted_indices}
                        large
                        aria="Edit damaged cue"
                      />
                      <Legend />
                      <div className="inspector-callout">
                        {config.rows * config.cols} pixels ·{" "}
                        {current?.model.free_indices.length || 0} free variables
                        · {current?.model.free_indices.length || 0} simulated
                        qubits
                      </div>
                    </>
                  ) : chapter === 2 || chapter === 3 ? (
                    <>
                      <div className="inspector-kicker">
                        {chapter === 2
                          ? "03 / ONE ACTUAL UPDATE"
                          : "04 / ONE ACTUAL SEEDED DRAW"}
                      </div>
                      <h2>
                        {chapter === 2
                          ? "Neighbors vote.\nOne neuron decides."
                          : "Temperature changes\nthe decision."}
                      </h2>
                      <p>
                        {chapter === 2
                          ? "An asynchronous update cannot increase this energy. A zero field retains the spin. Convergence can still reach the wrong memory."
                          : "Uphill moves are allowed. The exact Gibbs distribution is a reference; a finite chain has sampling error."}
                      </p>
                      <Equation
                        tex={
                          chapter === 2 ? formulas.hopfield : formulas.thermal
                        }
                      />
                      {event && (
                        <>
                          <div className="event-values">
                            <span>
                              PIXEL <b>{event.neuron}</b>
                            </span>
                            <span>
                              FIELD <b>{num(event.local_field)}</b>
                            </span>
                            <span>
                              ΔE{" "}
                              <b>
                                {num(event.energy_after - event.energy_before)}
                              </b>
                            </span>
                          </div>
                          {chapter === 3 ? (
                            <div className="gibbs-decision">
                              <div className="probability-split">
                                <i
                                  style={{
                                    width: `${(event.p_plus ?? event.probability_plus ?? 0) * 100}%`,
                                  }}
                                />
                                <span
                                  style={{
                                    left: `${(event.draw ?? event.random_draw ?? 0) * 100}%`,
                                  }}
                                />
                              </div>
                              <div className="probability-labels">
                                <span>
                                  P(+1) ={" "}
                                  {num(event.p_plus ?? event.probability_plus)}
                                </span>
                                <span>
                                  draw = {num(event.draw ?? event.random_draw)}
                                </span>
                              </div>
                              <p className="decision-caption">
                                {event.energy_after >
                                event.energy_before + 1e-10
                                  ? "↑ A real sampled uphill move"
                                  : event.state_after[event.neuron] ===
                                      event.state_before[event.neuron]
                                    ? "This draw retains the current spin"
                                    : "↓ This draw moves downhill"}
                              </p>
                            </div>
                          ) : (
                            current && (
                              <FieldGraph
                                result={current}
                                event={event}
                                playing={playback.playing && !reduced}
                                progressRef={playback.progressRef}
                              />
                            )
                          )}
                          <div className="contribution-list">
                            <div className="section-label">
                              ACTUAL CONTRIBUTIONS TO u<sub>{event.neuron}</sub>
                            </div>
                            {event.contributions?.slice(0, 6).map((v, i) => (
                              <span
                                key={i}
                                className={
                                  v.value >= 0 ? "positive" : "negative"
                                }
                              >
                                x{v.neuron ?? (v as any).index}{" "}
                                <b>{num(v.value)}</b>
                              </span>
                            ))}
                          </div>
                          <EnergyChart
                            events={events as ClassicalEvent[]}
                            index={playback.index}
                          />
                          {chapter === 3 && current && (
                            <Distribution
                              result={current}
                              probabilities={
                                current.references.exact_gibbs.probabilities
                              }
                              counts={current.gibbs.counts}
                              onState={setSelectedState}
                              selected={selectedState}
                            />
                          )}{" "}
                          {chapter === 3 && (
                            <p className="fine-print">
                              Main bar: exact Gibbs distribution · thin line:
                              finite chain frequencies. Samples are correlated,
                              not independent trials.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  ) : chapter === 4 ? (
                    <>
                      <div className="inspector-kicker">
                        05 / GATE-BOUNDARY PLAYBACK
                      </div>
                      <h2>
                        {quantumEvent?.event?.startsWith("cost")
                          ? "Change phase.\nKeep probability."
                          : quantumEvent?.event?.startsWith("mixer")
                            ? "Mix amplitudes.\nRedistribute probability."
                            : "One energy model.\nA real quantum circuit."}
                      </h2>
                      <p>
                        {quantumEvent?.event?.startsWith("cost")
                          ? "This diagonal cost operation rotates actual relative phases. Every computational-basis probability stays fixed."
                          : quantumEvent?.event?.startsWith("mixer")
                            ? "RX rotations mix amplitudes. Interference can now shift probability between configurations."
                            : "Hadamard gates initialize an equal superposition. Follow the cost and mixer gates using the timeline."}
                      </p>
                      <Equation
                        tex={
                          explain === "Math"
                            ? formulas.hamiltonian
                            : formulas.quantum
                        }
                      />
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={allStates}
                          onChange={(e) => setAllStates(e.target.checked)}
                        />
                        Show all basis states
                      </label>
                      <div className="quantum-readout">
                        <span>
                          CURRENT OPERATION{" "}
                          <b>
                            {quantumEvent?.gate?.toUpperCase() ||
                              quantumEvent?.event
                                ?.replace("_", " ")
                                .toUpperCase() ||
                              "H"}
                          </b>
                        </span>
                        <span>
                          EXPECTED ENERGY{" "}
                          <b>{num(quantumEvent?.expected_energy)}</b>
                        </span>
                      </div>
                      {current && (
                        <Distribution
                          result={current}
                          probabilities={quantumEvent?.probabilities}
                          onState={setSelectedState}
                          selected={selectedState}
                        />
                      )}
                      <div className="selected-state-inspector">
                        {current && (
                          <>
                            <Pattern
                              values={current.model.states[selectedState]}
                              cols={config.cols}
                            />
                            <span>
                              Selected E ={" "}
                              {num(current.model.energies[selectedState])}
                              <br />
                              |a| ={" "}
                              {num(
                                Math.sqrt(
                                  (quantumEvent?.probabilities ||
                                    current.quantum.probabilities)[
                                    selectedState
                                  ],
                                ),
                              )}
                              <br />φ ={" "}
                              {quantumEvent?.phases[selectedState] == null
                                ? "undefined"
                                : num(quantumEvent.phases[selectedState]) +
                                  " rad"}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="inspector-callout">
                        {quantumEvent?.event?.startsWith("cost")
                          ? "Probabilities unchanged; phases changed."
                          : `Σ P(x) = ${num(
                              quantumEvent?.probabilities.reduce(
                                (a, b) => a + b,
                                0,
                              ),
                              6,
                            )}`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="inspector-kicker">
                        06 / FINITE-SHOT READOUT
                      </div>
                      <h2>
                        Recover a pattern.
                        <br />
                        Keep the uncertainty.
                      </h2>
                      <p>
                        The most frequent sampled configuration is the output.
                        Other candidates remain visible. A sample probability is
                        not a calibrated confidence score.
                      </p>
                      <Equation tex={formulas.measure} />
                      {current && (
                        <>
                          <Pattern
                            values={
                              measurementEvent?.output || current.quantum.output
                            }
                            cols={config.cols}
                            clamped={current.model.trusted_indices}
                            large
                            aria="Quantum reconstructed pattern"
                          />
                          <div className="measurement-label">
                            <Check size={13} />
                            {measurementEvent?.shots ??
                              current.quantum.resources.shots}{" "}
                            actual circuit shots · modal decision
                          </div>
                          <Distribution
                            result={current}
                            counts={
                              measurementEvent?.counts || current.quantum.counts
                            }
                            onState={setSelectedState}
                            selected={selectedState}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              </aside>
            </section>
          )}
          {job && (
            <div className="job-banner" role="status">
              <LoaderCircle
                size={15}
                className={job.status === "running" ? "spin" : ""}
              />
              <span>
                {job.kind === "optimize"
                  ? "Optimizing ideal expected energy"
                  : "Running independent benchmark cues"}{" "}
                · {job.status} ·{" "}
                {Math.round(
                  job.progress <= 1 ? job.progress * 100 : job.progress,
                )}
                %
              </span>
              {job.status === "running" ? (
                <button onClick={cancelJob}>Cancel</button>
              ) : (
                <button onClick={() => setJob(null)}>Dismiss</button>
              )}
            </div>
          )}
          {mathLabOpen && current && <div id="math-workbench" ref={mathLabAnchor}><MathLab result={current} chapter={chapter} event={event} quantumEvent={quantumEvent} measurementEvent={measurementEvent} selectedState={selectedState} onSelectState={setSelectedState} onClose={() => { setMathLabOpen(false); mathLabToggle.current?.focus(); }} /></div>}
          <section className="experiment-dock">
            <div className="memories-control">
              <div className="section-label">
                <span>MEMORY BANK</span>
                <span>{config.memories.length} stored patterns</span>
              </div>
              <div className="memory-bank">
                {config.memories.map((m, i) => (
                  <div
                    key={i}
                    className={`memory-item ${target === i ? "active" : ""}`}
                  >
                    <button
                      className="memory-heading"
                      aria-pressed={target === i}
                      onClick={() => changeTarget(i)}
                    >
                      <span>MEMORY {String(i + 1).padStart(2, "0")}</span>
                      <i>{target === i ? "SELECTED" : "SELECT"}</i>
                    </button>
                    <Pattern
                      values={m}
                      cols={config.cols}
                      aria={`Stored memory ${i + 1}`}
                      onCell={(k) =>
                        update((c) => ({
                          ...c,
                          memories: c.memories.map((v, a) =>
                            a === i
                              ? v.map((s, b) => (b === k ? (-s as Spin) : s))
                              : v,
                          ),
                        }))
                      }
                    />
                  </div>
                ))}
                {config.memories.length < 4 && (
                  <button
                    className="add-memory"
                    title="Add a copy of the selected memory"
                    onClick={() => {
                      const next = config.memories.length;
                      update((c) => ({
                        ...c,
                        memories: [...c.memories, [...c.memories[target]]],
                      }));
                      setTarget(next);
                      setNotice(
                        `Memory ${next + 1} added as a copy. Click its pixels to edit it.`,
                      );
                    }}
                  >
                    +<span>Add</span>
                  </button>
                )}
              </div>
              <Legend />
            </div>
            <div className="cue-control">
              <div className="section-label">
                <span>INPUT CUE</span>
                <span>
                  {config.mode === "erasure"
                    ? "trusted / unknown"
                    : "soft observations"}
                </span>
              </div>
              <div className="cue-body">
                <Pattern
                  values={config.cue}
                  cols={config.cols}
                  onCell={editCue}
                  aria="Input cue"
                />
                <div>
                  <div className="segmented">
                    <button
                      className={config.mode === "erasure" ? "active" : ""}
                      aria-pressed={config.mode === "erasure"}
                      onClick={() => changeMode("erasure")}
                    >
                      Erase
                    </button>
                    <button
                      className={config.mode === "noisy" ? "active" : ""}
                      aria-pressed={config.mode === "noisy"}
                      onClick={() => changeMode("noisy")}
                    >
                      Flip
                    </button>
                  </div>
                  <label className="slider-label">
                    {config.mode === "erasure" ? "Unknown" : "Flipped"} pixels{" "}
                    <b>{corruption}</b>
                    <input
                      type="range"
                      aria-label="Corruption amount"
                      min="0"
                      max="8"
                      value={corruption}
                      onChange={(e) => damage(Number(e.target.value))}
                    />
                  </label>
                  <button
                    className="text-button compact"
                    onClick={() => {
                      damage(0);
                      setNotice(
                        "Cue restored. Use the slider or click pixels to damage it again.",
                      );
                    }}
                  >
                    <RotateCcw size={12} />
                    Reset cue
                  </button>
                </div>
              </div>
            </div>
            <div className="method-control">
              <div className="section-label">
                <span>
                  {chapter === 3
                    ? "THERMAL PARAMETERS"
                    : chapter === 4 || chapter === 5
                      ? "QUANTUM PARAMETERS"
                      : "EXPERIMENT SETTINGS"}
                </span>
                <SlidersHorizontal size={13} />
              </div>
              {chapter === 3 ? (
                <>
                  <label className="slider-label">
                    Temperature τ <b>{num(config.temperature, 2)}</b>
                    <input
                      type="range"
                      min=".05"
                      max="3"
                      step=".05"
                      value={config.temperature}
                      aria-label="Temperature"
                      onChange={(e) =>
                        update({ temperature: Number(e.target.value) })
                      }
                    />
                  </label>
                  <div className="parameter-caption">
                    {config.burn_in} burn-in sweeps · {config.samples} samples ·
                    thinning {config.thinning}
                  </div>
                  <label className="field-label">
                    Samples
                    <select
                      value={config.samples}
                      aria-label="Samples"
                      onChange={(e) =>
                        update({ samples: Number(e.target.value) })
                      }
                    >
                      {[128, 256, 512].map((count) => (
                        <option
                          key={count}
                          disabled={
                            (config.burn_in + count * config.thinning) *
                              (current?.model.free_indices.length ??
                                (config.mode === "noisy"
                                  ? config.rows * config.cols
                                  : corruption)) >
                            8192
                          }
                        >
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : chapter === 4 || chapter === 5 ? (
                <>
                  <div className="angle-row">
                    <label>
                      γ₁{" "}
                      <input
                        type="number"
                        step=".05"
                        min="-6.28"
                        max="6.28"
                        value={config.gammas[0]}
                        aria-label="Gamma 1"
                        onChange={(e) => {
                          const gammas = [...config.gammas];
                          gammas[0] = Number(e.target.value);
                          update({ gammas });
                        }}
                      />
                    </label>
                    <label>
                      β₁{" "}
                      <input
                        type="number"
                        step=".05"
                        min="-3.14"
                        max="3.14"
                        value={config.betas[0]}
                        aria-label="Beta 1"
                        onChange={(e) => {
                          const betas = [...config.betas];
                          betas[0] = Number(e.target.value);
                          update({ betas });
                        }}
                      />
                    </label>
                    <label>
                      p
                      <select
                        value={config.depth}
                        aria-label="QAOA depth"
                        onChange={(e) => {
                          const depth = Number(e.target.value);
                          update({
                            depth,
                            gammas: Array.from(
                              { length: depth },
                              (_, i) => config.gammas[i] ?? 0.7,
                            ),
                            betas: Array.from(
                              { length: depth },
                              (_, i) => config.betas[i] ?? 0.35,
                            ),
                          });
                        }}
                      >
                        <option>1</option>
                        <option>2</option>
                        <option>3</option>
                      </select>
                    </label>
                  </div>
                  {config.depth > 1 &&
                    config.gammas.slice(1).map((g, i) => (
                      <div className="angle-row extra-angle" key={i}>
                        <label>
                          γ{i + 2}
                          <input
                            aria-label={`Gamma ${i + 2}`}
                            type="number"
                            step=".05"
                            value={g}
                            onChange={(e) => {
                              const gammas = [...config.gammas];
                              gammas[i + 1] = Number(e.target.value);
                              update({ gammas });
                            }}
                          />
                        </label>
                        <label>
                          β{i + 2}
                          <input
                            aria-label={`Beta ${i + 2}`}
                            type="number"
                            step=".05"
                            value={config.betas[i + 1]}
                            onChange={(e) => {
                              const betas = [...config.betas];
                              betas[i + 1] = Number(e.target.value);
                              update({ betas });
                            }}
                          />
                        </label>
                      </div>
                    ))}
                  {optimization && (
                    <div className="optimizer-summary">
                      {optimization.length} ideal evaluations · best E ={" "}
                      {num(optimization.at(-1)?.best_objective)}
                      <svg
                        viewBox="0 0 200 40"
                        aria-label="Actual optimizer best objective progress"
                      >
                        <polyline
                          fill="none"
                          stroke="#b5a2ff"
                          strokeWidth="1.5"
                          points={optimization
                            .map(
                              (e, i) =>
                                `${(i / Math.max(1, optimization.length - 1)) * 195},${5 + ((e.best_objective - Math.min(...optimization.map((h) => h.best_objective))) / (Math.max(...optimization.map((h) => h.best_objective)) - Math.min(...optimization.map((h) => h.best_objective)) || 1)) * 30}`,
                            )
                            .join(" ")}
                        />
                      </svg>
                    </div>
                  )}
                  <div className="quantum-control-bottom">
                    <button
                      className="text-button compact"
                      disabled={jobBusy || !current}
                      onClick={() => beginJob("optimize")}
                    >
                      <Sparkles size={12} />
                      Optimize angles
                    </button>
                    <label className="noise-label">
                      <input
                        type="checkbox"
                        checked={config.noise.enabled}
                        onChange={(e) =>
                          update({
                            noise: {
                              ...config.noise,
                              enabled: e.target.checked,
                            },
                          })
                        }
                      />
                      Aer noise
                    </label>
                  </div>
                  <p className="parameter-caption">
                    {config.noise.enabled
                      ? `Ideal angles · ${(config.noise.gate_error * 100).toFixed(1)}% gate / ${(config.noise.readout_error * 100).toFixed(1)}% readout noise`
                      : "Ideal statevector"}{" "}
                    · {config.shots} shots
                  </p>
                </>
              ) : (
                <>
                  <label className="field-label">
                    Seed
                    <input
                      type="number"
                      min="0"
                      max="2147483647"
                      value={config.seed}
                      onChange={(e) => update({ seed: Number(e.target.value) })}
                    />
                    <button
                      aria-label="Generate a new seed"
                      className="icon-button"
                      onClick={() =>
                        update({ seed: Math.floor(Math.random() * 100000) })
                      }
                    >
                      <Shuffle size={13} />
                    </button>
                  </label>
                  <label className="field-label">
                    Scenario
                    <select
                      aria-label="Scenario preset"
                      value={selectedPreset}
                      onChange={(e) => loadPreset(e.target.value)}
                    >
                      <option value="">
                        {presets.length
                          ? "Choose a verified case"
                          : "Loading verified cases…"}
                      </option>
                      {presets.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {config.mode === "noisy" && (
                    <label className="slider-label">
                      Cue strength λ <b>{num(config.cue_strength, 2)}</b>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".05"
                        value={config.cue_strength}
                        onChange={(e) =>
                          update({ cue_strength: Number(e.target.value) })
                        }
                      />
                    </label>
                  )}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={reduced}
                      onChange={(e) => setReduced(e.target.checked)}
                    />
                    Reduced motion
                  </label>
                </>
              )}
            </div>
          </section>
          <p className="playback-help" role="status">
            {!current
              ? connectionLost
                ? "Start the local demo to reconnect. Playback will become available when the engine returns."
                : status === "error"
                  ? "Check the error above and repair the input, or choose a verified case."
                  : "Computing your experiment…"
              : !current.model.free_indices.length
                ? "All pixels are observed. Erase a pixel to create a recovery animation."
                : !animatedChapter
                  ? "This chapter is interactive. Play recall opens the first computed animation."
                  : events.length < 2
                    ? "This configuration has no updates to animate. Edit the cue or choose a verified case."
                    : playback.playing
                      ? "Playing computed events · Pause freezes the view · use the timeline to inspect a step."
                      : "Press Play for live animation. Use Previous, Next or the timeline to inspect an event."}
          </p>
          <section className="transport" aria-label="Playback controls">
            <div className="transport-buttons">
              <button
                className="icon-button"
                onClick={playback.reset}
                disabled={
                  !events.length || (playback.index === 0 && !playback.playing)
                }
                aria-label="Reset playback"
              >
                <SkipBack size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => playback.step(-1)}
                disabled={!events.length || playback.index === 0}
                aria-label="Previous event"
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="play-button"
                disabled={
                  !current ||
                  (animatedChapter
                    ? events.length < 2
                    : !current.model.free_indices.length)
                }
                onClick={runAnimation}
                aria-label={
                  playback.playing
                    ? "Pause"
                    : !animatedChapter
                      ? "Play recall"
                      : playback.index >= events.length - 1
                        ? "Replay"
                        : "Play"
                }
              >
                {playback.playing ? <Pause size={15} /> : <Play size={15} />}
                <span>
                  {playback.playing
                    ? "Pause"
                    : !animatedChapter
                      ? "Play recall"
                      : playback.index >= events.length - 1
                        ? "Replay"
                        : "Play"}
                </span>
              </button>
              <button
                className="icon-button"
                onClick={() => playback.step(1)}
                disabled={!events.length || playback.index >= events.length - 1}
                aria-label="Next event"
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="timeline">
              <div className="timeline-caption">
                <span>
                  {events.length
                    ? measurementEvent
                      ? `MEASUREMENT · ${measurementEvent.shots} SHOTS`
                      : quantumEvent
                        ? `${quantumEvent.event.toUpperCase()}${quantumEvent.gate ? " · " + quantumEvent.gate.toUpperCase() : ""}`
                        : `${chapter === 3 ? "GIBBS DRAW" : "NEURON UPDATE"} ${playback.index + 1}`
                    : "INTERACTIVE CHAPTER · PLAY RECALL TO ANIMATE"}
                </span>
                <span className="mono">
                  {events.length
                    ? `${String(playback.index + 1).padStart(2, "0")} / ${String(events.length).padStart(2, "0")}`
                    : "—"}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={Math.max(0, events.length - 1)}
                value={playback.index}
                disabled={events.length < 2 || !current}
                onChange={(e) => {
                  playback.seek(Number(e.target.value));
                }}
                aria-label="Scrub event timeline"
              />
            </div>
            <select
              className="speed-select"
              aria-label="Playback speed"
              value={playback.speed}
              disabled={events.length < 2 || !current}
              onChange={(e) => playback.setSpeed(Number(e.target.value))}
            >
              <option value=".5">0.5×</option>
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4">4×</option>
            </select>
            <button
              className="next-chapter"
              onClick={() => go(chapter === 7 ? 0 : chapter + 1)}
            >
              {chapter === 7
                ? "Back to experiment"
                : chapters[chapter + 1].label}
              <ArrowRight size={16} />
            </button>
          </section>
        </div>
      </main>
      <footer className="footer">
        <span>
          <span className="verified-dot" />{" "}
          {current
            ? "Computed locally · reproducible by seed"
            : connectionLost
              ? "Engine disconnected · retrying connection"
              : "Connecting to local scientific engine"}
        </span>
        <span>SIMULATOR · NO QUANTUM ADVANTAGE CLAIMED</span>
        <button onClick={exportExperiment} disabled={!current}>
          Export <ArrowUpRight size={12} />
        </button>
      </footer>
      {filePreview && (
        <div className="modal-backdrop" onClick={() => setFilePreview(null)}>
          <section
            className="science-modal export-file-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-file-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close export"
              onClick={() => setFilePreview(null)}
            >
              <X size={18} />
            </button>
            <div className="eyebrow">YOUR COMPUTED EVIDENCE</div>
            <h2 id="export-file-title">{filePreview.name}</h2>
            <p>
              The file is ready to review. Download it or copy the content
              below.
            </p>
            <div className="export-file-actions">
              {filePreview.url ? (
                <a
                  className="primary-button"
                  href={filePreview.url}
                  download={filePreview.name}
                >
                  <Download size={15} /> Download file
                </a>
              ) : (
                <span>
                  {filePreview.error
                    ? "Copy is available below."
                    : "Preparing file…"}
                </span>
              )}
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(filePreview.content);
                    setCopyStatus("Content copied.");
                  } catch {
                    setCopyStatus(
                  "Use Download file to save the full content. You can also select and copy the preview below.",
                    );
                  }
                }}
              >
                Copy content
              </button>
            </div>
            {filePreview.error && (
              <p className="error-text">{filePreview.error}</p>
            )}
            <p role="status" className="fine-print">
              {copyStatus ||
                `${(new Blob([filePreview.content]).size / 1024).toFixed(1)} KB · ${filePreview.type}`}
            </p>
            <textarea
              aria-label="Export content"
              readOnly
              value={filePreview.content.slice(0, 20000)}
              spellCheck={false}
            />
            {filePreview.content.length > 20000 && <p className="fine-print">Preview shows the first 20,000 characters. Download file and Copy content include the full export.</p>}
          </section>
        </div>
      )}
      {sourcesOpen && (
        <div className="modal-backdrop" onClick={() => setSourcesOpen(false)}>
          <section
            className="science-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Sources and scientific limitations"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close science notes"
              onClick={() => setSourcesOpen(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">THE SCIENCE BEHIND THE SCENE</div>
            <h2>
              One model.
              <br />
              Three different dynamics.
            </h2>
            <p>
              QRecall links Hebbian memory, Gibbs sampling and QAOA on a shared
              cue-conditioned energy. It is an interactive explanation and
              evaluation tool, not a trained quantum Boltzmann machine.
            </p>
            <ul>
              <li>
                QAOA runs on a classical Qiskit simulator. No hardware speedup
                is demonstrated.
              </li>
              <li>
                A lower model energy need not recover the original stored
                pattern.
              </li>
              <li>
                Exact enumeration is inexpensive for these deliberately small
                systems.
              </li>
              <li>
                The nearest stored memory is a strong baseline and is included.
              </li>
              <li>
                Thermal temperature, cue corruption and device noise are
                separate quantities.
              </li>
            </ul>
            <div className="source-links">
              <a
                href="https://www.pnas.org/doi/10.1073/pnas.79.8.2554"
                target="_blank"
                rel="noreferrer"
              >
                Hopfield · 1982 <ArrowUpRight size={14} />
              </a>
              <a
                href="https://arxiv.org/abs/1411.4028"
                target="_blank"
                rel="noreferrer"
              >
                Farhi et al. · QAOA <ArrowUpRight size={14} />
              </a>
              <a
                href="https://quantum.cloud.ibm.com/docs/en/tutorials/quantum-approximate-optimization-algorithm"
                target="_blank"
                rel="noreferrer"
              >
                IBM · QAOA documentation <ArrowUpRight size={14} />
              </a>
              <a
                href="https://www.youtube.com/watch?v=1WPJdAW-sFo"
                target="_blank"
                rel="noreferrer"
              >
                Visual inspiration · Artem Kirsanov <ArrowUpRight size={14} />
              </a>
            </div>
            <p className="fine-print">
              Original code and visual composition. Detailed source access and
              reuse notes are in docs/SOURCES.md.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
function SceneStep({
  chapter, event, quantumEvent, measurementEvent, index, length, playing, pair, result,
}: {
  chapter: number;
  event?: ClassicalEvent;
  quantumEvent?: QuantumEvent;
  measurementEvent?: MeasurementEvent;
  index: number;
  length: number;
  playing: boolean;
  pair: [number, number];
  result: Result;
}) {
  let tag = "MEMORY NETWORK";
  let title = `Pixel ${pair[0]} ↔ pixel ${pair[1]}`;
  let description = "Select a connection to inspect its learned weight. Filled tiles are spin +1; hollow tiles are spin −1.";
  let value = `W = ${num(result.model.weights[pair[0]]?.[pair[1]])}`;
  if (chapter === 1) {
    tag = "INPUT CUE";
    title = `${result.model.free_indices.length} free pixels to recover`;
    description = result.config.mode === "erasure"
      ? "Trusted pixels remain fixed. Their connections contribute to the fields of the free pixels."
      : "Every pixel is free. Noisy observations contribute soft fields, so the solver can change them.";
    value = `${result.model.trusted_indices.length} trusted`;
  } else if (chapter < 4 && event) {
    const before = event.state_before[event.neuron];
    const after = event.state_after[event.neuron];
    tag = chapter === 2 ? "SPIN UPDATE" : "THERMAL DRAW";
    title = before === after
      ? `Pixel ${event.neuron} keeps spin ${after === 1 ? "+1" : "−1"}`
      : `Pixel ${event.neuron}: ${before === 1 ? "+1" : "−1"} → ${after === 1 ? "+1" : "−1"}`;
    description = chapter === 2
      ? `The local field is ${num(event.local_field)}. The white marker follows the computed state; violet marks the state you inspect.`
      : `P(+1) = ${num(event.p_plus ?? event.probability_plus)}, actual draw = ${num(event.draw ?? event.random_draw)}. Uphill moves can occur at positive temperature.`;
    value = `ΔE ${num(event.energy_after - event.energy_before)}`;
  } else if (chapter >= 2 && chapter < 4) {
    tag = "OBSERVATIONS FIXED";
    title = "No free-pixel updates are needed";
    description = "All trusted observations already determine the state. The scene shows its exact energy.";
    value = `E ${num(result.model.constant)}`;
  } else if (chapter >= 4 && !result.model.free_indices.length) {
    tag = "FULLY OBSERVED";
    title = "No quantum circuit is needed";
    description = "All pixels are already fixed by trusted observations. No gates or measurement shots are executed.";
    value = "0 free qubits";
  } else if (chapter === 4 && quantumEvent) {
    const gate = quantumEvent.gate?.toUpperCase();
    tag = quantumEvent.event === "initialization" ? "SUPERPOSITION"
      : gate === "RX" || quantumEvent.event === "mixer_layer" ? "MIXER" : "COST PHASE";
    title = gate
      ? `${gate} on ${quantumEvent.qubits.map(q => `q${q}`).join(" ↔ ")}`
      : quantumEvent.event === "initialization" ? "Begin with equal basis probabilities"
      : `${tag === "MIXER" ? "Mixer" : "Cost"} layer ${quantumEvent.layer} complete`;
    description = quantumEvent.event === "initialization"
      ? "Hadamard gates prepare equal basis probabilities. The view shows the actual basis probabilities; the dials show their relative phases."
      : tag === "MIXER"
        ? "Mixer gates combine amplitudes and can redistribute probability. The view shows the computed statevector at this step."
        : "Cost gates rotate relative phases while preserving basis probabilities. The highlighted circuit gate is the actual operation.";
    value = gate ? `${num(quantumEvent.angle, 4)} rad` : `⟨E⟩ ${num(quantumEvent.expected_energy)}`;
  } else if (chapter === 5 && measurementEvent) {
    tag = "FINITE MEASUREMENT";
    title = `${measurementEvent.shots.toLocaleString()} actual shots counted`;
    description = "The view accumulates real Aer shot prefixes. The most frequent state decides recovery; a tie selects the lowest integer.";
    value = `Modal state ${measurementEvent.state_integer}`;
  }
  return (
    <div className={`scene-step${playing ? " is-playing" : ""}`} aria-live="off">
      <div className="scene-step-top">
        <span className="scene-step-tag"><span />{tag}</span>
        <span className="mono">{length ? `Step ${index + 1} of ${length}` : "Explore the model"}</span>
      </div>
      <div className="scene-step-heading"><h3>{title}</h3><b className="mono">{value}</b></div>
      <p>{description}</p>
      {length > 1 && <div className="scene-step-track"><span style={{ width: `${((index + 1) / length) * 100}%` }} /></div>}
    </div>
  );
}

function MathInspector({
  chapter,
  config,
  result,
  event,
}: {
  chapter: number;
  config: Config;
  result: Result | null;
  event?: ClassicalEvent;
}) {
  const equations = [
    formulas.store,
    config.mode === "erasure"
      ? formulas.damage
      : String.raw`b'_i=b_i+\lambda r_i y_i`,
    formulas.hopfield,
    formulas.thermal,
    formulas.hamiltonian,
    formulas.measure,
  ];
  return (
    <>
      <div className="inspector-kicker">
        MATHEMATICAL MODEL / CHAPTER {chapter + 1}
      </div>
      <h2>
        {
          [
            "How weights are learned.",
            "How the cue becomes a field.",
            "Why the update descends.",
            "How a thermal draw works.",
            "From energy to quantum gates.",
            "From amplitudes to counts.",
          ][chapter]
        }
      </h2>
      <Equation tex={equations[chapter] || formulas.export} />
      {chapter < 2 ? (
        <>
          <Equation tex={String.raw`E(s)=-\frac12s^TWs-b^Ts`} />
          <p>
            {chapter === 0
              ? "Normalize by the total number of pixels. The diagonal is zero, and every pair has the same weight in both directions."
              : config.mode === "erasure"
                ? "Trusted cue spins are eliminated from the free problem. Their couplings contribute to h; their mutual energy stays in the constant."
                : "No noisy observation is clamped. Reliability and cue strength add a soft bias that the solver can overcome."}
          </p>
          <dl className="math-details">
            <dt>Total pixels / normalization n</dt>
            <dd>{config.rows * config.cols}</dd>
            <dt>Stored memories M</dt>
            <dd>{config.memories.length}</dd>
            <dt>Free indices F</dt>
            <dd>{result?.model.free_indices.join(", ") || "none"}</dd>
            <dt>Conditioning constant</dt>
            <dd>{num(result?.model.constant)}</dd>
            <dt>Computed fields h</dt>
            <dd>
              {result?.model.fields.map((v) => num(v)).join(", ") ||
                "awaiting computation"}
            </dd>
          </dl>
        </>
      ) : chapter < 4 ? (
        <>
          <Equation
            tex={
              chapter === 2
                ? String.raw`s'_i=\operatorname{sign}(u_i),\qquad \Delta E=-(s'_i-s_i)u_i\le0`
                : String.raw`\sigma(z)=\frac{1}{1+e^{-z}},\quad s'_i=+1\ \text{if }r<P(+1)`
            }
          />
          <p>
            {chapter === 2
              ? "A zero local field retains the previous spin. Asynchronous updates use the state committed by the preceding event."
              : "The draw r comes from a seeded random generator. Positive temperature allows genuine uphill moves."}
          </p>
          <dl className="math-details">
            <dt>Selected pixel / local field u</dt>
            <dd>
              {event
                ? `${event.neuron} / ${num(event.local_field)}`
                : "no free-pixel update"}
            </dd>
            <dt>Spin before → after</dt>
            <dd>
              {event
                ? `${event.state_before[event.neuron]} → ${event.state_after[event.neuron]}`
                : "—"}
            </dd>
            <dt>Energy before → after</dt>
            <dd>
              {event
                ? `${num(event.energy_before)} → ${num(event.energy_after)}`
                : "—"}
            </dd>
            {chapter === 3 && (
              <>
                <dt>P(+1) / actual random draw</dt>
                <dd>
                  {num(event?.p_plus ?? event?.probability_plus)} /{" "}
                  {num(event?.draw ?? event?.random_draw)}
                </dd>
              </>
            )}
          </dl>
        </>
      ) : chapter === 4 ? (
        <>
          <Equation tex={formulas.quantum} />
          <Equation
            tex={String.raw`\operatorname{RZZ}(-2\gamma W_{ij}),\quad \operatorname{RZ}(-2\gamma h_i),\quad \operatorname{RX}(2\beta)`}
          />
          <p>
            Cost first, mixer second. Z eigenvalues match the pixel spins.
            Diagonal cost gates preserve basis probabilities and rotate relative
            phases; RX gates can redistribute probabilities.
          </p>
          <dl className="math-details">
            <dt>Layers p / free qubits</dt>
            <dd>
              {config.depth} / {result?.model.free_indices.length ?? "—"}
            </dd>
            <dt>γ values / β values</dt>
            <dd>
              {config.gammas.map((v) => num(v)).join(", ")} /{" "}
              {config.betas.map((v) => num(v)).join(", ")}
            </dd>
          </dl>
        </>
      ) : (
        <>
          <Equation
            tex={String.raw`f(x)=\frac{N_x}{N_{\rm shots}},\qquad \hat x=\arg\max_x N_x`}
          />
          <p>
            Ideal probabilities and observed shot frequencies are separate. The
            largest measured count decides recovery; a tie selects the lowest
            basis integer without consulting the target.
          </p>
          <Equation tex={formulas.export} />
          <p className="fine-print">
            Filled pixel: spin +1, bit 0. Qiskit count strings list the highest
            qubit first; the logical display lists free-pixel index 0 first.
          </p>
        </>
      )}
    </>
  );
}
function Comparison({
  evaluation,
  config,
  result,
}: {
  evaluation: Evaluation | null;
  config: Config;
  result: Result | null;
}) {
  return (
    <>
      <div className="comparison-note">
        <Zap size={15} />
        <span>
          Same memory bank. Same cue. Same energy. Target identity stays in the
          evaluator.
        </span>
      </div>
      <div className="comparison-table-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th>METHOD</th>
              <th>RECONSTRUCTION</th>
              <th>RECOVERED?</th>
              <th>BIT ERROR</th>
              <th>ENERGY GAP</th>
              <th>RESOURCE COUNTS</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(labels).map((key) => {
              const m = evaluation?.methods[key];
              return (
                <tr
                  key={key}
                  className={key === "quantum" ? "quantum-row" : ""}
                >
                  <td>
                    <span className={`method-dot ${key}`} />
                    <strong>{labels[key]}</strong>
                    <small>
                      {key === "quantum"
                        ? "Actual QAOA circuit"
                        : key === "exact_gibbs"
                          ? "Distribution diagnostic"
                          : key === "exact_minimum"
                            ? "Enumerated diagnostic"
                            : key === "nearest_memory"
                              ? "Observed pixels only"
                              : key === "gibbs"
                                ? "Modal sampled state"
                                : "Asynchronous descent"}
                    </small>
                  </td>
                  <td>
                    {m ? (
                      <Pattern values={m.final_state} cols={config.cols} />
                    ) : (
                      <span className="muted">Computing</span>
                    )}
                  </td>
                  <td>
                    {m ? (
                      <span
                        className={`recovery-badge ${m.recovery ? "yes" : ""}`}
                      >
                        {m.recovery ? "EXACT" : "DIFFERENT"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="mono">
                    {m ? `${(m.bit_error_rate * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="mono">{num(m?.energy_gap)}</td>
                  <td className="resource-text">
                    {m
                      ? Object.entries(m.resources || {})
                          .filter(
                            ([k, v]) =>
                              typeof v === "number" &&
                              !/time|seconds|duration/.test(k),
                          )
                          .slice(0, 3)
                          .map(([k, v]) => (
                            <span key={k}>
                              {String(v)} {k.replaceAll("_", " ")}
                            </span>
                          ))
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="comparison-footnote">
        <span>Bit error: all pixels · energy gap: normalized units</span>
        <span>
          Modal sample ties: lowest basis integer.{" "}
          {evaluation?.warnings?.join(" ")}
        </span>
      </div>
      {result && (
        <div className="model-warning">
          <Square size={12} />
          <span>
            Exact minimum energy = {num(Math.min(...result.model.energies))}. A
            low energy is a property of this model; it does not guarantee
            correct recall.
          </span>
        </div>
      )}
    </>
  );
}
function BenchmarkView({
  data,
  onExport,
}: {
  data: any;
  onExport: () => void;
}) {
  const aggregate = data.aggregates || data.summary || data.aggregate || {};
  return (
    <div className="benchmark-results">
      <div className="section-label">
        <span>
          ACTUAL BENCHMARK RESULTS ·{" "}
          {data.cases?.length || data.case_count || 12} CASES
        </span>
        <button className="text-button" onClick={onExport}>
          <Download size={13} />
          CSV
        </button>
      </div>
      <div className="benchmark-summary">
        {Object.entries(aggregate)
          .filter(([k, v]) => labels[k] && typeof v === "object")
          .map(([k, v]) => {
            const a = v as any;
            return (
              <div key={k}>
                <span>{labels[k]}</span>
                <b>
                  {(
                    (a.recovery_rate ?? a.exact_recovery_rate ?? 0) * 100
                  ).toFixed(1)}
                  <small>%</small>
                </b>
                <p>
                  {a.recovered ?? a.exact_recoveries ?? "—"} /{" "}
                  {a.cases ?? a.total ?? 12} exact recoveries
                </p>
                {a.recovery_interval_95 && (
                  <small className="interval-text">
                    95% Wilson: {(a.recovery_interval_95[0] * 100).toFixed(1)}–
                    {(a.recovery_interval_95[1] * 100).toFixed(1)}%
                  </small>
                )}
              </div>
            );
          })}
      </div>
      <p className="fine-print">
        {data.replay_provenance ? "Recorded replay" : "Live computation"} ·
        benchmark seed {data.benchmark_seed} ·{" "}
        {data.definition?.evaluation_budget} optimizer evaluations per cue.
        Independent cue cases are the repetition unit. Sampling variation and
        ambiguity are included. Full definitions, per-case metrics and
        provenance are in the export.
      </p>
    </div>
  );
}
function toCsv(data: any) {
  const lines = [
    "case,method,recovery,bit_error_rate,energy_gap,target_probability",
  ];
  for (const [i, c] of (data.cases || []).entries())
    for (const [m, v] of Object.entries(
      c.comparison?.methods || c.evaluation?.methods || c.metrics || {},
    )) {
      const r = v as any;
      lines.push(
        [
          i,
          m,
          r.recovery,
          r.bit_error_rate,
          r.energy_gap,
          r.target_probability,
        ].join(","),
      );
    }
  return lines.join("\n");
}
