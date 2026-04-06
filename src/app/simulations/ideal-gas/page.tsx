"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type ProcessMode = "isothermal" | "isobaric" | "isochoric";

const R_GAS = 8.314; // J/(mol*K)
const k_B = 1.381e-23; // Boltzmann constant
const N_A = 6.022e23;
const NUM_PARTICLES = 200;

// Particle mass in "simulation units" — we use argon-like mass for MB distribution
const PARTICLE_MASS_KG = 6.63e-26; // ~40 amu (argon)

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
    ke: g("--ke-color"),
    pe: g("--pe-color"),
    total: g("--total-color"),
    position: g("--position-color"),
    velocity: g("--velocity-color"),
    accel: g("--accel-color"),
    phase: g("--phase-color"),
    border: g("--border"),
    wallFill: g("--wall-fill"),
    wallHatch: g("--wall-hatch"),
    massFill: g("--mass-fill"),
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
// Color by speed: blue (slow) -> red (fast)
// ---------------------------------------------------------------------------

function speedColor(speed: number, maxSpeed: number): string {
  const t = Math.min(speed / maxSpeed, 1);
  // blue (200,60,60) -> red (0,80,60) in HSL
  const h = (1 - t) * 240;
  const s = 75 + t * 10;
  const l = 50 + (1 - t) * 10;
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---------------------------------------------------------------------------
// Maxwell-Boltzmann speed distribution f(v)
// ---------------------------------------------------------------------------

function mbDistribution(v: number, T: number, m: number): number {
  const a = m / (2 * k_B * T);
  return 4 * Math.PI * Math.pow(a / Math.PI, 1.5) * v * v * Math.exp(-a * v * v);
}

// ---------------------------------------------------------------------------
// Constants for simulation mapping
// ---------------------------------------------------------------------------

// We map macro state (P, V, n, T) to a visual box + particle speeds.
// Box width scales with V. Particle speeds scale with sqrt(T).
// Base visual dimensions
const BOX_BASE_W = 400;
const BOX_BASE_H = 200;
const V_REF = 22.4; // reference volume (L) for box sizing
const T_REF = 300; // reference temperature (K) for speed scaling
const SPEED_REF = 180; // px/s base RMS speed at T_REF

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IdealGasPage() {
  const { theme, toggle } = useTheme();

  // State variables: P (atm), V (L), n (mol), T (K)
  const [pressure, setPressure] = useState(1.0);
  const [volume, setVolume] = useState(22.4);
  const [moles, setMoles] = useState(1.0);
  const [temperature, setTemperature] = useState(273);
  const [mode, setMode] = useState<ProcessMode>("isothermal");
  const [collapsed, setCollapsed] = useState(false);
  const [running, setRunning] = useState(true);

  const gasCanvasRef = useRef<HTMLCanvasElement>(null);
  const mbCanvasRef = useRef<HTMLCanvasElement>(null);
  const pvCanvasRef = useRef<HTMLCanvasElement>(null);

  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(running);
  const colorsRef = useRef<Colors | null>(null);
  const prevTRef = useRef(temperature);
  const prevVRef = useRef(volume);

  // Track PV history for diagram
  const pvHistoryRef = useRef<{ P: number; V: number }[]>([]);

  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  // Enforce PV = nRT when sliders change
  const enforceIdealGas = useCallback((
    changedVar: "P" | "V" | "n" | "T",
    P: number, V: number, n: number, T: number
  ) => {
    // PV = nRT, R in L*atm/(mol*K) = 0.08206
    const R_Latm = 0.08206;
    switch (mode) {
      case "isothermal": {
        // T fixed
        if (changedVar === "P") {
          const newV = Math.max(1, (n * R_Latm * T) / P);
          setVolume(Math.min(60, newV));
        } else if (changedVar === "V") {
          const newP = Math.max(0.1, (n * R_Latm * T) / V);
          setPressure(Math.min(10, newP));
        } else if (changedVar === "n") {
          const newP = Math.max(0.1, (n * R_Latm * T) / V);
          setPressure(Math.min(10, newP));
        }
        break;
      }
      case "isobaric": {
        // P fixed
        if (changedVar === "T") {
          const newV = Math.max(1, (n * R_Latm * T) / P);
          setVolume(Math.min(60, newV));
        } else if (changedVar === "V") {
          const newT = Math.max(50, (P * V) / (n * R_Latm));
          setTemperature(Math.min(1000, newT));
        } else if (changedVar === "n") {
          const newV = Math.max(1, (n * R_Latm * T) / P);
          setVolume(Math.min(60, newV));
        }
        break;
      }
      case "isochoric": {
        // V fixed
        if (changedVar === "T") {
          const newP = Math.max(0.1, (n * R_Latm * T) / V);
          setPressure(Math.min(10, newP));
        } else if (changedVar === "P") {
          const newT = Math.max(50, (P * V) / (n * R_Latm));
          setTemperature(Math.min(1000, newT));
        } else if (changedVar === "n") {
          const newP = Math.max(0.1, (n * R_Latm * T) / V);
          setPressure(Math.min(10, newP));
        }
        break;
      }
    }
    // Record PV point
    pvHistoryRef.current.push({ P, V });
    if (pvHistoryRef.current.length > 500) pvHistoryRef.current.shift();
  }, [mode]);

  // Initialize particles
  const initParticles = useCallback(() => {
    const boxW = BOX_BASE_W * (volume / V_REF);
    const boxH = BOX_BASE_H;
    const rmsSpeed = SPEED_REF * Math.sqrt(temperature / T_REF);
    const particles: Particle[] = [];
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const angle = Math.random() * 2 * Math.PI;
      // Rayleigh-distributed speed for 2D MB
      const u1 = Math.random();
      const speed = rmsSpeed * Math.sqrt(-Math.log(1 - u1));
      particles.push({
        x: Math.random() * boxW,
        y: Math.random() * boxH,
        vx: speed * Math.cos(angle),
        vy: speed * Math.sin(angle),
      });
    }
    particlesRef.current = particles;
    pvHistoryRef.current = [{ P: pressure, V: volume }];
  }, [volume, temperature, pressure]);

  useEffect(() => { initParticles(); }, [initParticles]);

  // Rescale speeds when T changes
  useEffect(() => {
    if (prevTRef.current !== temperature && particlesRef.current.length > 0) {
      const ratio = Math.sqrt(temperature / Math.max(prevTRef.current, 1));
      particlesRef.current.forEach((p) => {
        p.vx *= ratio;
        p.vy *= ratio;
      });
    }
    prevTRef.current = temperature;
  }, [temperature]);

  // Reposition when V changes
  useEffect(() => {
    if (prevVRef.current !== volume && particlesRef.current.length > 0) {
      const ratio = volume / Math.max(prevVRef.current, 0.1);
      const newBoxW = BOX_BASE_W * (volume / V_REF);
      particlesRef.current.forEach((p) => {
        p.x = Math.min(Math.max(0, p.x * ratio), newBoxW);
      });
    }
    prevVRef.current = volume;
  }, [volume]);

  // --- Animation loop ---
  useEffect(() => {
    const gasCanvas = gasCanvasRef.current;
    const mbCanvas = mbCanvasRef.current;
    const pvCanvas = pvCanvasRef.current;
    if (!gasCanvas || !mbCanvas || !pvCanvas) return;

    const gasCtx = gasCanvas.getContext("2d")!;
    const mbCtx = mbCanvas.getContext("2d")!;
    const pvCtx = pvCanvas.getContext("2d")!;

    colorsRef.current = getColors();

    function resizeCanvas(c: HTMLCanvasElement) {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width < 1 || rect.height < 1) return;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizeAll() {
      resizeCanvas(gasCanvas!);
      resizeCanvas(mbCanvas!);
      resizeCanvas(pvCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    const DT = 1 / 60;

    function stepParticles(vol: number, temp: number) {
      const boxW = BOX_BASE_W * (vol / V_REF);
      const boxH = BOX_BASE_H;
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx * DT;
        p.y += p.vy * DT;
        // Elastic wall collisions
        if (p.x < 0) { p.x = -p.x; p.vx = Math.abs(p.vx); }
        if (p.x > boxW) { p.x = 2 * boxW - p.x; p.vx = -Math.abs(p.vx); }
        if (p.y < 0) { p.y = -p.y; p.vy = Math.abs(p.vy); }
        if (p.y > boxH) { p.y = 2 * boxH - p.y; p.vy = -Math.abs(p.vy); }
      }
    }

    function drawGas(vol: number, temp: number) {
      const C = colorsRef.current!;
      const c = gasCanvas!;
      const cw = c.getBoundingClientRect().width;
      const ch = c.getBoundingClientRect().height;
      if (cw < 1 || ch < 1) return;
      gasCtx.clearRect(0, 0, cw, ch);

      const boxW = BOX_BASE_W * (vol / V_REF);
      const boxH = BOX_BASE_H;
      if (boxW < 1 || boxH < 1) return;

      // Center the box
      const offsetX = (cw - boxW) / 2;
      const offsetY = (ch - boxH) / 2;

      // Box outline with hatched walls
      gasCtx.strokeStyle = C.fg;
      gasCtx.lineWidth = 2;
      gasCtx.strokeRect(offsetX, offsetY, boxW, boxH);

      // Wall hatching on left side
      gasCtx.save();
      gasCtx.beginPath();
      gasCtx.rect(offsetX - 10, offsetY, 10, boxH);
      gasCtx.clip();
      gasCtx.fillStyle = C.wallFill;
      gasCtx.fillRect(offsetX - 10, offsetY, 10, boxH);
      gasCtx.strokeStyle = C.wallHatch;
      gasCtx.lineWidth = 1;
      const step = 7;
      for (let i = -step; i < boxH + step; i += step) {
        gasCtx.beginPath();
        gasCtx.moveTo(offsetX, offsetY + i);
        gasCtx.lineTo(offsetX - 14, offsetY + i + step);
        gasCtx.stroke();
      }
      gasCtx.restore();

      // Right wall (piston-like)
      gasCtx.fillStyle = C.wallFill;
      gasCtx.fillRect(offsetX + boxW, offsetY, 10, boxH);
      gasCtx.strokeStyle = C.fg;
      gasCtx.lineWidth = 2;
      gasCtx.beginPath();
      gasCtx.moveTo(offsetX + boxW, offsetY);
      gasCtx.lineTo(offsetX + boxW, offsetY + boxH);
      gasCtx.stroke();

      // Piston arrow
      gasCtx.fillStyle = C.muted;
      gasCtx.font = "italic 11px Georgia, serif";
      gasCtx.textAlign = "center";
      gasCtx.textBaseline = "top";
      gasCtx.fillText("V", offsetX + boxW / 2, offsetY + boxH + 8);

      // Draw particles
      const rmsSpeed = SPEED_REF * Math.sqrt(temp / T_REF);
      const maxSpeed = rmsSpeed * 3;
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        gasCtx.fillStyle = speedColor(speed, maxSpeed);
        gasCtx.beginPath();
        gasCtx.arc(offsetX + p.x, offsetY + p.y, 2.5, 0, Math.PI * 2);
        gasCtx.fill();
      }
    }

    function drawMB(temp: number) {
      const C = colorsRef.current!;
      const c = mbCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      mbCtx.clearRect(0, 0, w, h);

      const margin = { left: 48, right: 16, top: 16, bottom: 32 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Axes
      mbCtx.strokeStyle = C.grid;
      mbCtx.lineWidth = 0.8;
      mbCtx.beginPath();
      mbCtx.moveTo(margin.left, margin.top);
      mbCtx.lineTo(margin.left, h - margin.bottom);
      mbCtx.lineTo(w - margin.right, h - margin.bottom);
      mbCtx.stroke();

      // Axis labels
      mbCtx.fillStyle = C.muted;
      mbCtx.font = "italic 12px Georgia, serif";
      mbCtx.textAlign = "center";
      mbCtx.textBaseline = "top";
      mbCtx.fillText("v (m/s)", margin.left + plotW / 2, h - margin.bottom + 14);
      mbCtx.save();
      mbCtx.translate(14, margin.top + plotH / 2);
      mbCtx.rotate(-Math.PI / 2);
      mbCtx.textAlign = "center";
      mbCtx.textBaseline = "middle";
      mbCtx.fillText("f(v)", 0, 0);
      mbCtx.restore();

      // Speed range for MB curve: 0 to ~1200 m/s
      const vMax = 1200;
      const m = PARTICLE_MASS_KG;
      const T = Math.max(temp, 10);

      // Theoretical MB curve
      const numPts = 200;
      let maxF = 0;
      const curve: { v: number; f: number }[] = [];
      for (let i = 0; i <= numPts; i++) {
        const v = (i / numPts) * vMax;
        const f = mbDistribution(v, T, m);
        curve.push({ v, f });
        if (f > maxF) maxF = f;
      }

      // Histogram of particle speeds (map sim speeds to physical speeds)
      const rmsSimSpeed = SPEED_REF * Math.sqrt(T / T_REF);
      // Physical RMS speed = sqrt(3kT/m)
      const rmsPhysical = Math.sqrt(3 * k_B * T / m);
      const speedScale = rmsPhysical / Math.max(rmsSimSpeed, 1);

      const numBins = 30;
      const binWidth = vMax / numBins;
      const bins = new Array(numBins).fill(0);
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const simSpeed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const physSpeed = simSpeed * speedScale;
        const bin = Math.floor(physSpeed / binWidth);
        if (bin >= 0 && bin < numBins) bins[bin]++;
      }

      // Normalize histogram to match MB distribution
      const totalParticles = particles.length;
      let maxBinVal = 0;
      const binNorm: number[] = [];
      for (let i = 0; i < numBins; i++) {
        const val = bins[i] / (totalParticles * binWidth);
        binNorm.push(val);
        if (val > maxBinVal) maxBinVal = val;
      }

      const yScale = Math.max(maxF, maxBinVal) * 1.15;
      if (yScale < 1e-30) return;

      // Draw histogram as stacked dots — one dot per particle in each bin
      const dotR = 2.2;
      const dotSpacing = dotR * 2.4;
      mbCtx.fillStyle = C.position;
      mbCtx.globalAlpha = 0.55;
      for (let i = 0; i < numBins; i++) {
        const binCenterX = margin.left + ((i + 0.5) * binWidth / vMax) * plotW;
        const count = bins[i];
        for (let j = 0; j < count; j++) {
          const dotY = h - margin.bottom - dotR - 1 - j * dotSpacing;
          if (dotY < margin.top) break;
          mbCtx.beginPath();
          mbCtx.arc(binCenterX, dotY, dotR, 0, Math.PI * 2);
          mbCtx.fill();
        }
      }
      mbCtx.globalAlpha = 1;

      // Draw theoretical curve
      mbCtx.strokeStyle = C.velocity;
      mbCtx.lineWidth = 2;
      mbCtx.beginPath();
      for (let i = 0; i <= numPts; i++) {
        const px = margin.left + (curve[i].v / vMax) * plotW;
        const py = h - margin.bottom - (curve[i].f / yScale) * plotH;
        if (i === 0) mbCtx.moveTo(px, py);
        else mbCtx.lineTo(px, py);
      }
      mbCtx.stroke();

      // Legend
      mbCtx.fillStyle = C.position;
      mbCtx.globalAlpha = 0.55;
      mbCtx.beginPath();
      mbCtx.arc(w - margin.right - 124, margin.top + 12, 3, 0, Math.PI * 2);
      mbCtx.fill();
      mbCtx.globalAlpha = 1;
      mbCtx.fillStyle = C.muted;
      mbCtx.font = "italic 11px Georgia, serif";
      mbCtx.textAlign = "left";
      mbCtx.textBaseline = "middle";
      mbCtx.fillText("simulation", w - margin.right - 112, margin.top + 12);

      mbCtx.strokeStyle = C.velocity;
      mbCtx.lineWidth = 2;
      mbCtx.beginPath();
      mbCtx.moveTo(w - margin.right - 130, margin.top + 28);
      mbCtx.lineTo(w - margin.right - 118, margin.top + 28);
      mbCtx.stroke();
      mbCtx.fillStyle = C.muted;
      mbCtx.fillText("theory", w - margin.right - 112, margin.top + 28);
    }

    function drawPV() {
      const C = colorsRef.current!;
      const c = pvCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      pvCtx.clearRect(0, 0, w, h);

      const margin = { left: 48, right: 16, top: 16, bottom: 32 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Axes
      pvCtx.strokeStyle = C.grid;
      pvCtx.lineWidth = 0.8;
      pvCtx.beginPath();
      pvCtx.moveTo(margin.left, margin.top);
      pvCtx.lineTo(margin.left, h - margin.bottom);
      pvCtx.lineTo(w - margin.right, h - margin.bottom);
      pvCtx.stroke();

      // Arrowheads
      pvCtx.fillStyle = C.grid;
      pvCtx.beginPath();
      pvCtx.moveTo(w - margin.right, h - margin.bottom);
      pvCtx.lineTo(w - margin.right - 6, h - margin.bottom - 3);
      pvCtx.lineTo(w - margin.right - 6, h - margin.bottom + 3);
      pvCtx.closePath();
      pvCtx.fill();
      pvCtx.beginPath();
      pvCtx.moveTo(margin.left, margin.top);
      pvCtx.lineTo(margin.left - 3, margin.top + 6);
      pvCtx.lineTo(margin.left + 3, margin.top + 6);
      pvCtx.closePath();
      pvCtx.fill();

      // Axis labels
      pvCtx.fillStyle = C.muted;
      pvCtx.font = "italic 13px Georgia, serif";
      pvCtx.textAlign = "center";
      pvCtx.textBaseline = "top";
      pvCtx.fillText("V", margin.left + plotW / 2, h - margin.bottom + 12);
      pvCtx.textAlign = "right";
      pvCtx.textBaseline = "middle";
      pvCtx.fillText("P", margin.left - 10, margin.top + plotH / 2);

      const hist = pvHistoryRef.current;
      if (hist.length < 1) return;

      // Scale: V from 0 to 65, P from 0 to 11
      const vScale = 65;
      const pScale = 11;

      // Draw trace
      pvCtx.strokeStyle = C.phase;
      pvCtx.lineWidth = 2;
      pvCtx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const px = margin.left + (hist[i].V / vScale) * plotW;
        const py = h - margin.bottom - (hist[i].P / pScale) * plotH;
        if (i === 0) pvCtx.moveTo(px, py);
        else pvCtx.lineTo(px, py);
      }
      pvCtx.stroke();

      // Current point
      const last = hist[hist.length - 1];
      pvCtx.fillStyle = C.phase;
      pvCtx.beginPath();
      pvCtx.arc(
        margin.left + (last.V / vScale) * plotW,
        h - margin.bottom - (last.P / pScale) * plotH,
        5, 0, Math.PI * 2
      );
      pvCtx.fill();

      // Also draw ideal isotherms lightly
      const R_Latm = 0.08206;
      const curNRT = last.P * last.V; // = nRT for current state
      pvCtx.strokeStyle = C.grid;
      pvCtx.lineWidth = 0.8;
      pvCtx.setLineDash([4, 4]);
      pvCtx.beginPath();
      for (let i = 1; i <= 200; i++) {
        const vv = (i / 200) * vScale;
        const pp = curNRT / vv;
        if (pp > pScale || pp < 0) continue;
        const px = margin.left + (vv / vScale) * plotW;
        const py = h - margin.bottom - (pp / pScale) * plotH;
        if (i === 1 || pp > pScale) pvCtx.moveTo(px, py);
        else pvCtx.lineTo(px, py);
      }
      pvCtx.stroke();
      pvCtx.setLineDash([]);
    }

    // Refs to current state for the animation loop closure
    let currentVolume = volume;
    let currentTemperature = temperature;
    let currentPressure = pressure;

    function loop() {
      if (runningRef.current) {
        stepParticles(currentVolume, currentTemperature);
      }
      if (!colorsRef.current) colorsRef.current = getColors();
      drawGas(currentVolume, currentTemperature);
      drawMB(currentTemperature);
      drawPV();
      rafRef.current = requestAnimationFrame(loop);
    }

    // We need to update these from outside
    const updateParams = () => {
      currentVolume = volume;
      currentTemperature = temperature;
      currentPressure = pressure;
    };
    updateParams();

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume, temperature, pressure]);

  const handleSlider = (variable: "P" | "V" | "n" | "T", value: number) => {
    switch (variable) {
      case "P":
        setPressure(value);
        enforceIdealGas("P", value, volume, moles, temperature);
        break;
      case "V":
        setVolume(value);
        enforceIdealGas("V", pressure, value, moles, temperature);
        break;
      case "n":
        setMoles(value);
        enforceIdealGas("n", pressure, volume, value, temperature);
        break;
      case "T":
        setTemperature(value);
        enforceIdealGas("T", pressure, volume, moles, value);
        break;
    }
  };

  const modeLabel = (m: ProcessMode) =>
    m === "isothermal" ? "Isothermal (T fixed)"
    : m === "isobaric" ? "Isobaric (P fixed)"
    : "Isochoric (V fixed)";

  const modeColor = (m: ProcessMode) =>
    m === "isothermal" ? "var(--velocity-color)"
    : m === "isobaric" ? "var(--position-color)"
    : "var(--total-color)";

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
            <span style={{ color: "var(--foreground)" }}>Ideal Gas Law</span>
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
            The Ideal Gas
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            A microscopic kinetic-theory model of an ideal gas, linking particle collisions
            to the macroscopic equation of state <Tex>{`PV = nRT`}</Tex>.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Gas box — sticky, collapsible, with mode + controls inside */}
        <div
          className="mt-8 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Top bar — always visible, even when collapsed */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}
          >
            <button
              onClick={() => {
                const modes: ProcessMode[] = ["isothermal", "isobaric", "isochoric"];
                const next = modes[(modes.indexOf(mode) + 1) % modes.length];
                setMode(next);
                pvHistoryRef.current = [{ P: pressure, V: volume }];
              }}
              className="text-sm font-medium px-3 py-1 rounded border cursor-pointer"
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                borderColor: modeColor(mode),
                color: modeColor(mode),
              }}
            >
              {modeLabel(mode)}
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRunning((r) => !r)}
                className="text-sm px-3 py-1 rounded border transition-colors cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                {running ? "Pause" : "Play"}
              </button>
              <button
                onClick={() => {
                  initParticles();
                  pvHistoryRef.current = [{ P: pressure, V: volume }];
                }}
                className="text-sm px-3 py-1 rounded border transition-colors cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                Reset
              </button>
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="text-xs px-2 py-1 rounded border cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                {collapsed ? "show ↓" : "hide ↑"}
              </button>
            </div>
          </div>
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <canvas
                ref={gasCanvasRef}
                className="w-full"
                style={{ height: 260, background: "var(--canvas-bg)" }}
              />
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Pressure" symbol="P" unit="atm"
                min={0.1} max={10} step={0.1}
                value={pressure}
                onChange={(v) => handleSlider("P", v)}
                disabled={mode === "isobaric"}
              />
              <SliderControl
                label="Volume" symbol="V" unit="L"
                min={1} max={60} step={0.5}
                value={volume}
                onChange={(v) => handleSlider("V", v)}
                disabled={mode === "isochoric"}
              />
              <SliderControl
                label="Amount" symbol="n" unit="mol"
                min={0.1} max={5} step={0.1}
                value={moles}
                onChange={(v) => handleSlider("n", v)}
              />
              <SliderControl
                label="Temperature" symbol="T" unit="K"
                min={50} max={1000} step={5}
                value={temperature}
                onChange={(v) => handleSlider("T", v)}
                disabled={mode === "isothermal"}
              />
            </div>
          </div>
        </div>

        {/* Maxwell-Boltzmann distribution */}
        <figure className="mt-16">
          <canvas
            ref={mbCanvasRef}
            className="w-full rounded border"
            style={{ height: 300, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Maxwell-Boltzmann speed distribution: histogram of particle speeds vs. the theoretical curve for argon at the current temperature.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          <h2 className="text-2xl font-semibold tracking-tight mb-5">Kinetic theory of gases</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              An ideal gas consists of <Tex>N</Tex> identical particles of mass <Tex>m</Tex> in
              a container of volume <Tex>V</Tex>. The particles move freely except for
              perfectly elastic collisions with the walls. We derive the equation of
              state from first principles.
            </p>

            <p>
              Consider a single particle with velocity component <Tex>{`v_x`}</Tex> hitting
              a wall perpendicular to the <Tex>x</Tex>-axis. The momentum change per
              collision is <Tex>{`\\Delta p = 2mv_x`}</Tex>. In a box of length <Tex>L</Tex>,
              the particle hits this wall once every <Tex>{`\\Delta t = 2L / v_x`}</Tex> seconds,
              so the average force from this one particle is
            </p>

            <div className="text-center py-1">
              <Tex display>{`F_1 = \\frac{\\Delta p}{\\Delta t} = \\frac{2mv_x}{2L/v_x} = \\frac{mv_x^2}{L}`}</Tex>
            </div>

            <p>
              Summing over all <Tex>N</Tex> particles and using <Tex>{`P = F/A`}</Tex> with <Tex>{`A = L^2`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`P = \\frac{1}{V}\\sum_{i=1}^{N} m v_{x,i}^2 = \\frac{Nm\\langle v_x^2\\rangle}{V}`}</Tex>
            </div>

            <p>
              By isotropy, <Tex>{`\\langle v_x^2\\rangle = \\langle v_y^2\\rangle = \\langle v_z^2\\rangle = \\frac{1}{3}\\langle v^2\\rangle`}</Tex>, so
            </p>

            <div className="text-center py-1">
              <Tex display>{`PV = \\frac{1}{3}Nm\\langle v^2\\rangle = \\frac{2}{3}N\\left\\langle\\frac{1}{2}mv^2\\right\\rangle = \\frac{2}{3}N\\langle E_k\\rangle`}</Tex>
            </div>

            <p>
              This is the <em>pressure equation</em> of kinetic theory. Comparing with the
              empirical ideal gas law <Tex>{`PV = nRT = Nk_BT`}</Tex> immediately gives
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\langle E_k\\rangle = \\frac{1}{2}m\\langle v^2\\rangle = \\frac{3}{2}k_BT`}</Tex>
            </div>

            <p>
              This is the <em>equipartition theorem</em> for translational degrees of
              freedom: each quadratic degree of freedom carries <Tex>{`\\frac{1}{2}k_BT`}</Tex> of
              average energy. Temperature is a direct measure of the mean kinetic
              energy of the microscopic particles.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Maxwell-Boltzmann distribution</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Not all particles move at the same speed. Maxwell showed that in
              thermal equilibrium, the probability of finding a particle with
              speed between <Tex>v</Tex> and <Tex>{`v + dv`}</Tex> is
            </p>

            <div className="text-center py-1">
              <Tex display>{`f(v) = 4\\pi\\left(\\frac{m}{2\\pi k_BT}\\right)^{3/2} v^2 \\exp\\!\\left(-\\frac{mv^2}{2k_BT}\\right)`}</Tex>
            </div>

            <p>
              The distribution has three characteristic speeds:
            </p>

            <div className="text-center py-1">
              <Tex display>{`v_{\\text{mp}} = \\sqrt{\\frac{2k_BT}{m}}, \\qquad \\bar{v} = \\sqrt{\\frac{8k_BT}{\\pi m}}, \\qquad v_{\\text{rms}} = \\sqrt{\\frac{3k_BT}{m}}`}</Tex>
            </div>

            <p>
              At low temperatures the distribution is sharply peaked near
              zero — most particles are slow. As <Tex>T</Tex> increases, the peak
              shifts right and the distribution broadens. The histogram in the
              simulation above shows the measured speed distribution of the
              simulated particles converging to the theoretical curve.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Thermodynamic processes</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The ideal gas law <Tex>{`PV = nRT`}</Tex> constrains the state
              to a surface in <Tex>{`(P, V, T)`}</Tex>-space. Fixing one variable defines
              a thermodynamic process.
            </p>
          </div>

          {/* Process cards */}
          <div className="grid sm:grid-cols-3 gap-5 mt-10 -mx-4 sm:-mx-28 lg:-mx-44">
            <ProcessCard
              title="Isothermal"
              condition={`T = \\text{const}`}
              equation={`PV = \\text{const}`}
              description="Pressure and volume are inversely proportional. The PV curve is a hyperbola."
              borderColor="var(--velocity-color)"
            />
            <ProcessCard
              title="Isobaric"
              condition={`P = \\text{const}`}
              equation={`V \\propto T`}
              description="Volume scales linearly with temperature at constant pressure (Charles's law)."
              borderColor="var(--position-color)"
            />
            <ProcessCard
              title="Isochoric"
              condition={`V = \\text{const}`}
              equation={`P \\propto T`}
              description="Pressure scales linearly with temperature at constant volume (Gay-Lussac's law)."
              borderColor="var(--total-color)"
            />
          </div>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">PV diagram</h3>
            <p>
              As you adjust the sliders, the trace below records the path through
              state space. In isothermal mode, the trace follows a
              hyperbola <Tex>{`P \\propto 1/V`}</Tex>. In isobaric mode it is a
              horizontal line, and in isochoric mode a vertical line.
            </p>
          </div>

          <figure className="mt-10">
            <canvas
              ref={pvCanvasRef}
              className="w-full rounded border"
              style={{ height: 300, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              PV diagram tracing the thermodynamic path. Dashed line shows the current isotherm.
            </figcaption>
          </figure>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">From collisions to thermodynamics</h3>
            <p>
              The simulation above directly illustrates the kinetic origin
              of <Tex>{`PV = nRT`}</Tex>. Each particle bouncing off a wall delivers
              a tiny impulse. The aggregate of <Tex>{`{\\sim}200`}</Tex> such impulses
              per unit time creates a measurable pressure. When you raise the
              temperature, particle speeds increase
              as <Tex>{`v_{\\text{rms}} \\propto \\sqrt{T}`}</Tex>, wall collisions become
              harder, and the pressure rises — exactly as the ideal gas law
              predicts.
            </p>
            <p>
              Reducing the volume forces the same particles into a smaller box.
              They hit the walls more frequently (shorter transit time between
              bounces), increasing the pressure even if the temperature stays
              constant. This is the microscopic explanation of Boyle&rsquo;s
              law, <Tex>{`PV = \\text{const}`}</Tex> at fixed <Tex>T</Tex>.
            </p>
            <p>
              The Maxwell-Boltzmann histogram confirms that the simulated particles
              actually thermalize to the correct distribution. The <Tex>{`v^2`}</Tex> prefactor
              comes from the density of states in velocity space (the surface area
              of a sphere of radius <Tex>v</Tex>), while the exponential
              factor <Tex>{`e^{-mv^2/2k_BT}`}</Tex> is the Boltzmann weight — the
              probability of finding a given kinetic energy at temperature <Tex>T</Tex>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Process card
// ---------------------------------------------------------------------------

function ProcessCard({
  title, condition, equation, description, borderColor,
}: {
  title: string;
  condition: string;
  equation: string;
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
      <div className="text-center py-2">
        <Tex display>{equation}</Tex>
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
  label, symbol, unit, min, max, step, value, onChange, displayValue, disabled,
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
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ opacity: disabled ? 0.4 : 1 }}>
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
        disabled={disabled}
        style={{
          background: `linear-gradient(to right, var(--foreground) ${pct}%, var(--border) ${pct}%)`,
        }}
      />
    </div>
  );
}
