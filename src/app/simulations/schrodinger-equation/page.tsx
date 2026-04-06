"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type PotentialMode =
  | "free particle"
  | "single barrier"
  | "double barrier"
  | "harmonic well"
  | "step potential"
  | "infinite well";

const MODES: PotentialMode[] = [
  "free particle",
  "single barrier",
  "double barrier",
  "harmonic well",
  "step potential",
  "infinite well",
];

const N = 1024; // grid points (must be power of 2)
const L = 40; // domain half-width in atomic units
const DX = (2 * L) / N;
const DK = (2 * Math.PI) / (N * DX);
const DT = 0.005; // time step (small for smooth wavefunction)
const STEPS_PER_FRAME = 8;
const HISTORY_LEN = 400;

// ---------------------------------------------------------------------------
// Cooley-Tukey radix-2 FFT (pure JS)
// ---------------------------------------------------------------------------

function fft(reIn: Float64Array, imIn: Float64Array, inverse: boolean): [Float64Array, Float64Array] {
  const n = reIn.length;
  const re = new Float64Array(reIn);
  const im = new Float64Array(imIn);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }

  // Cooley-Tukey iterative
  for (let len = 2; len <= n; len *= 2) {
    const ang = (2 * Math.PI / len) * (inverse ? -1 : 1);
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * curRe - im[i + j + len / 2] * curIm;
        const vIm = re[i + j + len / 2] * curIm + im[i + j + len / 2] * curRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }

  return [re, im];
}

// ---------------------------------------------------------------------------
// Wave packet initialization
// ---------------------------------------------------------------------------

function initWavePacket(
  k0: number,
  sigma: number,
  x0Frac: number
): [Float64Array, Float64Array] {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const x0 = -L + x0Frac * 2 * L;
  let norm = 0;
  for (let i = 0; i < N; i++) {
    const x = -L + i * DX;
    const env = Math.exp(-((x - x0) ** 2) / (4 * sigma * sigma));
    re[i] = env * Math.cos(k0 * x);
    im[i] = env * Math.sin(k0 * x);
    norm += re[i] * re[i] + im[i] * im[i];
  }
  norm = Math.sqrt(norm * DX);
  for (let i = 0; i < N; i++) {
    re[i] /= norm;
    im[i] /= norm;
  }
  return [re, im];
}

// ---------------------------------------------------------------------------
// Potential construction
// ---------------------------------------------------------------------------

function buildPotential(
  mode: PotentialMode,
  barrierHeight: number,
  barrierWidth: number
): Float64Array {
  const V = new Float64Array(N);
  const center = N / 2;
  const bwPts = Math.round(barrierWidth / DX);

  switch (mode) {
    case "free particle":
      break;
    case "single barrier": {
      const start = center - Math.floor(bwPts / 2);
      const end = center + Math.ceil(bwPts / 2);
      for (let i = start; i < end && i < N; i++) {
        if (i >= 0) V[i] = barrierHeight;
      }
      break;
    }
    case "double barrier": {
      const gap = Math.max(Math.round(1.5 / DX), 4);
      const s1 = center - gap - bwPts;
      const e1 = center - gap;
      const s2 = center + gap;
      const e2 = center + gap + bwPts;
      for (let i = s1; i < e1 && i < N; i++) if (i >= 0) V[i] = barrierHeight;
      for (let i = s2; i < e2 && i < N; i++) if (i >= 0) V[i] = barrierHeight;
      break;
    }
    case "harmonic well": {
      const omega = barrierHeight * 0.01;
      for (let i = 0; i < N; i++) {
        const x = -L + i * DX;
        V[i] = 0.5 * omega * omega * x * x;
        if (V[i] > barrierHeight * 2) V[i] = barrierHeight * 2;
      }
      break;
    }
    case "step potential": {
      for (let i = center; i < N; i++) {
        V[i] = barrierHeight;
      }
      break;
    }
    case "infinite well": {
      // Well from -L/3 to L/3, infinite walls outside
      const wallHeight = 1000;
      const wellLeft = Math.round(N / 2 - N / 6);
      const wellRight = Math.round(N / 2 + N / 6);
      for (let i = 0; i < wellLeft; i++) V[i] = wallHeight;
      for (let i = wellRight; i < N; i++) V[i] = wallHeight;
      break;
    }
  }

  return V;
}

