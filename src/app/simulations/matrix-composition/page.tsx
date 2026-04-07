"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Mat2 = [number, number, number, number]; // [a11, a12, a21, a22]

function matMul(a: Mat2, b: Mat2): Mat2 {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
  ];
}

function det(m: Mat2): number {
  return m[0] * m[3] - m[1] * m[2];
}

function lerpMat(a: Mat2, b: Mat2, t: number): Mat2 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

const IDENTITY: Mat2 = [1, 0, 0, 1];

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
// Canvas grid drawing helpers
// ---------------------------------------------------------------------------

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  ox: number, oy: number,
  scale: number,
  C: Colors,
) {
  const gridRange = 6;

  // Grid lines
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 0.5;
  for (let i = -gridRange; i <= gridRange; i++) {
    if (i === 0) continue;
    const px = ox + i * scale;
    const py = oy - i * scale;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();
  }

  // Axes
  ctx.strokeStyle = C.fg;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(w, oy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, h);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = C.muted;
  ctx.font = "italic 11px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = -gridRange; i <= gridRange; i++) {
    if (i === 0) continue;
    const px = ox + i * scale;
    ctx.fillText(String(i), px, oy + 4);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = -gridRange; i <= gridRange; i++) {
    if (i === 0) continue;
    const py = oy - i * scale;
    ctx.fillText(String(i), ox - 6, py);
  }
}

