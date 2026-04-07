"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

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
// Geometry helpers
// ---------------------------------------------------------------------------

function hypotenuse(a: number, b: number) {
  return Math.sqrt(a * a + b * b);
}

// ---------------------------------------------------------------------------
// Drawing: main triangle + squares canvas
// ---------------------------------------------------------------------------

function drawMainCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: number,
  b: number,
  C: Colors,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  const c = hypotenuse(a, b);
  const scale = Math.min((w - 80) / (a + c + 1.5), (h - 80) / (b + a + 1.5));

  // Triangle origin: bottom-left of the right angle
  const ox = w * 0.35 - (a * scale) / 2;
  const oy = h * 0.55 + (b * scale) / 2;

  // Triangle vertices: right angle at O, leg a along x, leg b along y (upward)
  const Ax = ox;
  const Ay = oy;
  const Bx = ox + a * scale;
  const By = oy;
  const Cx = ox;
  const Cy = oy - b * scale;

  // --- Square on side a (bottom) ---
  ctx.fillStyle = C.position + "4d"; // ~0.3 opacity
  ctx.beginPath();
  ctx.moveTo(Ax, Ay);
  ctx.lineTo(Bx, By);
  ctx.lineTo(Bx, By + a * scale);
  ctx.lineTo(Ax, Ay + a * scale);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.position;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // --- Square on side b (left) ---
  ctx.fillStyle = C.velocity + "4d";
  ctx.beginPath();
  ctx.moveTo(Ax, Ay);
  ctx.lineTo(Cx, Cy);
  ctx.lineTo(Cx - b * scale, Cy);
  ctx.lineTo(Ax - b * scale, Ay);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.velocity;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // --- Square on side c (hypotenuse) ---
  // The hypotenuse goes from B to C. Build the square outward.
  const dx = Cx - Bx;
  const dy = Cy - By;
  // Perpendicular outward (to the right of B->C direction)
  const px = -dy;
  const py = dx;
  const D1x = Bx + px;
  const D1y = By + py;
  const D2x = Cx + px;
  const D2y = Cy + py;

  ctx.fillStyle = C.phase + "4d";
  ctx.beginPath();
  ctx.moveTo(Bx, By);
  ctx.lineTo(D1x, D1y);
  ctx.lineTo(D2x, D2y);
  ctx.lineTo(Cx, Cy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = C.phase;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // --- Triangle ---
  ctx.beginPath();
  ctx.moveTo(Ax, Ay);
  ctx.lineTo(Bx, By);
  ctx.lineTo(Cx, Cy);
  ctx.closePath();
  ctx.strokeStyle = C.fg;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Right-angle marker
  const markSize = 10;
  ctx.beginPath();
  ctx.moveTo(Ax + markSize, Ay);
  ctx.lineTo(Ax + markSize, Ay - markSize);
  ctx.lineTo(Ax, Ay - markSize);
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1;
  ctx.stroke();

  // --- Labels ---
  ctx.font = "italic 14px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // Side a label (bottom)
  ctx.fillStyle = C.position;
  ctx.fillText("a", (Ax + Bx) / 2, Ay + 6);

  // Side b label (left)
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.velocity;
  ctx.textAlign = "right";
  ctx.fillText("b", Ax - 8, (Ay + Cy) / 2);

  // Side c label (hypotenuse)
  ctx.fillStyle = C.phase;
  ctx.textAlign = "left";
  const midHx = (Bx + Cx) / 2;
  const midHy = (By + Cy) / 2;
  ctx.fillText("c", midHx + 8, midHy);

  // Area labels inside squares
  ctx.font = "italic 13px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = C.position;
  ctx.fillText("a\u00B2", (Ax + Bx) / 2, Ay + (a * scale) / 2);

  ctx.fillStyle = C.velocity;
  ctx.fillText("b\u00B2", Ax - (b * scale) / 2, (Ay + Cy) / 2);

  ctx.fillStyle = C.phase;
  ctx.fillText("c\u00B2", (Bx + D1x + D2x + Cx) / 4, (By + D1y + D2y + Cy) / 4);

  // Numeric readout
  ctx.font = "13px Georgia, serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.muted;
  ctx.fillText(
    `a = ${a.toFixed(1)}   b = ${b.toFixed(1)}   c = ${c.toFixed(2)}`,
    12,
    12,
  );
  ctx.fillText(
    `a\u00B2 + b\u00B2 = ${(a * a + b * b).toFixed(2)}   c\u00B2 = ${(c * c).toFixed(2)}`,
    12,
    28,
  );
}

