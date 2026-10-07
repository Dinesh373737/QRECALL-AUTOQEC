import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { RefObject } from "react";
import type { ClassicalEvent, QuantumEvent, Result, Spin } from "./types";
import { num } from "./components";
import { selectedNeuronPair, visibleBasisStates } from "./sceneSelection";
import {
  basisGridPosition,
  probabilityHeight,
  probabilityScale,
  sceneProgress,
  stateBasisIndex,
  tweenPhase,
  tweenValue,
} from "./sceneMotion";
import {
  orbitIsActive,
  orbitalStatePosition,
  probabilityRadius,
  singleBitEdges,
  stateConstellationPosition,
} from "./sceneConstellation";
interface Props {
  result: Result;
  chapter: number;
  event?: ClassicalEvent;
  quantumEvent?: QuantumEvent;
  pair: [number, number];
  state: Spin[];
  selectedState: number;
  onState: (i: number) => void;
  onPair: (p: [number, number]) => void;
  reduced: boolean;
  quality: string;
  presenter: boolean;
  playing: boolean;
  progressRef: RefObject<number>;
  allStates: boolean;
  viewReset: number;
  counts?: Record<string, number>;
  alternateView?: boolean;
  cinematic?: boolean;
}
const palette = { teal: "#70ddd0", amber: "#eac17d", violet: "#b5a2ff" };
const gridPosition = basisGridPosition;

/** One demand-loop driver animates computed event progress, then stops on pause. */
function PlaybackFrames({
  playing,
  reduced,
}: {
  playing: boolean;
  reduced: boolean;
}) {
  const { invalidate } = useThree();
  useEffect(() => {
    invalidate();
  }, [playing, reduced, invalidate]);
  useFrame(() => {
    if (playing && !reduced) invalidate();
  });
  return null;
}

