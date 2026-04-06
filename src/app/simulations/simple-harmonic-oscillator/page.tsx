"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface SimState {
  x: number;
  v: number;
  t: number;
}

type Regime = "undamped" | "underdamped" | "critically damped" | "overdamped";

function dampingRegime(k: number, m: number, b: number): Regime {
  if (b === 0) return "undamped";
  const disc = b * b - 4 * m * k;
  // Tolerance relative to 4mk so preset values register correctly
  if (Math.abs(disc) < 0.5) return "critically damped";
  return disc < 0 ? "underdamped" : "overdamped";
}

// ---------------------------------------------------------------------------
// Theme-aware color getter (reads CSS variables from computed style)
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
    spring: g("--spring-color"),
    massFill: g("--mass-fill"),
    massStroke: g("--mass-stroke"),
    wallFill: g("--wall-fill"),
    wallHatch: g("--wall-hatch"),
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
// Textbook-style drawing helpers
// ---------------------------------------------------------------------------

function drawSpring(
  ctx: CanvasRenderingContext2D,
  x0: number, y: number, x1: number,
  coils: number, amplitude: number, color: string
) {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  const leadIn = 12;
  ctx.lineTo(x0 + leadIn, y);
  const springStart = x0 + leadIn;
  const springEnd = x1 - leadIn;
  const springLen = springEnd - springStart;
  // Use many points per coil for smooth sinusoidal shape
  const totalPts = coils * 16;
  for (let i = 0; i <= totalPts; i++) {
    const frac = i / totalPts;
    const px = springStart + frac * springLen;
    // Sinusoidal with smooth envelope at endpoints
    const envelope = Math.sin(frac * Math.PI); // tapers to 0 at both ends
    const py = y + Math.sin(frac * coils * 2 * Math.PI) * amplitude * Math.min(envelope * 2, 1);
    ctx.lineTo(px, py);
  }
  ctx.lineTo(x1 - leadIn, y);
  ctx.lineTo(x1, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, h: number,
  fillColor: string, hatchColor: string
) {
  // Wall fill
  ctx.fillStyle = fillColor;
  ctx.fillRect(x - 8, y - h / 2, 8, h);
  // Hatching clipped inside the wall rect
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - 8, y - h / 2, 8, h);
  ctx.clip();
  ctx.strokeStyle = hatchColor;
  ctx.lineWidth = 1;
  const step = 7;
  for (let i = -step; i < h + step; i += step) {
    ctx.beginPath();
    ctx.moveTo(x, y - h / 2 + i);
    ctx.lineTo(x - 14, y - h / 2 + i + step);
    ctx.stroke();
  }
  ctx.restore();
  // Wall edge line
  ctx.strokeStyle = hatchColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2);
  ctx.lineTo(x, y + h / 2);
  ctx.stroke();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number, toX: number, toY: number,
  color: string, label?: string, labelBelow?: boolean
) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 3) return;
  const ux = dx / len;
  const uy = dy / len;
  const headLen = 8;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - ux * headLen - uy * 4, toY - uy * headLen + ux * 4);
  ctx.lineTo(toX - ux * headLen + uy * 4, toY - uy * headLen - ux * 4);
  ctx.closePath();
  ctx.fill();

  if (label) {
    ctx.font = "italic 13px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText(label, (fromX + toX) / 2, labelBelow ? fromY + 18 : fromY - 8);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_LEN = 600;
const DT = 1 / 120;
const STEPS_PER_FRAME = 2;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Preset parameter sets for each regime
// b_crit = 2*sqrt(k*m)
const PRESETS: Record<Regime, { k: number; mass: number; b: number; x0: number }> = {
  undamped:            { k: 10, mass: 3, b: 0, x0: 150 },
  underdamped:         { k: 10, mass: 3, b: 2, x0: 150 },
  "critically damped": { k: 10, mass: 3, b: +(2 * Math.sqrt(10 * 3)).toFixed(1), x0: 150 },
  overdamped:          { k: 10, mass: 3, b: 20, x0: 150 },
};

export default function SimpleHarmonicOscillatorPage() {
  const { theme, toggle } = useTheme();
  const [k, setK] = useState(10);
  const [mass, setMass] = useState(3);
  const [b, setB] = useState(0);
  const [x0, setX0] = useState(150);
  const [running, setRunning] = useState(true);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const phaseCanvasRef = useRef<HTMLCanvasElement>(null);
  const energyCanvasRef = useRef<HTMLCanvasElement>(null);
  const energyTimeCanvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef<SimState>({ x: x0, v: 0, t: 0 });
  const historyRef = useRef<{ x: number; v: number; a: number; t: number }[]>([]);
  const phaseTrailRef = useRef<{ x: number; v: number }[]>([]);
  const energyHistRef = useRef<{ ke: number; pe: number; total: number }[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(running);
  const paramsRef = useRef({ k, mass, b });
  const colorsRef = useRef<Colors | null>(null);
  // Fixed scales: set once on reset from initial conditions, never auto-rescaled
  const fixedScaleRef = useRef<{ maxX: number; maxV: number; maxA: number }>({ maxX: 1, maxV: 1, maxA: 1 });
  const phaseZoomRef = useRef<number>(1);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { paramsRef.current = { k, mass, b }; }, [k, mass, b]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    stateRef.current = { x: x0, v: 0, t: 0 };
    historyRef.current = [];
    phaseTrailRef.current = [];
    energyHistRef.current = [];
    phaseZoomRef.current = 1;
    // Compute fixed scales from initial conditions
    const omega = Math.sqrt(k / mass);
    const maxDisp = Math.abs(x0);
    const maxVel = maxDisp * omega;
    const maxAcc = maxDisp * omega * omega;
    fixedScaleRef.current = {
      maxX: maxDisp * 1.15,
      maxV: maxVel * 1.15,
      maxA: maxAcc * 1.15,
    };
  }, [x0, k, mass]);

  useEffect(() => { reset(); }, [k, mass, b, x0, reset]);

  // Apply a preset regime
  const applyPreset = (regime: Regime) => {
    const p = PRESETS[regime];
    setK(p.k);
    setMass(p.mass);
    setB(p.b);
    setX0(p.x0);
  };

  // --- Animation loop ---
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const waveCanvas = waveCanvasRef.current;
    const phaseCanvas = phaseCanvasRef.current;
    const energyCanvas = energyCanvasRef.current;
    const energyTimeCanvas = energyTimeCanvasRef.current;
    if (!mainCanvas || !waveCanvas || !phaseCanvas || !energyCanvas || !energyTimeCanvas) return;

    const mainCtx = mainCanvas.getContext("2d")!;
    const waveCtx = waveCanvas.getContext("2d")!;
    const phaseCtx = phaseCanvas.getContext("2d")!;
    const energyCtx = energyCanvas.getContext("2d")!;
    const energyTimeCtx = energyTimeCanvas.getContext("2d")!;

    colorsRef.current = getColors();

    function resizeCanvas(c: HTMLCanvasElement) {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizeAll() {
      resizeCanvas(mainCanvas!);
      resizeCanvas(waveCanvas!);
      resizeCanvas(phaseCanvas!);
      resizeCanvas(energyCanvas!);
      resizeCanvas(energyTimeCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    function step() {
      const { k: ck, mass: cm, b: cb } = paramsRef.current;
      const s = stateRef.current;
      const a = (-ck * s.x - cb * s.v) / cm;
      s.x += s.v * DT + 0.5 * a * DT * DT;
      const aNew = (-ck * s.x - cb * (s.v + a * DT)) / cm;
      s.v += 0.5 * (a + aNew) * DT;
      s.t += DT;

      const acc = (-ck * s.x - cb * s.v) / cm;
      historyRef.current.push({ x: s.x, v: s.v, a: acc, t: s.t });
      if (historyRef.current.length > HISTORY_LEN) historyRef.current.shift();
      phaseTrailRef.current.push({ x: s.x, v: s.v });
      if (phaseTrailRef.current.length > 800) phaseTrailRef.current.shift();
      const ke = 0.5 * cm * s.v * s.v;
      const pe = 0.5 * ck * s.x * s.x;
      energyHistRef.current.push({ ke, pe, total: ke + pe });
      if (energyHistRef.current.length > HISTORY_LEN) energyHistRef.current.shift();
    }

    function drawMain() {
      const C = colorsRef.current!;
      const c = mainCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      mainCtx.clearRect(0, 0, w, h);

      const wallX = 50;
      const centerY = h * 0.46;
      const eqX = w * 0.42;
      const massSize = 44;
      const s = stateRef.current;
      const massX = eqX + s.x;
      const groundY = centerY + massSize / 2 + 2;

      // Ground line
      mainCtx.strokeStyle = C.fg;
      mainCtx.lineWidth = 1.5;
      mainCtx.beginPath();
      mainCtx.moveTo(wallX, groundY);
      mainCtx.lineTo(w - 40, groundY);
      mainCtx.stroke();

      // Wall
      drawWall(mainCtx, wallX, centerY, 90, C.wallFill, C.wallHatch);

      // Spring
      drawSpring(mainCtx, wallX, centerY, massX - massSize / 2, 14, 10, C.spring);

      // Mass block
      mainCtx.fillStyle = C.massFill;
      mainCtx.strokeStyle = C.massStroke;
      mainCtx.lineWidth = 1.5;
      mainCtx.fillRect(massX - massSize / 2, centerY - massSize / 2, massSize, massSize);
      mainCtx.strokeRect(massX - massSize / 2, centerY - massSize / 2, massSize, massSize);
      mainCtx.fillStyle = C.fg;
      mainCtx.font = "italic 14px Georgia, serif";
      mainCtx.textAlign = "center";
      mainCtx.textBaseline = "middle";
      mainCtx.fillText("m", massX, centerY);

      // --- Displacement arrow from equilibrium (always visible) ---
      const dispY = groundY + 22;
      if (Math.abs(s.x) > 3) {
        drawArrow(mainCtx, eqX, dispY, massX, dispY, C.position);
      }
      mainCtx.fillStyle = C.position;
      mainCtx.font = "italic 13px Georgia, serif";
      mainCtx.textAlign = "left";
      mainCtx.textBaseline = "middle";
      mainCtx.fillText(`x = ${(s.x / 100).toFixed(2)} m`, w * 0.72, dispY);

      // --- Force arrow from equilibrium (always visible) ---
      const { k: ck, b: cb } = paramsRef.current;
      const F = -ck * s.x - cb * s.v;
      const fScale = 0.15;
      const arrowY = centerY - massSize / 2 - 14;
      if (Math.abs(F) > 1) {
        drawArrow(mainCtx, eqX, arrowY, eqX + F * fScale, arrowY, C.velocity);
      }
      mainCtx.fillStyle = C.velocity;
      mainCtx.font = "italic 13px Georgia, serif";
      mainCtx.textAlign = "left";
      mainCtx.textBaseline = "middle";
      mainCtx.fillText(`F = ${(F / 100).toFixed(1)} N`, w * 0.72, arrowY);
    }

    function drawWaveforms() {
      const C = colorsRef.current!;
      const c = waveCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      waveCtx.clearRect(0, 0, w, h);

      const hist = historyRef.current;
      if (hist.length < 2) return;

      const margin = { left: 48, right: 12, top: 6, bottom: 6 };
      const plotW = w - margin.left - margin.right;
      const panelH = (h - margin.top - margin.bottom) / 3;

      const fs = fixedScaleRef.current;
      const labels = [
        { key: "x" as const, color: C.position, label: "x(t)", maxVal: fs.maxX },
        { key: "v" as const, color: C.velocity, label: "v(t)", maxVal: fs.maxV },
        { key: "a" as const, color: C.accel, label: "a(t)", maxVal: fs.maxA },
      ];

      labels.forEach((cfg, idx) => {
        const yOff = margin.top + idx * panelH;
        const midY = yOff + panelH / 2;

        // Separator
        if (idx > 0) {
          waveCtx.strokeStyle = C.grid;
          waveCtx.lineWidth = 0.5;
          waveCtx.beginPath();
          waveCtx.moveTo(margin.left, yOff);
          waveCtx.lineTo(w - margin.right, yOff);
          waveCtx.stroke();
        }

        // Axis line (zero)
        waveCtx.strokeStyle = C.grid;
        waveCtx.lineWidth = 0.5;
        waveCtx.beginPath();
        waveCtx.moveTo(margin.left, midY);
        waveCtx.lineTo(w - margin.right, midY);
        waveCtx.stroke();

        // Y-axis
        waveCtx.strokeStyle = C.grid;
        waveCtx.lineWidth = 0.5;
        waveCtx.beginPath();
        waveCtx.moveTo(margin.left, yOff + 2);
        waveCtx.lineTo(margin.left, yOff + panelH - 2);
        waveCtx.stroke();

        // Label (italic, textbook style)
        waveCtx.fillStyle = cfg.color;
        waveCtx.font = "italic 13px Georgia, serif";
        waveCtx.textAlign = "right";
        waveCtx.textBaseline = "middle";
        waveCtx.fillText(cfg.label, margin.left - 8, midY);

        // Fixed scale — no auto-rescaling
        const scaleY = (panelH / 2 - 10) / cfg.maxVal;

        // Waveform
        waveCtx.strokeStyle = cfg.color;
        waveCtx.lineWidth = 1.5;
        waveCtx.beginPath();
        for (let i = 0; i < hist.length; i++) {
          const px = margin.left + (i / HISTORY_LEN) * plotW;
          const py = midY - hist[i][cfg.key] * scaleY;
          if (i === 0) waveCtx.moveTo(px, py);
          else waveCtx.lineTo(px, py);
        }
        waveCtx.stroke();
      });

      // Time axis label
      waveCtx.fillStyle = C.muted;
      waveCtx.font = "italic 11px Georgia, serif";
      waveCtx.textAlign = "right";
      waveCtx.textBaseline = "top";
      waveCtx.fillText("t →", w - margin.right, h - 16);
    }

    function drawPhaseSpace() {
      const C = colorsRef.current!;
      const c = phaseCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      phaseCtx.clearRect(0, 0, w, h);

      const trail = phaseTrailRef.current;

      const cx = w / 2;
      const cy = h / 2;

      // Axes
      phaseCtx.strokeStyle = C.grid;
      phaseCtx.lineWidth = 0.8;
      phaseCtx.beginPath();
      phaseCtx.moveTo(20, cy);
      phaseCtx.lineTo(w - 10, cy);
      phaseCtx.moveTo(cx, 10);
      phaseCtx.lineTo(cx, h - 10);
      phaseCtx.stroke();

      // Axis labels (italic)
      phaseCtx.fillStyle = C.muted;
      phaseCtx.font = "italic 13px Georgia, serif";
      phaseCtx.textAlign = "left";
      phaseCtx.textBaseline = "bottom";
      phaseCtx.fillText("x", w - 18, cy - 6);
      phaseCtx.textAlign = "left";
      phaseCtx.textBaseline = "top";
      phaseCtx.fillText("v", cx + 6, 10);

      // Arrowheads on axes
      phaseCtx.fillStyle = C.grid;
      phaseCtx.beginPath();
      phaseCtx.moveTo(w - 10, cy);
      phaseCtx.lineTo(w - 16, cy - 3);
      phaseCtx.lineTo(w - 16, cy + 3);
      phaseCtx.closePath();
      phaseCtx.fill();
      phaseCtx.beginPath();
      phaseCtx.moveTo(cx, 10);
      phaseCtx.lineTo(cx - 3, 16);
      phaseCtx.lineTo(cx + 3, 16);
      phaseCtx.closePath();
      phaseCtx.fill();

      if (trail.length < 2) return;

      const fs = fixedScaleRef.current;
      const last = trail[trail.length - 1];

      // Adaptive zoom: scale so the current point stays at ~60% of the
      // available radius. For undamped motion the amplitude is constant
      // so the zoom stays constant too.
      const normX = last.x / fs.maxX;
      const normV = last.v / fs.maxV;
      const currentR = Math.sqrt(normX * normX + normV * normV);
      const targetR = 0.55; // fraction of half-canvas the dot should sit at
      let targetZoom = currentR > 1e-4 ? targetR / currentR : 1;
      targetZoom = Math.max(1, Math.min(targetZoom, 200));
      // Smooth lerp — slow enough to feel like a steady zoom-in
      phaseZoomRef.current += (targetZoom - phaseZoomRef.current) * 0.008;
      const zoom = phaseZoomRef.current;

      const scaleX = ((w / 2 - 30) / fs.maxX) * zoom;
      const scaleV = ((h / 2 - 24) / fs.maxV) * zoom;

      // Trail with fading
      for (let i = 1; i < trail.length; i++) {
        const alpha = (i / trail.length) * 0.85 + 0.05;
        phaseCtx.strokeStyle = C.phase;
        phaseCtx.globalAlpha = alpha;
        phaseCtx.lineWidth = 1.5;
        phaseCtx.beginPath();
        phaseCtx.moveTo(cx + trail[i - 1].x * scaleX, cy - trail[i - 1].v * scaleV);
        phaseCtx.lineTo(cx + trail[i].x * scaleX, cy - trail[i].v * scaleV);
        phaseCtx.stroke();
      }
      phaseCtx.globalAlpha = 1;

      // Current point
      phaseCtx.fillStyle = C.phase;
      phaseCtx.beginPath();
      phaseCtx.arc(cx + last.x * scaleX, cy - last.v * scaleV, 4, 0, Math.PI * 2);
      phaseCtx.fill();
    }

    function drawEnergy() {
      const C = colorsRef.current!;
      const c = energyCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      energyCtx.clearRect(0, 0, w, h);

      const { k: ck, mass: cm } = paramsRef.current;
      const s = stateRef.current;

      const KE = 0.5 * cm * s.v * s.v;
      const PE = 0.5 * ck * s.x * s.x;
      const total = KE + PE;

      const maxE = 0.5 * ck * x0 * x0;
      const refE = Math.max(maxE, total, 1);

      const barW = 36;
      const gap = 24;
      const barsTotal = 3;
      const totalBarW = barsTotal * barW + (barsTotal - 1) * gap;
      const startX = (w - totalBarW) / 2;
      const maxBarH = h - 55;
      const baseY = h - 26;

      const bars = [
        { label: "T", fullLabel: "Kinetic", value: KE, color: C.ke },
        { label: "V", fullLabel: "Potential", value: PE, color: C.pe },
        { label: "E", fullLabel: "Total", value: total, color: C.total },
      ];

      bars.forEach((bar, i) => {
        const bx = startX + i * (barW + gap);
        const barH = Math.max(0, (bar.value / refE) * maxBarH);

        // Bar outline
        energyCtx.strokeStyle = C.grid;
        energyCtx.lineWidth = 1;
        energyCtx.strokeRect(bx, baseY - maxBarH, barW, maxBarH);

        // Bar fill
        energyCtx.fillStyle = bar.color;
        energyCtx.globalAlpha = 0.7;
        energyCtx.fillRect(bx, baseY - barH, barW, barH);
        energyCtx.globalAlpha = 1;

        // Border on fill
        energyCtx.strokeStyle = bar.color;
        energyCtx.lineWidth = 1.5;
        energyCtx.strokeRect(bx, baseY - barH, barW, barH);

        // Label (italic, textbook) — purely qualitative, no values
        energyCtx.fillStyle = C.fg;
        energyCtx.font = "italic 13px Georgia, serif";
        energyCtx.textAlign = "center";
        energyCtx.textBaseline = "top";
        energyCtx.fillText(bar.label, bx + barW / 2, baseY + 6);
      });
    }

    function drawEnergyTime() {
      const C = colorsRef.current!;
      const c = energyTimeCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      energyTimeCtx.clearRect(0, 0, w, h);

      const hist = energyHistRef.current;
      if (hist.length < 2) return;

      const margin = { left: 48, right: 12, top: 12, bottom: 12 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Fixed scale from initial energy
      const maxE = 0.5 * paramsRef.current.k * x0 * x0;
      const refE = Math.max(maxE, 1) * 1.1;

      // Zero line
      energyTimeCtx.strokeStyle = C.grid;
      energyTimeCtx.lineWidth = 0.5;
      energyTimeCtx.beginPath();
      energyTimeCtx.moveTo(margin.left, h - margin.bottom);
      energyTimeCtx.lineTo(w - margin.right, h - margin.bottom);
      energyTimeCtx.stroke();

      // Y axis
      energyTimeCtx.beginPath();
      energyTimeCtx.moveTo(margin.left, margin.top);
      energyTimeCtx.lineTo(margin.left, h - margin.bottom);
      energyTimeCtx.stroke();

      // Labels
      energyTimeCtx.fillStyle = C.muted;
      energyTimeCtx.font = "italic 11px Georgia, serif";
      energyTimeCtx.textAlign = "right";
      energyTimeCtx.textBaseline = "top";
      energyTimeCtx.fillText("t →", w - margin.right, h - margin.bottom + 2);
      energyTimeCtx.textAlign = "right";
      energyTimeCtx.textBaseline = "middle";
      energyTimeCtx.fillText("E", margin.left - 8, margin.top + plotH / 2);

      const curves = [
        { key: "ke" as const, color: C.ke, label: "T" },
        { key: "pe" as const, color: C.pe, label: "V" },
        { key: "total" as const, color: C.total, label: "E" },
      ];

      curves.forEach((cfg) => {
        energyTimeCtx.strokeStyle = cfg.color;
        energyTimeCtx.lineWidth = 1.5;
        energyTimeCtx.beginPath();
        for (let i = 0; i < hist.length; i++) {
          const px = margin.left + (i / HISTORY_LEN) * plotW;
          const py = h - margin.bottom - (hist[i][cfg.key] / refE) * plotH;
          if (i === 0) energyTimeCtx.moveTo(px, py);
          else energyTimeCtx.lineTo(px, py);
        }
        energyTimeCtx.stroke();
      });

      // Legend
      const legendX = margin.left + 8;
      curves.forEach((cfg, i) => {
        const ly = margin.top + 6 + i * 16;
        energyTimeCtx.fillStyle = cfg.color;
        energyTimeCtx.fillRect(legendX, ly, 12, 3);
        energyTimeCtx.fillStyle = C.muted;
        energyTimeCtx.font = "italic 11px Georgia, serif";
        energyTimeCtx.textAlign = "left";
        energyTimeCtx.textBaseline = "middle";
        energyTimeCtx.fillText(cfg.label, legendX + 18, ly + 2);
      });
    }

    function loop() {
      if (runningRef.current) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) step();
      }
      if (!colorsRef.current) colorsRef.current = getColors();
      drawMain();
      drawWaveforms();
      drawPhaseSpace();
      drawEnergy();
      drawEnergyTime();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x0]);

  const regime = dampingRegime(k, mass, b);

  const regimeColor = (r: Regime) =>
    r === "undamped" ? "var(--total-color)"
    : r === "underdamped" ? "var(--position-color)"
    : r === "critically damped" ? "var(--accel-color)"
    : "var(--velocity-color)";

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
            <span style={{ color: "var(--foreground)" }}>Simple Harmonic Oscillator</span>
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
            The Damped Harmonic Oscillator
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            A mass&ndash;spring system with viscous damping, exhibiting underdamped, critically damped, and overdamped behaviour depending on the system parameters.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Controls bar */}
        <div className="mt-8 flex items-center justify-between mx-auto" style={{ maxWidth: "65ch" }}>
          <button
            onClick={() => {
              const order: Regime[] = ["undamped", "underdamped", "critically damped", "overdamped"];
              const next = order[(order.indexOf(regime) + 1) % order.length];
              applyPreset(next);
            }}
            className="text-sm font-medium px-3 py-1.5 rounded border cursor-pointer"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              borderColor: regimeColor(regime),
              color: regimeColor(regime),
            }}
          >
            {regime}
          </button>
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

        {/* Spring diagram + parameter controls — sticky */}
        <div
          className="mt-3 rounded border overflow-hidden sticky top-4 z-10"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          <canvas
            ref={mainCanvasRef}
            className="w-full"
            style={{ height: 180, background: "var(--canvas-bg)" }}
          />
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
            style={{ borderTop: "1px solid var(--border)" }}
          >
            <SliderControl label="Spring constant" symbol="k" unit="N/m" min={1} max={100} step={0.5} value={k} onChange={setK} />
            <SliderControl label="Mass" symbol="m" unit="kg" min={0.1} max={10} step={0.1} value={mass} onChange={setMass} />
            <SliderControl label="Damping" symbol="b" unit="Ns/m" min={0} max={40} step={0.1} value={b} onChange={setB} />
            <SliderControl
              label="Initial displacement"
              symbol="x₀"
              unit="m"
              min={10} max={250} step={5}
              value={x0} onChange={setX0}
              displayValue={(v) => (v / 100).toFixed(2)}
            />
          </div>
        </div>

        {/* --- Visuals --- */}

        {/* Waveforms */}
        <figure className="mt-16">
          <canvas
            ref={waveCanvasRef}
            className="w-full rounded border"
            style={{ height: 320, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Displacement, velocity, and acceleration against time. Scale is fixed to the initial amplitude.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          {/* Part 1: The undamped oscillator */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The simple harmonic oscillator</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A mass <Tex>m</Tex> on a spring with stiffness <Tex>k</Tex> obeys
              Hooke&rsquo;s law. With no friction or drag, Newton&rsquo;s second law gives:
            </p>

            <div className="text-center py-1">
              <Tex display>{`m\\ddot{x} = -kx`}</Tex>
            </div>

            <p>
              Defining the natural frequency <Tex>{`\\omega_0 = \\sqrt{k/m}`}</Tex>, this becomes
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\ddot{x} + \\omega_0^{\\,2}\\,x = 0`}</Tex>
            </div>

            <p>
              The general solution is purely sinusoidal — oscillation that continues forever
              with no change in amplitude:
            </p>

            <div className="text-center py-1">
              <Tex display>{`x(t) = A\\cos(\\omega_0 t + \\phi)`}</Tex>
            </div>

            <p>
              The total energy <Tex>{`E = \\tfrac{1}{2}m\\dot{x}^2 + \\tfrac{1}{2}kx^2 = \\tfrac{1}{2}kA^2`}</Tex> is
              exactly conserved. In the phase portrait, the trajectory is a closed ellipse
              that never shrinks — the system revisits the same states indefinitely.
            </p>
          </div>

          {/* Part 2: Adding damping */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Adding damping</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Now introduce a velocity-proportional damping force with coefficient <Tex>b</Tex>.
              The equation of motion becomes
            </p>

            <div className="text-center py-1">
              <Tex display>{`m\\ddot{x} = -kx - b\\dot{x}`}</Tex>
            </div>

            <p>
              Note that setting <Tex>{`b = 0`}</Tex> recovers the undamped equation above — damping
              is a strict generalisation. Defining <Tex>{`\\gamma = b/2m`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\ddot{x} + 2\\gamma\\,\\dot{x} + \\omega_0^{\\,2}\\,x = 0`}</Tex>
            </div>

            <p>
              The ansatz <Tex>{`x(t) = Ae^{\\lambda t}`}</Tex> gives
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\lambda = -\\gamma \\pm \\sqrt{\\gamma^2 - \\omega_0^{\\,2}}`}</Tex>
            </div>

            <p>
              The discriminant <Tex>{`\\Delta = \\gamma^2 - \\omega_0^{\\,2}`}</Tex> determines
              three qualitatively different regimes:
            </p>
          </div>

          {/* Regime cards — break out of the text column */}
          <div className="grid sm:grid-cols-3 gap-5 mt-10 -mx-4 sm:-mx-28 lg:-mx-44">
            <RegimeCard
              title="Underdamped"
              condition={`b^2 < 4mk`}
              equation={`x(t) = A\\,e^{-\\gamma t}\\cos(\\omega_d t + \\phi)`}
              description="Oscillatory decay. The damped frequency is"
              extra={`\\omega_d = \\sqrt{\\omega_0^{\\,2} - \\gamma^2}`}
              borderColor="var(--position-color)"
            />
            <RegimeCard
              title="Critically damped"
              condition={`b^2 = 4mk`}
              equation={`x(t) = (A + Bt)\\,e^{-\\gamma t}`}
              description="Fastest non-oscillatory return to equilibrium. Degenerate roots."
              borderColor="var(--accel-color)"
            />
            <RegimeCard
              title="Overdamped"
              condition={`b^2 > 4mk`}
              equation={`x(t) = A\\,e^{\\lambda_+ t} + B\\,e^{\\lambda_- t}`}
              description="Sluggish exponential decay. Both roots real and negative."
              borderColor="var(--velocity-color)"
            />
          </div>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Energy</h3>
            <p>
              The total mechanical energy <Tex>{`E = \\tfrac{1}{2}m\\dot{x}^2 + \\tfrac{1}{2}kx^2`}</Tex> is
              conserved only when <Tex>{`b = 0`}</Tex> (the undamped case). With any
              nonzero damping:
            </p>
            <div className="text-center py-1">
              <Tex display>{`\\frac{dE}{dt} = -b\\,\\dot{x}^{\\,2} \\leq 0`}</Tex>
            </div>
            <p>
              Energy is monotonically removed from the system. In the undamped
              preset the total energy bar stays constant while kinetic and potential
              trade back and forth. With damping, all three decay to zero — the
              rate depends on both <Tex>b</Tex> and the instantaneous velocity, so
              energy is lost fastest at the equilibrium crossing (where <Tex>{`|\\dot{x}|`}</Tex> peaks)
              and not at all at the turning points (where the mass is momentarily at rest).
            </p>
            <p>
              For the underdamped case the energy envelope decays
              as <Tex>{`E(t) \\propto e^{-2\\gamma t}`}</Tex> — twice the rate of the
              amplitude, since energy goes as the square of displacement.
            </p>
          </div>

          <figure className="mt-10">
            <canvas
              ref={energyCanvasRef}
              className="w-full rounded border"
              style={{ height: 260, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Instantaneous energy — kinetic (<Tex>T</Tex>), potential (<Tex>V</Tex>), and total (<Tex>E</Tex>).
            </figcaption>
          </figure>

          <figure className="mt-8">
            <canvas
              ref={energyTimeCanvasRef}
              className="w-full rounded border"
              style={{ height: 220, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Energy over time — kinetic and potential oscillate in antiphase while the total decays smoothly.
            </figcaption>
          </figure>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Phase space</h3>
            <p>
              The phase portrait plots <Tex>{`(x, \\dot{x})`}</Tex> as the system
              evolves. For the undamped oscillator, this trajectory is a closed ellipse:
            </p>
            <div className="text-center py-1">
              <Tex display>{`\\frac{x^2}{A^2} + \\frac{\\dot{x}^{\\,2}}{(\\omega_0 A)^2} = 1`}</Tex>
            </div>
            <p>
              The ellipse never changes — the system endlessly retraces its path,
              reflecting exact energy conservation. The aspect ratio is set
              by <Tex>{`\\omega_0`}</Tex>: a stiffer spring (higher <Tex>{`\\omega_0`}</Tex>)
              stretches the ellipse along the velocity axis.
            </p>
            <p>
              With damping, the trajectory becomes a spiral that winds inward
              toward the origin. The key insight visible in the simulation is that
              each successive orbit is geometrically similar to the last — the
              spiral is self-similar because the damping reduces <Tex>x</Tex> and <Tex>{`\\dot{x}`}</Tex> by
              the same factor <Tex>{`e^{-\\gamma T_d}`}</Tex> per period. The zoom
              in the phase portrait compensates for this decay, showing that the
              local shape of the orbit is always the same ellipse.
            </p>
          </div>

          <figure className="mt-10">
            <canvas
              ref={phaseCanvasRef}
              className="w-full rounded border"
              style={{ height: 340, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Phase portrait — the view zooms to track the decay, showing the elliptical shape is preserved at every scale.
            </figcaption>
          </figure>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Quality factor</h3>
            <p>
              The quality factor <Tex>{`Q = \\omega_0 / 2\\gamma = \\sqrt{mk}/b`}</Tex> measures
              how many oscillations occur before the energy decays
              to <Tex>{`1/e`}</Tex> of its initial value. High-<Tex>Q</Tex> systems
              (small damping) ring for many cycles; low-<Tex>Q</Tex> systems
              lose energy within a fraction of a period. At <Tex>{`Q = \\tfrac{1}{2}`}</Tex> the
              system is critically damped and no longer oscillates at all.
            </p>
          </div>
        </section>

        {/* Visuals moved inline with derivation sections */}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Regime card
// ---------------------------------------------------------------------------

function RegimeCard({
  title, condition, equation, description, extra, borderColor,
}: {
  title: string;
  condition: string;
  equation: string;
  description: string;
  extra?: string;
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
        {description}{extra && <> <Tex>{extra}</Tex>.</>}
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