function drawTransformedGrid(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  ox: number, oy: number,
  scale: number,
  mat: Mat2,
  color: string,
  lineWidth: number,
) {
  const gridRange = 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 0.3;

  // Transformed vertical lines (x = const)
  for (let i = -gridRange; i <= gridRange; i++) {
    ctx.beginPath();
    for (let j = -gridRange; j <= gridRange; j++) {
      const tx = mat[0] * i + mat[1] * j;
      const ty = mat[2] * i + mat[3] * j;
      const px = ox + tx * scale;
      const py = oy - ty * scale;
      if (j === -gridRange) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // Transformed horizontal lines (y = const)
  for (let j = -gridRange; j <= gridRange; j++) {
    ctx.beginPath();
    for (let i = -gridRange; i <= gridRange; i++) {
      const tx = mat[0] * i + mat[1] * j;
      const ty = mat[2] * i + mat[3] * j;
      const px = ox + tx * scale;
      const py = oy - ty * scale;
      if (i === -gridRange) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

function drawParallelogram(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  scale: number,
  mat: Mat2,
  fillColor: string,
  strokeColor: string,
) {
  // Vertices: origin, col1, col1+col2, col2
  const points = [
    [0, 0],
    [mat[0], mat[2]],
    [mat[0] + mat[1], mat[2] + mat[3]],
    [mat[1], mat[3]],
  ];

  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const px = ox + points[i][0] * scale;
    const py = oy - points[i][1] * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();

  ctx.globalAlpha = 0.15;
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface Preset {
  label: string;
  mat: Mat2;
}

const PRESETS_A: Preset[] = [
  { label: "Identity", mat: [1, 0, 0, 1] },
  { label: "Rot 45\u00b0", mat: [Math.cos(Math.PI / 4), -Math.sin(Math.PI / 4), Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)] },
  { label: "Reflect x", mat: [1, 0, 0, -1] },
  { label: "Shear", mat: [1, 1, 0, 1] },
  { label: "Scale 2\u00d7", mat: [2, 0, 0, 2] },
];

const PRESETS_B: Preset[] = [
  { label: "Identity", mat: [1, 0, 0, 1] },
  { label: "Rot 90\u00b0", mat: [0, -1, 1, 0] },
  { label: "Reflect y", mat: [-1, 0, 0, 1] },
  { label: "Shear", mat: [1, 0, 1, 1] },
  { label: "Scale 0.5\u00d7", mat: [0.5, 0, 0, 0.5] },
];

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function MatrixCompositionPage() {
  const { theme, toggle } = useTheme();

  // Matrix A entries
  const [a11, setA11] = useState(1);
  const [a12, setA12] = useState(0);
  const [a21, setA21] = useState(0);
  const [a22, setA22] = useState(1);

  // Matrix B entries
  const [b11, setB11] = useState(1);
  const [b12, setB12] = useState(0);
  const [b21, setB21] = useState(0);
  const [b22, setB22] = useState(1);

  const [collapsed, setCollapsed] = useState(false);
  const [animT, setAnimT] = useState(0);
  const [animating, setAnimating] = useState(false);

  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const compCanvasRef = useRef<HTMLCanvasElement>(null);
  const detCanvasRef = useRef<HTMLCanvasElement>(null);

  const colorsRef = useRef<Colors | null>(null);
  const rafRef = useRef<number>(0);
  const animTRef = useRef(0);
  const animatingRef = useRef(false);

  // Keep refs in sync
  const matA: Mat2 = [a11, a12, a21, a22];
  const matB: Mat2 = [b11, b12, b21, b22];
  const matBA = matMul(matB, matA);

  const matARef = useRef(matA);
  const matBRef = useRef(matB);
  matARef.current = matA;
  matBRef.current = matB;

  const applyPresetA = useCallback((p: Preset) => {
    setA11(parseFloat(p.mat[0].toFixed(2)));
    setA12(parseFloat(p.mat[1].toFixed(2)));
    setA21(parseFloat(p.mat[2].toFixed(2)));
    setA22(parseFloat(p.mat[3].toFixed(2)));
  }, []);

  const applyPresetB = useCallback((p: Preset) => {
    setB11(parseFloat(p.mat[0].toFixed(2)));
    setB12(parseFloat(p.mat[1].toFixed(2)));
    setB21(parseFloat(p.mat[2].toFixed(2)));
    setB22(parseFloat(p.mat[3].toFixed(2)));
  }, []);

  const startAnimation = useCallback(() => {
    animTRef.current = 0;
    setAnimT(0);
    animatingRef.current = true;
    setAnimating(true);
  }, []);

  // Invalidate colors on theme change
  useEffect(() => {
    colorsRef.current = null;
  }, [theme]);

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    const compCanvas = compCanvasRef.current;
    const detCanvas = detCanvasRef.current;
    if (!mainCanvas || !compCanvas || !detCanvas) return;

    const mainCtx = mainCanvas.getContext("2d")!;
    const compCtx = compCanvas.getContext("2d")!;
    const detCtx = detCanvas.getContext("2d")!;

    function resize(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizeAll() {
      resize(mainCanvas!, mainCtx);
      resize(compCanvas!, compCtx);
      resize(detCanvas!, detCtx);
      colorsRef.current = getColors();
    }

    window.addEventListener("resize", resizeAll);
    resizeAll();

    // --- Main canvas: single transformation ---
    function drawMain() {
      if (!colorsRef.current) colorsRef.current = getColors();
      const C = colorsRef.current;
      const w = mainCanvas!.getBoundingClientRect().width;
      const h = mainCanvas!.getBoundingClientRect().height;
      const ox = w / 2;
      const oy = h / 2;
      const scale = Math.min(w, h) / 8;

      mainCtx.clearRect(0, 0, w, h);
      mainCtx.fillStyle = C.bg;
      mainCtx.fillRect(0, 0, w, h);

      // Background grid
      drawGrid(mainCtx, w, h, ox, oy, scale, C);

      const A = matARef.current;

      // Transformed grid lines
      drawTransformedGrid(mainCtx, w, h, ox, oy, scale, A, C.position, 0.8);

      // Original unit square (identity)
      drawParallelogram(mainCtx, ox, oy, scale, IDENTITY, C.muted, C.muted);

      // Transformed parallelogram
      drawParallelogram(mainCtx, ox, oy, scale, A, C.position, C.position);

      // Original basis vectors (faint)
      drawArrow(mainCtx, ox, oy, ox + scale, oy, C.muted, "\u00ea\u2081");
      drawArrow(mainCtx, ox, oy, ox, oy - scale, C.muted, "\u00ea\u2082");

      // Transformed basis vectors
      const e1x = ox + A[0] * scale;
      const e1y = oy - A[2] * scale;
      const e2x = ox + A[1] * scale;
      const e2y = oy - A[3] * scale;
      drawArrow(mainCtx, ox, oy, e1x, e1y, C.position, "A\u00ea\u2081");
      drawArrow(mainCtx, ox, oy, e2x, e2y, C.velocity, "A\u00ea\u2082");

      // Matrix display
      mainCtx.fillStyle = C.fg;
      mainCtx.font = "italic 13px Georgia, serif";
      mainCtx.textAlign = "left";
      mainCtx.textBaseline = "top";
      mainCtx.fillText(`A = [${A[0].toFixed(1)}, ${A[1].toFixed(1)}; ${A[2].toFixed(1)}, ${A[3].toFixed(1)}]`, 10, 10);
      mainCtx.fillText(`det(A) = ${det(A).toFixed(2)}`, 10, 28);
    }

    // --- Composition canvas ---
    function drawComposition() {
      if (!colorsRef.current) colorsRef.current = getColors();
      const C = colorsRef.current;
      const w = compCanvas!.getBoundingClientRect().width;
      const h = compCanvas!.getBoundingClientRect().height;

      compCtx.clearRect(0, 0, w, h);
      compCtx.fillStyle = C.bg;
      compCtx.fillRect(0, 0, w, h);

      const panelW = w / 3;
      const A = matARef.current;
      const B = matBRef.current;
      const BA = matMul(B, A);
      const t = animTRef.current;

      const labels = ["Identity", "After A", "After BA"];
      const matrices: Mat2[] = [IDENTITY, A, BA];
      const basisColors = [C.muted, C.position, C.phase];

      for (let p = 0; p < 3; p++) {
        const ox = panelW * p + panelW / 2;
        const oy = h / 2;
        const scale = Math.min(panelW, h) / 8;

        // Clipping region for this panel
        compCtx.save();
        compCtx.beginPath();
        compCtx.rect(panelW * p, 0, panelW, h);
        compCtx.clip();

        // Determine interpolated matrix based on animation parameter t
        let currentMat: Mat2;
        if (animatingRef.current) {
          if (t <= 1) {
            // Interpolate identity -> A
            if (p === 0) currentMat = IDENTITY;
            else if (p === 1) currentMat = lerpMat(IDENTITY, A, t);
            else currentMat = lerpMat(IDENTITY, A, t);
          } else {
            // Interpolate A -> BA
            const t2 = t - 1;
            if (p === 0) currentMat = IDENTITY;
            else if (p === 1) currentMat = A;
            else currentMat = lerpMat(A, BA, t2);
          }
        } else {
          currentMat = matrices[p];
        }

        // Grid
        drawGrid(compCtx, panelW, h, ox, oy, scale, C);

        // Transformed grid
        drawTransformedGrid(compCtx, panelW, h, ox, oy, scale, currentMat, basisColors[p], 0.6);

        // Parallelogram
        drawParallelogram(compCtx, ox, oy, scale, currentMat, basisColors[p], basisColors[p]);

        // Basis vectors
        const e1x = ox + currentMat[0] * scale;
        const e1y = oy - currentMat[2] * scale;
        const e2x = ox + currentMat[1] * scale;
        const e2y = oy - currentMat[3] * scale;
        drawArrow(compCtx, ox, oy, e1x, e1y, basisColors[p]);
        drawArrow(compCtx, ox, oy, e2x, e2y, basisColors[p]);

        // Label
        compCtx.fillStyle = C.fg;
        compCtx.font = "italic 13px Georgia, serif";
        compCtx.textAlign = "center";
        compCtx.textBaseline = "top";
        compCtx.fillText(labels[p], ox, 8);

        compCtx.restore();

        // Panel dividers
        if (p > 0) {
          compCtx.strokeStyle = C.grid;
          compCtx.lineWidth = 1;
          compCtx.beginPath();
          compCtx.moveTo(panelW * p, 0);
          compCtx.lineTo(panelW * p, h);
          compCtx.stroke();
        }
      }

      // Bottom info
      compCtx.fillStyle = C.muted;
      compCtx.font = "italic 11px Georgia, serif";
      compCtx.textAlign = "left";
      compCtx.textBaseline = "bottom";
      compCtx.fillText(`B = [${B[0].toFixed(1)}, ${B[1].toFixed(1)}; ${B[2].toFixed(1)}, ${B[3].toFixed(1)}]`, 8, h - 6);
      compCtx.fillText(`BA = [${BA[0].toFixed(1)}, ${BA[1].toFixed(1)}; ${BA[2].toFixed(1)}, ${BA[3].toFixed(1)}]`, panelW * 2 + 8, h - 6);
    }

    // --- Determinant canvas ---
    function drawDeterminant() {
      if (!colorsRef.current) colorsRef.current = getColors();
      const C = colorsRef.current;
      const w = detCanvas!.getBoundingClientRect().width;
      const h = detCanvas!.getBoundingClientRect().height;
      const ox = w / 2;
      const oy = h / 2;
      const scale = Math.min(w, h) / 8;

      detCtx.clearRect(0, 0, w, h);
      detCtx.fillStyle = C.bg;
      detCtx.fillRect(0, 0, w, h);

      drawGrid(detCtx, w, h, ox, oy, scale, C);

      const A = matARef.current;
      const d = det(A);

      // Original unit square
      drawParallelogram(detCtx, ox, oy, scale, IDENTITY, C.muted, C.muted);

      // Transformed parallelogram with color based on determinant sign
      const fillCol = d >= 0 ? C.total : C.velocity;
      const strokeCol = d >= 0 ? C.total : C.velocity;

      // Draw filled parallelogram
      const points = [
        [0, 0],
        [A[0], A[2]],
        [A[0] + A[1], A[2] + A[3]],
        [A[1], A[3]],
      ];

      detCtx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const px = ox + points[i][0] * scale;
        const py = oy - points[i][1] * scale;
        if (i === 0) detCtx.moveTo(px, py);
        else detCtx.lineTo(px, py);
      }
      detCtx.closePath();
      detCtx.globalAlpha = 0.25;
      detCtx.fillStyle = fillCol;
      detCtx.fill();
      detCtx.globalAlpha = 1;
      detCtx.strokeStyle = strokeCol;
      detCtx.lineWidth = 1.5;
      detCtx.stroke();

      // Basis vectors
      const e1x = ox + A[0] * scale;
      const e1y = oy - A[2] * scale;
      const e2x = ox + A[1] * scale;
      const e2y = oy - A[3] * scale;
      drawArrow(detCtx, ox, oy, e1x, e1y, C.position);
      drawArrow(detCtx, ox, oy, e2x, e2y, C.velocity);

      // Determinant label
      detCtx.fillStyle = fillCol;
      detCtx.font = "bold 14px Georgia, serif";
      detCtx.textAlign = "left";
      detCtx.textBaseline = "top";
      detCtx.fillText(`det(A) = ${d.toFixed(2)}`, 10, 10);

      detCtx.font = "italic 12px Georgia, serif";
      detCtx.fillStyle = C.muted;
      detCtx.fillText(`|det(A)| = ${Math.abs(d).toFixed(2)} (area scale factor)`, 10, 30);

      if (Math.abs(d) < 0.01) {
        detCtx.fillStyle = C.accel;
        detCtx.font = "italic 12px Georgia, serif";
        detCtx.fillText("Singular! The plane is collapsed.", 10, 50);
      } else if (d < 0) {
        detCtx.fillStyle = C.velocity;
        detCtx.font = "italic 12px Georgia, serif";
        detCtx.fillText("Negative: orientation is reversed.", 10, 50);
      }

      // Area comparison label
      detCtx.fillStyle = C.muted;
      detCtx.font = "italic 11px Georgia, serif";
      detCtx.textAlign = "right";
      detCtx.textBaseline = "bottom";
      detCtx.fillText("Unit square area = 1", w - 10, h - 24);
      detCtx.fillStyle = fillCol;
      detCtx.fillText(`Parallelogram area = ${Math.abs(d).toFixed(2)}`, w - 10, h - 8);
    }

    // --- Main loop ---
    function loop() {
      if (!colorsRef.current) colorsRef.current = getColors();

      // Advance animation
      if (animatingRef.current) {
        animTRef.current += 0.012;
        if (animTRef.current >= 2) {
          animTRef.current = 2;
          animatingRef.current = false;
          setAnimating(false);
        }
        setAnimT(animTRef.current);
      }

      drawMain();
      drawComposition();
      drawDeterminant();

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a11, a12, a21, a22, b11, b12, b21, b22]);

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
            <span style={{ color: "var(--foreground)" }}>Matrix Composition</span>
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
            Composition of Linear Transformations
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Every 2&times;2 matrix represents a linear transformation of the plane. Drag the sliders to
            reshape the grid and see how matrix multiplication composes two transformations into one.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Preset buttons */}
        <div className="mt-8 flex flex-wrap items-center gap-2 mx-auto" style={{ maxWidth: "65ch" }}>
          <span className="text-sm" style={{ color: "var(--muted)" }}>Matrix A presets:</span>
          {PRESETS_A.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPresetA(p)}
              className="text-sm px-3 py-1 rounded border cursor-pointer"
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

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
                Matrix composition &mdash; A = [{a11.toFixed(1)}, {a12.toFixed(1)}; {a21.toFixed(1)}, {a22.toFixed(1)}]
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
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl label="Row 1, Col 1" symbol="a\u2081\u2081" unit="" min={-3} max={3} step={0.1} value={a11} onChange={setA11} />
              <SliderControl label="Row 1, Col 2" symbol="a\u2081\u2082" unit="" min={-3} max={3} step={0.1} value={a12} onChange={setA12} />
              <SliderControl label="Row 2, Col 1" symbol="a\u2082\u2081" unit="" min={-3} max={3} step={0.1} value={a21} onChange={setA21} />
              <SliderControl label="Row 2, Col 2" symbol="a\u2082\u2082" unit="" min={-3} max={3} step={0.1} value={a22} onChange={setA22} />
            </div>
          </div>
        </div>

        {/* --- Composition visualization --- */}
        <figure className="mt-16">
          <div className="flex flex-wrap items-center gap-2 mb-3 mx-auto" style={{ maxWidth: "65ch" }}>
            <span className="text-sm" style={{ color: "var(--muted)" }}>Matrix B presets:</span>
            {PRESETS_B.map((p) => (
              <button
                key={p.label}
                onClick={() => applyPresetB(p)}
                className="text-sm px-3 py-1 rounded border cursor-pointer"
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  borderColor: "var(--border)",
                  color: "var(--foreground)",
                }}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={startAnimation}
              className="text-sm px-4 py-1 rounded border cursor-pointer ml-auto"
              style={{
                borderColor: "var(--phase-color)",
                color: "var(--phase-color)",
                fontFamily: "var(--font-geist-mono), monospace",
              }}
            >
              {animating ? `Animating (${(animT / 2 * 100).toFixed(0)}%)` : "Animate"}
            </button>
          </div>
          <canvas
            ref={compCanvasRef}
            className="w-full rounded border"
            style={{ height: 280, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6 rounded-b border border-t-0"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
          >
            <SliderControl label="Row 1, Col 1" symbol="b\u2081\u2081" unit="" min={-3} max={3} step={0.1} value={b11} onChange={setB11} />
            <SliderControl label="Row 1, Col 2" symbol="b\u2081\u2082" unit="" min={-3} max={3} step={0.1} value={b12} onChange={setB12} />
            <SliderControl label="Row 2, Col 1" symbol="b\u2082\u2081" unit="" min={-3} max={3} step={0.1} value={b21} onChange={setB21} />
            <SliderControl label="Row 2, Col 2" symbol="b\u2082\u2082" unit="" min={-3} max={3} step={0.1} value={b22} onChange={setB22} />
          </div>
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Composition of two linear transformations. Left: the original grid. Centre: after
            applying <Tex>{"A"}</Tex>. Right: after applying <Tex>{"BA"}</Tex> (first <Tex>{"A"}</Tex>,
            then <Tex>{"B"}</Tex>). Press <em>Animate</em> to watch the morph.
          </figcaption>
        </figure>

        {/* --- Determinant visualization --- */}
        <figure className="mt-16">
          <canvas
            ref={detCanvasRef}
            className="w-full rounded border"
            style={{ height: 260, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            The determinant as a signed area. The unit square (grey) maps to the coloured
            parallelogram. Green when <Tex>{"\\det A > 0"}</Tex> (orientation preserved),
            red when <Tex>{"\\det A < 0"}</Tex> (orientation reversed).
          </figcaption>
        </figure>

        {/* --- Live matrix display --- */}
        <section className="mt-12 mx-auto" style={{ maxWidth: "65ch" }}>
          <div className="grid sm:grid-cols-3 gap-5">
            <MatrixCard label="A" mat={matA} color="var(--position-color)" />
            <MatrixCard label="B" mat={matB} color="var(--velocity-color)" />
            <MatrixCard label="BA" mat={matBA} color="var(--phase-color)" />
          </div>
          <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
            <Tex>{`\\det(BA) = ${det(matBA).toFixed(2)} = \\det(B) \\cdot \\det(A) = ${det(matB).toFixed(2)} \\times ${det(matA).toFixed(2)}`}</Tex>
          </p>
        </section>

        {/* --- Derivation: Linear transformations --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>
          <h2 className="text-2xl font-semibold tracking-tight mb-5">Linear transformations</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A <em>linear transformation</em> <Tex>{"T : \\mathbb{R}^2 \\to \\mathbb{R}^2"}</Tex> is
              completely determined by where it sends the standard basis vectors. If
            </p>

            <div className="text-center py-1">
              <Tex display>{`T(\\hat{e}_1) = \\begin{pmatrix} a \\\\ c \\end{pmatrix}, \\qquad T(\\hat{e}_2) = \\begin{pmatrix} b \\\\ d \\end{pmatrix}`}</Tex>
            </div>

            <p>
              then the matrix representation of <Tex>{"T"}</Tex> is
            </p>

            <div className="text-center py-1">
              <Tex display>{`[T] = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}`}</Tex>
            </div>

            <p>
              Any vector <Tex>{"\\mathbf{v} = x\\hat{e}_1 + y\\hat{e}_2"}</Tex> is mapped to
            </p>

            <div className="text-center py-1">
              <Tex display>{`T(\\mathbf{v}) = x\\,T(\\hat{e}_1) + y\\,T(\\hat{e}_2) = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} \\begin{pmatrix} x \\\\ y \\end{pmatrix}`}</Tex>
            </div>

            <p>
              This is why the columns of the matrix are the images of the basis vectors &mdash;
              the entire transformation is encoded in just four numbers. The canvas above
              shows exactly this: the grey arrows are <Tex>{"\\hat{e}_1"}</Tex> and <Tex>{"\\hat{e}_2"}</Tex>,
              and the coloured arrows are their images under <Tex>{"A"}</Tex>.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Composition as multiplication</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Suppose we apply transformation <Tex>{"A"}</Tex> first, then <Tex>{"B"}</Tex>. The
              combined effect on a vector <Tex>{"\\mathbf{v}"}</Tex> is
            </p>

            <div className="text-center py-1">
              <Tex display>{`B(A\\mathbf{v}) = (BA)\\mathbf{v}`}</Tex>
            </div>

            <p>
              So the composition &ldquo;first <Tex>{"A"}</Tex>, then <Tex>{"B"}</Tex>&rdquo; is
              represented by the matrix product <Tex>{"BA"}</Tex> (note the order!). For 2&times;2
              matrices, the multiplication formula is:
            </p>

            <div className="text-center py-1">
              <Tex display>{`BA = \\begin{pmatrix} b_{11} & b_{12} \\\\ b_{21} & b_{22} \\end{pmatrix} \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix} = \\begin{pmatrix} b_{11}a_{11}+b_{12}a_{21} & b_{11}a_{12}+b_{12}a_{22} \\\\ b_{21}a_{11}+b_{22}a_{21} & b_{21}a_{12}+b_{22}a_{22} \\end{pmatrix}`}</Tex>
            </div>

            <p>
              Matrix multiplication is <strong>not commutative</strong> in general: <Tex>{"AB \\neq BA"}</Tex>.
              You can verify this in the simulation &mdash; try setting <Tex>{"A"}</Tex> to a rotation and <Tex>{"B"}</Tex> to
              a shear, then swap them. The result looks completely different because the order in
              which you apply transformations matters.
            </p>

            <p>
              Composition <em>is</em> associative, however: <Tex>{"(CB)A = C(BA)"}</Tex>. This means
              we can chain as many transformations as we like without worrying about how to
              group them &mdash; only the left-to-right order matters.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The determinant</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The determinant of a 2&times;2 matrix
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\det \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} = ad - bc`}</Tex>
            </div>

            <p>
              measures the <em>signed area scaling factor</em> of the transformation. If the
              unit square has area 1, its image under <Tex>{"A"}</Tex> has signed
              area <Tex>{"\\det A"}</Tex>.
            </p>

            <p>
              The sign carries geometric meaning:
            </p>

            <ul className="list-disc ml-6 space-y-1">
              <li><Tex>{"\\det A > 0"}</Tex> &mdash; the transformation preserves orientation (no reflection)</li>
              <li><Tex>{"\\det A < 0"}</Tex> &mdash; the transformation reverses orientation (includes a reflection)</li>
              <li><Tex>{"\\det A = 0"}</Tex> &mdash; the transformation is singular and collapses the plane to a line or point</li>
            </ul>

            <p>
              A key property of the determinant under composition:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\det(BA) = \\det(B) \\cdot \\det(A)`}</Tex>
            </div>

            <p>
              This makes intuitive sense: if <Tex>{"A"}</Tex> scales areas by a
              factor <Tex>{"\\det A"}</Tex> and <Tex>{"B"}</Tex> then scales by <Tex>{"\\det B"}</Tex>,
              the combined scaling factor is the product. You can check this numerically in the
              live matrix display above.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            <InfoCard
              title="Invertible matrices"
              equation={`A^{-1} = \\frac{1}{\\det A}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}`}
              description="A matrix is invertible if and only if its determinant is non-zero. The inverse undoes the transformation."
              borderColor="var(--position-color)"
            />
            <InfoCard
              title="Rotation matrices"
              equation={`R_\\theta = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}`}
              description="Rotations always have determinant 1 (they preserve area and orientation). Two rotations compose to another rotation."
              borderColor="var(--phase-color)"
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Eigenvalues and eigenvectors</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              An <em>eigenvector</em> of <Tex>{"A"}</Tex> is a non-zero
              vector <Tex>{"\\mathbf{v}"}</Tex> such that <Tex>{"A\\mathbf{v} = \\lambda \\mathbf{v}"}</Tex> for
              some scalar <Tex>{"\\lambda"}</Tex> (the <em>eigenvalue</em>). Geometrically, the
              transformation only stretches or flips the vector &mdash; it does not rotate it.
            </p>

            <p>
              For a 2&times;2 matrix, the eigenvalues satisfy the characteristic equation:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\det(A - \\lambda I) = \\lambda^2 - (a+d)\\lambda + (ad - bc) = 0`}</Tex>
            </div>

            <p>
              The trace <Tex>{"a + d"}</Tex> equals the sum of the eigenvalues, and the
              determinant <Tex>{"ad - bc"}</Tex> equals their product. Try setting <Tex>{"A"}</Tex> to a
              diagonal matrix (e.g. <Tex>{"a_{12} = a_{21} = 0"}</Tex>) &mdash; the basis vectors
              are eigenvectors, and the diagonal entries are the eigenvalues.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Pythagorean theorem from inner products</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Linear algebra provides a clean derivation of the Pythagorean theorem.
              Let <Tex>{"\\mathbf{a}"}</Tex> and <Tex>{"\\mathbf{b}"}</Tex> be two vectors
              in <Tex>{"\\mathbb{R}^n"}</Tex>. Define a third vector as their
              difference: <Tex>{"\\mathbf{c} = \\mathbf{a} - \\mathbf{b}"}</Tex>. Then
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\|\\mathbf{c}\\|^2 = \\|\\mathbf{a} - \\mathbf{b}\\|^2 = (\\mathbf{a} - \\mathbf{b}) \\cdot (\\mathbf{a} - \\mathbf{b})`}</Tex>
            </div>

            <p>
              Expanding the inner product by bilinearity:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\|\\mathbf{a} - \\mathbf{b}\\|^2 = \\|\\mathbf{a}\\|^2 - 2\\,\\mathbf{a}\\cdot\\mathbf{b} + \\|\\mathbf{b}\\|^2`}</Tex>
            </div>

            <p>
              If <Tex>{"\\mathbf{a}"}</Tex> and <Tex>{"\\mathbf{b}"}</Tex> are <strong>orthogonal</strong> &mdash;
              that is, <Tex>{"\\mathbf{a} \\cdot \\mathbf{b} = 0"}</Tex> &mdash; the cross term
              vanishes and we get:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\|\\mathbf{a} - \\mathbf{b}\\|^2 = \\|\\mathbf{a}\\|^2 + \\|\\mathbf{b}\\|^2`}</Tex>
            </div>

            <p>
              This <em>is</em> the Pythagorean theorem. In <Tex>{"\\mathbb{R}^2"}</Tex>, take <Tex>{"\\mathbf{a}"}</Tex> along
              one leg of a right triangle and <Tex>{"\\mathbf{b}"}</Tex> along the other.
              The hypotenuse is the vector from the tip of <Tex>{"\\mathbf{b}"}</Tex> to
              the tip of <Tex>{"\\mathbf{a}"}</Tex>, i.e. <Tex>{"\\mathbf{a} - \\mathbf{b}"}</Tex>.
              Orthogonality of the legs gives the classical result immediately.
            </p>

            <p>
              But notice that nothing in the derivation is specific to two dimensions.
              The identity holds in <Tex>{"\\mathbb{R}^3"}</Tex>, <Tex>{"\\mathbb{R}^n"}</Tex>,
              and indeed in any inner product space &mdash; including infinite-dimensional
              function spaces used in quantum mechanics and Fourier analysis.
            </p>
          </div>

          <h3 className="text-xl font-semibold mt-10 mb-4">Visualising it with matrices</h3>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              We can see this geometrically in the transformation canvas above. Set matrix <Tex>{"A"}</Tex> to
              a rotation (try the &ldquo;Rot 45&deg;&rdquo; preset). A rotation matrix
              satisfies <Tex>{"A^\\top A = I"}</Tex>, which means it preserves inner products:
            </p>

            <div className="text-center py-1">
              <Tex display>{`(A\\mathbf{u}) \\cdot (A\\mathbf{v}) = \\mathbf{u}^\\top A^\\top A\\,\\mathbf{v} = \\mathbf{u} \\cdot \\mathbf{v}`}</Tex>
            </div>

            <p>
              In particular, it preserves lengths: <Tex>{"\\|A\\mathbf{v}\\| = \\|\\mathbf{v}\\|"}</Tex>.
              Notice in the canvas that the parallelogram produced by a rotation is always a
              square of unit area &mdash; this is a direct visual confirmation
              that <Tex>{"\\det(R_\\theta) = 1"}</Tex> and that norms are preserved.
            </p>

            <p>
              Now set <Tex>{"A"}</Tex> to a general matrix. The columns
              of <Tex>{"A"}</Tex> are the images of the basis vectors. The squared length of
              the first column is <Tex>{"a_{11}^2 + a_{21}^2"}</Tex>. If the two columns are
              orthogonal (their dot product <Tex>{"a_{11}a_{12} + a_{21}a_{22} = 0"}</Tex>),
              then the Pythagorean theorem says:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\|A\\hat{e}_1\\|^2 + \\|A\\hat{e}_2\\|^2 = \\|A\\hat{e}_1 - A\\hat{e}_2\\|^2 \\quad \\text{(when columns are orthogonal)}`}</Tex>
            </div>

            <p>
              You can see this in the grid: when the transformed basis vectors meet at a right
              angle, the diagonal of the parallelogram satisfies the Pythagorean relation.
              The moment you break orthogonality (e.g. apply a shear), the cross
              term <Tex>{"2\\,\\mathbf{a}\\cdot\\mathbf{b}"}</Tex> reappears, and the simple sum-of-squares
              identity no longer holds.
            </p>
          </div>

          {/* Info card for the generalized theorem */}
          <div className="grid sm:grid-cols-1 gap-5 mt-10">
            <InfoCard
              title="Generalised Pythagorean theorem"
              equation={`\\|\\mathbf{a}\\|^2 + \\|\\mathbf{b}\\|^2 = \\|\\mathbf{a} - \\mathbf{b}\\|^2 \\quad \\Longleftrightarrow \\quad \\mathbf{a} \\cdot \\mathbf{b} = 0`}
              description="In any inner product space, the Pythagorean theorem is equivalent to orthogonality. This includes function spaces — Parseval's theorem in Fourier analysis is the Pythagorean theorem applied to an orthonormal basis of sines and cosines."
              borderColor="var(--total-color)"
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Fibonacci numbers from matrix powers</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              One of the most striking applications of matrix composition is the
              closed-form derivation of the Fibonacci sequence.
              Define the <em>Fibonacci matrix</em>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F = \\begin{pmatrix} 1 & 1 \\\\ 1 & 0 \\end{pmatrix}`}</Tex>
            </div>

            <p>
              A direct computation shows that composing <Tex>{"F"}</Tex> with
              itself produces the next Fibonacci numbers:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F^n = \\begin{pmatrix} F_{n+1} & F_n \\\\ F_n & F_{n-1} \\end{pmatrix}`}</Tex>
            </div>

            <p>
              where <Tex>{"F_n"}</Tex> is the <Tex>{"n"}</Tex>-th Fibonacci number
              (<Tex>{"F_0 = 0,\\; F_1 = 1,\\; F_2 = 1,\\; F_3 = 2,\\; \\ldots"}</Tex>).
              You can verify this by induction: if the identity holds for <Tex>{"n"}</Tex>,
              then multiplying by <Tex>{"F"}</Tex> on the right gives
            </p>

            <div className="text-center py-1">
              <Tex display>{`F^{n+1} = F^n \\cdot F = \\begin{pmatrix} F_{n+1} + F_n & F_{n+1} \\\\ F_n + F_{n-1} & F_n \\end{pmatrix} = \\begin{pmatrix} F_{n+2} & F_{n+1} \\\\ F_{n+1} & F_n \\end{pmatrix}`}</Tex>
            </div>

            <p>
              using the recurrence <Tex>{"F_{n+2} = F_{n+1} + F_n"}</Tex>.
            </p>
          </div>

          <h3 className="text-xl font-semibold mt-10 mb-4">Diagonalisation and the closed form</h3>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The power of matrices is that we can compute <Tex>{"F^n"}</Tex> in
              closed form by <em>diagonalising</em> <Tex>{"F"}</Tex>.
              The characteristic equation is
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\det(F - \\lambda I) = \\lambda^2 - \\lambda - 1 = 0`}</Tex>
            </div>

            <p>
              whose roots are the golden ratio and its conjugate:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\varphi = \\frac{1 + \\sqrt{5}}{2} \\approx 1.618, \\qquad \\psi = \\frac{1 - \\sqrt{5}}{2} \\approx -0.618`}</Tex>
            </div>

            <p>
              The eigenvectors
              of <Tex>{"F"}</Tex> are <Tex>{"\\mathbf{v}_1 = (\\varphi,\\, 1)^\\top"}</Tex> and <Tex>{"\\mathbf{v}_2 = (\\psi,\\, 1)^\\top"}</Tex>.
              Assembling these into a matrix <Tex>{"P"}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F = P \\begin{pmatrix} \\varphi & 0 \\\\ 0 & \\psi \\end{pmatrix} P^{-1}, \\qquad P = \\begin{pmatrix} \\varphi & \\psi \\\\ 1 & 1 \\end{pmatrix}`}</Tex>
            </div>

            <p>
              Taking the <Tex>{"n"}</Tex>-th power is now trivial &mdash; a diagonal
              matrix raised to a power just raises each diagonal entry:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F^n = P \\begin{pmatrix} \\varphi^n & 0 \\\\ 0 & \\psi^n \\end{pmatrix} P^{-1}`}</Tex>
            </div>

            <p>
              Extracting the top-right entry (which equals <Tex>{"F_n"}</Tex>) and
              simplifying gives <strong>Binet&rsquo;s formula</strong>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F_n = \\frac{\\varphi^n - \\psi^n}{\\sqrt{5}}`}</Tex>
            </div>

            <p>
              This is remarkable: every Fibonacci number &mdash; an integer &mdash;
              equals a difference of powers of two irrational numbers, divided by
              another irrational number. The formula works because the
              irrational parts cancel exactly.
            </p>

            <p>
              Since <Tex>{"|\\psi| < 1"}</Tex>, the
              term <Tex>{"\\psi^n"}</Tex> shrinks to zero exponentially, so for
              large <Tex>{"n"}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`F_n \\approx \\frac{\\varphi^n}{\\sqrt{5}}`}</Tex>
            </div>

            <p>
              In other words, the Fibonacci numbers grow like powers of the golden
              ratio. The ratio of consecutive Fibonacci numbers converges
              to <Tex>{"\\varphi"}</Tex> &mdash; try computing <Tex>{"F_{10}/F_9 = 55/34 \\approx 1.6176"}</Tex>.
            </p>
          </div>

          <h3 className="text-xl font-semibold mt-10 mb-4">Why this matters for composition</h3>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The Fibonacci derivation illustrates a general principle:
              <strong> repeated composition of a transformation is the same as
              raising its matrix to a power</strong>. Diagonalisation (when
              possible) reduces the <Tex>{"n"}</Tex>-fold composition to
              simple exponentiation of the eigenvalues. This is why eigenvalues
              govern the long-term behaviour of every linear recurrence, dynamical
              system, and Markov chain.
            </p>

            <p>
              Try it in the canvas above: set <Tex>{"A"}</Tex> to the Fibonacci
              matrix (<Tex>{"a_{11}=a_{12}=a_{21}=1,\\; a_{22}=0"}</Tex>). The
              determinant is <Tex>{"\\det F = -1"}</Tex> (area-preserving but
              orientation-reversing), and the transformation shears the plane in a
              pattern that encodes the golden ratio.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10">
            <InfoCard
              title="Cassini&rsquo;s identity"
              equation={`F_{n-1}\\,F_{n+1} - F_n^{\\,2} = (-1)^n`}
              description="Follows immediately from det(F^n) = (det F)^n = (-1)^n. A one-line proof via matrices of an identity that takes real work to prove by induction."
              borderColor="var(--accel-color)"
            />
            <InfoCard
              title="Fast Fibonacci"
              equation={`F^n = (F^{n/2})^2`}
              description="Matrix exponentiation by repeated squaring computes F_n in O(log n) multiplications instead of O(n) additions. This is how large Fibonacci numbers are computed in practice."
              borderColor="var(--total-color)"
            />
          </div>

        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Matrix display card
// ---------------------------------------------------------------------------

function MatrixCard({ label, mat, color }: { label: string; mat: Mat2; color: string }) {
  const html = katex.renderToString(
    `${label} = \\begin{pmatrix} ${mat[0].toFixed(2)} & ${mat[1].toFixed(2)} \\\\ ${mat[2].toFixed(2)} & ${mat[3].toFixed(2)} \\end{pmatrix}`,
    { displayMode: false, throwOnError: false }
  );
  return (
    <div
      className="rounded-lg border-l-4 p-4 space-y-1"
      style={{
        borderLeftColor: color,
        borderTop: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
      }}
    >
      <span dangerouslySetInnerHTML={{ __html: html }} />
      <div className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
        det = {det(mat).toFixed(2)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info card
// ---------------------------------------------------------------------------

function InfoCard({
  title, equation, description, borderColor,
}: {
  title: string;
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
