"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type OrbitPreset = "circular" | "plunge" | "scatter" | "precessing";

interface OrbitState {
  r: number;
  phi: number;
  dr: number; // dr/dtau
  dphi: number; // dphi/dtau
  tau: number;
}

const M = 1; // geometric units: G = c = 1, M = 1
const RS = 2 * M; // Schwarzschild radius
const PHOTON_R = 3 * M;
const ISCO_R = 6 * M;
const TRAIL_LEN = 4000;
const DT = 0.02; // proper time step
const STEPS_PER_FRAME = 4;

// ---------------------------------------------------------------------------
// Theme-aware color getter
// ---------------------------------------------------------------------------

function getColors() {
  const s = getComputedStyle(document.documentElement);
  const g = (v: string) => s.getPropertyValue(v).trim();
  return {
    bg: g("--canvas-bg"),
    fg: g("--canvas-fg"),
    grid: g("--canvas-grid"),
    muted: g("--canvas-muted"),
    position: g("--position-color"),
    velocity: g("--velocity-color"),
    accel: g("--accel-color"),
    phase: g("--phase-color"),
    ke: g("--ke-color"),
    pe: g("--pe-color"),
    total: g("--total-color"),
    border: g("--border"),
  };
}

type Colors = ReturnType<typeof getColors>;

// ---------------------------------------------------------------------------
// KaTeX helper
// ---------------------------------------------------------------------------

