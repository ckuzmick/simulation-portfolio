"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type Mode = "double slit" | "single slit";

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
// Wavelength to visible color (approximate)
// ---------------------------------------------------------------------------

function wavelengthToRGB(lambda: number): [number, number, number] {
  // lambda in nm, 380–780
  let r = 0, g = 0, b = 0;
  if (lambda >= 380 && lambda < 440) {
    r = -(lambda - 440) / (440 - 380);
    g = 0;
    b = 1;
  } else if (lambda >= 440 && lambda < 490) {
    r = 0;
    g = (lambda - 440) / (490 - 440);
    b = 1;
  } else if (lambda >= 490 && lambda < 510) {
    r = 0;
    g = 1;
    b = -(lambda - 510) / (510 - 490);
  } else if (lambda >= 510 && lambda < 580) {
    r = (lambda - 510) / (580 - 510);
    g = 1;
    b = 0;
  } else if (lambda >= 580 && lambda < 645) {
    r = 1;
    g = -(lambda - 645) / (645 - 580);
    b = 0;
  } else if (lambda >= 645 && lambda <= 780) {
    r = 1;
    g = 0;
    b = 0;
  }

  // Intensity falloff at edges of visible spectrum
  let factor: number;
  if (lambda >= 380 && lambda < 420) factor = 0.3 + 0.7 * (lambda - 380) / (420 - 380);
  else if (lambda >= 420 && lambda <= 700) factor = 1;
  else if (lambda > 700 && lambda <= 780) factor = 0.3 + 0.7 * (780 - lambda) / (780 - 700);
  else factor = 0;

  return [r * factor, g * factor, b * factor];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WAVE_W = 600;
const WAVE_H = 400;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WaveInterferencePage() {
  const { theme, toggle } = useTheme();

  // Parameters
  const [slitSep, setSlitSep] = useState(60);       // d in pixels
  const [wavelength, setWavelength] = useState(540); // lambda in nm (for color), also sets spatial wavelength
  const [phaseDiff, setPhaseDiff] = useState(0);     // delta-phi
  const [frequency, setFrequency] = useState(1.5);   // wave speed factor
  const [mode, setMode] = useState<Mode>("double slit");
  const [running, setRunning] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Canvas refs
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const intensityCanvasRef = useRef<HTMLCanvasElement>(null);
  const comparisonCanvasRef = useRef<HTMLCanvasElement>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement>(null);

  // Particle detection hits — accumulate over time
  const particleHitsRef = useRef<number[]>([]);
  const particleTickRef = useRef(0);

  // Mutable refs for animation
  const rafRef = useRef<number>(0);
  const runningRef = useRef(running);
  const paramsRef = useRef({ slitSep, wavelength, phaseDiff, frequency, mode });
  const colorsRef = useRef<Colors | null>(null);
  const phaseRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => {
    paramsRef.current = { slitSep, wavelength, phaseDiff, frequency, mode };
  }, [slitSep, wavelength, phaseDiff, frequency, mode]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    phaseRef.current = 0;
    lastTimeRef.current = 0;
    particleHitsRef.current = [];
    particleTickRef.current = 0;
  }, []);

  // ---------------------------------------------------------------------------
  // Source positions helper
  // ---------------------------------------------------------------------------

  function getSourcePositions(
    centerY: number,
    d: number,
    currentMode: Mode
  ): number[] {
    if (currentMode === "single slit") return [centerY];
    return [centerY - d / 2, centerY + d / 2];
  }

  // ---------------------------------------------------------------------------
  // Animation loop
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const waveCanvas = waveCanvasRef.current;
    const intensityCanvas = intensityCanvasRef.current;
    const comparisonCanvas = comparisonCanvasRef.current;
    const particleCanvas = particleCanvasRef.current;
    if (!waveCanvas || !intensityCanvas || !comparisonCanvas || !particleCanvas) return;

    const waveCtx = waveCanvas.getContext("2d")!;
    const intCtx = intensityCanvas.getContext("2d")!;
    const compCtx = comparisonCanvas.getContext("2d")!;
    const partCtx = particleCanvas.getContext("2d")!;

    colorsRef.current = getColors();

    function resizeCanvas(c: HTMLCanvasElement) {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizeAll() {
      resizeCanvas(waveCanvas!);
      resizeCanvas(intensityCanvas!);
      resizeCanvas(comparisonCanvas!);
      resizeCanvas(particleCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    // --- Draw wave field using ImageData for performance ---
    function drawWaveField() {
      const C = colorsRef.current!;
      const c = waveCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return; // collapsed — skip drawing
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);

      const ctx = waveCtx;
      const imageData = ctx.createImageData(pw, ph);
      const data = imageData.data;

      const { slitSep: d, wavelength: lam, phaseDiff: dphi, frequency: freq, mode: m } = paramsRef.current;

      const spatialLambda = lam / 15;
      const k = (2 * Math.PI) / spatialLambda;
      const omega = freq * 4;
      const phase = phaseRef.current;

      const centerY = h / 2;
      const sourceX = 30;

      const sources = getSourcePositions(centerY, d, m);
      const numSources = sources.length;

      // Get wave color from wavelength
      const [cr, cg, cb] = wavelengthToRGB(lam);

      // Parse background color for blending
      const bgHex = C.bg;
      let bgR = 255, bgG = 255, bgB = 255;
      if (bgHex.startsWith("#")) {
        bgR = parseInt(bgHex.slice(1, 3), 16);
        bgG = parseInt(bgHex.slice(3, 5), 16);
        bgB = parseInt(bgHex.slice(5, 7), 16);
      } else if (bgHex.startsWith("rgb")) {
        const parts = bgHex.match(/\d+/g);
        if (parts) { bgR = +parts[0]; bgG = +parts[1]; bgB = +parts[2]; }
      }

      // Render pixel by pixel — use dpr-scaled coordinates
      const scaleX = w / pw;
      const scaleY = h / ph;

      for (let py = 0; py < ph; py++) {
        const worldY = py * scaleY;
        for (let px = 0; px < pw; px++) {
          const worldX = px * scaleX;

          // Sum wave amplitudes from all sources
          let ampSum = 0;
          for (let s = 0; s < numSources; s++) {
            const dx = worldX - sourceX;
            const dy = worldY - sources[s];
            const r = Math.sqrt(dx * dx + dy * dy);
            // Add phase offset for each source (progressive phase difference)
            const srcPhase = s * dphi;
            // Decay with 1/sqrt(r) for 2D circular waves
            const amp = r > 1 ? (1 / Math.sqrt(r)) * Math.sin(k * r - omega * phase + srcPhase) : 0;
            ampSum += amp;
          }

          // Normalize: max possible amplitude is numSources / sqrt(r_min)
          // Use a reasonable normalization for visual clarity
          const norm = ampSum / (numSources * 0.3);
          const intensity = Math.max(-1, Math.min(1, norm));

          // Map to color: positive = bright wave color, negative = dark
          // Intensity 0 = background
          const brightness = (intensity + 1) / 2; // 0 to 1
          const i4 = (py * pw + px) * 4;
          data[i4]     = Math.round(bgR + (cr * 255 - bgR) * brightness);
          data[i4 + 1] = Math.round(bgG + (cg * 255 - bgG) * brightness);
          data[i4 + 2] = Math.round(bgB + (cb * 255 - bgB) * brightness);
          data[i4 + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);

      // Draw source markers with DPR-aware coordinates
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const sy of sources) {
        ctx.fillStyle = C.fg;
        ctx.beginPath();
        ctx.arc(sourceX, sy, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // Label sources
      ctx.fillStyle = C.muted;
      ctx.font = "italic 11px Georgia, serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      if (numSources === 1) {
        ctx.fillText("source", sourceX + 8, sources[0] - 6);
      } else {
        ctx.fillText("S\u2081", sourceX + 8, sources[0] - 4);
        if (numSources === 2) {
          ctx.fillText("S\u2082", sourceX + 8, sources[numSources - 1] + 16);
        }
      }

      // Draw "screen" line on right edge
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(w - 20, 0);
      ctx.lineTo(w - 20, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.muted;
      ctx.font = "italic 10px Georgia, serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText("screen", w - 24, 6);
    }

    // --- Draw intensity plot ---
    function drawIntensityPlot() {
      const C = colorsRef.current!;
      const c = intensityCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      intCtx.clearRect(0, 0, w, h);

      const { slitSep: d, wavelength: lam, phaseDiff: dphi, mode: m } = paramsRef.current;

      const margin = { left: 50, right: 20, top: 16, bottom: 28 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      const spatialLambda = lam / 15;
      const k = (2 * Math.PI) / spatialLambda;
      const numSources = m === "single slit" ? 1 : 2;

      // Axes
      intCtx.strokeStyle = C.grid;
      intCtx.lineWidth = 0.8;
      intCtx.beginPath();
      intCtx.moveTo(margin.left, margin.top);
      intCtx.lineTo(margin.left, h - margin.bottom);
      intCtx.lineTo(w - margin.right, h - margin.bottom);
      intCtx.stroke();

      // Axis labels
      intCtx.fillStyle = C.muted;
      intCtx.font = "italic 12px Georgia, serif";
      intCtx.textAlign = "center";
      intCtx.textBaseline = "top";
      intCtx.fillText("\u03b8", margin.left + plotW / 2, h - margin.bottom + 8);
      intCtx.save();
      intCtx.translate(margin.left - 32, margin.top + plotH / 2);
      intCtx.rotate(-Math.PI / 2);
      intCtx.textAlign = "center";
      intCtx.textBaseline = "middle";
      intCtx.fillText("I(\u03b8)", 0, 0);
      intCtx.restore();

      // Compute intensity as a function of angle
      const nPoints = Math.round(plotW);
      const maxTheta = Math.PI / 3; // +/- 60 degrees
      const intensityVals: number[] = [];
      let maxI = 0;

      for (let i = 0; i < nPoints; i++) {
        const theta = -maxTheta + (2 * maxTheta * i) / (nPoints - 1);
        const sinTheta = Math.sin(theta);

        let intensity: number;
        if (numSources === 1) {
          // Single slit — approximate as sinc^2 with effective slit width
          const slitWidth = 20; // effective slit width in pixels
          const beta = (Math.PI * slitWidth * sinTheta) / spatialLambda;
          intensity = beta === 0 ? 1 : Math.pow(Math.sin(beta) / beta, 2);
        } else {
          // N-slit interference
          const delta = k * d * sinTheta + dphi;
          // Multi-slit: I = (sin(N*delta/2) / sin(delta/2))^2
          const halfDelta = delta / 2;
          const nHalfDelta = numSources * halfDelta;
          const sinD = Math.sin(halfDelta);
          const sinND = Math.sin(nHalfDelta);
          intensity = Math.abs(sinD) < 1e-10
            ? numSources * numSources
            : (sinND / sinD) * (sinND / sinD);
        }
        intensityVals.push(intensity);
        if (intensity > maxI) maxI = intensity;
      }

      // Normalize and draw
      if (maxI === 0) maxI = 1;

      // Get wave color
      const [cr, cg, cb] = wavelengthToRGB(lam);
      const waveColor = `rgb(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)})`;

      // Filled area
      intCtx.fillStyle = waveColor;
      intCtx.globalAlpha = 0.15;
      intCtx.beginPath();
      intCtx.moveTo(margin.left, h - margin.bottom);
      for (let i = 0; i < nPoints; i++) {
        const px = margin.left + (i / (nPoints - 1)) * plotW;
        const py = h - margin.bottom - (intensityVals[i] / maxI) * plotH;
        intCtx.lineTo(px, py);
      }
      intCtx.lineTo(margin.left + plotW, h - margin.bottom);
      intCtx.closePath();
      intCtx.fill();
      intCtx.globalAlpha = 1;

      // Line
      intCtx.strokeStyle = waveColor;
      intCtx.lineWidth = 1.8;
      intCtx.beginPath();
      for (let i = 0; i < nPoints; i++) {
        const px = margin.left + (i / (nPoints - 1)) * plotW;
        const py = h - margin.bottom - (intensityVals[i] / maxI) * plotH;
        if (i === 0) intCtx.moveTo(px, py);
        else intCtx.lineTo(px, py);
      }
      intCtx.stroke();

      // Theta tick marks
      intCtx.fillStyle = C.muted;
      intCtx.font = "11px Georgia, serif";
      intCtx.textAlign = "center";
      intCtx.textBaseline = "top";
      const ticks = [-60, -30, 0, 30, 60];
      for (const deg of ticks) {
        const frac = (deg + 60) / 120;
        const px = margin.left + frac * plotW;
        intCtx.strokeStyle = C.grid;
        intCtx.lineWidth = 0.5;
        intCtx.beginPath();
        intCtx.moveTo(px, h - margin.bottom);
        intCtx.lineTo(px, h - margin.bottom + 4);
        intCtx.stroke();
        intCtx.fillText(`${deg}\u00b0`, px, h - margin.bottom + 6);
      }
    }

    // --- Draw comparison plot (single vs double vs grating) ---
    function drawComparison() {
      const C = colorsRef.current!;
      const c = comparisonCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      compCtx.clearRect(0, 0, w, h);

      const { slitSep: d, wavelength: lam, phaseDiff: dphi } = paramsRef.current;

      const margin = { left: 50, right: 20, top: 16, bottom: 28 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      const spatialLambda = lam / 15;
      const kWave = (2 * Math.PI) / spatialLambda;

      // Axes
      compCtx.strokeStyle = C.grid;
      compCtx.lineWidth = 0.8;
      compCtx.beginPath();
      compCtx.moveTo(margin.left, margin.top);
      compCtx.lineTo(margin.left, h - margin.bottom);
      compCtx.lineTo(w - margin.right, h - margin.bottom);
      compCtx.stroke();

      // Axis labels
      compCtx.fillStyle = C.muted;
      compCtx.font = "italic 12px Georgia, serif";
      compCtx.textAlign = "center";
      compCtx.textBaseline = "top";
      compCtx.fillText("\u03b8", margin.left + plotW / 2, h - margin.bottom + 8);
      compCtx.save();
      compCtx.translate(margin.left - 32, margin.top + plotH / 2);
      compCtx.rotate(-Math.PI / 2);
      compCtx.textAlign = "center";
      compCtx.textBaseline = "middle";
      compCtx.fillText("I(\u03b8)", 0, 0);
      compCtx.restore();

      const nPoints = Math.round(plotW);
      const maxTheta = Math.PI / 3;

      // Compute for single, double, N slits
      const configs: { label: string; color: string; numSlits: number }[] = [
        { label: "single slit", color: C.total, numSlits: 1 },
        { label: "double slit", color: C.position, numSlits: 2 },
      ];

      // Find global max for normalization
      let globalMax = 0;
      const allVals: number[][] = [];
      for (const cfg of configs) {
        const vals: number[] = [];
        for (let i = 0; i < nPoints; i++) {
          const theta = -maxTheta + (2 * maxTheta * i) / (nPoints - 1);
          const sinTheta = Math.sin(theta);
          let intensity: number;
          if (cfg.numSlits === 1) {
            const slitWidth = 20;
            const beta = (Math.PI * slitWidth * sinTheta) / spatialLambda;
            intensity = beta === 0 ? 1 : Math.pow(Math.sin(beta) / beta, 2);
          } else {
            const delta = kWave * d * sinTheta + dphi;
            const halfDelta = delta / 2;
            const nHalfDelta = cfg.numSlits * halfDelta;
            const sinD = Math.sin(halfDelta);
            const sinND = Math.sin(nHalfDelta);
            intensity = Math.abs(sinD) < 1e-10
              ? cfg.numSlits * cfg.numSlits
              : (sinND / sinD) * (sinND / sinD);
            // Normalize to peak of 1 for comparison
            intensity /= (cfg.numSlits * cfg.numSlits);
          }
          vals.push(intensity);
          if (intensity > globalMax) globalMax = intensity;
        }
        allVals.push(vals);
      }

      if (globalMax === 0) globalMax = 1;

      // Draw each curve
      configs.forEach((cfg, idx) => {
        const vals = allVals[idx];
        compCtx.strokeStyle = cfg.color;
        compCtx.lineWidth = 1.5;
        compCtx.globalAlpha = 0.85;
        compCtx.beginPath();
        for (let i = 0; i < nPoints; i++) {
          const px = margin.left + (i / (nPoints - 1)) * plotW;
          const py = h - margin.bottom - (vals[i] / globalMax) * plotH;
          if (i === 0) compCtx.moveTo(px, py);
          else compCtx.lineTo(px, py);
        }
        compCtx.stroke();
        compCtx.globalAlpha = 1;
      });

      // Legend
      const legendX = w - margin.right - 110;
      configs.forEach((cfg, i) => {
        const ly = margin.top + 8 + i * 18;
        compCtx.fillStyle = cfg.color;
        compCtx.fillRect(legendX, ly, 14, 3);
        compCtx.fillStyle = C.muted;
        compCtx.font = "italic 11px Georgia, serif";
        compCtx.textAlign = "left";
        compCtx.textBaseline = "middle";
        compCtx.fillText(cfg.label, legendX + 20, ly + 2);
      });

      // Theta ticks
      compCtx.fillStyle = C.muted;
      compCtx.font = "11px Georgia, serif";
      compCtx.textAlign = "center";
      compCtx.textBaseline = "top";
      const ticks = [-60, -30, 0, 30, 60];
      for (const deg of ticks) {
        const frac = (deg + 60) / 120;
        const px = margin.left + frac * plotW;
        compCtx.strokeStyle = C.grid;
        compCtx.lineWidth = 0.5;
        compCtx.beginPath();
        compCtx.moveTo(px, h - margin.bottom);
        compCtx.lineTo(px, h - margin.bottom + 4);
        compCtx.stroke();
        compCtx.fillText(`${deg}\u00b0`, px, h - margin.bottom + 6);
      }
    }

    // --- Draw particle detection simulation ---
    // Particles arrive one at a time, landing on a screen according to the
    // quantum probability distribution (same as the wave intensity pattern).
    // Over time the dots build up the interference pattern.
    function drawParticles() {
      const C = colorsRef.current!;
      const c = particleCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      partCtx.clearRect(0, 0, w, h);

      const { slitSep: d, wavelength: lam, phaseDiff: dphi, mode: m } = paramsRef.current;
      const spatialLambda = lam / 15;
      const kWave = (2 * Math.PI) / spatialLambda;
      const numSources = m === "single slit" ? 1 : 2;

      // Add new particles if running
      if (runningRef.current) {
        particleTickRef.current++;
        // Add a few particles per frame, sampled from the intensity distribution
        const particlesPerFrame = 3;
        for (let p = 0; p < particlesPerFrame; p++) {
          // Rejection sampling from I(theta)
          let y: number;
          for (let attempt = 0; attempt < 50; attempt++) {
            const candidate = Math.random() * h;
            const theta = ((candidate / h) - 0.5) * (Math.PI / 2); // +/- 45 deg
            let intensity: number;
            if (numSources === 1) {
              const slitWidth = 20;
              const beta = (Math.PI * slitWidth * Math.sin(theta)) / spatialLambda;
              intensity = beta === 0 ? 1 : Math.pow(Math.sin(beta) / beta, 2);
            } else {
              const delta = kWave * d * Math.sin(theta) + dphi;
              const halfDelta = delta / 2;
              const sinD = Math.sin(halfDelta);
              intensity = Math.abs(sinD) < 1e-10 ? 1 : Math.pow(Math.cos(halfDelta), 2);
            }
            if (Math.random() < intensity) {
              y = candidate;
              particleHitsRef.current.push(y);
              break;
            }
          }
        }
      }

      const hits = particleHitsRef.current;

      // Background
      // Draw the barrier with slits on the left
      const barrierX = 60;
      const centerY = h / 2;
      const { slitSep: d2 } = paramsRef.current;
      const slitWidth = 12;

      partCtx.fillStyle = C.fg;
      partCtx.globalAlpha = 0.15;
      if (numSources === 2) {
        // Barrier with two slits
        partCtx.fillRect(barrierX - 2, 0, 4, centerY - d2 / 2 - slitWidth / 2);
        partCtx.fillRect(barrierX - 2, centerY - d2 / 2 + slitWidth / 2, 4, d2 - slitWidth);
        partCtx.fillRect(barrierX - 2, centerY + d2 / 2 + slitWidth / 2, 4, h);
      } else {
        partCtx.fillRect(barrierX - 2, 0, 4, centerY - slitWidth / 2);
        partCtx.fillRect(barrierX - 2, centerY + slitWidth / 2, 4, h);
      }
      partCtx.globalAlpha = 1;

      // Screen line on the right
      const screenX = w - 40;
      partCtx.strokeStyle = C.grid;
      partCtx.lineWidth = 1;
      partCtx.setLineDash([4, 3]);
      partCtx.beginPath();
      partCtx.moveTo(screenX, 0);
      partCtx.lineTo(screenX, h);
      partCtx.stroke();
      partCtx.setLineDash([]);

      // Draw accumulated dots on the screen
      const [cr, cg, cb] = wavelengthToRGB(paramsRef.current.wavelength);
      const dotColor = `rgb(${Math.round(cr * 255)}, ${Math.round(cg * 255)}, ${Math.round(cb * 255)})`;
      partCtx.fillStyle = dotColor;
      partCtx.globalAlpha = 0.6;
      for (const hitY of hits) {
        // Spread dots horizontally near the screen with a little randomness
        const dx = (Math.random() - 0.5) * 16;
        partCtx.fillRect(screenX + dx - 1, hitY - 1, 2, 2);
      }
      partCtx.globalAlpha = 1;

      // Labels
      partCtx.fillStyle = C.muted;
      partCtx.font = "italic 11px Georgia, serif";
      partCtx.textAlign = "left";
      partCtx.textBaseline = "top";
      partCtx.fillText(`${hits.length} detections`, 8, 8);
      partCtx.textAlign = "right";
      partCtx.fillText("screen", screenX - 6, 8);
    }

    function loop(timestamp: number) {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      if (runningRef.current) {
        phaseRef.current += dt;
      }

      if (!colorsRef.current) colorsRef.current = getColors();
      drawWaveField();
      drawIntensityPlot();
      drawComparison();
      drawParticles();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modeColor = (m: Mode) =>
    m === "double slit" ? "var(--position-color)" : "var(--total-color)";

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
            <span style={{ color: "var(--foreground)" }}>Wave Interference</span>
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
            Wave Interference &amp; the Double Slit
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Superposition of circular wavefronts from point sources, producing interference fringes
            whose spacing depends on wavelength, slit separation, and the number of sources.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* Controls bar */}
        <div className="mt-8 flex items-center justify-between mx-auto" style={{ maxWidth: "65ch" }}>
          <button
            onClick={() => {
              const order: Mode[] = ["double slit", "single slit"];
              const next = order[(order.indexOf(mode) + 1) % order.length];
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

        {/* Wave field + parameter controls — sticky, collapsible */}
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
                Wave interference — {mode}
              </span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>
                &#9660; expand
              </span>
            </div>
          )}
          {/* Full panel — hidden when collapsed but stays in DOM */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <canvas
                ref={waveCanvasRef}
                className="w-full"
                style={{ height: 340, background: "var(--canvas-bg)" }}
              />
              <button
                onClick={() => setCollapsed(true)}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded border cursor-pointer"
                style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--muted)" }}
              >
                &#9650; collapse
              </button>
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Slit separation"
                symbol="d"
                unit="px"
                min={10} max={160} step={1}
                value={slitSep} onChange={setSlitSep}
              />
              <SliderControl
                label="Wavelength"
                symbol={"\u03bb"}
                unit="nm"
                min={380} max={750} step={5}
                value={wavelength} onChange={setWavelength}
                colorIndicator={wavelength}
              />
              <SliderControl
                label="Phase difference"
                symbol={"\u0394\u03c6"}
                unit="rad"
                min={0} max={6.28} step={0.01}
                value={phaseDiff} onChange={setPhaseDiff}
                displayValue={(v) => v.toFixed(2)}
              />
              <SliderControl
                label="Frequency"
                symbol="f"
                unit={"\u00d7"}
                min={0.2} max={4} step={0.1}
                value={frequency} onChange={setFrequency}
                displayValue={(v) => v.toFixed(1)}
              />
            </div>
          </div>
        </div>

        {/* Intensity plot */}
        <figure className="mt-16">
          <canvas
            ref={intensityCanvasRef}
            className="w-full rounded border"
            style={{ height: 260, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Intensity distribution <Tex>{`I(\\theta)`}</Tex> on the detection screen for the current configuration.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          {/* Part 1: Superposition */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The superposition principle</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              When two or more waves overlap in space, the resulting displacement is the
              algebraic sum of the individual displacements. For two point sources
              emitting monochromatic waves of the same frequency and amplitude, the
              total wave at any point <Tex>P</Tex> is
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\psi(P, t) = \\psi_1 + \\psi_2 = A\\,e^{i(kr_1 - \\omega t)} + A\\,e^{i(kr_2 - \\omega t + \\Delta\\phi)}`}</Tex>
            </div>

            <p>
              where <Tex>{`r_1`}</Tex> and <Tex>{`r_2`}</Tex> are the distances from each source
              to <Tex>P</Tex>, and <Tex>{`\\Delta\\phi`}</Tex> is any intrinsic phase difference
              between the sources.
            </p>
          </div>

          {/* Part 2: Double slit */}
          <h2 className="text-2xl font-semibold tracking-tight mt-14 mb-5">The double-slit pattern</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              For two slits separated by distance <Tex>d</Tex>, viewed at angle <Tex>{`\\theta`}</Tex> from
              the forward direction, the path difference between the two waves is
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\Delta r = r_2 - r_1 = d\\sin\\theta`}</Tex>
            </div>

            <p>
              Constructive interference occurs when the path difference is an integer
              number of wavelengths, and destructive when it is a half-integer:
            </p>

            <div className="text-center py-1">
              <Tex display>{`d\\sin\\theta = m\\lambda \\quad (\\text{constructive, } m = 0, \\pm 1, \\pm 2, \\ldots)`}</Tex>
            </div>
            <div className="text-center py-1">
              <Tex display>{`d\\sin\\theta = \\left(m + \\tfrac{1}{2}\\right)\\lambda \\quad (\\text{destructive})`}</Tex>
            </div>

            <p>
              The observed intensity is the square of the total amplitude. Summing the two
              phasors and taking the modulus squared gives
            </p>

            <div className="text-center py-1">
              <Tex display>{`I(\\theta) = I_0 \\cos^2\\!\\left(\\frac{\\pi d \\sin\\theta}{\\lambda}\\right)`}</Tex>
            </div>

            <p>
              This <Tex>{`\\cos^2`}</Tex> pattern produces equally spaced bright fringes, each
              with the same peak intensity. The fringe spacing (angular distance between
              adjacent maxima) is <Tex>{`\\Delta\\theta \\approx \\lambda / d`}</Tex> for
              small angles.
            </p>
          </div>

          {/* Part 3: Single slit diffraction */}
          <h2 className="text-2xl font-semibold tracking-tight mt-14 mb-5">Single-slit diffraction</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A single slit of width <Tex>a</Tex> produces a diffraction pattern that
              modulates any multi-slit interference. Treating the slit as a continuous
              line of point sources and integrating, the intensity is
            </p>

            <div className="text-center py-1">
              <Tex display>{`I(\\theta) = I_0 \\,\\operatorname{sinc}^2\\!\\left(\\frac{\\pi a \\sin\\theta}{\\lambda}\\right)`}</Tex>
            </div>

            <p>
              where <Tex>{`\\operatorname{sinc}(x) = \\sin(x)/x`}</Tex>. The central maximum is
              twice as wide as the subsidiary maxima, and minima occur
              at <Tex>{`a\\sin\\theta = m\\lambda`}</Tex> for nonzero integers <Tex>m</Tex>.
              In a real double-slit experiment the observed pattern is
              the <Tex>{`\\cos^2`}</Tex> interference fringes multiplied by this
              sinc<Tex>{`^2`}</Tex> envelope.
            </p>
          </div>

          {/* Inline comparison canvas */}
          <figure className="mt-10">
            <canvas
              ref={comparisonCanvasRef}
              className="w-full rounded border"
              style={{ height: 280, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Comparison of intensity patterns: single slit (sinc<Tex>{`^2`}</Tex> envelope) vs
              double slit (<Tex>{`\\cos^2`}</Tex> fringes).
            </figcaption>
          </figure>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Coherence and visibility</h3>
            <p>
              The slider for phase difference <Tex>{`\\Delta\\phi`}</Tex> lets you explore
              what happens when the sources are not perfectly in phase. A nonzero
              phase offset shifts the entire fringe pattern. When the phase
              difference changes randomly over time (as with incoherent sources),
              the fringes wash out and the pattern approaches uniform illumination.
              The fringe visibility
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\mathcal{V} = \\frac{I_{\\max} - I_{\\min}}{I_{\\max} + I_{\\min}}`}</Tex>
            </div>

            <p>
              is a measure of coherence: <Tex>{`\\mathcal{V} = 1`}</Tex> for perfectly coherent
              sources and <Tex>{`\\mathcal{V} = 0`}</Tex> for completely incoherent ones.
              In the simulation, <Tex>{`\\Delta\\phi = 0`}</Tex> gives maximum
              visibility while increasing it shifts and eventually (with random
              variation) would destroy the pattern.
            </p>
          </div>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Young&rsquo;s experiment in context</h3>
            <p>
              Thomas Young&rsquo;s 1801 double-slit experiment was the first
              definitive demonstration that light is a wave. The observation of
              interference fringes &mdash; bright where waves arrive in phase, dark
              where they cancel &mdash; could not be explained by Newton&rsquo;s
              corpuscular theory.
            </p>
          </div>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Particles vs waves</h3>
            <p>
              A classical particle — a tiny billiard ball — would pass through one slit
              or the other and land in one of two clumps behind the slits. There would
              be no interference pattern, just two overlapping bumps. This is the
              prediction of Newton&rsquo;s corpuscular theory of light.
            </p>
            <p>
              The extraordinary fact is that when the experiment is performed with
              single photons, electrons, or even large molecules like C₆₀, each
              particle arrives at a single point on the screen — a definite detection
              event. But as detections accumulate one by one, the interference
              pattern gradually emerges. No individual particle &ldquo;interferes&rdquo;
              with another; each particle interferes with <em>itself</em>, exploring
              both paths simultaneously as a quantum amplitude.
            </p>
            <p>
              The simulation below shows this process. Each dot is a single
              detection event, sampled from the quantum probability
              distribution <Tex>{`|\\psi|^2 \\propto I(\\theta)`}</Tex>. Watch the
              pattern build up from apparent randomness into the characteristic
              fringe structure.
            </p>
          </div>

          <figure className="mt-10">
            <canvas
              ref={particleCanvasRef}
              className="w-full rounded border"
              style={{ height: 300, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Individual particle detections accumulating over time. Each dot is one detection event — the interference pattern emerges statistically.
            </figcaption>
          </figure>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

function SliderControl({
  label, symbol, unit, min, max, step, value, onChange, displayValue, colorIndicator,
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
  colorIndicator?: number; // wavelength in nm for color dot
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const colorDot = colorIndicator !== undefined
    ? (() => {
        const [r, g, b] = wavelengthToRGB(colorIndicator);
        return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
      })()
    : undefined;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-sm" style={{ color: "var(--muted)" }}>
          {label} <span className="italic" style={{ color: "var(--foreground)" }}>{symbol}</span>
          {colorDot && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full ml-1.5"
              style={{ backgroundColor: colorDot, verticalAlign: "middle" }}
            />
          )}
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
