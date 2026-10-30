import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Geometry, Mechanism } from "../lib/types";
import { BASIS_COLOR } from "./Lattice2D";
import type { Overlay } from "./Lattice2D";

export type { Overlay };

const T_SPACING = 1.25;

function useFrameCenter(geo: Geometry) {
  return useMemo(() => {
    const xs = geo.detectors.map((d) => d.x);
    const ys = geo.detectors.map((d) => d.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 4);
    return { cx, cy, span };
  }, [geo]);
}

function Pulse({ position, color, size }: { position: [number, number, number]; color: string; size: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + 0.25 * Math.sin(clock.elapsedTime * 2.6 + position[0] + position[2]);
      ref.current.scale.setScalar(s);
    }
  });
  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[size * 1.9, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.16} depthWrite={false} />
    </mesh>
  );
}

type Hover = { id: number; x: number; y: number } | null;

// Labels are plain DOM over the canvas: drei's <Html> mounts a separate React root, and unmounting it during a
// page change makes React 19 throw ("synchronously unmount a root while React was already rendering").
function Scene({ geo, fired, overlay, round, show, reduced, onHover }: {
  geo: Geometry; fired: Set<number>; overlay: Overlay; round: number | null; show: { pm: boolean; ising: boolean; comp: boolean }; reduced: boolean;
  onHover: (h: Hover) => void;
}) {
  const { cx, cy } = useFrameCenter(geo);
  const pos = (x: number, y: number, t: number): [number, number, number] => [x - cx, t * T_SPACING, y - cy];
  const quiet = useMemo(() => {
    const arr: number[] = [];
    for (const d of geo.detectors) if (!fired.has(d.id)) arr.push(...pos(d.x, d.y, d.t));
    return new Float32Array(arr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo, fired]);
  const byId = useMemo(() => new Map(geo.detectors.map((d) => [d.id, d])), [geo]);
  const tMax = geo.time_steps - 1;
  const boundaryStub = (d: { x: number; y: number; t: number }): [number, number, number][] => {
    const p = pos(d.x, d.y, d.t);
    const len = Math.hypot(p[0], p[2]) || 1;
    return [p, [p[0] + (p[0] / len) * 1.6, p[1], p[2] + (p[2] / len) * 1.6]];
  };
  const mechLines = (mechs: Mechanism[] | undefined) =>
    (mechs ?? []).map((m) => {
      const pts = m.detectors.map((id) => byId.get(id)).filter(Boolean) as { x: number; y: number; t: number }[];
      if (pts.length === 1) return boundaryStub(pts[0]);
      return pts.map((d) => pos(d.x, d.y, d.t));
    });
  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[8, 18, 10]} intensity={60} />
      {/* qubit layout plate under the stack */}
      {geo.qubits.map((q) => (
        <mesh key={q.id} position={pos(q.x, q.y, -0.7)} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[q.role === "data" ? 0.42 : 0.34, q.role === "data" ? 0.42 : 0.34]} />
          <meshBasicMaterial color={q.role === "data" ? "#5ad8ef" : BASIS_COLOR[q.basis ?? "Z"]} transparent opacity={q.role === "data" ? 0.55 : 0.35} />
        </mesh>
      ))}
      {/* time-slice frames */}
      {Array.from({ length: geo.time_steps }, (_, t) => {
        const xs = geo.detectors.map((d) => d.x - cx);
        const zs = geo.detectors.map((d) => d.y - cy);
        const a = Math.min(...xs) - 0.6, b = Math.max(...xs) + 0.6, c = Math.min(...zs) - 0.6, e = Math.max(...zs) + 0.6;
        const active = round === null || round === t;
        return (
          <Line key={t} points={[[a, t * T_SPACING, c], [b, t * T_SPACING, c], [b, t * T_SPACING, e], [a, t * T_SPACING, e], [a, t * T_SPACING, c]]}
            color={round === t ? "#5ad8ef" : "#26365a"} lineWidth={round === t ? 1.6 : 1} transparent opacity={active ? 0.9 : 0.25} />
        );
      })}
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[quiet, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.09} color="#5a6b8f" transparent opacity={round === null ? 0.7 : 0.35} sizeAttenuation />
      </points>
      {[...fired].map((id) => {
        const d = byId.get(id);
        if (!d) return null;
        const p = pos(d.x, d.y, d.t);
        const dim = round !== null && round !== d.t;
        const color = BASIS_COLOR[d.basis] ?? "#ffffff";
        return (
          <group key={id}>
            {!reduced && !dim && <Pulse position={p} color={color} size={0.16} />}
            <mesh position={p} onPointerOver={(e) => { e.stopPropagation(); onHover({ id, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }); }}
              onPointerOut={() => onHover(null)}>
              <sphereGeometry args={[0.17, 20, 20]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim ? 0.15 : 0.9} transparent opacity={dim ? 0.3 : 1} />
            </mesh>
          </group>
        );
      })}
      {show.pm && (overlay.pymatching ?? []).map((e, i) => {
        const ds = e.detectors.map((id) => byId.get(id)).filter(Boolean) as { x: number; y: number; t: number }[];
        const pts = e.boundary ? boundaryStub(ds[0]) : ds.map((d) => pos(d.x, d.y, d.t));
        return <Line key={`pm${i}`} points={pts} color="#3fd0b0" lineWidth={2.6} dashed={e.boundary} dashSize={0.18} gapSize={0.12} />;
      })}
      {show.ising && mechLines(overlay.ising).map((pts, i) => <Line key={`is${i}`} points={pts} color="#c7b8ff" lineWidth={2.2} />)}
      {show.comp && mechLines(overlay.complement).map((pts, i) => <Line key={`co${i}`} points={pts} color="#f47c80" lineWidth={1.6} dashed dashSize={0.14} gapSize={0.1} />)}
    </>
  );
}