function Tex({ children, display = false }: { children: string; display?: boolean }) {
  const html = katex.renderToString(children, { displayMode: display, throwOnError: false });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------------------------------------------------------------------------
// Physics: effective potential and geodesic equations
// ---------------------------------------------------------------------------

function effectivePotential(r: number, L: number): number {
  // V_eff = -M/r + L^2/(2r^2) - M*L^2/r^3
  return -M / r + (L * L) / (2 * r * r) - (M * L * L) / (r * r * r);
}

function circularOrbitEnergy(r: number, L: number): number {
  // For a circular orbit, E = V_eff(r)
  return effectivePotential(r, L);
}

function circularOrbitL(r: number): number {
  // L for circular orbit at radius r: L = sqrt(M*r^2 / (r - 3M))
  if (r <= 3 * M) return NaN;
  return Math.sqrt((M * r * r) / (r - 3 * M));
}

// RK4 integration of geodesic equations
// State: [r, phi, dr/dtau, dphi/dtau]
// Using the radial equation: (dr/dtau)^2 = E^2 - (1 - 2M/r)(1 + L^2/r^2)
// And angular equation: dphi/dtau = L/r^2
// Radial acceleration: d^2r/dtau^2 = -M/r^2 + L^2/r^3 - 3ML^2/r^4
// (derived from dV_eff/dr with appropriate sign)

function geodesicDerivatives(state: number[], L: number): number[] {
  const [r, , dr, dphi] = state;
  if (r <= RS * 1.01) return [0, 0, 0, 0]; // inside horizon, stop

  const r2 = r * r;
  const r3 = r2 * r;
  const r4 = r3 * r;

  const drdt = dr;
  const dphidt = dphi;
  // d^2r/dtau^2 from geodesic equation
  const d2r = -M / r2 + (L * L) / r3 - 3 * M * L * L / r4;
  // dphi/dtau = L/r^2 is constant of motion, but we track it for generality
  const d2phi = -2 * dr * dphi / r;

  return [drdt, dphidt, d2r, d2phi];
}

function rk4Step(state: number[], L: number, dt: number): number[] {
  const k1 = geodesicDerivatives(state, L);
  const s2 = state.map((s, i) => s + 0.5 * dt * k1[i]);
  const k2 = geodesicDerivatives(s2, L);
  const s3 = state.map((s, i) => s + 0.5 * dt * k2[i]);
  const k3 = geodesicDerivatives(s3, L);
  const s4 = state.map((s, i) => s + dt * k3[i]);
  const k4 = geodesicDerivatives(s4, L);

  return state.map((s, i) => s + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Record<OrbitPreset, { r0: number; L: number; energy: number; label: string }> = {
  circular: {
    r0: 10,
    L: circularOrbitL(10),
    energy: 0, // will be computed
    label: "Circular orbit",
  },
  precessing: {
    r0: 12,
    L: 4.2,
    energy: -0.01,
    label: "Precessing ellipse",
  },
  plunge: {
    r0: 8,
    L: 3.5,
    energy: 0.02,
    label: "Plunge orbit",
  },
  scatter: {
    r0: 25,
    L: 4.5,
    energy: 0.005,
    label: "Scatter orbit",
  },
};

// Compute initial dr/dtau from energy: (dr/dtau)^2 = 2(E - V_eff)
function initialDr(r0: number, L: number, energy: number): number {
  const vEff = effectivePotential(r0, L);
  const dr2 = 2 * (energy - vEff);
  if (dr2 < 0) return 0;
  // For scatter, start with inward velocity; for plunge, also inward
  // For precessing, start at apoapsis (dr = 0 ideally) or small inward
  return -Math.sqrt(dr2);
}

// ---------------------------------------------------------------------------
// Flamm's paraboloid: z = 2*sqrt(2M*(r - 2M)) for r > 2M
// ---------------------------------------------------------------------------

function flammZ(r: number): number {
  if (r <= RS) return 0;
  return 2 * Math.sqrt(RS * (r - RS));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SchwarzschildGeodesicsPage() {
  const { theme, toggle } = useTheme();
  const [r0, setR0] = useState(12);
  const [angMom, setAngMom] = useState(4.2);
  const [energy, setEnergy] = useState(-0.01);
  const [running, setRunning] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<OrbitPreset | null>("precessing");

  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const trailMeshRef = useRef<THREE.Line | null>(null);
  const particleMeshRef = useRef<THREE.Mesh | null>(null);
  const paraboloidRef = useRef<THREE.Mesh | null>(null);
  const horizonRef = useRef<THREE.Mesh | null>(null);
  const photonRingRef = useRef<THREE.Line | null>(null);
  const iscoRingRef = useRef<THREE.Line | null>(null);
  const threeRafRef = useRef<number>(0);

  // 2D canvas ref
  const potentialCanvasRef = useRef<HTMLCanvasElement>(null);
  const potentialRafRef = useRef<number>(0);

  // Simulation state
  const orbitRef = useRef<OrbitState>({ r: r0, phi: 0, dr: 0, dphi: angMom / (r0 * r0), tau: 0 });
  const trailRef = useRef<{ r: number; phi: number }[]>([]);
  const runningRef = useRef(running);
  const paramsRef = useRef({ r0, angMom, energy });
  const colorsRef = useRef<Colors | null>(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { paramsRef.current = { r0, angMom, energy }; }, [r0, angMom, energy]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    const dr = activePreset === "circular"
      ? 0
      : initialDr(r0, angMom, energy);
    orbitRef.current = {
      r: r0,
      phi: 0,
      dr: dr,
      dphi: angMom / (r0 * r0),
      tau: 0,
    };
    trailRef.current = [{ r: r0, phi: 0 }];
  }, [r0, angMom, energy, activePreset]);

  useEffect(() => { reset(); }, [r0, angMom, energy, reset]);

  const applyPreset = useCallback((preset: OrbitPreset) => {
    const p = PRESETS[preset];
    setR0(p.r0);
    if (preset === "circular") {
      const L = circularOrbitL(p.r0);
      setAngMom(+L.toFixed(2));
      setEnergy(+effectivePotential(p.r0, L).toFixed(4));
    } else {
      setAngMom(p.L);
      setEnergy(p.energy);
    }
    setActivePreset(preset);
  }, []);

  // ---------------------------------------------------------------------------
  // Three.js setup and animation
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    colorsRef.current = getColors();

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / 400, 0.1, 200);
    camera.position.set(20, 25, 30);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, 400);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 8;
    controls.maxDistance = 80;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 15);
    scene.add(dirLight);

    // --- Flamm's paraboloid ---
    const paraboloidGeo = new THREE.BufferGeometry();
    const parSegR = 80;
    const parSegT = 96;
    const parVertices: number[] = [];
    const parColors: number[] = [];
    const parIndices: number[] = [];

    for (let i = 0; i <= parSegR; i++) {
      const frac = i / parSegR;
      const r = RS + frac * (30 - RS);
      const z = -flammZ(r); // flip so it goes down
      for (let j = 0; j <= parSegT; j++) {
        const theta = (j / parSegT) * Math.PI * 2;
        const x = r * Math.cos(theta);
        const y = r * Math.sin(theta);
        parVertices.push(x, z, y);

        // Color gradient: darker near horizon
        const t = Math.max(0, Math.min(1, (r - RS) / (20 - RS)));
        const colorR = 0.15 + 0.45 * t;
        const colorG = 0.2 + 0.5 * t;
        const colorB = 0.35 + 0.45 * t;
        parColors.push(colorR, colorG, colorB);
      }
    }

    for (let i = 0; i < parSegR; i++) {
      for (let j = 0; j < parSegT; j++) {
        const a = i * (parSegT + 1) + j;
        const b = a + 1;
        const c = a + (parSegT + 1);
        const d = c + 1;
        parIndices.push(a, c, b);
        parIndices.push(b, c, d);
      }
    }

    paraboloidGeo.setAttribute("position", new THREE.Float32BufferAttribute(parVertices, 3));
    paraboloidGeo.setAttribute("color", new THREE.Float32BufferAttribute(parColors, 3));
    paraboloidGeo.setIndex(parIndices);
    paraboloidGeo.computeVertexNormals();

    const paraboloidMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      wireframe: false,
      shininess: 30,
    });
    const paraboloid = new THREE.Mesh(paraboloidGeo, paraboloidMat);
    scene.add(paraboloid);
    paraboloidRef.current = paraboloid;

    // Wireframe overlay
    const wireframeMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    });
    const wireframe = new THREE.Mesh(paraboloidGeo.clone(), wireframeMat);
    scene.add(wireframe);

    // --- Event horizon (dark sphere at r = 2M) ---
    const horizonGeo = new THREE.SphereGeometry(RS, 48, 48);
    const horizonMat = new THREE.MeshPhongMaterial({
      color: 0x111111,
      emissive: 0x050505,
      shininess: 80,
    });
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    horizon.position.y = -flammZ(RS + 0.01);
    scene.add(horizon);
    horizonRef.current = horizon;

    // --- Photon sphere ring at r = 3M ---
    const photonGeo = new THREE.BufferGeometry();
    const photonPts: number[] = [];
    for (let i = 0; i <= 128; i++) {
      const theta = (i / 128) * Math.PI * 2;
      photonPts.push(PHOTON_R * Math.cos(theta), -flammZ(PHOTON_R), PHOTON_R * Math.sin(theta));
    }
    photonGeo.setAttribute("position", new THREE.Float32BufferAttribute(photonPts, 3));
    const photonMat = new THREE.LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.6 });
    const photonRing = new THREE.Line(photonGeo, photonMat);
    scene.add(photonRing);
    photonRingRef.current = photonRing;

    // --- ISCO ring at r = 6M ---
    const iscoGeo = new THREE.BufferGeometry();
    const iscoPts: number[] = [];
    for (let i = 0; i <= 128; i++) {
      const theta = (i / 128) * Math.PI * 2;
      iscoPts.push(ISCO_R * Math.cos(theta), -flammZ(ISCO_R), ISCO_R * Math.sin(theta));
    }
    iscoGeo.setAttribute("position", new THREE.Float32BufferAttribute(iscoPts, 3));
    const iscoMat = new THREE.LineBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.6 });
    const iscoRing = new THREE.Line(iscoGeo, iscoMat);
    scene.add(iscoRing);
    iscoRingRef.current = iscoRing;

    // --- Orbit trail ---
    const trailGeo = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(TRAIL_LEN * 3);
    trailGeo.setAttribute("position", new THREE.Float32BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
    const trailLine = new THREE.Line(trailGeo, trailMat);
    scene.add(trailLine);
    trailMeshRef.current = trailLine;

    // --- Particle ---
    const particleGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const particleMat = new THREE.MeshPhongMaterial({ color: 0xff6644, emissive: 0x441100 });
    const particle = new THREE.Mesh(particleGeo, particleMat);
    scene.add(particle);
    particleMeshRef.current = particle;

    // --- Animation loop ---
    function updateThreeColors() {
      const C = colorsRef.current;
      if (!C) return;
      const bgColor = C.bg || "#0a0a0a";
      scene.background = new THREE.Color(bgColor);
    }

    function animate() {
      threeRafRef.current = requestAnimationFrame(animate);
      updateThreeColors();

      // Physics step
      if (runningRef.current) {
        const { angMom: L } = paramsRef.current;
        const s = orbitRef.current;

        for (let i = 0; i < STEPS_PER_FRAME; i++) {
          if (s.r <= RS * 1.05) break; // stop at horizon

          const stateArr = [s.r, s.phi, s.dr, s.dphi];
          const next = rk4Step(stateArr, L, DT);
          s.r = next[0];
          s.phi = next[1];
          s.dr = next[2];
          s.dphi = next[3];
          s.tau += DT;

          trailRef.current.push({ r: s.r, phi: s.phi });
          if (trailRef.current.length > TRAIL_LEN) trailRef.current.shift();
        }
      }

      // Update trail geometry
      const trail = trailRef.current;
      const trailLine = trailMeshRef.current;
      if (trailLine) {
        const posAttr = trailLine.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = posAttr.array as Float32Array;
        for (let i = 0; i < trail.length; i++) {
          const { r, phi } = trail[i];
          const z = -flammZ(Math.max(r, RS + 0.01));
          arr[i * 3] = r * Math.cos(phi);
          arr[i * 3 + 1] = z;
          arr[i * 3 + 2] = r * Math.sin(phi);
        }
        posAttr.needsUpdate = true;
        trailLine.geometry.setDrawRange(0, trail.length);
      }

      // Update particle position
      const s = orbitRef.current;
      if (particleMeshRef.current && s.r > RS) {
        const pz = -flammZ(Math.max(s.r, RS + 0.01));
        particleMeshRef.current.position.set(
          s.r * Math.cos(s.phi),
          pz,
          s.r * Math.sin(s.phi)
        );
      }

      controls.update();
      renderer.render(scene, camera);
    }

    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      camera.aspect = w / 400;
      camera.updateProjectionMatrix();
      renderer.setSize(w, 400);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(threeRafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      // Dispose geometries and materials
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Three.js background on theme change
  useEffect(() => {
    const t = setTimeout(() => {
      const C = getColors();
      colorsRef.current = C;
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(C.bg || "#0a0a0a");
      }
    }, 60);
    return () => clearTimeout(t);
  }, [theme]);

  // ---------------------------------------------------------------------------
  // 2D effective potential canvas
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = potentialCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    colorsRef.current = getColors();

    function resizeCanvas() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      colorsRef.current = getColors();
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function drawPotential() {
      const C = colorsRef.current;
      if (!C) { potentialRafRef.current = requestAnimationFrame(drawPotential); return; }

      const w = canvas!.getBoundingClientRect().width;
      const h = canvas!.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);

      const { angMom: L, energy: E } = paramsRef.current;

      const margin = { left: 56, right: 20, top: 20, bottom: 36 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Compute V_eff over range
      const rMin = RS + 0.1;
      const rMax = 35;
      const nPts = 400;
      const vData: { r: number; v: number }[] = [];
      let vMin = Infinity, vMax = -Infinity;

      for (let i = 0; i < nPts; i++) {
        const r = rMin + (i / (nPts - 1)) * (rMax - rMin);
        const v = effectivePotential(r, L);
        vData.push({ r, v });
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
      }

      // Clamp for visual
      vMin = Math.max(vMin, -0.15);
      vMax = Math.min(vMax, 0.1);
      const vRange = vMax - vMin || 0.1;

      const toX = (r: number) => margin.left + ((r - rMin) / (rMax - rMin)) * plotW;
      const toY = (v: number) => margin.top + (1 - (v - vMin) / vRange) * plotH;

      // Grid lines
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.5;
      // Horizontal at V=0
      if (vMin < 0 && vMax > 0) {
        const y0 = toY(0);
        ctx.beginPath();
        ctx.moveTo(margin.left, y0);
        ctx.lineTo(w - margin.right, y0);
        ctx.stroke();
      }

      // Axes
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, margin.top);
      ctx.lineTo(margin.left, h - margin.bottom);
      ctx.lineTo(w - margin.right, h - margin.bottom);
      ctx.stroke();

      // Axis labels
      ctx.fillStyle = C.muted;
      ctx.font = "italic 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("r / M", w / 2, h - 4);
      ctx.save();
      ctx.translate(14, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("V_eff", 0, 0);
      ctx.restore();

      // Tick marks for r
      ctx.fillStyle = C.muted;
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      for (let r = 5; r <= 30; r += 5) {
        const x = toX(r);
        ctx.beginPath();
        ctx.moveTo(x, h - margin.bottom);
        ctx.lineTo(x, h - margin.bottom + 4);
        ctx.strokeStyle = C.muted;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillText(r.toString(), x, h - margin.bottom + 16);
      }

      // Mark event horizon, photon sphere, ISCO
      const markers = [
        { r: RS, label: "r_s", color: "#666" },
        { r: PHOTON_R, label: "3M", color: "#ffaa00" },
        { r: ISCO_R, label: "ISCO", color: "#44aaff" },
      ];
      markers.forEach(({ r, label, color }) => {
        const x = toX(r);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, h - margin.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        ctx.fillText(label, x, margin.top - 4);
      });

      // V_eff curve
      ctx.strokeStyle = C.position;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      for (const { r, v } of vData) {
        const x = toX(r);
        const y = toY(Math.max(vMin, Math.min(vMax, v)));
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Energy level line
      const clampedE = Math.max(vMin, Math.min(vMax, E));
      const ey = toY(clampedE);
      ctx.strokeStyle = C.total;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(margin.left, ey);
      ctx.lineTo(w - margin.right, ey);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = C.total;
      ctx.font = "italic 12px Georgia, serif";
      ctx.textAlign = "left";
      ctx.fillText("E", w - margin.right + 4, ey + 4);

      // Particle position marker
      const s = orbitRef.current;
      if (s.r > rMin && s.r < rMax) {
        const px = toX(s.r);
        const pv = effectivePotential(s.r, L);
        const py = toY(Math.max(vMin, Math.min(vMax, pv)));
        ctx.fillStyle = C.accel;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Legend
      ctx.fillStyle = C.position;
      ctx.fillRect(margin.left + 8, margin.top + 6, 14, 3);
      ctx.fillStyle = C.muted;
      ctx.font = "11px Georgia, serif";
      ctx.textAlign = "left";
      ctx.fillText("V_eff(r)", margin.left + 28, margin.top + 10);

      ctx.fillStyle = C.total;
      ctx.fillRect(margin.left + 8, margin.top + 22, 14, 3);
      ctx.fillStyle = C.muted;
      ctx.fillText("E (energy)", margin.left + 28, margin.top + 26);

      potentialRafRef.current = requestAnimationFrame(drawPotential);
    }

    potentialRafRef.current = requestAnimationFrame(drawPotential);

    return () => {
      cancelAnimationFrame(potentialRafRef.current);
      window.removeEventListener("resize", resizeCanvas);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {/* Header */}
      <header className="max-w-6xl mx-auto px-6 pt-10 pb-2">
        <div className="flex items-center justify-between">
          <nav className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <Link href="/simulations" className="hover:underline">
              Simulations
            </Link>
            <span>/</span>
            <span style={{ color: "var(--foreground)" }}>Schwarzschild Geodesics</span>
          </nav>
          <button
            onClick={toggle}
            className="text-sm px-3 py-1.5 rounded-md border transition-colors cursor-pointer"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            aria-label="Toggle theme"
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
        <div className="mt-8 mx-auto" style={{ maxWidth: "65ch" }}>
          <h1 className="text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-serif), Georgia, serif" }}>
            Geodesics in Schwarzschild Spacetime
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Test-particle orbits around a non-rotating black hole, visualised on
            Flamm&rsquo;s paraboloid embedding of the spatial geometry. Explore
            circular orbits, precessing ellipses, plunging trajectories, and
            scattering in the curved spacetime of general relativity.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Controls bar */}
        <div className="mt-8 flex items-center justify-between mx-auto" style={{ maxWidth: "65ch" }}>
          <div className="flex items-center gap-2 flex-wrap">
            {(Object.keys(PRESETS) as OrbitPreset[]).map((key) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                className="text-sm px-3 py-1.5 rounded border cursor-pointer transition-colors"
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  borderColor: activePreset === key ? "var(--position-color)" : "var(--border)",
                  color: activePreset === key ? "var(--position-color)" : "var(--muted)",
                }}
              >
                {PRESETS[key].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRunning((r) => !r)}
              className="text-sm px-4 py-1.5 rounded border transition-colors cursor-pointer"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              {running ? "Pause" : "Play"}
            </button>
            <button
              onClick={reset}
              className="text-sm px-4 py-1.5 rounded border transition-colors cursor-pointer"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* 3D view + parameter controls -- sticky, collapsible */}
        <div
          className="mt-3 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Collapsed bar */}
          {collapsed && (
            <div
              className="flex items-center justify-between px-4 py-2 cursor-pointer"
              onClick={() => setCollapsed(false)}
            >
              <span className="text-sm italic" style={{ color: "var(--muted)" }}>
                Schwarzschild geodesics &mdash; {activePreset ? PRESETS[activePreset].label : "custom orbit"}
              </span>
              <span className="text-xs font-medium tracking-wide" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
                show &darr;
              </span>
            </div>
          )}
          {/* Full panel */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <div
                ref={containerRef}
                className="w-full"
                style={{ height: 400, background: "var(--canvas-bg)" }}
              />
              <button
                onClick={() => setCollapsed(true)}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded border cursor-pointer"
                style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--muted)" }}
              >
                hide &uarr;
              </button>
              {/* Legend overlay */}
              <div className="absolute bottom-3 left-3 text-xs space-y-1" style={{ color: "var(--muted)" }}>
                <div className="flex items-center gap-2">
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "#111" }} />
                  <span>Event horizon (<Tex>{`r = 2M`}</Tex>)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ display: "inline-block", width: 10, height: 3, background: "#ffaa00" }} />
                  <span>Photon sphere (<Tex>{`r = 3M`}</Tex>)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span style={{ display: "inline-block", width: 10, height: 3, background: "#44aaff" }} />
                  <span>ISCO (<Tex>{`r = 6M`}</Tex>)</span>
                </div>
              </div>
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Initial radius"
                symbol="r₀"
                unit="M"
                min={4}
                max={30}
                step={0.5}
                value={r0}
                onChange={(v) => { setR0(v); setActivePreset(null); }}
                displayValue={(v) => v.toFixed(1)}
              />
              <SliderControl
                label="Angular momentum"
                symbol="L"
                unit="M"
                min={2}
                max={6}
                step={0.05}
                value={angMom}
                onChange={(v) => { setAngMom(v); setActivePreset(null); }}
                displayValue={(v) => v.toFixed(2)}
              />
              <SliderControl
                label="Energy"
                symbol="E"
                unit=""
                min={-0.08}
                max={0.06}
                step={0.001}
                value={energy}
                onChange={(v) => { setEnergy(v); setActivePreset(null); }}
                displayValue={(v) => v.toFixed(3)}
              />
            </div>
          </div>
        </div>

        {/* Effective potential plot */}
        <figure className="mt-16">
          <canvas
            ref={potentialCanvasRef}
            className="w-full rounded border"
            style={{ height: 320, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Effective potential <Tex>{`V_{\\text{eff}}(r)`}</Tex> for the current angular
            momentum. The dashed line marks the particle&rsquo;s energy. Turning
            points occur where the curve meets the energy level.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          {/* Part 1: The Schwarzschild metric */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The Schwarzschild metric</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              In 1916, Karl Schwarzschild found the first exact solution to
              Einstein&rsquo;s field equations. It describes the spacetime geometry
              outside any spherically symmetric, non-rotating mass&nbsp;<Tex>M</Tex>. In
              coordinates <Tex>{`(t, r, \\theta, \\phi)`}</Tex> the line element reads:
            </p>

            <div className="text-center py-1">
              <Tex display>{`ds^2 = -\\left(1 - \\frac{2M}{r}\\right)dt^2 + \\left(1 - \\frac{2M}{r}\\right)^{\\!-1}dr^2 + r^2\\,d\\Omega^2`}</Tex>
            </div>

            <p>
              where <Tex>{`d\\Omega^2 = d\\theta^2 + \\sin^2\\!\\theta\\,d\\phi^2`}</Tex> is the
              metric on the unit two-sphere. We work in geometric units
              with <Tex>{`G = c = 1`}</Tex>, so all distances are measured in units
              of <Tex>M</Tex>.
            </p>

            <p>
              The coordinate singularity at <Tex>{`r = 2M`}</Tex> is the event
              horizon &mdash; a one-way membrane from which nothing, not even
              light, can escape. The curvature singularity at <Tex>{`r = 0`}</Tex> is
              the true physical singularity where tidal forces diverge.
            </p>
          </div>

          {/* Part 2: Conserved quantities */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Geodesic equation and conserved quantities</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A freely falling test particle follows a geodesic &mdash; a path of
              extremal proper time between two events. The Schwarzschild metric
              has two Killing vectors (time translation and axial rotation),
              yielding two conserved quantities along every geodesic:
            </p>

            <div className="text-center py-1">
              <Tex display>{`E = \\left(1 - \\frac{2M}{r}\\right)\\frac{dt}{d\\tau}, \\qquad L = r^2\\frac{d\\phi}{d\\tau}`}</Tex>
            </div>

            <p>
              Here <Tex>E</Tex> is the specific energy (energy per unit rest mass)
              and <Tex>L</Tex> is the specific angular momentum.
              Substituting into the normalisation
              condition <Tex>{`g_{\\mu\\nu}\\,\\dot{x}^\\mu\\dot{x}^\\nu = -1`}</Tex> for
              massive particles, the radial equation becomes:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\frac{1}{2}\\left(\\frac{dr}{d\\tau}\\right)^{\\!2} = \\frac{1}{2}\\left(E^2 - 1\\right) - V_{\\text{eff}}(r)`}</Tex>
            </div>

            <p>
              This has the form of a one-dimensional energy equation with an
              effective potential, reducing the two-body relativistic problem to
              a problem in classical mechanics &mdash; but with a crucially different
              potential.
            </p>
          </div>

          {/* Part 3: Effective potential */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The effective potential</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The effective potential for radial motion in Schwarzschild
              spacetime is:
            </p>

            <div className="text-center py-1">
              <Tex display>{`V_{\\text{eff}}(r) = -\\frac{M}{r} + \\frac{L^2}{2r^2} - \\frac{ML^2}{r^3}`}</Tex>
            </div>

            <p>
              The first two terms are identical to the Newtonian effective
              potential (gravitational attraction plus the centrifugal barrier).
              The third term, <Tex>{`-ML^2/r^3`}</Tex>, is the relativistic
              correction &mdash; it is always attractive and dominates at small <Tex>r</Tex>,
              causing the centrifugal barrier to eventually be overwhelmed. This
              is what allows plunge orbits that spiral into the black hole, an
              outcome impossible in Newtonian gravity where the centrifugal
              barrier always prevents infall for <Tex>{`L \\neq 0`}</Tex>.
            </p>

            <p>
              The shape of <Tex>{`V_{\\text{eff}}`}</Tex> determines what types of
              orbit are possible for a given angular momentum:
            </p>
          </div>

          {/* Orbit type cards */}
          <div className="grid sm:grid-cols-3 gap-5 mt-10 -mx-4 sm:-mx-28 lg:-mx-44">
            <OrbitCard
              title="Bound orbits"
              condition={`E < 0`}
              description="The particle oscillates between two turning points (periapsis and apoapsis). Unlike Newtonian ellipses, these orbits do not close — the periapsis precesses."
              borderColor="var(--position-color)"
            />
            <OrbitCard
              title="Circular orbits"
              condition={`\\dot{r} = 0, \\; V'_{\\text{eff}} = 0`}
              description="Exist for r > 3M. Stable only for r > 6M (the ISCO). At r = 3M, only photons can orbit, but unstably."
              borderColor="var(--ke-color)"
            />
            <OrbitCard
              title="Plunge & scatter"
              condition={`E > V_{\\text{max}}`}
              description="If the energy exceeds the potential barrier peak, the particle plunges into the horizon. Below the peak but unbound, it scatters back to infinity."
              borderColor="var(--accel-color)"
            />
          </div>

          {/* Part 4: Orbital precession */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Orbital precession</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              In Newtonian gravity, bound orbits around a point mass are exact
              ellipses that close after every revolution. In general relativity,
              the relativistic correction to the effective potential causes the
              orbit to precess: the periapsis advances by a small angle each
              orbit. For a nearly circular orbit with semi-major
              axis <Tex>a</Tex> and eccentricity <Tex>e</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\Delta\\phi \\approx \\frac{6\\pi M}{a(1 - e^2)}`}</Tex>
            </div>

            <p>
              This was the first experimental test of general relativity.
              Mercury&rsquo;s orbit precesses by about 43 arcseconds per
              century more than Newtonian theory predicts when accounting
              for all other planetary perturbations. Einstein&rsquo;s 1915
              calculation of this anomalous precession, matching the observed
              value to within experimental error, convinced him that his theory
              was correct.
            </p>

            <p>
              In the simulation above, the &ldquo;Precessing ellipse&rdquo;
              preset shows this effect dramatically. Because we use a
              strong-field regime (<Tex>{`r \\sim 10M`}</Tex>), the precession
              per orbit is much larger than Mercury&rsquo;s, making it easy to
              see the rosette pattern traced out by the orbit. The orbit never
              exactly retraces itself &mdash; each petal of the rosette is
              rotated slightly from the last.
            </p>
          </div>

          {/* Part 5: Flamm's paraboloid */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Flamm&rsquo;s paraboloid</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The 3D surface in the visualisation above is Flamm&rsquo;s
              paraboloid &mdash; an isometric embedding of the equatorial
              plane (<Tex>{`\\theta = \\pi/2`}</Tex>) of the Schwarzschild spatial
              geometry into three-dimensional Euclidean space. The embedding
              height is:
            </p>

            <div className="text-center py-1">
              <Tex display>{`z(r) = 2\\sqrt{2M(r - 2M)}`}</Tex>
            </div>

            <p>
              This surface faithfully reproduces the spatial curvature: distances
              measured along the paraboloid match the proper distances computed
              from the Schwarzschild metric. The &ldquo;throat&rdquo; narrowing
              toward the event horizon visualises how space stretches near
              the black hole &mdash; a clock at smaller <Tex>r</Tex> ticks
              slower, and radial rulers appear stretched when viewed from
              afar.
            </p>

            <p>
              It is important to remember that this embedding represents the
              spatial geometry at one instant of coordinate time. It does
              not show the full spacetime curvature, and the orbits drawn
              on it are spatial projections, not the true four-dimensional
              worldlines.
            </p>
          </div>

          {/* Part 6: Special radii */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Special radii</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Three characteristic radii structure the Schwarzschild geometry:
            </p>

            <div className="grid sm:grid-cols-3 gap-5 mt-6 -mx-4 sm:-mx-28 lg:-mx-44">
              <OrbitCard
                title="Event horizon"
                condition={`r_s = 2M`}
                description="The point of no return. Once a particle crosses inward, it cannot escape regardless of its energy or trajectory."
                borderColor="#666"
              />
              <OrbitCard
                title="Photon sphere"
                condition={`r = 3M`}
                description="The radius of unstable circular photon orbits. Any small perturbation sends a photon spiraling in or escaping to infinity."
                borderColor="#ffaa00"
              />
              <OrbitCard
                title="ISCO"
                condition={`r = 6M`}
                description="The innermost stable circular orbit for massive particles. Below this, circular orbits exist but are unstable to radial perturbations."
                borderColor="#44aaff"
              />
            </div>

            <p className="mt-8">
              The effective potential plot makes these radii concrete: the
              potential maximum (when it exists) lies between <Tex>{`3M`}</Tex> and <Tex>{`6M`}</Tex>,
              and the ISCO is the radius where the maximum and minimum of the
              potential merge into an inflection point.
              For <Tex>{`L < 2\\sqrt{3}\\,M`}</Tex> the potential has no
              barrier at all, and every orbit plunges into the
              horizon.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Orbit type info card
// ---------------------------------------------------------------------------

function OrbitCard({
  title, condition, description, borderColor,
}: {
  title: string;
  condition: string;
  description: string;
  borderColor: string;
}) {
  return (
    <div
      className="rounded-lg border-l-4 p-6 sm:p-8 space-y-4"
      style={{ borderLeftColor: borderColor, borderTop: "1px solid var(--border)", borderRight: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--panel)" }}
    >
      <div className="text-base font-semibold">{title}</div>
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        <Tex>{condition}</Tex>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {description}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function SliderControl({
  label, symbol, unit, min, max, step, value, onChange, displayValue,
}: {
  label: string;
  symbol: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  displayValue?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-sm" style={{ color: "var(--muted)" }}>
          {label} <span className="italic" style={{ color: "var(--foreground)" }}>{symbol}</span>
        </label>
        <span className="text-sm tabular-nums" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
          {displayValue ? displayValue(value) : value.toFixed(step < 1 ? 1 : 0)}{" "}
          <span style={{ color: "var(--muted-2)" }}>{unit}</span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--foreground) ${pct}%, var(--border) ${pct}%)`,
        }}
      />
    </div>
  );
}
