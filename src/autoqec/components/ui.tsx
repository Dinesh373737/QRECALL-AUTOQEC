import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import katex from "katex";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Cpu,
  FlaskConical,
  Info,
  LoaderCircle,
  Radio,
  TriangleAlert,
  X,
  History,
} from "lucide-react";
import type { Job } from "../lib/api";

export function Card({ children, className = "", title, icon, sub, right, tone, bodyClass = "" }: {
  children?: ReactNode; className?: string; title?: ReactNode; icon?: ReactNode; sub?: ReactNode; right?: ReactNode;
  tone?: "cyan" | "teal" | "violet" | "red" | "green"; bodyClass?: string;
}) {
  return (
    <section className={`card ${tone ? `glow-${tone}` : ""} ${className}`}>
      {(title || right) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{icon}{title}</h3>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {right && <div className="right">{right}</div>}
        </header>
      )}
      {children !== undefined && <div className={`card-body ${bodyClass}`}>{children}</div>}
    </section>
  );
}

export function Metric({ label, value, unit, hint, tone, tip }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; hint?: ReactNode; tone?: string; tip?: string;
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <div className="label">{label}{tip && <Tip text={tip} />}</div>
      <div className="value">{value}{unit && <small>{unit}</small>}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" tabIndex={0} data-tip={text} aria-label={text} role="note">
      <CircleHelp />
    </span>
  );
}

export type Prov = "simulation" | "hardware" | "live" | "recorded";
export function ProvenanceBadge({ kind, label }: { kind: Prov; label?: string }) {
  const map = {
    simulation: { cls: "sim", icon: <FlaskConical />, text: "Simulation" },
    hardware: { cls: "hw", icon: <Cpu />, text: "Google hardware data" },
    live: { cls: "live", icon: <Radio />, text: "Computed live" },
    recorded: { cls: "rec", icon: <History />, text: "Recorded run" },
  }[kind];
  return <span className={`badge ${map.cls}`} title={label ?? map.text}>{map.icon}{label ?? map.text}</span>;
}

export function Status({ ok, pass = "Pass", fail = "Fail", warn }: { ok: boolean | null | undefined; pass?: string; fail?: string; warn?: string }) {
  if (ok === null || ok === undefined) return <span className="badge neutral">{warn ?? "n/a"}</span>;
  return ok ? (
    <span className="badge pass"><CircleCheck />{pass}</span>
  ) : (
    <span className="badge fail"><CircleX />{fail}</span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === "restored") return <span className="badge pass"><CircleCheck />Restored</span>;
  if (outcome === "recoverable_residual") return <span className="badge warn"><CircleAlert />Recoverable residual</span>;
  return <span className="badge fail"><CircleX />Logical failure</span>;
}

export function Seg<T extends string | number>({ value, options, onChange, full, label, mini }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; full?: boolean; label?: string; mini?: boolean;
}) {
  return (
    <div className={`seg ${full ? "full" : ""} ${mini ? "mini" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value}
          className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, onChange, format, help, tone, disabled }: {
  label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  format?: (v: number) => string; help?: ReactNode; tone?: "teal" | "violet"; disabled?: boolean;
}) {
  const fill = ((value - min) / (max - min || 1)) * 100;
  const id = useMemo(() => `s${Math.random().toString(36).slice(2, 8)}`, []);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
        <span className="val">{format ? format(value) : value}</span>
      </label>
      <input id={id} type="range" className={tone} min={min} max={max} step={step} value={value} disabled={disabled}
        style={{ ["--fill" as string]: `${fill}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function Field({ label, children, help }: { label: ReactNode; children: ReactNode; help?: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label"><span>{label}</span></div>
      {children}
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="switch" />
      <span>{label}</span>
    </button>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { value: T; label: ReactNode; count?: number | string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} className={`tab ${t.value === value ? "on" : ""}`} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Callout({ tone = "info", children, icon }: { tone?: "info" | "warn" | "hw" | "sim" | "err"; children: ReactNode; icon?: ReactNode }) {
  const ic = icon ?? (tone === "warn" ? <TriangleAlert /> : tone === "err" ? <CircleX /> : tone === "hw" ? <Cpu /> : tone === "sim" ? <FlaskConical /> : <Info />);
  return <div className={`callout ${tone}`}>{ic}<div>{children}</div></div>;
}

export function Tech({ title, children, open }: { title: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="tech" open={open}>
      <summary>{title}</summary>
      <div className="tech-body">{children}</div>
    </details>
  );
}

export function Eq({ tex, block = true }: { tex: string; block?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: "ignore" });
    } catch {
      return tex;
    }
  }, [tex, block]);
  return block ? <div className="eq" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Loading({ label = "Computing…" }: { label?: string }) {
  return <div className="state-box" role="status"><LoaderCircle className="spin" /><span>{label}</span></div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-box" role="alert">
      <CircleX style={{ color: "var(--red)" }} />
      <span style={{ color: "var(--text-2)", maxWidth: 520 }}>{message}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="state-box">{icon ?? <Info />}<div style={{ maxWidth: 540 }}>{children}</div></div>;
}

export function JobProgress({ job, error, onCancel }: { job: Job | null; error?: string; onCancel?: () => void }) {
  if (error) return <Callout tone="err">{error}</Callout>;
  if (!job) return null;
  const active = job.status === "queued" || job.status === "running";
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="spread" style={{ fontSize: 12 }}>
        <span className="muted">{active ? <LoaderCircle className="spin" style={{ width: 12, height: 12, verticalAlign: -2, marginRight: 6 }} /> : null}{job.phase}</span>
        <span className="num muted">{Math.round(job.progress * 100)}%</span>
      </div>
      <div className="progress"><i style={{ width: `${Math.max(3, job.progress * 100)}%` }} /></div>
      {active && onCancel && <button className="btn sm ghost" onClick={onCancel} style={{ alignSelf: "flex-start" }}>Cancel job</button>}
      {job.status === "cancelled" && <span className="badge warn">Cancelled</span>}
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <div style={{ fontWeight: 650 }}>{title}</div>
          <button className="btn icon ghost" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bits({ value, compare, highlight = "err", size = 24 }: { value: string; compare?: string; highlight?: "err" | "fixed" | "one"; size?: number }) {
  return (
    <span className="row" style={{ gap: 4, display: "inline-flex" }}>
      {value.split("").map((b, i) => {
        const diff = compare !== undefined ? compare[i] !== b : b === "1";
        const cls = diff ? highlight : "";
        return <span key={i} className={`bit-tile ${cls}`} style={{ width: size, height: size }}>{b}</span>;
      })}
    </span>
  );
}

/** True when a page is rendered inside a hub tab: its own title block is replaced by the hub's. */
export const EmbedContext = createContext(false);

export function PageHead({ kicker, title, lede, right, module = 1 }: { kicker: string; title: ReactNode; lede?: ReactNode; right?: ReactNode; module?: 1 | 2 | 0 }) {
  const embedded = useContext(EmbedContext);
  if (embedded) return right ? <div className="row wrap embed-actions">{right}</div> : null;
  return (
    <div className="page-head">
      <div>
        <div className={`page-kicker ${module === 2 ? "m2" : ""}`}>{kicker}</div>
        <h1 className="page-title">{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {right && <div className="row wrap">{right}</div>}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
