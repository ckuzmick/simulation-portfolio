"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

interface ProjectileState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  landed: boolean;
}

type Mode = "ideal" | "with drag";

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
// Arrow drawing helper
// ---------------------------------------------------------------------------

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

const HISTORY_LEN = 800;
const DT = 1 / 120;
const STEPS_PER_FRAME = 2;
const TRAIL_MAX = 2000;
const DRAG_COEFF = 0.47; // sphere drag coefficient
const AIR_DENSITY = 1.225; // kg/m^3
const BALL_RADIUS = 0.05; // m
const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;

// ---------------------------------------------------------------------------
// Physics: analytical solutions for ideal case
// ---------------------------------------------------------------------------

function idealTrajectory(v0: number, angleDeg: number, g: number) {
  const theta = (angleDeg * Math.PI) / 180;
  const vx0 = v0 * Math.cos(theta);
  const vy0 = v0 * Math.sin(theta);
  const tFlight = (2 * vy0) / g;
  const range = vx0 * tFlight;
  const maxHeight = (vy0 * vy0) / (2 * g);
  return { vx0, vy0, tFlight, range, maxHeight, theta };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProjectileMotionPage() {
  const { theme, toggle } = useTheme();
  const [angle, setAngle] = useState(45);
  const [v0, setV0] = useState(30);
  const [gravity, setGravity] = useState(9.81);
  const [mode, setMode] = useState<Mode>("ideal");
  const [running, setRunning] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const xCanvasRef = useRef<HTMLCanvasElement>(null);
  const yCanvasRef = useRef<HTMLCanvasElement>(null);

  const stateRef = useRef<ProjectileState>({ x: 0, y: 0, vx: 0, vy: 0, t: 0, landed: false });
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const xHistRef = useRef<{ t: number; val: number }[]>([]);
  const yHistRef = useRef<{ t: number; val: number }[]>([]);
  const rafRef = useRef<number>(0);
  const runningRef = useRef(running);
  const paramsRef = useRef({ angle, v0, gravity, mode });
  const colorsRef = useRef<Colors | null>(null);
  const maxRangeRef = useRef(100);
  const maxHeightRef = useRef(50);
  const statsRef = useRef({ maxHeight: 0, range: 0 });

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { paramsRef.current = { angle, v0, gravity, mode }; }, [angle, v0, gravity, mode]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    const theta = (angle * Math.PI) / 180;
    stateRef.current = {
      x: 0,
      y: 0,
      vx: v0 * Math.cos(theta),
      vy: v0 * Math.sin(theta),
      t: 0,
      landed: false,
    };
    trailRef.current = [{ x: 0, y: 0 }];
    xHistRef.current = [];
    yHistRef.current = [];
    statsRef.current = { maxHeight: 0, range: 0 };

    // Compute scale from ideal trajectory
    const ideal = idealTrajectory(v0, angle, gravity);
    maxRangeRef.current = Math.max(ideal.range * 1.15, 10);
    maxHeightRef.current = Math.max(ideal.maxHeight * 1.3, 5);
  }, [angle, v0, gravity]);

  useEffect(() => { reset(); }, [angle, v0, gravity, mode, reset]);

  // --- Animation loop ---
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const xCanvas = xCanvasRef.current;
    const yCanvas = yCanvasRef.current;
    if (!mainCanvas || !xCanvas || !yCanvas) return;

    const mainCtx = mainCanvas.getContext("2d")!;
    const xCtx = xCanvas.getContext("2d")!;
    const yCtx = yCanvas.getContext("2d")!;

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
      resizeCanvas(xCanvas!);
      resizeCanvas(yCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    function step() {
      const s = stateRef.current;
      if (s.landed) return;

      const { gravity: g, mode: m } = paramsRef.current;

      if (m === "ideal") {
        // Analytical update (Verlet-like for consistency)
        const ax = 0;
        const ay = -g;
        s.x += s.vx * DT + 0.5 * ax * DT * DT;
        s.y += s.vy * DT + 0.5 * ay * DT * DT;
        s.vx += ax * DT;
        s.vy += ay * DT;
      } else {
        // Euler integration with quadratic drag
        const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
        const mass = 0.145; // kg (baseball)
        const dragMag = 0.5 * AIR_DENSITY * DRAG_COEFF * BALL_AREA * speed * speed;
        const ax = speed > 1e-8 ? -(dragMag / mass) * (s.vx / speed) : 0;
        const ay = -g + (speed > 1e-8 ? -(dragMag / mass) * (s.vy / speed) : 0);
        s.vx += ax * DT;
        s.vy += ay * DT;
        s.x += s.vx * DT;
        s.y += s.vy * DT;
      }

      s.t += DT;

      // Track max height
      if (s.y > statsRef.current.maxHeight) {
        statsRef.current.maxHeight = s.y;
      }

      // Ground collision
      if (s.y <= 0 && s.t > DT) {
        s.y = 0;
        s.landed = true;
        statsRef.current.range = s.x;
      }

      trailRef.current.push({ x: s.x, y: s.y });
      if (trailRef.current.length > TRAIL_MAX) trailRef.current.shift();
      xHistRef.current.push({ t: s.t, val: s.x });
      if (xHistRef.current.length > HISTORY_LEN) xHistRef.current.shift();
      yHistRef.current.push({ t: s.t, val: s.y });
      if (yHistRef.current.length > HISTORY_LEN) yHistRef.current.shift();
    }

    function drawMain() {
      const C = colorsRef.current!;
      const c = mainCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      mainCtx.clearRect(0, 0, w, h);

      const margin = { left: 60, right: 30, top: 30, bottom: 40 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      const maxR = maxRangeRef.current;
      const maxH = maxHeightRef.current;

      const toScreenX = (px: number) => margin.left + (px / maxR) * plotW;
      const toScreenY = (py: number) => margin.top + plotH - (py / maxH) * plotH;

      // Ground line
      mainCtx.strokeStyle = C.fg;
      mainCtx.lineWidth = 1.5;
      mainCtx.beginPath();
      mainCtx.moveTo(margin.left, toScreenY(0));
      mainCtx.lineTo(w - margin.right, toScreenY(0));
      mainCtx.stroke();

      // Ground hatching
      const groundY = toScreenY(0);
      mainCtx.save();
      mainCtx.beginPath();
      mainCtx.rect(margin.left, groundY, plotW, margin.bottom);
      mainCtx.clip();
      mainCtx.strokeStyle = C.grid;
      mainCtx.lineWidth = 0.7;
      const hStep = 8;
      for (let i = 0; i < plotW + margin.bottom; i += hStep) {
        mainCtx.beginPath();
        mainCtx.moveTo(margin.left + i, groundY);
        mainCtx.lineTo(margin.left + i - margin.bottom, groundY + margin.bottom);
        mainCtx.stroke();
      }
      mainCtx.restore();

      // Grid lines
      mainCtx.strokeStyle = C.grid;
      mainCtx.lineWidth = 0.5;
      const nGridX = 5;
      const nGridY = 4;
      for (let i = 1; i <= nGridX; i++) {
        const gx = margin.left + (i / nGridX) * plotW;
        mainCtx.beginPath();
        mainCtx.moveTo(gx, margin.top);
        mainCtx.lineTo(gx, toScreenY(0));
        mainCtx.stroke();
        // Label
        mainCtx.fillStyle = C.muted;
        mainCtx.font = "11px Georgia, serif";
        mainCtx.textAlign = "center";
        mainCtx.textBaseline = "top";
        mainCtx.fillText(((i / nGridX) * maxR).toFixed(0) + " m", gx, toScreenY(0) + 4);
      }
      for (let i = 1; i <= nGridY; i++) {
        const gy = toScreenY((i / nGridY) * maxH);
        mainCtx.beginPath();
        mainCtx.moveTo(margin.left, gy);
        mainCtx.lineTo(w - margin.right, gy);
        mainCtx.stroke();
        mainCtx.fillStyle = C.muted;
        mainCtx.font = "11px Georgia, serif";
        mainCtx.textAlign = "right";
        mainCtx.textBaseline = "middle";
        mainCtx.fillText(((i / nGridY) * maxH).toFixed(0) + " m", margin.left - 6, gy);
      }

      // Dotted theoretical parabola (ideal case)
      const { v0: cv0, angle: cAngle, gravity: cg } = paramsRef.current;
      const ideal = idealTrajectory(cv0, cAngle, cg);
      mainCtx.setLineDash([4, 4]);
      mainCtx.strokeStyle = C.muted;
      mainCtx.lineWidth = 1;
      mainCtx.beginPath();
      const nPts = 200;
      for (let i = 0; i <= nPts; i++) {
        const t = (i / nPts) * ideal.tFlight;
        const px = ideal.vx0 * t;
        const py = ideal.vy0 * t - 0.5 * cg * t * t;
        if (py < 0) break;
        const sx = toScreenX(px);
        const sy = toScreenY(py);
        if (i === 0) mainCtx.moveTo(sx, sy);
        else mainCtx.lineTo(sx, sy);
      }
      mainCtx.stroke();
      mainCtx.setLineDash([]);

      // Trail with fading
      const trail = trailRef.current;
      if (trail.length > 1) {
        for (let i = 1; i < trail.length; i++) {
          const alpha = (i / trail.length) * 0.8 + 0.1;
          mainCtx.strokeStyle = C.position;
          mainCtx.globalAlpha = alpha;
          mainCtx.lineWidth = 2;
          mainCtx.beginPath();
          mainCtx.moveTo(toScreenX(trail[i - 1].x), toScreenY(trail[i - 1].y));
          mainCtx.lineTo(toScreenX(trail[i].x), toScreenY(trail[i].y));
          mainCtx.stroke();
        }
        mainCtx.globalAlpha = 1;
      }

      // Launch point
      mainCtx.fillStyle = C.fg;
      mainCtx.beginPath();
      mainCtx.arc(toScreenX(0), toScreenY(0), 4, 0, Math.PI * 2);
      mainCtx.fill();

      // Current projectile position
      const s = stateRef.current;
      const ballSX = toScreenX(s.x);
      const ballSY = toScreenY(Math.max(s.y, 0));
      mainCtx.fillStyle = C.velocity;
      mainCtx.beginPath();
      mainCtx.arc(ballSX, ballSY, 6, 0, Math.PI * 2);
      mainCtx.fill();
      mainCtx.strokeStyle = C.fg;
      mainCtx.lineWidth = 1;
      mainCtx.stroke();

      // Velocity arrow
      const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
      const vScale = 1.5;
      if (speed > 0.5) {
        drawArrow(
          mainCtx,
          ballSX, ballSY,
          ballSX + s.vx * vScale,
          ballSY - s.vy * vScale,
          C.velocity
        );
      }

      // Real-time labels
      mainCtx.fillStyle = C.fg;
      mainCtx.font = "italic 12px Georgia, serif";
      mainCtx.textAlign = "left";
      mainCtx.textBaseline = "top";
      const labelX = margin.left + 6;
      let labelY = margin.top + 4;
      const lineH = 16;

      mainCtx.fillStyle = C.position;
      mainCtx.fillText(`x = ${s.x.toFixed(1)} m`, labelX, labelY); labelY += lineH;
      mainCtx.fillText(`y = ${Math.max(s.y, 0).toFixed(1)} m`, labelX, labelY); labelY += lineH;
      mainCtx.fillStyle = C.velocity;
      mainCtx.fillText(`v = ${speed.toFixed(1)} m/s`, labelX, labelY); labelY += lineH;
      mainCtx.fillStyle = C.muted;
      mainCtx.fillText(`t = ${s.t.toFixed(2)} s`, labelX, labelY); labelY += lineH;
      mainCtx.fillStyle = C.total;
      mainCtx.fillText(`H_max = ${statsRef.current.maxHeight.toFixed(1)} m`, labelX, labelY); labelY += lineH;
      if (s.landed) {
        mainCtx.fillText(`R = ${statsRef.current.range.toFixed(1)} m`, labelX, labelY);
      }
    }

    function drawTimeSeries(
      ctx: CanvasRenderingContext2D,
      canvas: HTMLCanvasElement,
      hist: { t: number; val: number }[],
      label: string,
      color: string,
      maxVal: number
    ) {
      const C = colorsRef.current!;
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      ctx.clearRect(0, 0, w, h);

      if (hist.length < 2) return;

      const margin = { left: 48, right: 12, top: 10, bottom: 20 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Y axis
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(margin.left, margin.top);
      ctx.lineTo(margin.left, h - margin.bottom);
      ctx.stroke();

      // Zero line
      ctx.beginPath();
      ctx.moveTo(margin.left, h - margin.bottom);
      ctx.lineTo(w - margin.right, h - margin.bottom);
      ctx.stroke();

      // Mid line
      const midY = margin.top + plotH / 2;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.moveTo(margin.left, midY);
      ctx.lineTo(w - margin.right, midY);
      ctx.stroke();

      // Label
      ctx.fillStyle = color;
      ctx.font = "italic 13px Georgia, serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(label, margin.left - 8, margin.top + plotH / 2);

      // Time label
      ctx.fillStyle = C.muted;
      ctx.font = "italic 11px Georgia, serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("t \u2192", w - margin.right, h - margin.bottom + 4);

      const scaleY = plotH / Math.max(maxVal, 0.1);

      // Scrolling waveform
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < hist.length; i++) {
        const px = margin.left + (i / HISTORY_LEN) * plotW;
        const py = h - margin.bottom - hist[i].val * scaleY;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    function loop() {
      if (runningRef.current) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) step();
      }
      if (!colorsRef.current) colorsRef.current = getColors();
      drawMain();

      const C = colorsRef.current!;
      drawTimeSeries(xCtx, xCanvas!, xHistRef.current, "x(t)", C.position, maxRangeRef.current);
      drawTimeSeries(yCtx, yCanvas!, yHistRef.current, "y(t)", C.total, maxHeightRef.current);

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v0, angle, gravity, mode]);

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
            <span style={{ color: "var(--foreground)" }}>Projectile Motion</span>
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
            Projectile Motion
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            A classic two-dimensional kinematics problem: launch a projectile at an angle and watch it trace
            a parabolic arc under gravity, with an optional quadratic air-resistance model.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Controls bar */}
        <div className="mt-8 flex items-center justify-between mx-auto" style={{ maxWidth: "65ch" }}>
          <button
            onClick={() => setMode(mode === "ideal" ? "with drag" : "ideal")}
            className="text-sm font-medium px-3 py-1.5 rounded border cursor-pointer"
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              borderColor: mode === "ideal" ? "var(--total-color)" : "var(--velocity-color)",
              color: mode === "ideal" ? "var(--total-color)" : "var(--velocity-color)",
            }}
          >
            {mode}
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

        {/* Main canvas + controls — sticky, collapsible */}
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
                Projectile motion &mdash; {mode}
              </span>
              <span className="text-xs font-medium tracking-wide" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
                show &darr;
              </span>
            </div>
          )}
          {/* Full panel */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <canvas
                ref={mainCanvasRef}
                className="w-full"
                style={{ height: 320, background: "var(--canvas-bg)" }}
              />
              <button
                onClick={() => setCollapsed(true)}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded border cursor-pointer"
                style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--muted)" }}
              >
                hide &uarr;
              </button>
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl label="Launch angle" symbol={"\u03b8"} unit="\u00b0" min={0} max={90} step={1} value={angle} onChange={setAngle} />
              <SliderControl label="Initial velocity" symbol="v\u2080" unit="m/s" min={1} max={80} step={0.5} value={v0} onChange={setV0} />
              <SliderControl label="Gravity" symbol="g" unit="m/s\u00b2" min={0.5} max={25} step={0.1} value={gravity} onChange={setGravity} />
            </div>
          </div>
        </div>

        {/* Time-domain plots */}
        <figure className="mt-16">
          <canvas
            ref={xCanvasRef}
            className="w-full rounded border"
            style={{ height: 160, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Horizontal position <Tex>{"x(t)"}</Tex> as a function of time.
          </figcaption>
        </figure>

        <figure className="mt-8">
          <canvas
            ref={yCanvasRef}
            className="w-full rounded border"
            style={{ height: 160, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Vertical position <Tex>{"y(t)"}</Tex> as a function of time.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          <h2 className="text-2xl font-semibold tracking-tight mb-5">Equations of motion</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A projectile launched with speed <Tex>{"v_0"}</Tex> at angle <Tex>{`\\theta`}</Tex> from
              the horizontal has initial velocity components:
            </p>

            <div className="text-center py-1">
              <Tex display>{`v_{x0} = v_0\\cos\\theta, \\qquad v_{y0} = v_0\\sin\\theta`}</Tex>
            </div>

            <p>
              In the ideal case (no air resistance), the only force is gravity acting
              downward. Newton&rsquo;s second law gives:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\ddot{x} = 0, \\qquad \\ddot{y} = -g`}</Tex>
            </div>

            <p>
              Integrating directly with initial conditions <Tex>{`x(0) = 0, \\; y(0) = 0`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`x(t) = v_0 \\cos\\theta \\; t`}</Tex>
            </div>
            <div className="text-center py-1">
              <Tex display>{`y(t) = v_0 \\sin\\theta \\; t - \\tfrac{1}{2}g\\,t^2`}</Tex>
            </div>

            <p>
              These are the parametric equations of a parabola. The horizontal motion is
              uniform (constant velocity) while the vertical motion is uniformly
              accelerated &mdash; the two are completely independent.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Trajectory equation</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Eliminating time from the parametric equations by
              solving <Tex>{`t = x / (v_0\\cos\\theta)`}</Tex> and substituting:
            </p>

            <div className="text-center py-1">
              <Tex display>{`y(x) = x\\tan\\theta - \\frac{g\\,x^2}{2\\,v_0^{\\,2}\\cos^2\\!\\theta}`}</Tex>
            </div>

            <p>
              This is the equation of a downward-opening parabola. The dotted curve
              overlaid on the simulation canvas shows exactly this analytical trajectory.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Maximum height and range</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The projectile reaches its apex when <Tex>{`\\dot{y} = 0`}</Tex>, i.e.
              at <Tex>{`t^* = v_0\\sin\\theta / g`}</Tex>. Substituting back:
            </p>

            <div className="text-center py-1">
              <Tex display>{`H_{\\max} = \\frac{v_0^{\\,2}\\sin^2\\!\\theta}{2g}`}</Tex>
            </div>

            <p>
              The range <Tex>R</Tex> is found by setting <Tex>{`y = 0`}</Tex> and
              solving for the non-trivial root <Tex>{`t = 2v_0\\sin\\theta / g`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`R = \\frac{v_0^{\\,2}\\sin 2\\theta}{g}`}</Tex>
            </div>

            <p>
              The range is maximised when <Tex>{`\\theta = 45^\\circ`}</Tex>, giving <Tex>{`R_{\\max} = v_0^{\\,2}/g`}</Tex>.
              This is a well-known result: complementary angles (e.g. 30&deg; and 60&deg;)
              give equal range but different maximum heights and flight times.
            </p>
          </div>

          {/* Complementary angle cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            <InfoCard
              title="Maximum range"
              equation={`R_{\\max} = \\frac{v_0^{\\,2}}{g}`}
              description="Achieved at 45 degrees. For the current parameters:"
              extra={`R_{\\max} = ${(v0 * v0 / gravity).toFixed(1)}\\text{ m}`}
              borderColor="var(--position-color)"
            />
            <InfoCard
              title="Maximum height"
              equation={`H_{\\max} = \\frac{v_0^{\\,2}}{2g}`}
              description="Achieved at 90 degrees (straight up). For the current parameters:"
              extra={`H_{\\max} = ${(v0 * v0 / (2 * gravity)).toFixed(1)}\\text{ m}`}
              borderColor="var(--total-color)"
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Air resistance</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Real projectiles experience aerodynamic drag. At moderate speeds the
              dominant contribution is quadratic (turbulent) drag:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\mathbf{F}_{\\text{drag}} = -\\tfrac{1}{2}\\,\\rho\\,C_D\\,A\\,|\\mathbf{v}|\\,\\mathbf{v}`}</Tex>
            </div>

            <p>
              where <Tex>{`\\rho`}</Tex> is the air density, <Tex>{`C_D`}</Tex> the
              drag coefficient (0.47 for a sphere), and <Tex>A</Tex> the cross-sectional
              area. The equations of motion become:
            </p>

            <div className="text-center py-1">
              <Tex display>{`m\\,\\ddot{x} = -\\tfrac{1}{2}\\rho\\,C_D A\\,|\\mathbf{v}|\\,\\dot{x}`}</Tex>
            </div>
            <div className="text-center py-1">
              <Tex display>{`m\\,\\ddot{y} = -mg - \\tfrac{1}{2}\\rho\\,C_D A\\,|\\mathbf{v}|\\,\\dot{y}`}</Tex>
            </div>

            <p>
              Because drag depends on <Tex>{`|\\mathbf{v}| = \\sqrt{\\dot{x}^2 + \\dot{y}^2}`}</Tex>,
              the horizontal and vertical motions are now <em>coupled</em> and there is no
              closed-form solution. The simulation uses forward Euler integration to step
              through these equations numerically.
            </p>

            <p>
              The effect of drag is dramatic: range and maximum height both decrease
              significantly, the trajectory is no longer symmetric, and the descent
              is steeper than the ascent. Toggle between &ldquo;ideal&rdquo; and
              &ldquo;with drag&rdquo; in the simulation to compare.
            </p>

            <p>
              Defining the drag parameter <Tex>{`\\beta = \\rho\\,C_D\\,A / (2m)`}</Tex>,
              the equations simplify to:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\ddot{x} = -\\beta\\,|\\mathbf{v}|\\,\\dot{x}, \\qquad \\ddot{y} = -g -\\beta\\,|\\mathbf{v}|\\,\\dot{y}`}</Tex>
            </div>

            <p>
              For low speeds where <Tex>{`\\beta |\\mathbf{v}| \\ll g/v_0`}</Tex>, drag
              is negligible and the ideal parabola is recovered. For high speeds the
              trajectory is markedly shortened and asymmetric.
            </p>
          </div>

        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Info card
// ---------------------------------------------------------------------------

function InfoCard({
  title, equation, description, extra, borderColor,
}: {
  title: string;
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