// ---------------------------------------------------------------------------
// Drawing: rearrangement proof canvas
// ---------------------------------------------------------------------------

function drawRearrangementCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: number,
  b: number,
  t: number,
  C: Colors,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  const S = a + b;
  const scale = Math.min((w - 60) / S, (h - 80) / S);
  const ox = (w - S * scale) / 2;
  const oy = (h - S * scale) / 2 - 10;

  const px = (x: number) => ox + x * scale;
  const py = (y: number) => oy + y * scale;

  // -----------------------------------------------------------------
  // Rigid-body triangle interpolation
  //
  // Each triangle is parameterised by:
  //   - RA position (right-angle vertex)
  //   - θ: direction of the "primary" leg from the RA
  //   - L1: primary leg length, L2: secondary leg length
  //   - Secondary leg is 90° CCW from primary (θ − π/2) in screen coords
  //
  // The two arrangements have opposite handedness, so we smoothly
  // swap the leg lengths: L1 goes from a→b and L2 from b→a.
  // This keeps the triangle a perfect right triangle at every t.
  // -----------------------------------------------------------------

  const L1 = a + (b - a) * t;
  const L2 = b + (a - b) * t;

  const PI = Math.PI;
  const pairs = [
    { // Pair 0: pivot at (S,0), no rotation — just leg-swap
      rx0: S, ry0: 0, rx1: S, ry1: 0,
      t0: PI, t1: PI,
    },
    { // Pair 1: slides up along left edge, 90° CCW
      rx0: 0, ry0: S, rx1: 0, ry1: a,
      t0: 0, t1: PI / 2,
    },
    { // Pair 2: diagonal slide, 180° CW
      rx0: 0, ry0: 0, rx1: a, ry1: S,
      t0: PI / 2, t1: -PI / 2,
    },
    { // Pair 3: diagonal slide, 90° CCW
      rx0: S, ry0: S, rx1: a, ry1: a,
      t0: 3 * PI / 2, t1: 2 * PI,
    },
  ];

  // --- Highlight uncovered areas --------------------------------

  // c² inner rotated square (fades out)
  if (t < 0.85) {
    const alpha = (1 - t / 0.85) * 0.25;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.phase;
    ctx.beginPath();
    ctx.moveTo(px(b), py(0));
    ctx.lineTo(px(S), py(b));
    ctx.lineTo(px(a), py(S));
    ctx.lineTo(px(0), py(a));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // a² and b² squares (fade in)
  if (t > 0.15) {
    const alpha = ((t - 0.15) / 0.85) * 0.25;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.position;
    ctx.fillRect(px(0), py(0), a * scale, a * scale);
    ctx.fillStyle = C.velocity;
    ctx.fillRect(px(a), py(a), b * scale, b * scale);
    ctx.globalAlpha = 1;
  }

  // --- Draw the four rigid triangles, clipped to the square ------

  ctx.save();
  ctx.beginPath();
  ctx.rect(ox - 1, oy - 1, S * scale + 2, S * scale + 2);
  ctx.clip();

  pairs.forEach((p) => {
    const rx = p.rx0 + (p.rx1 - p.rx0) * t;
    const ry = p.ry0 + (p.ry1 - p.ry0) * t;
    const theta = p.t0 + (p.t1 - p.t0) * t;

    const v0x = px(rx);
    const v0y = py(ry);
    const v1x = px(rx + L1 * Math.cos(theta));
    const v1y = py(ry + L1 * Math.sin(theta));
    const v2x = px(rx + L2 * Math.cos(theta - PI / 2));
    const v2y = py(ry + L2 * Math.sin(theta - PI / 2));

    ctx.beginPath();
    ctx.moveTo(v0x, v0y);
    ctx.lineTo(v1x, v1y);
    ctx.lineTo(v2x, v2y);
    ctx.closePath();
    ctx.fillStyle = C.muted + "55";
    ctx.fill();
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  ctx.restore();

  // --- Big square outline ----------------------------------------
  ctx.strokeStyle = C.fg;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ox, oy, S * scale, S * scale);

  // Dashed a/b dividers (fade in)
  if (t > 0.3) {
    ctx.globalAlpha = ((t - 0.3) / 0.7) * 0.5;
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px(0), py(a));
    ctx.lineTo(px(S), py(a));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(a), py(0));
    ctx.lineTo(px(a), py(S));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // --- Labels ----------------------------------------------------

  ctx.font = "italic 12px Georgia, serif";
  ctx.fillStyle = C.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("a + b", px(S / 2), py(S) + 6);
  ctx.save();
  ctx.translate(px(0) - 10, py(S / 2));
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("a + b", 0, 0);
  ctx.restore();

  ctx.font = "italic 15px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (t < 0.35) {
    ctx.fillStyle = C.phase;
    ctx.fillText("c\u00B2", px(S / 2), py(S / 2));
  }

  if (t > 0.65) {
    ctx.fillStyle = C.position;
    ctx.fillText("a\u00B2", px(a / 2), py(a / 2));
    ctx.fillStyle = C.velocity;
    ctx.fillText("b\u00B2", px(a + b / 2), py(a + b / 2));
  }

  // Equation below
  ctx.font = "13px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = C.fg;
  const eqY = py(S) + 24;

  if (t < 0.25) {
    ctx.fillText("(a + b)\u00B2 = c\u00B2 + 4 \u00B7 \u00BDab  =  c\u00B2 + 2ab", w / 2, eqY);
  } else if (t > 0.75) {
    ctx.fillText("(a + b)\u00B2 = a\u00B2 + 2ab + b\u00B2", w / 2, eqY);
  } else {
    ctx.fillText("c\u00B2 + 2ab  =  a\u00B2 + 2ab + b\u00B2   \u27F9   c\u00B2 = a\u00B2 + b\u00B2", w / 2, eqY);
  }
}