export function SpacetimeLattice3D({ geo, fired, overlay, round, show, reduced, height = 520 }: {
  geo: Geometry; fired: number[]; overlay: Overlay; round: number | null; show: { pm: boolean; ising: boolean; comp: boolean }; reduced: boolean; height?: number;
}) {
  const firedSet = useMemo(() => new Set(fired), [fired]);
  const tMax = geo.time_steps - 1;
  const xs = geo.detectors.map((d) => d.x);
  const span = Math.max(4, Math.max(...xs) - Math.min(...xs));
  const dist = Math.max(span * 1.5, tMax * T_SPACING * 1.05) + 4.5;
  const [hover, setHover] = useState<Hover>(null);
  const hovered = hover ? geo.detectors.find((d) => d.id === hover.id) : undefined;
  return (
    <div style={{ position: "relative", height, borderRadius: 12, overflow: "hidden", background: "radial-gradient(ellipse at 50% 30%, #0e1a30, #05080f 70%)", border: "1px solid var(--line)" }}>
      <Canvas camera={{ position: [dist * 0.85, (tMax * T_SPACING) / 2 + dist * 0.35, dist * 0.85], fov: 42 }} dpr={[1, 2]}>
        <Scene geo={geo} fired={firedSet} overlay={overlay} round={round} show={show} reduced={reduced} onHover={setHover} />
        <OrbitControls target={[0, (tMax * T_SPACING) / 2, 0]} enableDamping dampingFactor={0.08} autoRotate={!reduced} autoRotateSpeed={0.35} />
      </Canvas>
      <div className="num muted" style={{ position: "absolute", top: 10, left: 0, right: 0, textAlign: "center", fontSize: 10.5, pointerEvents: "none" }}>
        time ↑ (rounds 0 – {tMax})
      </div>
      {hover && hovered && (
        <div className="chart-tooltip" style={{ position: "absolute", left: hover.x + 12, top: hover.y, transform: "translateY(-50%)", pointerEvents: "none" }}>
          <b>detector D{hovered.id}</b><div className="num">({hovered.x}, {hovered.y}) · round {hovered.t} · {hovered.basis}-type</div>
        </div>
      )}
    </div>
  );
}