/** Local canvas labels avoid font downloads and remain camera-facing. */
function SceneLabel({
  text,
  position,
  color = "#dce8ed",
  width = 1.25,
  small = false,
}: {
  text: string;
  position: [number, number, number];
  color?: string;
  width?: number;
  small?: boolean;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(128, Math.min(512, text.length * 26 + 48));
    canvas.height = small ? 96 : 112;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(9, 17, 29, .88)";
      context.beginPath();
      context.roundRect(1, 1, canvas.width - 2, canvas.height - 2, 14);
      context.fill();
      context.strokeStyle = color;
      context.globalAlpha = 0.3;
      context.lineWidth = 3;
      context.stroke();
      context.globalAlpha = 1;
      context.font = `${small ? 60 : 42}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      context.fillStyle = color;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(
        text,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width - 24,
      );
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  }, [text, color, small]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite
      position={position}
      scale={[width, (width * texture.image.height) / texture.image.width, 1]}
    >
      <spriteMaterial
        map={texture}
        transparent
        depthWrite={false}
        depthTest={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function StageFloor({
  quantum = false,
  landscape = false,
}: {
  quantum?: boolean;
  landscape?: boolean;
}) {
  const floor = landscape ? -1.75 : quantum ? -1.07 : -0.4;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floor - 0.03, 0]}>
        <circleGeometry args={[5.7, 64]} />
        <meshStandardMaterial color="#0d1726" roughness={0.8} metalness={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floor - 0.02, 0]}>
        <ringGeometry args={[5.1, 5.13, 80]} />
        <meshBasicMaterial
          color={quantum ? palette.violet : palette.teal}
          transparent
          opacity={0.22}
        />
      </mesh>
      <gridHelper
        args={[9, 18, quantum ? "#35304f" : "#29414b", "#172631"]}
        position={[0, floor, 0]}
      />
    </group>
  );
}
function ContextGuard({ onLost }: { onLost: () => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onLost();
    };
    canvas.addEventListener("webglcontextlost", lost);
    // Canvas deliberately loses its context during disposal. Remove the
    // listener with the scene so that switching to 2D is not a GPU failure.
    return () => canvas.removeEventListener("webglcontextlost", lost);
  }, [gl, onLost]);
  return null;
}
function CameraRig({
  chapter,
  reduced,
  viewReset,
  manipulation,
  alternateView,
  cinematic,
  playing,
}: {
  chapter: number;
  reduced: boolean;
  viewReset: number;
  manipulation: RefObject<boolean>;
  alternateView: boolean;
  cinematic: boolean;
  playing: boolean;
}) {
  const { camera, invalidate, size } = useThree();
  const poses = [
    [7, 8, 11],
    [7, 8, 11],
    [9, 7, 10],
    [9, 7, 10],
    [8, 7, 11],
    [7, 8, 11],
    [7, 8, 11],
    [7, 8, 11],
  ];
  const target = new THREE.Vector3(
    ...(alternateView ? [9, 8, 12] : poses[chapter]),
  );
  const moving = useRef(true);
  const orbitAngle = useRef(0);
  const zoom = Math.min(
    alternateView ? 54 : chapter < 2 ? 87 : chapter < 4 ? 54 : 65,
    size.width / (alternateView ? 11.7 : chapter < 2 ? 6.8 : 10.5),
    size.height /
      (alternateView ? 10.2 : chapter < 2 ? 6.2 : chapter < 4 ? 8.4 : 9.4),
  );
  useEffect(() => {
    moving.current = true;
    orbitAngle.current = 0;
    manipulation.current = false;
    invalidate();
  }, [
    chapter,
    reduced,
    viewReset,
    size.width,
    size.height,
    alternateView,
    invalidate,
    manipulation,
  ]);
  useFrame((_, dt) => {
    if (manipulation.current) return;
    const orbiting = orbitIsActive(
      playing,
      reduced,
      cinematic,
      manipulation.current,
    );
    if (!moving.current && !orbiting) return;
    if (orbiting && !moving.current)
      orbitAngle.current += Math.min(dt, 0.05) * 0.09;
    const angle = Math.atan2(target.x, target.z) + orbitAngle.current;
    const distance = Math.hypot(target.x, target.z);
    const destination = new THREE.Vector3(
      Math.sin(angle) * distance,
      target.y,
      Math.cos(angle) * distance,
    );
    if (reduced) {
      camera.position.copy(destination);
      (camera as THREE.OrthographicCamera).zoom = zoom;
    } else {
      camera.position.lerp(destination, 1 - Math.exp(-dt * 5));
      const c = camera as THREE.OrthographicCamera;
      c.zoom += (zoom - c.zoom) * (1 - Math.exp(-dt * 5));
    }
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    if (
      camera.position.distanceTo(destination) < 0.002 &&
      Math.abs((camera as THREE.OrthographicCamera).zoom - zoom) < 0.02
    )
      moving.current = false;
    if (moving.current || orbiting) invalidate();
  });
  return null;
}
function Neuron({
  position,
  index,
  spin,
  active,
  trusted,
  reduced,
  onPick,
  playing,
  progressRef,
}: {
  position: [number, number, number];
  index: number;
  spin: Spin;
  active: boolean;
  trusted: boolean;
  reduced: boolean;
  onPick: () => void;
  playing: boolean;
  progressRef: RefObject<number>;
}) {
  const ref = useRef<THREE.Group>(null!);
  const tile = useRef<THREE.Mesh>(null!);
  const halo = useRef<THREE.Mesh>(null!);
  const material = useRef<THREE.MeshStandardMaterial>(null!);
  const initial = useRef(position);
  const { invalidate } = useThree();
  const target = useMemo(
    () => new THREE.Vector3(...position),
    [position[0], position[1], position[2]],
  );
  useFrame((_, dt) => {
    if (ref.current.position.distanceTo(target) > 0.001) {
      if (reduced) ref.current.position.copy(target);
      else ref.current.position.lerp(target, 1 - Math.exp(-dt * 8));
      invalidate();
    }
    const pulse =
      active && playing && !reduced
        ? Math.sin(Math.PI * progressRef.current)
        : 0;
    tile.current.scale.y = spin === 1 ? 0.36 : 0.15;
    material.current.emissiveIntensity = active
      ? 0.45 + pulse * 0.55
      : trusted
        ? 0.16
        : 0.1;
    if (halo.current) halo.current.scale.setScalar(1 + pulse * 0.24);
  });
  return (
    <group ref={ref} position={initial.current}>
      <mesh
        ref={tile}
        position={[0, 0.03, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
      >
        <boxGeometry args={[0.67, 1, 0.67]} />
        <meshStandardMaterial
          ref={material}
          color={
            spin === 1
              ? trusted
                ? "#dce8ed"
                : "#70ddd0"
              : trusted
                ? "#354556"
                : "#122335"
          }
          metalness={0.4}
          roughness={0.26}
          emissive={active ? palette.teal : trusted ? "#4b6573" : "#173b38"}
          emissiveIntensity={active ? 0.45 : 0.12}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]}>
        <ringGeometry args={[0.38, trusted ? 0.43 : 0.4, 32]} />
        <meshBasicMaterial
          color={trusted ? "#dce8ed" : "#457875"}
          transparent
          opacity={trusted ? 0.7 : 0.28}
          side={THREE.DoubleSide}
        />
      </mesh>
      {active && (
        <mesh
          ref={halo}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, -0.18, 0]}
        >
          <ringGeometry args={[0.46, 0.5, 40]} />
          <meshBasicMaterial
            color={palette.teal}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
      <SceneLabel
        text={`${index}  ${spin === 1 ? "+" : "−"}`}
        position={[0, 0.52, 0]}
        width={0.85}
        color={trusted ? "#dce8ed" : palette.teal}
        small
      />
    </group>
  );
}

function ConnectionPulse({
  curve,
  color,
  playing,
  reduced,
  progressRef,
}: {
  curve: THREE.QuadraticBezierCurve3;
  color: string;
  playing: boolean;
  reduced: boolean;
  progressRef: RefObject<number>;
}) {
  const marker = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    marker.current.visible = playing && !reduced;
    if (marker.current.visible)
      marker.current.position.copy(curve.getPoint(progressRef.current));
  });
  return (
    <mesh ref={marker} visible={playing && !reduced}>
      <sphereGeometry args={[0.07, 8, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

function Network(p: Props) {
  const { n, cols, rows, free_indices, weights, trusted_indices } =
    p.result.model;
  const pos = (i: number): [number, number, number] =>
    p.chapter === 4
      ? [-2.8, (free_indices.length / 2 - free_indices.indexOf(i)) * 0.65, -0.5]
      : [
          ((i % cols) - (cols - 1) / 2) * 1.05,
          0.2,
          (Math.floor(i / cols) - (rows - 1) / 2) * 1.05,
        ];
  const selected = p.event?.neuron;
  const links = useMemo(() => {
    const list: {
      i: number;
      j: number;
      weight: number;
      curve: THREE.QuadraticBezierCurve3;
    }[] = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const weight = weights[i][j];
        if (
          !weight ||
          (p.chapter === 4 &&
            (!free_indices.includes(i) || !free_indices.includes(j)))
        )
          continue;
        const a = pos(i),
          b = pos(j);
        const middle: [number, number, number] =
          p.chapter === 4
            ? [-2.1 + Math.abs(weight) * 2, (a[1] + b[1]) / 2, -0.2]
            : [
                (a[0] + b[0]) / 2,
                0.65 + Math.abs(weight) * 3 + (Math.abs(i - j) % 4) * 0.1,
                (a[2] + b[2]) / 2,
              ];
        list.push({
          i,
          j,
          weight,
          curve: new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(...a),
            new THREE.Vector3(...middle),
            new THREE.Vector3(...b),
          ),
        });
      }
    return list;
  }, [n, cols, rows, weights, free_indices, p.chapter]);
  return (
    <group>
      {links.map(({ i, j, weight, curve }) => {
        const active =
          (p.pair.includes(i) && p.pair.includes(j)) ||
          selected === i ||
          selected === j;
        const color = weight >= 0 ? palette.teal : palette.amber;
        return (
          <group key={`${i}-${j}`}>
            <Line
              points={curve.getPoints(p.quality === "low" ? 12 : 24)}
              color={color}
              lineWidth={active ? 2.6 : 0.75}
              transparent
              opacity={active ? 0.95 : p.chapter === 1 ? 0.12 : 0.2}
              dashed={weight < 0}
              dashSize={0.13}
              gapSize={0.07}
            />
            {active && (
              <ConnectionPulse
                curve={curve}
                color={color}
                playing={p.playing}
                reduced={p.reduced}
                progressRef={p.progressRef}
              />
            )}
          </group>
        );
      })}
      {p.state.map((spin, i) =>
        p.chapter === 4 && !free_indices.includes(i) ? null : (
          <Neuron
            key={i}
            position={pos(i)}
            index={i}
            spin={spin}
            active={
              selected === i ||
              p.pair.includes(i) ||
              !!p.quantumEvent?.global_qubits.includes(i)
            }
            trusted={trusted_indices.includes(i)}
            reduced={p.reduced}
            playing={p.playing}
            progressRef={p.progressRef}
            onPick={() => p.onPair(selectedNeuronPair(p.pair, i))}
          />
        ),
      )}
      {p.chapter !== 4 && <StageFloor />}
    </group>
  );
}
function SegmentLinks({
  positions,
  edges,
  colors,
  color = "#608b91",
  opacity = 0.2,
}: {
  positions: [number, number, number][];
  edges: [number, number][];
  colors?: string[];
  color?: string;
  opacity?: number;
}) {
  const geometry = useMemo(() => {
    const coordinates: number[] = [],
      vertexColors: number[] = [];
    for (const [a, b] of edges) {
      coordinates.push(...positions[a], ...positions[b]);
      if (colors)
        for (const index of [a, b]) {
          const value = new THREE.Color(colors[index]);
          vertexColors.push(value.r, value.g, value.b);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(coordinates, 3),
    );
    if (colors)
      g.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(vertexColors, 3),
      );
    return g;
  }, [positions, edges, colors]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial
        color={colors ? "#ffffff" : color}
        vertexColors={!!colors}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function StaticStateNodes({
  indices,
  positions,
  colors,
  active,
  onState,
  low,
}: {
  indices: number[];
  positions: [number, number, number][];
  colors: string[];
  active: number;
  onState: (index: number) => void;
  low: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const transform = new THREE.Object3D();
    for (let instance = 0; instance < indices.length; instance++) {
      const index = indices[instance];
      transform.position.set(...positions[index]);
      transform.scale.setScalar(index === active ? 0.13 : 0.065);
      transform.updateMatrix();
      mesh.current.setMatrixAt(instance, transform.matrix);
      mesh.current.setColorAt(instance, new THREE.Color(colors[index]));
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [indices, positions, colors, active]);
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, indices.length]}
      onClick={(event) => {
        if (event.instanceId === undefined) return;
        event.stopPropagation();
        onState(indices[event.instanceId]);
      }}
    >
      <sphereGeometry args={[1, low ? 8 : 12, low ? 6 : 10]} />
      <meshStandardMaterial
        color="#ffffff"
        emissive="#20433f"
        emissiveIntensity={0.35}
        roughness={0.3}
        metalness={0.25}
      />
    </instancedMesh>
  );
}

function WeightSculpture(p: Props) {
  const { weights, n } = p.result.model;
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const extent = Math.max(1e-12, ...weights.flat().map(Math.abs));
  const spacing = 6.5 / n;
  const positions = useMemo(
    () =>
      weights.flatMap((row, i) =>
        row.map((weight, j) => ({
          i,
          j,
          weight,
          x: (j - (n - 1) / 2) * spacing,
          z: (i - (n - 1) / 2) * spacing,
          height: (weight / extent) * 2.1,
        })),
      ),
    [weights, n, spacing, extent],
  );
  const color = (weight: number) =>
    weight > 0 ? palette.teal : weight < 0 ? palette.amber : "#475363";
  useLayoutEffect(() => {
    const transform = new THREE.Object3D();
    for (let instance = 0; instance < positions.length; instance++) {
      const item = positions[instance];
      transform.position.set(item.x, item.height / 2, item.z);
      transform.scale.set(
        spacing * 0.76,
        Math.abs(item.height),
        spacing * 0.76,
      );
      transform.updateMatrix();
      mesh.current.setMatrixAt(instance, transform.matrix);
      mesh.current.setColorAt(instance, new THREE.Color(color(item.weight)));
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [positions, spacing]);
  const [row, col] = p.pair;
  const selected = positions[row * n + col];
  return (
    <group>
      <gridHelper args={[6.5, n, "#80919d", "#263a4a"]} position={[0, 0, 0]} />
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(event) => {
          event.stopPropagation();
          const column = Math.min(
            n - 1,
            Math.max(0, Math.floor((event.point.x + 3.25) / spacing)),
          );
          const row = Math.min(
            n - 1,
            Math.max(0, Math.floor((event.point.z + 3.25) / spacing)),
          );
          p.onPair([row, column]);
        }}
      >
        <planeGeometry args={[6.5, 6.5]} />
        <meshBasicMaterial
          color="#243247"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <instancedMesh
        ref={mesh}
        args={[undefined, undefined, positions.length]}
        onClick={(event) => {
          if (event.instanceId === undefined) return;
          event.stopPropagation();
          const item = positions[event.instanceId];
          p.onPair([item.i, item.j]);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.24}
          metalness={0.35}
          emissive="#2c332c"
          emissiveIntensity={0.15}
        />
      </instancedMesh>
      {selected && (
        <group position={[selected.x, selected.height, selected.z]}>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, selected.height < 0 ? -0.03 : 0.03, 0]}
          >
            <ringGeometry args={[spacing * 0.42, spacing * 0.52, 32]} />
            <meshBasicMaterial
              color="#f4fbff"
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <SceneLabel
            text={`W${row},${col} ${num(selected.weight)}`}
            position={[0, selected.height < 0 ? -0.6 : 0.6, 0]}
            width={2}
            color={color(selected.weight)}
          />
        </group>
      )}
      {Array.from({ length: n }, (_, index) => (
        <group key={index}>
          <SceneLabel
            text={`${index}`}
            position={[(index - (n - 1) / 2) * spacing, 0, -3.65]}
            width={spacing * 0.7}
            color="#a4bccb"
            small
          />
          <SceneLabel
            text={`${index}`}
            position={[-3.65, 0, (index - (n - 1) / 2) * spacing]}
            width={spacing * 0.7}
            color="#a4bccb"
            small
          />
        </group>
      ))}
      <SceneLabel
        text={`+W ${num(extent)}`}
        position={[3.9, 2.3, 0]}
        width={1.5}
        color={palette.teal}
        small
      />
      <SceneLabel
        text={`−W ${num(-extent)}`}
        position={[3.9, -2.3, 0]}
        width={1.5}
        color={palette.amber}
        small
      />
      <Line
        points={[
          [3.9, -2.1, 0],
          [3.9, 2.1, 0],
        ]}
        color="#607180"
        lineWidth={1.2}
      />
    </group>
  );
}

function EnergyConstellation(p: Props) {
  const { energies, states, free_indices } = p.result.model;
  const q = free_indices.length;
  const min = Math.min(...energies),
    max = Math.max(...energies);
  const current = stateBasisIndex(states, p.state);
  const inspected = p.selectedState;
  const color = p.chapter === 3 ? palette.amber : palette.teal;
  const positions = useMemo(
    () =>
      energies.map((energy, index) => {
        const [x, z] = stateConstellationPosition(index, q);
        return [x, ((energy - min) / (max - min || 1)) * 3 - 1.4, z] as [
          number,
          number,
          number,
        ];
      }),
    [energies, q, min, max],
  );
  const colors = useMemo(
    () =>
      energies.map((energy) =>
        new THREE.Color("#72dbc7")
          .lerp(
            new THREE.Color(p.chapter === 3 ? "#d39254" : "#707bd4"),
            (energy - min) / (max - min || 1),
          )
          .getStyle(),
      ),
    [energies, min, max, p.chapter],
  );
  const indices = useMemo(() => {
    if (p.quality !== "low" || p.allStates || energies.length <= 64)
      return energies.map((_, index) => index);
    const shown = energies
      .map((_, index) => index)
      .filter((index) => index % Math.ceil(energies.length / 60) === 0);
    for (const index of [
      current,
      inspected,
      p.event ? stateBasisIndex(states, p.event.state_before) : -1,
    ])
      if (index >= 0 && !shown.includes(index)) shown.push(index);
    return shown.sort((a, b) => a - b);
  }, [energies, p.quality, p.allStates, current, inspected, p.event, states]);
  const edges = useMemo(() => singleBitEdges(indices, q), [indices, q]);
  const before = p.event
    ? stateBasisIndex(states, p.event.state_before)
    : current;
  const trace =
    p.chapter === 3 ? p.result.gibbs.trace : p.result.hopfield.trace;
  const index = p.event ? (p.event.index ?? trace.indexOf(p.event)) : -1;
  const path = useMemo(
    () =>
      trace
        .slice(Math.max(0, index - 20), Math.max(0, index))
        .map((event) => stateBasisIndex(states, event.state_after))
        .filter(
          (state, i, list) => state >= 0 && (i === 0 || state !== list[i - 1]),
        )
        .map((state) => positions[state]),
    [trace, index, states, positions],
  );
  return (
    <group>
      <SegmentLinks
        positions={positions}
        edges={edges}
        colors={colors}
        opacity={p.quality === "low" ? 0.24 : 0.12}
      />
      <StaticStateNodes
        indices={indices}
        positions={positions}
        colors={colors}
        active={current}
        onState={p.onState}
        low={p.quality === "low"}
      />
      {path.length > 1 && (
        <Line
          points={path}
          color={color}
          lineWidth={2.8}
          transparent
          opacity={0.7}
        />
      )}
      {before >= 0 && current >= 0 && before !== current && (
        <Line
          points={[positions[before], positions[current]]}
          color={color}
          lineWidth={3}
        />
      )}
      {current >= 0 && (
        <ClassicalTraveler
          before={positions[before >= 0 ? before : current]}
          after={positions[current]}
          color={color}
          playing={p.playing}
          reduced={p.reduced}
          progressRef={p.progressRef}
        />
      )}
      {current >= 0 && (
        <SceneLabel
          text={`s${current}  E ${num(energies[current])}`}
          position={[
            positions[current][0],
            positions[current][1] + 0.65,
            positions[current][2],
          ]}
          width={1.8}
          color={color}
        />
      )}
      {inspected >= 0 &&
        inspected < energies.length &&
        inspected !== current && (
          <group position={positions[inspected]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.17, 0.21, 32]} />
              <meshBasicMaterial
                color={palette.violet}
                side={THREE.DoubleSide}
              />
            </mesh>
            <SceneLabel
              text={`s${inspected}  E ${num(energies[inspected])}`}
              position={[0, 0.5, 0]}
              width={1.8}
              color={palette.violet}
            />
          </group>
        )}
      <Line
        points={[
          [4, -1.4, 0],
          [4, 1.6, 0],
        ]}
        color="#69808b"
        lineWidth={1.2}
      />
      <SceneLabel
        text={`E ${num(max)}`}
        position={[4, 2.05, 0]}
        width={1.4}
        color="#b4c5d0"
        small
      />
      <SceneLabel
        text={`E ${num(min)}`}
        position={[4, -1.95, 0]}
        width={1.4}
        color={color}
        small
      />
    </group>
  );
}

function ClassicalTraveler({
  before,
  after,
  color,
  playing,
  reduced,
  progressRef,
}: {
  before: [number, number, number];
  after: [number, number, number];
  color: string;
  playing: boolean;
  reduced: boolean;
  progressRef: RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null!);
  const halo = useRef<THREE.Mesh>(null!);
  useFrame(() => {
    const t = sceneProgress(progressRef.current, playing, reduced);
    group.current.position.set(
      tweenValue(before[0], after[0], t),
      tweenValue(before[1], after[1], t) + 0.08,
      tweenValue(before[2], after[2], t),
    );
    halo.current.scale.setScalar(
      1 + (playing && !reduced ? Math.sin(Math.PI * t) * 0.35 : 0),
    );
  });
  return (
    <group ref={group} position={after}>
      <mesh>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial
          color="#f2ffff"
          emissive={color}
          emissiveIntensity={1.25}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.25, 0.29, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}>
        <ringGeometry args={[0.33, 0.5, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.11}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function Landscape(p: Props) {
  const { energies, free_indices, states } = p.result.model;
  const q = free_indices.length;
  const min = Math.min(...energies),
    max = Math.max(...energies);
  const color = p.chapter === 3 ? palette.amber : palette.teal;
  const point = useCallback(
    (i: number): [number, number, number] => {
      const [x, z] = gridPosition(i, q);
      return [x, ((energies[i] - min) / (max - min || 1)) * 2.6 - 1.2, z];
    },
    [energies, q, min, max],
  );
  const geometry = useMemo(() => {
    const nx = 1 << Math.ceil(q / 2),
      nz = 1 << Math.floor(q / 2);
    const coordinates: number[] = [],
      colors: number[] = [];
    const integer = (x: number, z: number) =>
      (x ^ (x >> 1)) | ((z ^ (z >> 1)) << Math.ceil(q / 2));
    const low = new THREE.Color(p.chapter === 3 ? "#476364" : "#287f76");
    const high = new THREE.Color(p.chapter === 3 ? "#d69747" : "#273b78");
    for (let z = 0; z < nz - 1; z++)
      for (let x = 0; x < nx - 1; x++) {
        const ids = [
          integer(x, z),
          integer(x + 1, z),
          integer(x, z + 1),
          integer(x + 1, z),
          integer(x + 1, z + 1),
          integer(x, z + 1),
        ];
        for (const i of ids) {
          coordinates.push(...point(i));
          const tint = low
            .clone()
            .lerp(high, (energies[i] - min) / (max - min || 1));
          colors.push(tint.r, tint.g, tint.b);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(coordinates, 3),
    );
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, [energies, q, min, max, p.chapter, point]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const current = stateBasisIndex(states, p.state);
  const selected = current >= 0 ? current : p.selectedState;
  const before = p.event
    ? stateBasisIndex(states, p.event.state_before)
    : selected;
  const inspected = p.selectedState;
  const trace =
    p.chapter === 3 ? p.result.gibbs.trace : p.result.hopfield.trace;
  const eventIndex = p.event ? (p.event.index ?? trace.indexOf(p.event)) : -1;
  const trail = useMemo(() => {
    if (eventIndex < 1) return [];
    const recent = trace.slice(Math.max(0, eventIndex - 18), eventIndex);
    const indices = [
      stateBasisIndex(states, recent[0].state_before),
      ...recent.map((event) => stateBasisIndex(states, event.state_after)),
    ];
    return indices
      .filter((index, i) => index >= 0 && (i === 0 || index !== indices[i - 1]))
      .map((index) => {
        const position = point(index);
        return [position[0], position[1] + 0.07, position[2]] as [
          number,
          number,
          number,
        ];
      });
  }, [states, trace, eventIndex, point]);
  const uphill =
    !!p.event && p.event.energy_after > p.event.energy_before + 1e-10;
  const motionColor = uphill ? palette.amber : color;
  return (
    <group>
      <StageFloor landscape />
      <mesh geometry={geometry}>
        <meshStandardMaterial
          vertexColors
          transparent
          opacity={0.66}
          side={THREE.DoubleSide}
          roughness={0.58}
          metalness={0.18}
        />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.2}
          depthWrite={false}
        />
      </mesh>
      {energies.map((energy, index) => (
        <mesh
          key={index}
          position={point(index)}
          onClick={(event) => {
            event.stopPropagation();
            p.onState(index);
          }}
        >
          <sphereGeometry
            args={[
              index === inspected ? 0.065 : energy === min ? 0.06 : 0.038,
              8,
              8,
            ]}
          />
          <meshBasicMaterial
            color={
              index === inspected
                ? palette.violet
                : energy === min
                  ? "#a1ffdb"
                  : "#7d9ca9"
            }
            transparent
            opacity={index === inspected || energy === min ? 1 : 0.5}
          />
        </mesh>
      ))}
      {trail.length > 1 && (
        <Line
          points={trail}
          color={color}
          lineWidth={p.quality === "low" ? 1.8 : 2.4}
          transparent
          opacity={0.6}
        />
      )}
      {before >= 0 && selected >= 0 && before !== selected && (
        <Line
          points={[point(before), point(selected)]}
          color={motionColor}
          lineWidth={2.6}
          transparent
          opacity={0.72}
          dashed
          dashSize={0.09}
          gapSize={0.05}
        />
      )}
      {selected >= 0 && (
        <ClassicalTraveler
          before={point(before >= 0 ? before : selected)}
          after={point(selected)}
          color={motionColor}
          playing={p.playing}
          reduced={p.reduced}
          progressRef={p.progressRef}
        />
      )}
      {selected >= 0 && (
        <SceneLabel
          text={`s${selected}  E ${num(energies[selected])}`}
          position={[
            point(selected)[0],
            point(selected)[1] + 0.65,
            point(selected)[2],
          ]}
          width={1.85}
          color={color}
        />
      )}
      {inspected >= 0 &&
        inspected < energies.length &&
        inspected !== selected && (
          <group position={point(inspected)}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.07, 0]}>
              <ringGeometry args={[0.27, 0.32, 40]} />
              <meshBasicMaterial
                color={palette.violet}
                side={THREE.DoubleSide}
                toneMapped={false}
              />
            </mesh>
            <SceneLabel
              text={`s${inspected}  E ${num(energies[inspected])}`}
              position={[0, 0.62, 0]}
              width={1.85}
              color={palette.violet}
            />
          </group>
        )}
      <SceneLabel
        text={`E min ${num(min)}`}
        position={[-3.7, -1.52, 3.65]}
        width={1.6}
        color={color}
        small
      />
      <SceneLabel
        text={`E max ${num(max)}`}
        position={[3.7, -1.52, 3.65]}
        width={1.6}
        color="#b3c8d4"
        small
      />
    </group>
  );
}
function ProbabilityColumn({
  index,
  probability,
  previousProbability,
  phase,
  previousPhase,
  maximum,
  position,
  inspected,
  measured,
  showPhase,
  showIndex,
  changed,
  p,
}: {
  index: number;
  probability: number;
  previousProbability: number;
  phase: number | null;
  previousPhase: number | null;
  maximum: number;
  position: [number, number];
  inspected: boolean;
  measured: boolean;
  showPhase: boolean;
  showIndex: boolean;
  changed: boolean;
  p: Props;
}) {
  const bar = useRef<THREE.Mesh>(null!);
  const cap = useRef<THREE.Mesh>(null!);
  const dial = useRef<THREE.Group>(null!);
  const label = useRef<THREE.Group>(null!);
  const material = useRef<THREE.MeshStandardMaterial>(null!);
  const color = measured
    ? palette.amber
    : inspected
      ? "#e5dcff"
      : palette.violet;
  const height = probabilityHeight(probability, maximum);
  useFrame(() => {
    const t = sceneProgress(p.progressRef.current, p.playing, p.reduced);
    const visualProbability = tweenValue(previousProbability, probability, t);
    const h = probabilityHeight(visualProbability, maximum);
    bar.current.scale.y = h;
    bar.current.position.y = h / 2;
    bar.current.visible = h > 0;
    cap.current.position.y = h + 0.015;
    cap.current.visible = h > 0;
    const pulse =
      changed && p.playing && !p.reduced ? Math.sin(Math.PI * t) : 0;
    material.current.emissiveIntensity =
      (inspected || measured ? 0.6 : 0.16) + pulse * 0.65;
    if (dial.current) {
      dial.current.position.y = h + 0.18;
      const angle = tweenPhase(previousPhase, phase, t);
      dial.current.rotation.y = -(angle ?? 0);
      dial.current.visible = angle !== null && visualProbability > 0;
    }
    if (label.current) label.current.position.y = h + (showPhase ? 0.62 : 0.38);
  });
  return (
    <group position={[position[0], -1, position[1]]}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.012, 0]}
        onClick={(event) => {
          event.stopPropagation();
          p.onState(index);
        }}
      >
        <planeGeometry args={[0.36, 0.36]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={inspected || measured ? 0.35 : 0.09}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={bar}
        position={[0, height / 2, 0]}
        scale={[1, height, 1]}
        onClick={(event) => {
          event.stopPropagation();
          p.onState(index);
        }}
      >
        <boxGeometry args={[0.26, 1, 0.26]} />
        <meshStandardMaterial
          ref={material}
          color={color}
          transparent
          opacity={inspected || measured ? 0.95 : 0.72}
          emissive={measured ? palette.amber : palette.violet}
          emissiveIntensity={inspected ? 0.6 : 0.16}
          metalness={0.3}
          roughness={0.25}
        />
      </mesh>
      <mesh ref={cap} position={[0, height + 0.015, 0]}>
        <boxGeometry args={[0.28, 0.022, 0.28]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {(inspected || measured) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.027, 0]}>
          <ringGeometry args={[0.23, 0.27, 32]} />
          <meshBasicMaterial
            color={color}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      {showPhase && phase !== null && (
        <group
          ref={dial}
          position={[0, height + 0.18, 0]}
          rotation={[0, -phase, 0]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry
              args={[
                0.2,
                inspected ? 0.018 : 0.011,
                6,
                p.quality === "low" ? 20 : 40,
              ]}
            />
            <meshBasicMaterial
              color={inspected ? "#f2ebff" : palette.violet}
              transparent
              opacity={inspected ? 1 : 0.8}
              toneMapped={false}
            />
          </mesh>
          <Line
            points={[
              [0, 0, 0],
              [0.2, 0, 0],
            ]}
            color="#f3ecff"
            lineWidth={inspected ? 2.4 : 1.6}
          />
          <mesh position={[0.2, 0, 0]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshBasicMaterial color="#f3ecff" toneMapped={false} />
          </mesh>
        </group>
      )}
      {inspected && (
        <group
          ref={label}
          position={[0, height + (showPhase ? 0.62 : 0.38), 0]}
        >
          <SceneLabel
            text={`s${index}  ${(probability * 100).toFixed(2)}%`}
            position={[0, 0, 0]}
            width={2.4}
            color="#e6dcff"
          />
        </group>
      )}
      {showIndex && (
        <SceneLabel
          text={`${index}`}
          position={[0, -0.08, 0]}
          width={0.44}
          color={measured ? palette.amber : "#bbaee0"}
          small
        />
      )}
    </group>
  );
}

function ProbabilitySpace(p: Props) {
  const q = p.result.model.free_indices.length;
  const shotTotal = Object.values(p.counts || {}).reduce(
    (sum, value) => sum + value,
    0,
  );
  const measured = p.chapter === 5 && shotTotal > 0;
  const probs = measured
    ? p.result.quantum.probabilities.map(
        (_, i) => (p.counts?.[i] || 0) / shotTotal,
      )
    : p.quantumEvent?.probabilities || p.result.quantum.probabilities;
  const phase =
    p.quantumEvent?.phases || p.result.quantum.trace.at(-1)?.phases || [];
  const quantumIndex = p.quantumEvent
    ? p.result.quantum.trace.indexOf(p.quantumEvent)
    : -1;
  const priorQuantum =
    quantumIndex > 0
      ? p.result.quantum.trace[quantumIndex - 1]
      : p.quantumEvent;
  const measurementIndex = measured
    ? p.result.quantum.measurement_trace.findIndex(
        (event) => event.counts === p.counts,
      )
    : -1;
  const priorMeasurement =
    measurementIndex > 0
      ? p.result.quantum.measurement_trace[measurementIndex - 1]
      : null;
  const previousProbs = measured
    ? priorMeasurement
      ? probs.map(
          (_, i) => (priorMeasurement.counts[i] || 0) / priorMeasurement.shots,
        )
      : probs
    : priorQuantum?.probabilities || probs;
  const previousPhases = priorQuantum?.phases || phase;
  const top = visibleBasisStates(
    probs,
    p.allStates ? probs.length : p.quality === "low" ? 16 : 32,
    p.selectedState,
  ).sort((a, b) => a.index - b.index);
  // One fixed scale over computed snapshots makes redistribution comparable
  // and prevents a previous endpoint exceeding a newly smaller axis maximum.
  const maximum = useMemo(() => {
    if (p.chapter === 5 && p.result.quantum.measurement_trace.length) {
      return probabilityScale(
        p.result.quantum.measurement_trace.map((event) =>
          Object.values(event.counts).map((count) => count / event.shots),
        ),
      );
    }
    return probabilityScale([
      ...p.result.quantum.trace.map((event) => event.probabilities),
      p.result.quantum.probabilities,
    ]);
  }, [p.result.quantum, p.chapter]);
  const measuredState = measured
    ? stateBasisIndex(p.result.model.states, p.state)
    : -1;
  const phasePriority = new Set(
    visibleBasisStates(probs, 16, p.selectedState).map((state) => state.index),
  );
  return (
    <group>
      <StageFloor quantum />
      {top.map(({ value, index }) => (
        <ProbabilityColumn
          key={index}
          index={index}
          probability={value}
          previousProbability={previousProbs[index] ?? value}
          phase={phase[index] ?? null}
          previousPhase={previousPhases[index] ?? null}
          maximum={maximum}
          position={gridPosition(index, q)}
          inspected={index === p.selectedState}
          measured={index === measuredState}
          showPhase={
            p.chapter === 4 && (top.length <= 32 || phasePriority.has(index))
          }
          showIndex={
            top.length <= 32 ||
            index === p.selectedState ||
            index === measuredState
          }
          changed={
            measured
              ? (p.counts?.[index] || 0) >
                (priorMeasurement?.counts[index] || 0)
              : Math.abs(value - (previousProbs[index] ?? value)) > 1e-10 ||
                phase[index] !== previousPhases[index]
          }
          p={p}
        />
      ))}
      <Line
        points={[
          [-4.1, -1, -3.5],
          [-4.1, 2, -3.5],
        ]}
        color="#736990"
        lineWidth={1.3}
      />
      {[0, 1, 2, 3].map((tick) => (
        <Line
          key={tick}
          points={[
            [-4.2, tick - 1, -3.5],
            [-4, tick - 1, -3.5],
          ]}
          color="#9186ad"
          lineWidth={1.4}
        />
      ))}
      <SceneLabel
        text={`${measured ? "f" : "P"} scale ${(maximum * 100).toFixed(2)}%`}
        position={[-3.35, 1.93, -3.5]}
        width={2.6}
        color={measured ? palette.amber : palette.violet}
        small
      />
      <SceneLabel
        text="0"
        position={[-4.28, -1.05, -3.5]}
        width={0.42}
        color="#9186ad"
        small
      />
    </group>
  );
}
function ProbabilityOrbs({
  indices,
  positions,
  probabilities,
  previousProbabilities,
  phases,
  previousPhases,
  maximum,
  measuredState,
  p,
}: {
  indices: number[];
  positions: [number, number, number][];
  probabilities: number[];
  previousProbabilities: number[];
  phases: (number | null)[];
  previousPhases: (number | null)[];
  maximum: number;
  measuredState: number;
  p: Props;
}) {
  const nodes = useRef<THREE.InstancedMesh>(null!);
  const marker = useRef<THREE.Group>(null!);
  const dial = useRef<THREE.Group>(null!);
  const transform = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const progress = sceneProgress(p.progressRef.current, p.playing, p.reduced);
    for (let instance = 0; instance < indices.length; instance++) {
      const index = indices[instance];
      const probability = tweenValue(
        previousProbabilities[index] ?? probabilities[index],
        probabilities[index],
        progress,
      );
      const phase = tweenPhase(
        previousPhases[index] ?? null,
        phases[index] ?? null,
        progress,
      );
      transform.position.set(...positions[index]);
      transform.scale.setScalar(probabilityRadius(probability, maximum));
      transform.updateMatrix();
      nodes.current.setMatrixAt(instance, transform.matrix);
      if (p.chapter === 5)
        color.set(index === measuredState ? "#ffe2a9" : palette.violet);
      else if (phase === null) color.set("#778397");
      else
        color.setHSL(
          (((phase / (2 * Math.PI) + 0.72) % 1) + 1) % 1,
          0.62,
          index === p.selectedState ? 0.78 : 0.64,
        );
      nodes.current.setColorAt(instance, color);
    }
    nodes.current.instanceMatrix.needsUpdate = true;
    if (nodes.current.instanceColor)
      nodes.current.instanceColor.needsUpdate = true;
    const selectedProbability = tweenValue(
      previousProbabilities[p.selectedState] ?? probabilities[p.selectedState],
      probabilities[p.selectedState] ?? 0,
      progress,
    );
    const radius = probabilityRadius(selectedProbability, maximum);
    if (marker.current)
      marker.current.scale.setScalar(Math.max(0.13, radius + 0.1));
    if (dial.current) {
      const phase = tweenPhase(
        previousPhases[p.selectedState] ?? null,
        phases[p.selectedState] ?? null,
        progress,
      );
      dial.current.visible = phase !== null && selectedProbability > 0;
      dial.current.rotation.y = -(phase ?? 0);
      dial.current.position.y = radius + 0.18;
    }
  });
  useEffect(() => {
    nodes.current.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
  }, []);
  const selected =
    p.selectedState >= 0 && p.selectedState < positions.length
      ? p.selectedState
      : 0;
  return (
    <group>
      <instancedMesh
        ref={nodes}
        args={[undefined, undefined, indices.length]}
        onClick={(event) => {
          if (event.instanceId === undefined) return;
          event.stopPropagation();
          p.onState(indices[event.instanceId]);
        }}
      >
        <sphereGeometry
          args={[
            1,
            p.quality === "low" ? 10 : 18,
            p.quality === "low" ? 8 : 14,
          ]}
        />
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.2}
          metalness={0.4}
          emissive="#2b204b"
          emissiveIntensity={0.42}
        />
      </instancedMesh>
      <group position={positions[selected]}>
        <group ref={marker}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1, 0.018, 6, 48]} />
            <meshBasicMaterial
              color="#eee5ff"
              transparent
              opacity={0.8}
              toneMapped={false}
            />
          </mesh>
          <mesh>
            <torusGeometry args={[1, 0.018, 6, 48]} />
            <meshBasicMaterial color="#eee5ff" transparent opacity={0.35} />
          </mesh>
        </group>
        {p.chapter === 4 && phases[selected] !== null && (
          <group ref={dial}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.24, 0.012, 6, 32]} />
              <meshBasicMaterial color="#eee5ff" />
            </mesh>
            <Line
              points={[
                [0, 0, 0],
                [0.24, 0, 0],
              ]}
              color="#eee5ff"
              lineWidth={2}
            />
          </group>
        )}
        <SceneLabel
          text={`s${selected}  ${(probabilities[selected] * 100).toFixed(2)}%`}
          position={[0, 0.95, 0]}
          width={2.1}
          color="#e4d6ff"
        />
      </group>
      {measuredState >= 0 && measuredState !== selected && (
        <group position={positions[measuredState]}>
          <mesh>
            <torusGeometry
              args={[
                probabilityRadius(probabilities[measuredState], maximum) + 0.1,
                0.025,
                8,
                48,
              ]}
            />
            <meshBasicMaterial color={palette.amber} toneMapped={false} />
          </mesh>
          <SceneLabel
            text={`mode s${measuredState}`}
            position={[0, 0.8, 0]}
            width={1.6}
            color={palette.amber}
            small
          />
        </group>
      )}
    </group>
  );
}

function ProbabilityConstellation(p: Props) {
  const q = p.result.model.free_indices.length;
  const shotTotal = Object.values(p.counts || {}).reduce(
    (sum, value) => sum + value,
    0,
  );
  const measured = p.chapter === 5 && shotTotal > 0;
  const probabilities = measured
    ? p.result.quantum.probabilities.map(
        (_, index) => (p.counts?.[index] || 0) / shotTotal,
      )
    : p.quantumEvent?.probabilities || p.result.quantum.probabilities;
  const phases =
    p.chapter === 5
      ? probabilities.map(() => null)
      : p.quantumEvent?.phases ||
        p.result.quantum.trace.at(-1)?.phases ||
        probabilities.map(() => null);
  const quantumIndex = p.quantumEvent
    ? p.result.quantum.trace.indexOf(p.quantumEvent)
    : -1;
  const beforeQuantum =
    quantumIndex > 0
      ? p.result.quantum.trace[quantumIndex - 1]
      : p.quantumEvent;
  const measurementIndex = measured
    ? p.result.quantum.measurement_trace.findIndex(
        (event) => event.counts === p.counts,
      )
    : -1;
  const beforeMeasurement =
    measurementIndex > 0
      ? p.result.quantum.measurement_trace[measurementIndex - 1]
      : null;
  const previousProbabilities = measured
    ? beforeMeasurement
      ? probabilities.map(
          (_, index) =>
            (beforeMeasurement.counts[index] || 0) / beforeMeasurement.shots,
        )
      : probabilities
    : beforeQuantum?.probabilities || probabilities;
  const previousPhases =
    p.chapter === 5 ? phases : beforeQuantum?.phases || phases;
  const maximum = useMemo(
    () =>
      measured
        ? probabilityScale(
            p.result.quantum.measurement_trace.map((event) =>
              Object.values(event.counts).map((count) => count / event.shots),
            ),
          )
        : probabilityScale([
            ...p.result.quantum.trace.map((event) => event.probabilities),
            p.result.quantum.probabilities,
          ]),
    [p.result.quantum, measured],
  );
  const positions = useMemo(
    () =>
      probabilities.map((_, index) =>
        orbitalStatePosition(index, probabilities.length),
      ),
    [probabilities.length],
  );
  const measuredState = measured
    ? stateBasisIndex(p.result.model.states, p.state)
    : -1;
  const indices = useMemo(() => {
    const shown = visibleBasisStates(
      probabilities,
      p.allStates ? probabilities.length : p.quality === "low" ? 32 : 96,
      p.selectedState,
    ).map(({ index }) => index);
    if (measuredState >= 0 && !shown.includes(measuredState))
      shown.push(measuredState);
    return shown.sort((a, b) => a - b);
  }, [probabilities, p.allStates, p.quality, p.selectedState, measuredState]);
  const neighborBits =
    p.chapter === 4 && p.quantumEvent?.gate === "rx"
      ? p.quantumEvent.qubits
      : [];
  const edges = useMemo(
    () => singleBitEdges(indices, q, neighborBits),
    [indices, q, neighborBits.join(",")],
  );
  return (
    <group>
      <mesh>
        <sphereGeometry args={[3.9, 32, 24]} />
        <meshBasicMaterial
          color="#6e5597"
          transparent
          opacity={0.035}
          wireframe
          depthWrite={false}
        />
      </mesh>
      <SegmentLinks
        positions={positions}
        edges={edges}
        color={palette.violet}
        opacity={0.3}
      />
      <ProbabilityOrbs
        indices={indices}
        positions={positions}
        probabilities={probabilities}
        previousProbabilities={previousProbabilities}
        phases={phases}
        previousPhases={previousPhases}
        maximum={maximum}
        measuredState={measuredState}
        p={p}
      />
      <SceneLabel
        text={`${measured ? "f" : "P"} volume scale ${(maximum * 100).toFixed(2)}%`}
        position={[0, -3.3, 0]}
        width={3.3}
        color={measured ? palette.amber : palette.violet}
        small
      />
    </group>
  );
}

class SceneBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function AlternativeFallback(p: Props) {
  const activate = (
    event: React.KeyboardEvent<SVGGElement>,
    action: () => void,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };
  if (p.chapter < 2) {
    const { weights, n } = p.result.model;
    const maximum = Math.max(1e-12, ...weights.flat().map(Math.abs));
    const cell = 320 / n;
    return (
      <svg
        className="fallback-scene"
        viewBox="0 0 760 420"
        role="group"
        aria-label="Signed Hebbian weight matrix in 2D"
      >
        <text x="50" y="35" fill="#d5e6ed">
          Signed weight matrix · teal positive · amber negative
        </text>
        {weights.flatMap((row, i) =>
          row.map((weight, j) => (
            <g
              key={`${i}:${j}`}
              role="button"
              tabIndex={0}
              aria-label={`Inspect weight ${i}, ${j}: ${num(weight)}`}
              onClick={() => p.onPair([i, j])}
              onKeyDown={(event) => activate(event, () => p.onPair([i, j]))}
            >
              <title>{`W${i},${j} = ${num(weight)}`}</title>
              <rect
                x={220 + j * cell}
                y={60 + i * cell}
                width={cell - 1}
                height={cell - 1}
                fill={
                  weight > 0
                    ? palette.teal
                    : weight < 0
                      ? palette.amber
                      : "#283444"
                }
                fillOpacity={
                  weight ? 0.25 + (Math.abs(weight) / maximum) * 0.75 : 1
                }
                stroke={p.pair[0] === i && p.pair[1] === j ? "#ffffff" : "none"}
                strokeWidth={2}
              />
            </g>
          )),
        )}
        <text
          x="50"
          y="405"
          fill="#d5e6ed"
        >{`Selected W${p.pair[0]},${p.pair[1]} = ${num(weights[p.pair[0]]?.[p.pair[1]])}`}</text>
      </svg>
    );
  }
  const { energies, free_indices } = p.result.model;
  const q = free_indices.length;
  if (p.chapter < 4) {
    const minimum = Math.min(...energies),
      maximum = Math.max(...energies);
    const current = stateBasisIndex(p.result.model.states, p.state);
    const indices = energies.map((_, index) => index);
    const point = (index: number) => {
      const [x, z] = stateConstellationPosition(index, q);
      return [380 + x * 80, 210 + z * 45];
    };
    return (
      <svg
        className="fallback-scene"
        viewBox="0 0 760 420"
        role="group"
        aria-label="Single-bit energy constellation in 2D"
      >
        <text x="50" y="35" fill="#d5e6ed">
          Exact energy colors · links join one-bit neighbors
        </text>
        {singleBitEdges(indices, q).map(([a, b]) => (
          <line
            key={`${a}:${b}`}
            x1={point(a)[0]}
            y1={point(a)[1]}
            x2={point(b)[0]}
            y2={point(b)[1]}
            stroke="#446572"
            opacity={0.15}
          />
        ))}
        {indices.map((index) => {
          const color = new THREE.Color(palette.teal)
            .lerp(
              new THREE.Color(palette.amber),
              (energies[index] - minimum) / (maximum - minimum || 1),
            )
            .getStyle();
          return (
            <g
              key={index}
              role="button"
              tabIndex={0}
              aria-label={`Inspect state ${index}, energy ${num(energies[index])}`}
              onClick={() => p.onState(index)}
              onKeyDown={(event) => activate(event, () => p.onState(index))}
            >
              <title>{`State ${index} · E ${num(energies[index])}`}</title>
              <circle
                cx={point(index)[0]}
                cy={point(index)[1]}
                r={index === current ? 7 : index === p.selectedState ? 5 : 3}
                fill={index === current ? "#ffffff" : color}
                stroke={index === p.selectedState ? palette.violet : "none"}
                strokeWidth={3}
              />
            </g>
          );
        })}
        <text
          x="50"
          y="405"
          fill="#d5e6ed"
        >{`Inspected s${p.selectedState} · E ${num(energies[p.selectedState])} · arrangement is illustrative`}</text>
      </svg>
    );
  }
  const total = Object.values(p.counts || {}).reduce(
    (sum, value) => sum + value,
    0,
  );
  const measured = p.chapter === 5 && total > 0;
  const probabilities = measured
    ? p.result.quantum.probabilities.map(
        (_, index) => (p.counts?.[index] || 0) / total,
      )
    : p.quantumEvent?.probabilities || p.result.quantum.probabilities;
  const phases = p.quantumEvent?.phases || [];
  const shown = visibleBasisStates(
    probabilities,
    p.allStates ? probabilities.length : 64,
    p.selectedState,
  );
  const maximum = Math.max(1e-12, ...probabilities);
  const current = measured
    ? stateBasisIndex(p.result.model.states, p.state)
    : -1;
  return (
    <svg
      className="fallback-scene"
      viewBox="0 0 760 420"
      role="group"
      aria-label={
        measured
          ? "Measured frequency constellation in 2D"
          : "Quantum probability constellation in 2D"
      }
    >
      <text x="50" y="35" fill="#d5e6ed">
        {measured
          ? "Circle area = actual shot frequency · amber = modal state"
          : "Circle area = actual probability · color = relative phase"}
      </text>
      <ellipse
        cx="380"
        cy="210"
        rx="270"
        ry="152"
        fill="none"
        stroke="#66517e"
        opacity={0.3}
      />
      {shown.map(({ value, index }) => {
        const [x, y] = orbitalStatePosition(index, probabilities.length);
        const phase = phases[index];
        const fill = measured
          ? index === current
            ? palette.amber
            : palette.violet
          : phase == null
            ? "#778397"
            : new THREE.Color()
                .setHSL(
                  (((phase / (2 * Math.PI) + 0.72) % 1) + 1) % 1,
                  0.62,
                  0.64,
                )
                .getStyle();
        return (
          <g
            key={index}
            role="button"
            tabIndex={0}
            aria-label={`Basis state ${index}, ${measured ? "frequency" : "probability"} ${(value * 100).toFixed(3)}%`}
            onClick={() => p.onState(index)}
            onKeyDown={(event) => activate(event, () => p.onState(index))}
          >
            <title>{`s${index} · ${(value * 100).toFixed(3)}%`}</title>
            <circle
              cx={380 + x * 72}
              cy={210 - y * 55}
              r={22 * Math.sqrt(value / maximum)}
              fill={fill}
              opacity={0.85}
            />
            <circle
              cx={380 + x * 72}
              cy={210 - y * 55}
              r={Math.max(5, 22 * Math.sqrt(value / maximum) + 3)}
              fill="transparent"
              stroke={index === p.selectedState ? "#ffffff" : "none"}
              strokeWidth={2}
            />
          </g>
        );
      })}
      <text
        x="50"
        y="405"
        fill="#d5e6ed"
      >{`Inspected s${p.selectedState} · ${(probabilities[p.selectedState] * 100).toFixed(3)}% · arrangement is illustrative`}</text>
    </svg>
  );
}

export function FallbackScene(p: Props) {
  if (p.alternateView) return <AlternativeFallback {...p} />;
  const shotTotal = Object.values(p.counts || {}).reduce((a, b) => a + b, 0);
  const measured = p.chapter === 5 && shotTotal > 0;
  const probabilities =
    p.chapter === 5 && shotTotal
      ? p.result.quantum.probabilities.map(
          (_, i) => (p.counts?.[i] || 0) / shotTotal,
        )
      : p.quantumEvent?.probabilities || p.result.quantum.probabilities;
  if (p.chapter >= 4) {
    const top = visibleBasisStates(
      probabilities,
      p.allStates ? probabilities.length : 16,
      p.selectedState,
    ).map(({ value: v, index: i }) => ({ v, i }));
    const max = Math.max(...top.map((s) => s.v), 0.01);
    const columns = p.allStates ? Math.min(16, top.length) : top.length;
    const rows = Math.ceil(top.length / columns);
    const cellWidth = 660 / Math.max(1, columns);
    const cellHeight = p.allStates ? 320 / Math.max(1, rows) : 295;
    return (
      <svg
        className="fallback-scene"
        viewBox="0 0 760 420"
        role="group"
        aria-label={
          measured
            ? "Measured frequencies in 2D"
            : "Quantum probabilities in 2D"
        }
      >
        <line x1="50" y1="340" x2="720" y2="340" stroke="#39304b" />
        {top.map(({ v, i }, k) => {
          const x = 55 + (k % columns) * cellWidth;
          const bottom = p.allStates
            ? 55 + (Math.floor(k / columns) + 1) * cellHeight
            : 335;
          const height = (v / max) * (p.allStates ? cellHeight - 3 : 260);
          return (
            <g
              key={i}
              onClick={() => p.onState(i)}
              role="button"
              tabIndex={0}
              aria-label={`Basis state ${i}, ${measured ? "frequency" : "probability"} ${(v * 100).toFixed(3)}%`}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  p.onState(i);
                }
              }}
            >
              <title>{`State ${i} · ${measured ? "f" : "P"} = ${(v * 100).toFixed(3)}%`}</title>
              <rect
                x={x}
                y={bottom - cellHeight + 2}
                width={cellWidth - 5}
                height={cellHeight - 2}
                fill="transparent"
                stroke={
                  i === p.selectedState
                    ? "#ddd1ff"
                    : p.allStates
                      ? "#282238"
                      : "none"
                }
              />
              <rect
                x={x + 3}
                y={bottom - height}
                width={p.allStates ? cellWidth - 11 : 23}
                height={height}
                fill={i === p.selectedState ? "#ddd1ff" : "#9b86d8"}
                opacity=".8"
              />
              {!p.allStates && (
                <text
                  transform={`translate(${x + 11},355) rotate(45)`}
                  fontSize="10"
                  fill="#a4a1b8"
                >
                  {p.result.model.free_states[i]
                    ?.map((s) => (s === 1 ? "0" : "1"))
                    .join("")}
                </text>
              )}
            </g>
          );
        })}
        <text x="50" y="40" fill="#c0b1e2">
          {p.allStates
            ? `All ${probabilities.length} basis states`
            : `Top ${top.length} basis states`}{" "}
          · bar height encodes actual{" "}
          {measured ? "shot frequency" : "probability"}
        </text>
      </svg>
    );
  }
  if (p.chapter === 2 || p.chapter === 3) {
    const currentState = p.result.model.states.findIndex((s) =>
      s.every((v, j) => v === p.state[j]),
    );
    const activeState = currentState >= 0 ? currentState : p.selectedState;
    const energies = p.result.model.energies,
      min = Math.min(...energies),
      max = Math.max(...energies);
    return (
      <svg
        className="fallback-scene"
        viewBox="0 0 760 420"
        role="group"
        aria-label="Exact discrete state energies"
      >
        <line x1="50" y1="340" x2="710" y2="340" stroke="#33434b" />
        {energies.map((e, i) => (
          <circle
            key={i}
            cx={50 + (i / Math.max(1, energies.length - 1)) * 650}
            cy={330 - ((e - min) / (max - min || 1)) * 240}
            r={i === activeState ? 6 : 2.5}
            role="button"
            tabIndex={0}
            aria-label={`Inspect state ${i}, energy ${num(e)}`}
            stroke={i === p.selectedState ? palette.violet : "none"}
            strokeWidth={i === p.selectedState ? 3 : 0}
            fill={
              i === activeState
                ? "white"
                : p.chapter === 3
                  ? palette.amber
                  : palette.teal
            }
            onClick={() => p.onState(i)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                p.onState(i);
              }
            }}
          />
        ))}
        <text x="50" y="385" fill="#a4afbb">
          Basis state index →
        </text>
        <text x="50" y="35" fill="#a4afbb">
          Exact energy · {num(min)} to {num(max)} normalized units
        </text>
        <text x="50" y="408" fill={palette.violet}>
          {`Inspected state ${p.selectedState} · E = ${num(energies[p.selectedState])} · white = current trace state`}
        </text>
      </svg>
    );
  }
  const n = p.state.length,
    cols = p.result.model.cols;
  const pos = (i: number) => [
    200 + (i % cols) * 75,
    95 + Math.floor(i / cols) * 75,
  ];
  return (
    <svg
      className="fallback-scene"
      viewBox="0 0 760 420"
      role="group"
      aria-label="Stored memory weighted neuron network"
    >
      {p.result.model.weights.flatMap((row, i) =>
        row.map((w, j) => {
          if (j <= i || !w) return null;
          const [x, y] = pos(i),
            [a, b] = pos(j);
          return (
            <line
              key={`${i}-${j}`}
              x1={x}
              y1={y}
              x2={a}
              y2={b}
              stroke={w >= 0 ? palette.teal : palette.amber}
              opacity={p.pair.includes(i) && p.pair.includes(j) ? 1 : 0.15}
              strokeDasharray={w < 0 ? "4 4" : undefined}
            />
          );
        }),
      )}
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = pos(i);
        return (
          <g
            key={i}
            onClick={() => p.onPair(selectedNeuronPair(p.pair, i))}
            role="button"
            tabIndex={0}
            aria-label={`Select neuron ${i}`}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                p.onPair(selectedNeuronPair(p.pair, i));
              }
            }}
          >
            <rect
              x={x - 16}
              y={y - 16}
              width="32"
              height="32"
              rx="5"
              fill={p.state[i] === 1 ? palette.teal : "#162534"}
              stroke={p.pair.includes(i) ? "white" : "#425466"}
            />
            <text
              x={x}
              y={y + 4}
              textAnchor="middle"
              fill={p.state[i] === 1 ? "#0a171c" : "#cad6db"}
              fontSize="12"
            >
              {i}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
export default function Scene(p: Props) {
  const [failed, setFailed] = useState(false);
  const manipulation = useRef(false);
  const contextLost = useCallback(() => setFailed(true), []);
  useEffect(() => {
    setFailed(false);
  }, [p.quality, p.viewReset]);
  const fallback = <FallbackScene {...p} />;
  if (p.quality === "fallback" || failed) return fallback;
  return (
    <SceneBoundary key={`${p.quality}:${p.viewReset}`} fallback={fallback}>
      <Canvas
        orthographic
        camera={{ position: [7, 8, 11], zoom: 51, near: 0.1, far: 100 }}
        dpr={p.quality === "low" ? 1 : [1, 1.5]}
        frameloop="demand"
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor("#080c13", 0);
        }}
      >
        <ContextGuard onLost={contextLost} />
        <PlaybackFrames playing={p.playing} reduced={p.reduced} />
        <ambientLight intensity={0.75} />
        <directionalLight
          position={[4, 8, 4]}
          intensity={3.5}
          color="#c4d2f5"
        />
        <directionalLight
          position={[-5, 3, -4]}
          intensity={2.5}
          color={p.chapter >= 4 ? palette.violet : palette.teal}
        />
        <CameraRig
          chapter={p.chapter}
          reduced={p.reduced}
          viewReset={p.viewReset}
          manipulation={manipulation}
          alternateView={!!p.alternateView}
          cinematic={!!p.cinematic}
          playing={p.playing}
        />
        {p.alternateView ? (
          p.chapter < 2 ? (
            <WeightSculpture {...p} />
          ) : p.chapter < 4 ? (
            <EnergyConstellation {...p} />
          ) : (
            <ProbabilityConstellation {...p} />
          )
        ) : p.chapter < 2 ? (
          <Network {...p} />
        ) : null}
        {!p.alternateView && p.chapter >= 2 && p.chapter < 4 ? (
          <Landscape {...p} />
        ) : !p.alternateView && p.chapter >= 4 ? (
          <ProbabilitySpace {...p} />
        ) : null}{" "}
        {!p.presenter && (
          <OrbitControls
            onStart={() => {
              manipulation.current = true;
            }}
            enablePan={false}
            minPolarAngle={0.5}
            maxPolarAngle={1.25}
            minZoom={35}
            maxZoom={110}
            enableDamping={false}
          />
        )}
      </Canvas>
    </SceneBoundary>
  );
}