// ---------------------------------------------------------------------------
// Drawing: bar chart canvas
// ---------------------------------------------------------------------------

function drawBarChart(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  a: number,
  b: number,
  C: Colors,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);

  const c = hypotenuse(a, b);
  const a2 = a * a;
  const b2 = b * b;
  const c2 = c * c;
  const maxVal = c2;

  const pad = { top: 30, bottom: 40, left: 60, right: 30 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  // Y axis
  ctx.strokeStyle = C.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  // Grid lines
  const nTicks = 5;
  ctx.font = "11px Georgia, serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.muted;
  for (let i = 0; i <= nTicks; i++) {
    const val = (maxVal * i) / nTicks;
    const y = pad.top + plotH - (plotH * i) / nTicks;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = C.muted;
    ctx.fillText(val.toFixed(1), pad.left - 8, y);
  }

  // Bars
  const barW = plotW / 5;
  const barGap = barW * 0.3;
  const bars = [
    { label: "a\u00B2", val: a2, color: C.position },
    { label: "b\u00B2", val: b2, color: C.velocity },
    { label: "a\u00B2 + b\u00B2", val: a2 + b2, color: C.total },
    { label: "c\u00B2", val: c2, color: C.phase },
  ];

  const totalBarsW = bars.length * barW + (bars.length - 1) * barGap;
  const startX = pad.left + (plotW - totalBarsW) / 2;

  bars.forEach((bar, i) => {
    const x = startX + i * (barW + barGap);
    const barH = (bar.val / maxVal) * plotH;
    const y = pad.top + plotH - barH;

    ctx.fillStyle = bar.color + "4d";
    ctx.fillRect(x, y, barW, barH);
    ctx.strokeStyle = bar.color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, barW, barH);

    // Value on top
    ctx.font = "11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = bar.color;
    ctx.fillText(bar.val.toFixed(2), x + barW / 2, y - 4);

    // Label below
    ctx.font = "italic 13px Georgia, serif";
    ctx.textBaseline = "top";
    ctx.fillStyle = bar.color;
    ctx.fillText(bar.label, x + barW / 2, pad.top + plotH + 8);
  });

  // Bracket showing a^2 + b^2 = c^2
  const eq3x = startX + 2 * (barW + barGap) + barW / 2;
  const eq4x = startX + 3 * (barW + barGap) + barW / 2;
  const eqY = pad.top + plotH - ((a2 + b2) / maxVal) * plotH - 16;
  ctx.strokeStyle = C.fg + "60";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(eq3x, eqY);
  ctx.lineTo(eq4x, eqY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "italic 11px Georgia, serif";
  ctx.fillStyle = C.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("=", (eq3x + eq4x) / 2, eqY - 1);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PythagoreanTheoremPage() {
  const { theme, toggle } = useTheme();
  const [sideA, setSideA] = useState(3);
  const [sideB, setSideB] = useState(4);
  const [proofT, setProofT] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const proofCanvasRef = useRef<HTMLCanvasElement>(null);
  const barCanvasRef = useRef<HTMLCanvasElement>(null);

  const rafRef = useRef<number>(0);
  const colorsRef = useRef<Colors | null>(null);
  const paramsRef = useRef({ sideA, sideB, proofT });

  useEffect(() => {
    paramsRef.current = { sideA, sideB, proofT };
  }, [sideA, sideB, proofT]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      colorsRef.current = getColors();
    }, 50);
    return () => clearTimeout(timeout);
  }, [theme]);

  // --- Animation loop ---
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const proofCanvas = proofCanvasRef.current;
    const barCanvas = barCanvasRef.current;
    if (!mainCanvas || !proofCanvas || !barCanvas) return;

    const mainCtx = mainCanvas.getContext("2d")!;
    const proofCtx = proofCanvas.getContext("2d")!;
    const barCtx = barCanvas.getContext("2d")!;

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
      resizeCanvas(proofCanvas!);
      resizeCanvas(barCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    function draw() {
      if (!colorsRef.current) {
        colorsRef.current = getColors();
      }
      const C = colorsRef.current;
      const { sideA: a, sideB: b, proofT: t } = paramsRef.current;

      const mw = mainCanvas!.getBoundingClientRect().width;
      const mh = mainCanvas!.getBoundingClientRect().height;
      drawMainCanvas(mainCtx, mw, mh, a, b, C);

      const pw = proofCanvas!.getBoundingClientRect().width;
      const ph = proofCanvas!.getBoundingClientRect().height;
      drawRearrangementCanvas(proofCtx, pw, ph, a, b, t, C);

      const bw = barCanvas!.getBoundingClientRect().width;
      const bh = barCanvas!.getBoundingClientRect().height;
      drawBarChart(barCtx, bw, bh, a, b, C);

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideA, sideB, proofT]);

  const c = hypotenuse(sideA, sideB);

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
            <span style={{ color: "var(--foreground)" }}>Pythagorean Theorem</span>
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
            A Visual Proof of the Pythagorean Theorem
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            An interactive exploration of the most famous result in geometry: for any right triangle
            with legs <Tex>{"a"}</Tex> and <Tex>{"b"}</Tex> and hypotenuse <Tex>{"c"}</Tex>,
            the sum of the squares on the legs equals the square on the hypotenuse.
            Drag the sliders to reshape the triangle and watch the proof rearrange itself.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Main canvas + controls -- sticky, collapsible */}
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
                Pythagorean theorem &mdash; a = {sideA.toFixed(1)}, b = {sideB.toFixed(1)}, c = {c.toFixed(2)}
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
                style={{ height: 340, background: "var(--canvas-bg)" }}
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
              <SliderControl label="Side a" symbol="a" unit="" min={1} max={5} step={0.1} value={sideA} onChange={setSideA} />
              <SliderControl label="Side b" symbol="b" unit="" min={1} max={5} step={0.1} value={sideB} onChange={setSideB} />
              <SliderControl label="Rearrange" symbol="t" unit="" min={0} max={1} step={0.01} value={proofT} onChange={setProofT} displayValue={(v) => `${(v * 100).toFixed(0)}%`} />
            </div>
          </div>
        </div>

        {/* Rearrangement proof canvas */}
        <figure className="mt-16">
          <canvas
            ref={proofCanvasRef}
            className="w-full rounded border"
            style={{ height: 360, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Drag the rearrange slider to slide the four triangles within the <Tex>{"(a+b)^2"}</Tex> square.
            At <Tex>{"t=0"}</Tex> the uncovered area is <Tex>{"c^2"}</Tex>; at <Tex>{"t=1"}</Tex> it
            becomes <Tex>{"a^2 + b^2"}</Tex>. Same square, same triangles &mdash;
            so <Tex>{"c^2 = a^2 + b^2"}</Tex>.
          </figcaption>
        </figure>

        {/* Bar chart canvas */}
        <figure className="mt-8">
          <canvas
            ref={barCanvasRef}
            className="w-full rounded border"
            style={{ height: 200, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Area comparison: <Tex>{"a^2 + b^2 = c^2"}</Tex> verified numerically for the current
            values <Tex>{`a = ${sideA.toFixed(1)}`}</Tex>, <Tex>{`b = ${sideB.toFixed(1)}`}</Tex>.
          </figcaption>
        </figure>

        {/* --- Text sections --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          <h2 className="text-2xl font-semibold tracking-tight mb-5">The theorem</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The Pythagorean theorem states that for any right triangle with
              legs <Tex>{"a"}</Tex> and <Tex>{"b"}</Tex> and hypotenuse <Tex>{"c"}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{"a^2 + b^2 = c^2"}</Tex>
            </div>

            <p>
              This is arguably the most famous theorem in all of mathematics.
              It appears on Babylonian clay tablets dating to around 1800 BCE,
              and the earliest known general proof is attributed to the Greek
              mathematician Pythagoras (c. 570&ndash;495 BCE), though the
              result was almost certainly known to earlier civilisations including
              the Babylonians, Indians, and Chinese.
            </p>

            <p>
              Over the centuries, hundreds of distinct proofs have been discovered &mdash;
              Elisha Scott Loomis catalogued 367 of them in his 1927
              book <em>The Pythagorean Proposition</em>. The visual rearrangement
              proof shown above is among the most elegant: it requires no algebra at
              all, only the observation that area is preserved when shapes are moved
              without overlap.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Proof by rearrangement</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Consider two squares, each with side length <Tex>{"(a + b)"}</Tex>.
              Both have the same total area:
            </p>

            <div className="text-center py-1">
              <Tex display>{"(a + b)^2"}</Tex>
            </div>

            <p>
              Inside each square, arrange four copies of the right triangle with
              legs <Tex>{"a"}</Tex> and <Tex>{"b"}</Tex>. The four triangles together have
              area:
            </p>

            <div className="text-center py-1">
              <Tex display>{"4 \\cdot \\tfrac{1}{2}ab = 2ab"}</Tex>
            </div>

            <p>
              In the <strong>left arrangement</strong>, the four triangles are placed
              with their hypotenuses forming a tilted square in the centre. The
              uncovered region is a square of side <Tex>{"c"}</Tex>, with
              area <Tex>{"c^2"}</Tex>.
            </p>

            <p>
              In the <strong>right arrangement</strong>, the four triangles are
              rearranged so that the uncovered region consists of two
              squares: one of side <Tex>{"a"}</Tex> (area <Tex>{"a^2"}</Tex>)
              and one of side <Tex>{"b"}</Tex> (area <Tex>{"b^2"}</Tex>).
            </p>

            <p>
              Since both large squares have the same area, and both contain the same
              four triangles, the remaining uncovered areas must be equal:
            </p>

            <div className="text-center py-1">
              <Tex display>{"c^2 = a^2 + b^2"}</Tex>
            </div>

            <p>
              This completes the proof. No computation was needed &mdash; only the
              principle that rearranging pieces within a fixed boundary does not
              change the total covered area.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Algebraic verification</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              We can also verify the identity algebraically. Expand the area of
              the big square in two ways. First, using the left arrangement:
            </p>

            <div className="text-center py-1">
              <Tex display>{"(a + b)^2 = c^2 + 4 \\cdot \\tfrac{1}{2}ab = c^2 + 2ab"}</Tex>
            </div>

            <p>
              Second, using the right arrangement (or simply expanding the binomial):
            </p>

            <div className="text-center py-1">
              <Tex display>{"(a + b)^2 = a^2 + 2ab + b^2"}</Tex>
            </div>

            <p>
              Setting these equal:
            </p>

            <div className="text-center py-1">
              <Tex display>{"c^2 + 2ab = a^2 + 2ab + b^2"}</Tex>
            </div>

            <p>
              Subtracting <Tex>{"2ab"}</Tex> from both sides:
            </p>

            <div className="text-center py-1">
              <Tex display>{"c^2 = a^2 + b^2"}</Tex>
            </div>

            <p>
              The algebraic route is essentially a formalisation of the visual
              argument. Both approaches confirm the same fundamental identity that
              links the geometry of right triangles to the arithmetic of squares.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            <InfoCard
              title="Current triangle"
              equation={`a = ${sideA.toFixed(1)},\\; b = ${sideB.toFixed(1)},\\; c = ${c.toFixed(2)}`}
              description="The hypotenuse is computed as"
              extra={`c = \\sqrt{${sideA.toFixed(1)}^2 + ${sideB.toFixed(1)}^2} = ${c.toFixed(3)}`}
              borderColor="var(--phase-color)"
            />
            <InfoCard
              title="Area identity"
              equation={`${(sideA * sideA).toFixed(2)} + ${(sideB * sideB).toFixed(2)} = ${(c * c).toFixed(2)}`}
              description="The sum of the squares on the legs equals the square on the hypotenuse, as guaranteed by the theorem."
              borderColor="var(--total-color)"
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Pythagorean triples</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A <em>Pythagorean triple</em> is a set of three positive
              integers <Tex>{"(a, b, c)"}</Tex> satisfying <Tex>{"a^2 + b^2 = c^2"}</Tex>.
              The most familiar example is <Tex>{"(3, 4, 5)"}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{"3^2 + 4^2 = 9 + 16 = 25 = 5^2"}</Tex>
            </div>

            <p>
              Every Pythagorean triple can be generated by the parametrisation:
            </p>

            <div className="text-center py-1">
              <Tex display>{"a = m^2 - n^2, \\quad b = 2mn, \\quad c = m^2 + n^2"}</Tex>
            </div>

            <p>
              where <Tex>{"m > n > 0"}</Tex> are coprime integers of opposite parity.
              This formula, known since antiquity, generates all <em>primitive</em> triples
              (those where <Tex>{"\\gcd(a, b, c) = 1"}</Tex>). Non-primitive triples are
              simply integer multiples of primitive ones.
            </p>

            <p>
              Try setting the sliders to <Tex>{"a = 3, b = 4"}</Tex> and
              observe that <Tex>{"c = 5"}</Tex> exactly. Other small triples
              include <Tex>{"(5, 12, 13)"}</Tex>, <Tex>{"(8, 15, 17)"}</Tex>,
              and <Tex>{"(7, 24, 25)"}</Tex>.
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
          {unit && <span style={{ color: "var(--muted-2)" }}>{unit}</span>}
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
