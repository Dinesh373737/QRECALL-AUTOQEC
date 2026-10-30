import { Suspense, lazy } from "react";
import type { ComponentType } from "react";
import { navigate } from "../lib/router";
import { EmbedContext, Loading, PageHead, Tabs } from "../components/ui";

type Child = ComponentType<{ query: URLSearchParams }>;
interface HubTab { value: string; label: string; component: Child }

function Hub({ query, path, title, lede, tabs, defaults }: {
  query: URLSearchParams; path: string; title: string; lede: string; tabs: HubTab[]; defaults: Record<string, string>;
}) {
  const tab = query.get("tab") ?? defaults[path] ?? tabs[0].value;
  const current = tabs.find((t) => t.value === tab) ?? tabs[0];
  const Body = current.component;
  return (
    <div className="fade-in">
      <PageHead kicker="Module 1 · Interactive Studio" title={title} lede={lede} />
      <Tabs value={current.value} onChange={(v) => navigate(path, { tab: v })} tabs={tabs.map(({ value, label }) => ({ value, label }))} />
      <EmbedContext.Provider value={true}>
        <Suspense fallback={<Loading label="Loading…" />}>
          <Body query={query} />
        </Suspense>
      </EmbedContext.Provider>
    </div>
  );
}

const QecLab = lazy(() => import("./QecLab")) as unknown as Child;
const Explainer = lazy(() => import("./DecoderExplainer")) as unknown as Child;
const SimBench = lazy(() => import("./SimBenchmarks")) as unknown as Child;
const Inspector = lazy(() => import("./CircuitInspector")) as unknown as Child;
const Optimizer = lazy(() => import("./ResourceOptimizer")) as unknown as Child;

export function LabHub({ query, path }: { query: URLSearchParams; path: string }) {
  return (
    <Hub query={query} path={path} title="QEC Lab"
      lede="Run the three-qubit bit-flip code step by step, see why the decoder chose its correction, and test the decoders on seeded simulations."
      defaults={{ "/explainer": "explain", "/sim-benchmarks": "benchmarks" }}
      tabs={[
        { value: "experiment", label: "Experiment", component: QecLab },
        { value: "explain", label: "Explain a decision", component: Explainer },
        { value: "benchmarks", label: "Benchmarks", component: SimBench },
      ]} />
  );
}

export function CircuitsHub({ query, path }: { query: URLSearchParams; path: string }) {
  return (
    <Hub query={query} path={path} title="Circuits & Resources"
      lede="The real Qiskit circuit behind the lab, its compiled form, and the choice between verified implementations under resource limits."
      defaults={{ "/optimizer": "optimizer" }}
      tabs={[
        { value: "inspector", label: "Circuit inspector", component: Inspector },
        { value: "optimizer", label: "Resource optimizer", component: Optimizer },
      ]} />
  );
}