// Absorbing boundary mask — multiplicative damping applied after each step
// Returns a smooth window function: 1 in the interior, decays to 0 at edges
function buildAbsorbingMask(): Float64Array {
  const mask = new Float64Array(N);
  const absLen = 80;
  for (let i = 0; i < N; i++) {
    mask[i] = 1;
  }
  for (let i = 0; i < absLen; i++) {
    const frac = i / absLen;
    const damp = 1 - Math.cos(frac * Math.PI * 0.5); // smooth 0→1
    mask[i] = damp * damp;
    mask[N - 1 - i] = damp * damp;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Split-operator propagation step
// ---------------------------------------------------------------------------

function propagateStep(
  psiRe: Float64Array,
  psiIm: Float64Array,
  V: Float64Array,
  dt: number,
  mask: Float64Array | null
): void {
  // Half step in position space: exp(-i V dt/2)
  for (let i = 0; i < N; i++) {
    const angle = -V[i] * dt * 0.5;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = psiRe[i];
    const im = psiIm[i];
    psiRe[i] = r * c - im * s;
    psiIm[i] = r * s + im * c;
  }

  // FFT to momentum space
  const [kRe, kIm] = fft(psiRe, psiIm, false);

  // Full step in momentum space: exp(-i k^2 dt/2)
  for (let i = 0; i < N; i++) {
    const ki = i <= N / 2 ? i * DK : (i - N) * DK;
    const angle = -0.5 * ki * ki * dt;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = kRe[i];
    const im = kIm[i];
    kRe[i] = r * c - im * s;
    kIm[i] = r * s + im * c;
  }

  // Inverse FFT back to position space
  const [xRe, xIm] = fft(kRe, kIm, true);

  // Half step in position space: exp(-i V dt/2)
  for (let i = 0; i < N; i++) {
    const angle = -V[i] * dt * 0.5;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    psiRe[i] = xRe[i] * c - xIm[i] * s;
    psiIm[i] = xRe[i] * s + xIm[i] * c;
  }

  // Apply absorbing mask (damps wavefunction at edges so it "leaves the page")
  // Skip for infinite well which has hard walls
  if (mask) {
    for (let i = 0; i < N; i++) {
      psiRe[i] *= mask[i];
      psiIm[i] *= mask[i];
    }
  }
}

// ---------------------------------------------------------------------------
// Expectation values
// ---------------------------------------------------------------------------

function computeExpectations(
  psiRe: Float64Array,
  psiIm: Float64Array
): { expX: number; expP: number; norm: number } {
  let expX = 0;
  let norm = 0;

  for (let i = 0; i < N; i++) {
    const rho = psiRe[i] * psiRe[i] + psiIm[i] * psiIm[i];
    const x = -L + i * DX;
    expX += x * rho;
    norm += rho;
  }
  expX *= DX;
  norm *= DX;

  // <p> via finite difference: -i hbar d/dx in position basis
  let expP = 0;
  for (let i = 1; i < N - 1; i++) {
    const dRe = (psiRe[i + 1] - psiRe[i - 1]) / (2 * DX);
    const dIm = (psiIm[i + 1] - psiIm[i - 1]) / (2 * DX);
    // <p> = integral psi* (-i d/dx) psi dx
    // = integral (psiRe - i psiIm)(-i)(dRe + i dIm) dx
    // = integral (psiRe*dIm - psiIm*dRe) dx   (real part after hbar=1)
    expP += (psiRe[i] * dIm - psiIm[i] * dRe);
  }
  expP *= DX;

  return { expX, expP, norm };
}

// ---------------------------------------------------------------------------
// Momentum space density
// ---------------------------------------------------------------------------

function momentumDensity(
  psiRe: Float64Array,
  psiIm: Float64Array
): Float64Array {
  const [kRe, kIm] = fft(psiRe, psiIm, false);
  const density = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    density[i] = (kRe[i] * kRe[i] + kIm[i] * kIm[i]) * DX * DX;
  }
  return density;
}

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
    accent: g("--accent"),
    accent2: g("--accent-2"),
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SchrodingerEquationPage() {
  const { theme, toggle } = useTheme();

  const [k0, setK0] = useState(3);
  const [sigma, setSigma] = useState(1.5);
  const [barrierHeight, setBarrierHeight] = useState(5);
  const [barrierWidth, setBarrierWidth] = useState(1);
  const [mode, setMode] = useState<PotentialMode>("single barrier");
  const [running, setRunning] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const expectCanvasRef = useRef<HTMLCanvasElement>(null);
  const momentumCanvasRef = useRef<HTMLCanvasElement>(null);

  const psiReRef = useRef(new Float64Array(N));
  const psiImRef = useRef(new Float64Array(N));
  const potentialRef = useRef(new Float64Array(N));
  const absorbMaskRef = useRef<Float64Array | null>(buildAbsorbingMask());
  const timeRef = useRef(0);
  const expectHistRef = useRef<{ expX: number; expP: number; t: number }[]>([]);
  const rafRef = useRef(0);
  const runningRef = useRef(running);
  const paramsRef = useRef({ k0, sigma, barrierHeight, barrierWidth, mode });
  const colorsRef = useRef<Colors | null>(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => {
    paramsRef.current = { k0, sigma, barrierHeight, barrierWidth, mode };
  }, [k0, sigma, barrierHeight, barrierWidth, mode]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    const { k0: ck, sigma: cs, barrierHeight: bh, barrierWidth: bw, mode: cm } = paramsRef.current;
    // For infinite well, start the packet inside the well
    const startFrac = cm === "infinite well" ? 0.4 : 0.25;
    const [re, im] = initWavePacket(ck, cs, startFrac);
    psiReRef.current = re;
    psiImRef.current = im;
    potentialRef.current = buildPotential(cm, bh, bw);
    // Use absorbing mask for all modes except infinite well and harmonic well
    absorbMaskRef.current = (cm === "infinite well" || cm === "harmonic well") ? null : buildAbsorbingMask();
    timeRef.current = 0;
    expectHistRef.current = [];
  }, []);

  // Reset when params change
  useEffect(() => {
    reset();
  }, [k0, sigma, barrierHeight, barrierWidth, mode, reset]);

  // Rebuild potential when relevant params change (without resetting wave)
  useEffect(() => {
    potentialRef.current = buildPotential(mode, barrierHeight, barrierWidth);
  }, [mode, barrierHeight, barrierWidth]);

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const expectCanvas = expectCanvasRef.current;
    const momentumCanvas = momentumCanvasRef.current;
    if (!mainCanvas || !expectCanvas || !momentumCanvas) return;

    const mainCtx = mainCanvas.getContext("2d")!;
    const expectCtx = expectCanvas.getContext("2d")!;
    const momentumCtx = momentumCanvas.getContext("2d")!;

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
      resizeCanvas(mainCanvas!);
      resizeCanvas(expectCanvas!);
      resizeCanvas(momentumCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    function step() {
      propagateStep(
        psiReRef.current,
        psiImRef.current,
        potentialRef.current,
        DT,
        absorbMaskRef.current
      );
      timeRef.current += DT;

      const { expX, expP } = computeExpectations(psiReRef.current, psiImRef.current);
      expectHistRef.current.push({ expX, expP, t: timeRef.current });
      if (expectHistRef.current.length > HISTORY_LEN) expectHistRef.current.shift();
    }

    function drawMain() {
      const C = colorsRef.current!;
      const c = mainCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      mainCtx.clearRect(0, 0, w, h);

      const re = psiReRef.current;
      const im = psiImRef.current;
      const V = potentialRef.current;

      const margin = { left: 40, right: 20, top: 12, bottom: 24 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;
      const baseY = margin.top + plotH;

      // Compute |psi|^2 for scaling
      let maxProb = 0;
      let maxV = 0;
      for (let i = 0; i < N; i++) {
        const prob = re[i] * re[i] + im[i] * im[i];
        if (prob > maxProb) maxProb = prob;
        if (V[i] > maxV && V[i] < 100) maxV = V[i];
      }
      const probScale = maxProb > 1e-12 ? (plotH * 0.8) / maxProb : 1;
      const waveScale = maxProb > 1e-12 ? (plotH * 0.6) / Math.sqrt(maxProb) : 1;
      const vScale = maxV > 1e-6 ? (plotH * 0.6) / maxV : 0;

      // Axis line
      mainCtx.strokeStyle = C.grid;
      mainCtx.lineWidth = 0.5;
      mainCtx.beginPath();
      mainCtx.moveTo(margin.left, baseY);
      mainCtx.lineTo(w - margin.right, baseY);
      mainCtx.stroke();

      // Y axis
      mainCtx.beginPath();
      mainCtx.moveTo(margin.left, margin.top);
      mainCtx.lineTo(margin.left, baseY);
      mainCtx.stroke();

      const px = (i: number) => margin.left + (i / N) * plotW;

      // V(x) shaded gray
      if (vScale > 0) {
        mainCtx.fillStyle = C.muted;
        mainCtx.globalAlpha = 0.15;
        mainCtx.beginPath();
        mainCtx.moveTo(px(0), baseY);
        for (let i = 0; i < N; i++) {
          const vy = Math.min(V[i] * vScale, plotH);
          mainCtx.lineTo(px(i), baseY - vy);
        }
        mainCtx.lineTo(px(N - 1), baseY);
        mainCtx.closePath();
        mainCtx.fill();
        mainCtx.globalAlpha = 1;

        // V outline
        mainCtx.strokeStyle = C.muted;
        mainCtx.globalAlpha = 0.4;
        mainCtx.lineWidth = 1;
        mainCtx.beginPath();
        for (let i = 0; i < N; i++) {
          const vy = Math.min(V[i] * vScale, plotH);
          if (i === 0) mainCtx.moveTo(px(i), baseY - vy);
          else mainCtx.lineTo(px(i), baseY - vy);
        }
        mainCtx.stroke();
        mainCtx.globalAlpha = 1;
      }

      // |psi|^2 filled area (blue/purple gradient effect)
      mainCtx.fillStyle = C.accent2;
      mainCtx.globalAlpha = 0.3;
      mainCtx.beginPath();
      mainCtx.moveTo(px(0), baseY);
      for (let i = 0; i < N; i++) {
        const prob = re[i] * re[i] + im[i] * im[i];
        mainCtx.lineTo(px(i), baseY - prob * probScale);
      }
      mainCtx.lineTo(px(N - 1), baseY);
      mainCtx.closePath();
      mainCtx.fill();
      mainCtx.globalAlpha = 1;

      // |psi|^2 outline
      mainCtx.strokeStyle = C.accent2;
      mainCtx.lineWidth = 1.5;
      mainCtx.beginPath();
      for (let i = 0; i < N; i++) {
        const prob = re[i] * re[i] + im[i] * im[i];
        const py = baseY - prob * probScale;
        if (i === 0) mainCtx.moveTo(px(i), py);
        else mainCtx.lineTo(px(i), py);
      }
      mainCtx.stroke();

      // Re(psi) cyan line
      mainCtx.strokeStyle = "#06b6d4";
      mainCtx.lineWidth = 1;
      mainCtx.globalAlpha = 0.8;
      mainCtx.beginPath();
      for (let i = 0; i < N; i++) {
        const py = baseY - plotH * 0.5 - re[i] * waveScale;
        if (i === 0) mainCtx.moveTo(px(i), py);
        else mainCtx.lineTo(px(i), py);
      }
      mainCtx.stroke();
      mainCtx.globalAlpha = 1;

      // Im(psi) magenta line
      mainCtx.strokeStyle = "#d946ef";
      mainCtx.lineWidth = 1;
      mainCtx.globalAlpha = 0.8;
      mainCtx.beginPath();
      for (let i = 0; i < N; i++) {
        const py = baseY - plotH * 0.5 - im[i] * waveScale;
        if (i === 0) mainCtx.moveTo(px(i), py);
        else mainCtx.lineTo(px(i), py);
      }
      mainCtx.stroke();
      mainCtx.globalAlpha = 1;

      // Labels
      mainCtx.font = "italic 11px Georgia, serif";
      mainCtx.textAlign = "right";
      mainCtx.textBaseline = "top";
      mainCtx.fillStyle = C.muted;
      mainCtx.fillText("x", w - margin.right - 2, baseY + 4);

      // Legend
      const legendX = margin.left + 8;
      const legendY = margin.top + 6;
      const items: [string, string][] = [
        ["|\\u03C8|\\u00B2", C.accent2],
        ["Re(\\u03C8)", "#06b6d4"],
        ["Im(\\u03C8)", "#d946ef"],
      ];
      const labels = ["\u007C\u03C8\u007C\u00B2", "Re(\u03C8)", "Im(\u03C8)"];
      const itemColors = [C.accent2, "#06b6d4", "#d946ef"];
      labels.forEach((lbl, i) => {
        const ly = legendY + i * 15;
        mainCtx.fillStyle = itemColors[i];
        mainCtx.fillRect(legendX, ly, 12, 3);
        mainCtx.fillStyle = C.muted;
        mainCtx.font = "italic 10px Georgia, serif";
        mainCtx.textAlign = "left";
        mainCtx.textBaseline = "middle";
        mainCtx.fillText(lbl, legendX + 16, ly + 2);
      });

      // V(x) legend
      if (vScale > 0) {
        const ly = legendY + 3 * 15;
        mainCtx.fillStyle = C.muted;
        mainCtx.globalAlpha = 0.4;
        mainCtx.fillRect(legendX, ly, 12, 3);
        mainCtx.globalAlpha = 1;
        mainCtx.font = "italic 10px Georgia, serif";
        mainCtx.textAlign = "left";
        mainCtx.textBaseline = "middle";
        mainCtx.fillText("V(x)", legendX + 16, ly + 2);
      }
    }

    function drawExpectations() {
      const C = colorsRef.current!;
      const c = expectCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      expectCtx.clearRect(0, 0, w, h);

      const hist = expectHistRef.current;
      if (hist.length < 2) return;

      const margin = { left: 48, right: 12, top: 6, bottom: 6 };
      const plotW = w - margin.left - margin.right;
      const panelH = (h - margin.top - margin.bottom) / 2;

      // Find ranges
      let maxX = 1, maxP = 1;
      for (const h of hist) {
        if (Math.abs(h.expX) > maxX) maxX = Math.abs(h.expX);
        if (Math.abs(h.expP) > maxP) maxP = Math.abs(h.expP);
      }
      maxX *= 1.2;
      maxP *= 1.2;

      const panels = [
        { key: "expX" as const, color: C.position, label: "\u27E8x\u27E9", maxVal: maxX },
        { key: "expP" as const, color: C.velocity, label: "\u27E8p\u27E9", maxVal: maxP },
      ];

      panels.forEach((cfg, idx) => {
        const yOff = margin.top + idx * panelH;
        const midY = yOff + panelH / 2;

        if (idx > 0) {
          expectCtx.strokeStyle = C.grid;
          expectCtx.lineWidth = 0.5;
          expectCtx.beginPath();
          expectCtx.moveTo(margin.left, yOff);
          expectCtx.lineTo(w - margin.right, yOff);
          expectCtx.stroke();
        }

        // Zero line
        expectCtx.strokeStyle = C.grid;
        expectCtx.lineWidth = 0.5;
        expectCtx.beginPath();
        expectCtx.moveTo(margin.left, midY);
        expectCtx.lineTo(w - margin.right, midY);
        expectCtx.stroke();

        // Y axis
        expectCtx.beginPath();
        expectCtx.moveTo(margin.left, yOff + 2);
        expectCtx.lineTo(margin.left, yOff + panelH - 2);
        expectCtx.stroke();

        // Label
        expectCtx.fillStyle = cfg.color;
        expectCtx.font = "italic 13px Georgia, serif";
        expectCtx.textAlign = "right";
        expectCtx.textBaseline = "middle";
        expectCtx.fillText(cfg.label, margin.left - 8, midY);

        const scaleY = cfg.maxVal > 1e-8 ? (panelH / 2 - 10) / cfg.maxVal : 1;

        expectCtx.strokeStyle = cfg.color;
        expectCtx.lineWidth = 1.5;
        expectCtx.beginPath();
        for (let i = 0; i < hist.length; i++) {
          const px = margin.left + (i / HISTORY_LEN) * plotW;
          const py = midY - hist[i][cfg.key] * scaleY;
          if (i === 0) expectCtx.moveTo(px, py);
          else expectCtx.lineTo(px, py);
        }
        expectCtx.stroke();
      });

      expectCtx.fillStyle = C.muted;
      expectCtx.font = "italic 11px Georgia, serif";
      expectCtx.textAlign = "right";
      expectCtx.textBaseline = "top";
      expectCtx.fillText("t \u2192", w - margin.right, h - 16);
    }

    function drawMomentum() {
      const C = colorsRef.current!;
      const c = momentumCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      momentumCtx.clearRect(0, 0, w, h);

      const density = momentumDensity(psiReRef.current, psiImRef.current);

      const margin = { left: 48, right: 12, top: 12, bottom: 24 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;
      const baseY = margin.top + plotH;

      // Only plot the central portion of k-space
      const kRange = 12;
      const kStart = Math.max(0, Math.floor(N / 2 - kRange / DK));
      const kEnd = Math.min(N, Math.ceil(N / 2 + kRange / DK));

      let maxD = 0;
      for (let i = kStart; i < kEnd; i++) {
        const idx = i < N / 2 ? i + N / 2 : i - N / 2;
        if (density[idx] > maxD) maxD = density[idx];
      }
      const dScale = maxD > 1e-12 ? (plotH * 0.9) / maxD : 1;

      // Axes
      momentumCtx.strokeStyle = C.grid;
      momentumCtx.lineWidth = 0.5;
      momentumCtx.beginPath();
      momentumCtx.moveTo(margin.left, baseY);
      momentumCtx.lineTo(w - margin.right, baseY);
      momentumCtx.stroke();
      momentumCtx.beginPath();
      momentumCtx.moveTo(margin.left, margin.top);
      momentumCtx.lineTo(margin.left, baseY);
      momentumCtx.stroke();

      // Filled area
      momentumCtx.fillStyle = C.accent;
      momentumCtx.globalAlpha = 0.25;
      momentumCtx.beginPath();
      momentumCtx.moveTo(margin.left, baseY);
      const totalPts = kEnd - kStart;
      for (let j = 0; j < totalPts; j++) {
        const i = kStart + j;
        const idx = i < N / 2 ? i + N / 2 : i - N / 2;
        const px = margin.left + (j / totalPts) * plotW;
        const py = baseY - density[idx] * dScale;
        momentumCtx.lineTo(px, py);
      }
      momentumCtx.lineTo(margin.left + plotW, baseY);
      momentumCtx.closePath();
      momentumCtx.fill();
      momentumCtx.globalAlpha = 1;

      // Outline
      momentumCtx.strokeStyle = C.accent;
      momentumCtx.lineWidth = 1.5;
      momentumCtx.beginPath();
      for (let j = 0; j < totalPts; j++) {
        const i = kStart + j;
        const idx = i < N / 2 ? i + N / 2 : i - N / 2;
        const px = margin.left + (j / totalPts) * plotW;
        const py = baseY - density[idx] * dScale;
        if (j === 0) momentumCtx.moveTo(px, py);
        else momentumCtx.lineTo(px, py);
      }
      momentumCtx.stroke();

      // Labels
      momentumCtx.fillStyle = C.muted;
      momentumCtx.font = "italic 11px Georgia, serif";
      momentumCtx.textAlign = "right";
      momentumCtx.textBaseline = "top";
      momentumCtx.fillText("k", w - margin.right - 2, baseY + 4);
      momentumCtx.textAlign = "right";
      momentumCtx.textBaseline = "middle";
      momentumCtx.fillText("|\u03C6(k)|\u00B2", margin.left - 6, margin.top + plotH / 2);
    }

    function loop() {
      if (runningRef.current) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) step();
      }
      if (!colorsRef.current) colorsRef.current = getColors();
      drawMain();
      drawExpectations();
      drawMomentum();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const modeColor = (m: PotentialMode) =>
    m === "free particle" ? "var(--total-color)"
    : m === "single barrier" ? "var(--position-color)"
    : m === "double barrier" ? "var(--accel-color)"
    : m === "harmonic well" ? "var(--phase-color)"
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
            <span style={{ color: "var(--foreground)" }}>Schr&ouml;dinger Equation</span>
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
            The Schr&ouml;dinger Equation
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            A Gaussian wave packet propagating through various potentials, solved
            in real time with the split-operator Fourier method.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Sticky collapsible simulation panel */}
        <div
          className="mt-8 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Top bar: always visible, contains mode + play/pause/reset */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
                  setMode(next);
                }}
                className="text-sm font-medium px-3 py-1.5 rounded border cursor-pointer"
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  borderColor: modeColor(mode),
                  color: modeColor(mode),
                }}
              >
                {mode}
              </button>
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
              <button
                onClick={() => setCollapsed((c) => !c)}
                className="text-xs px-2 py-1 rounded border cursor-pointer ml-2"
                style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--muted)" }}
              >
                {collapsed ? "show \u2193" : "hide \u2191"}
              </button>
            </div>
          </div>

          {/* Full panel */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <canvas
              ref={mainCanvasRef}
              className="w-full"
              style={{ height: 220, background: "var(--canvas-bg)" }}
            />
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Momentum" symbol="k\u2080" unit="\u210F/a\u2080"
                min={0} max={10} step={0.1}
                value={k0} onChange={setK0}
              />
              <SliderControl
                label="Width" symbol="\u03C3" unit="a\u2080"
                min={0.3} max={4} step={0.1}
                value={sigma} onChange={setSigma}
              />
              <SliderControl
                label="Barrier height" symbol="V\u2080" unit="E\u2080"
                min={0} max={20} step={0.5}
                value={barrierHeight} onChange={setBarrierHeight}
              />
              <SliderControl
                label="Barrier width" symbol="a" unit="a\u2080"
                min={0.2} max={4} step={0.1}
                value={barrierWidth} onChange={setBarrierWidth}
              />
            </div>
          </div>
        </div>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>
          <h2 className="text-2xl font-semibold tracking-tight mb-5">
            The time-dependent Schr&ouml;dinger equation
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The fundamental equation governing the time evolution of a
              non-relativistic quantum system is the time-dependent
              Schr&ouml;dinger equation (TDSE):
            </p>

            <div className="text-center py-1">
              <Tex display>{`i\\hbar\\frac{\\partial\\psi}{\\partial t} = \\hat{H}\\psi`}</Tex>
            </div>

            <p>
              where <Tex>{`\\hat{H} = -\\frac{\\hbar^2}{2m}\\frac{\\partial^2}{\\partial x^2} + V(x)`}</Tex> is
              the Hamiltonian operator. The first term is the kinetic energy
              operator and the second is the potential. In atomic units
              (<Tex>{`\\hbar = m = 1`}</Tex>), this simplifies to
            </p>

            <div className="text-center py-1">
              <Tex display>{`i\\frac{\\partial\\psi}{\\partial t} = -\\frac{1}{2}\\frac{\\partial^2\\psi}{\\partial x^2} + V(x)\\,\\psi`}</Tex>
            </div>

            <p>
              The wave function <Tex>{`\\psi(x,t)`}</Tex> is complex-valued.
              The physical content is in the probability
              density <Tex>{`|\\psi(x,t)|^2`}</Tex>, which gives the probability
              per unit length of finding the particle near position <Tex>x</Tex> at
              time <Tex>t</Tex>. In the simulation above, the filled purple region
              shows <Tex>{`|\\psi|^2`}</Tex>, while the cyan and magenta traces show
              the real and imaginary parts of the wave function.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">
            Free particle propagation
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              For a free particle (<Tex>{`V = 0`}</Tex>), plane wave
              solutions <Tex>{`\\psi_k = e^{i(kx - \\omega t)}`}</Tex> with
              the dispersion relation <Tex>{`\\omega = k^2/2`}</Tex> form a
              complete basis. A Gaussian wave packet with initial
              momentum <Tex>{`k_0`}</Tex> and width <Tex>{`\\sigma`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\psi(x,0) = \\frac{1}{(2\\pi\\sigma^2)^{1/4}}\\exp\\!\\left(-\\frac{x^2}{4\\sigma^2} + ik_0 x\\right)`}</Tex>
            </div>

            <p>
              propagates with group velocity <Tex>{`v_g = k_0`}</Tex> and spreads
              over time. The width grows
              as <Tex>{`\\sigma(t) = \\sigma\\sqrt{1 + t^2/(4\\sigma^4)}`}</Tex>.
              The spreading is a direct consequence of the quadratic dispersion
              relation: different momentum components travel at different speeds.
            </p>
          </div>

          {/* Expectation values canvas inline */}
          <figure className="mt-10">
            <canvas
              ref={expectCanvasRef}
              className="w-full rounded border"
              style={{ height: 240, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Expectation values <Tex>{`\\langle x \\rangle`}</Tex> and <Tex>{`\\langle p \\rangle`}</Tex> over time.
              For a free particle, <Tex>{`\\langle x \\rangle`}</Tex> is linear
              and <Tex>{`\\langle p \\rangle`}</Tex> is constant.
            </figcaption>
          </figure>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">
            Quantum tunneling
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              When a wave packet encounters a potential barrier of
              height <Tex>{`V_0`}</Tex> and width <Tex>a</Tex>, classical
              mechanics predicts complete reflection if the particle energy
              is below <Tex>{`V_0`}</Tex>. Quantum mechanics disagrees: the wave
              function penetrates the barrier as an evanescent
              wave <Tex>{`\\sim e^{-\\kappa x}`}</Tex> where
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\kappa = \\sqrt{2m(V_0 - E)\\,/\\,\\hbar^2}`}</Tex>
            </div>

            <p>
              If the barrier is thin enough, a fraction of the wave function
              emerges on the other side. For a rectangular barrier the
              transmission coefficient in the WKB approximation is
            </p>

            <div className="text-center py-1">
              <Tex display>{`T \\approx e^{-2\\kappa a}`}</Tex>
            </div>

            <p>
              This exponential sensitivity to the barrier width <Tex>a</Tex> and
              the decay constant <Tex>{`\\kappa`}</Tex> is what makes tunneling
              both rare and exquisitely tunable. Switch to
              the <em>single barrier</em> or <em>double barrier</em> mode above
              and adjust the barrier parameters to watch the transmitted and
              reflected wave packets separate in real time.
            </p>
          </div>

          {/* Momentum space canvas inline */}
          <figure className="mt-10">
            <canvas
              ref={momentumCanvasRef}
              className="w-full rounded border"
              style={{ height: 220, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Momentum-space probability density <Tex>{`|\\phi(k)|^2`}</Tex>.
              The peak sits at <Tex>{`k = k_0`}</Tex> and its width is
              inversely proportional to <Tex>{`\\sigma`}</Tex>.
            </figcaption>
          </figure>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">
            Ehrenfest&rsquo;s theorem
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Ehrenfest&rsquo;s theorem provides the bridge between quantum
              expectation values and classical trajectories. For any
              potential <Tex>{`V(x)`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\frac{d\\langle x \\rangle}{dt} = \\frac{\\langle p \\rangle}{m}, \\qquad \\frac{d\\langle p \\rangle}{dt} = -\\left\\langle \\frac{\\partial V}{\\partial x} \\right\\rangle`}</Tex>
            </div>

            <p>
              These are structurally identical to Newton&rsquo;s equations, but
              with a subtlety: the force on the right is
              the expectation of the gradient, not the gradient evaluated
              at <Tex>{`\\langle x \\rangle`}</Tex>. For a free particle or a
              harmonic potential, the two coincide and the centroid of the
              wave packet follows the classical path exactly. For anharmonic
              potentials the distinction matters, and quantum corrections
              appear.
            </p>
            <p>
              The <Tex>{`\\langle x \\rangle`}</Tex> and <Tex>{`\\langle p \\rangle`}</Tex> traces
              in the plot above confirm this: for a free particle, the
              position expectation value increases linearly while momentum
              stays constant. When a barrier is present, you can watch the
              momentum kick as the wave packet scatters.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">
            The uncertainty principle
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The Heisenberg uncertainty principle sets a fundamental lower
              bound on the product of position and momentum uncertainties:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\Delta x \\,\\Delta p \\geq \\frac{\\hbar}{2}`}</Tex>
            </div>

            <p>
              A Gaussian wave packet saturates this bound at <Tex>{`t = 0`}</Tex> and
              is therefore a <em>minimum-uncertainty state</em>. As the packet
              propagates freely, <Tex>{`\\Delta x`}</Tex> grows while <Tex>{`\\Delta p`}</Tex> stays
              constant (since there is no force to change the momentum
              distribution). The complementarity is directly visible: narrow
              the width <Tex>{`\\sigma`}</Tex> in the simulation and watch the
              momentum-space distribution broaden, and vice versa.
            </p>
            <p>
              For the harmonic well, the uncertainty product oscillates but
              never drops below <Tex>{`\\hbar/2`}</Tex>. This oscillation
              reflects the periodic exchange between position and momentum
              uncertainty as the wave packet breathes inside the well.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">
            Numerical method
          </h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The simulation uses the split-operator Fourier method. The
              formal solution of the TDSE over a small time
              step <Tex>{`\\Delta t`}</Tex> is
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\psi(x, t+\\Delta t) = e^{-i\\hat{H}\\Delta t}\\,\\psi(x, t)`}</Tex>
            </div>

            <p>
              The Hamiltonian splits into kinetic and potential
              parts, <Tex>{`\\hat{H} = \\hat{T} + \\hat{V}`}</Tex>, which do not
              commute. The symmetric Trotter decomposition gives a
              second-order accurate scheme:
            </p>

            <div className="text-center py-1">
              <Tex display>{`e^{-i\\hat{H}\\Delta t} \\approx e^{-i\\hat{V}\\Delta t/2}\\,e^{-i\\hat{T}\\Delta t}\\,e^{-i\\hat{V}\\Delta t/2} + \\mathcal{O}(\\Delta t^3)`}</Tex>
            </div>

            <p>
              The potential operator is diagonal in position space, so the
              half-steps <Tex>{`e^{-iV\\Delta t/2}`}</Tex> are simple
              pointwise multiplications. The kinetic
              operator <Tex>{`\\hat{T} = -\\frac{1}{2}\\partial_x^2`}</Tex> is
              diagonal in momentum space, so we apply <Tex>{`e^{-ik^2\\Delta t/2}`}</Tex> by
              Fourier-transforming, multiplying, and transforming back. The FFT
              is a Cooley&ndash;Tukey radix-2 implementation running on 1024 grid points.
            </p>
            <p>
              Absorbing boundaries are implemented as a smooth imaginary
              potential at the domain edges, which exponentially damps the wave
              function and prevents unphysical reflections from the numerical
              boundary.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
