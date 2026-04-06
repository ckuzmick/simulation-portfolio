"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import katex from "katex";
import "katex/dist/katex.min.css";
import { useTheme } from "../../theme-provider";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type CycleMode = "Carnot" | "Otto" | "Diesel" | "Stirling";

interface StatePoint {
  P: number; // pressure (Pa)
  V: number; // volume (m^3)
  T: number; // temperature (K)
  S: number; // entropy (J/K)
}

const GAMMA = 1.4;
const R_GAS = 8.314; // J/(mol*K)
const N_MOL = 1; // 1 mole of ideal gas
const Cv = R_GAS / (GAMMA - 1); // per mole
const Cp = GAMMA * Cv;

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
    border: g("--border"),
    accent: g("--accent"),
    isothermal: "#2563eb",
    adiabatic: "#dc2626",
    isochoric: "#16a34a",
    isobaric: "#ea580c",
    panel: g("--panel"),
    ke: g("--ke-color"),
    pe: g("--pe-color"),
    total: g("--total-color"),
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
// Cycle state-point computation
// ---------------------------------------------------------------------------

function computeCyclePoints(mode: CycleMode, TH: number, TC: number, r: number): StatePoint[] {
  // State 1: start of compression, low T, large volume
  // We pick V1 = r (compression ratio times a base volume)
  const V1base = 1.0; // base volume in arbitrary units (will be scaled for display)
  const V1 = V1base * r;
  const V2 = V1base;

  switch (mode) {
    case "Carnot": {
      // 1->2: isothermal compression at TC (Q rejected)
      // 2->3: adiabatic compression TC->TH
      // 3->4: isothermal expansion at TH (Q added)
      // 4->1: adiabatic expansion TH->TC
      const P1 = N_MOL * R_GAS * TC / V1;
      const S1 = N_MOL * Cv * Math.log(TC) + N_MOL * R_GAS * Math.log(V1);

      // Isothermal compression 1->2: T=TC, volume decreases
      // We need V2 such that adiabatic 2->3 reaches TH
      // TV^(g-1) = const => TC * V2^(g-1) = TH * V3^(g-1)
      // Also isothermal expansion 3->4 at TH, then adiabatic 4->1: TH*V4^(g-1) = TC*V1^(g-1)
      // V4/V3 = V1/V2 (symmetry of Carnot)
      const V2c = V1 * Math.pow(TC / TH, 1 / (GAMMA - 1));
      const P2 = N_MOL * R_GAS * TC / V2c;
      const S2 = N_MOL * Cv * Math.log(TC) + N_MOL * R_GAS * Math.log(V2c);

      // Adiabatic 2->3: TC->TH, V2c -> V3
      const V3 = V2c * Math.pow(TC / TH, 1 / (GAMMA - 1));
      const P3 = N_MOL * R_GAS * TH / V3;
      const S3 = S2; // adiabatic => constant entropy

      // Isothermal expansion 3->4 at TH
      const V4 = V1 * Math.pow(TC / TH, 1 / (GAMMA - 1)) * (V1 / V2c);
      // Actually, for Carnot: V4 = V3 * (V1/V2c) to close the cycle
      const V4c = V3 * (V1 / V2c);
      const P4 = N_MOL * R_GAS * TH / V4c;
      const S4 = N_MOL * Cv * Math.log(TH) + N_MOL * R_GAS * Math.log(V4c);

      return [
        { P: P1, V: V1, T: TC, S: S1 },
        { P: P2, V: V2c, T: TC, S: S2 },
        { P: P3, V: V3, T: TH, S: S3 },
        { P: P4, V: V4c, T: TH, S: S4 },
      ];
    }
    case "Otto": {
      // 1->2: adiabatic compression
      // 2->3: isochoric heat addition
      // 3->4: adiabatic expansion
      // 4->1: isochoric heat rejection
      const T1 = TC;
      const P1 = N_MOL * R_GAS * T1 / V1;
      const S1 = N_MOL * Cv * Math.log(T1) + N_MOL * R_GAS * Math.log(V1);

      // Adiabatic 1->2: TV^(g-1)=const
      const T2 = T1 * Math.pow(r, GAMMA - 1);
      const P2 = N_MOL * R_GAS * T2 / V2;
      const S2 = S1; // adiabatic

      // Isochoric 2->3: V=V2, T2->TH (we set T3=TH)
      const T3 = TH;
      const P3 = N_MOL * R_GAS * T3 / V2;
      const S3 = S2 + N_MOL * Cv * Math.log(T3 / T2);

      // Adiabatic 3->4: V2->V1
      const T4 = T3 * Math.pow(1 / r, GAMMA - 1);
      const P4 = N_MOL * R_GAS * T4 / V1;
      const S4 = S3; // adiabatic

      return [
        { P: P1, V: V1, T: T1, S: S1 },
        { P: P2, V: V2, T: T2, S: S2 },
        { P: P3, V: V2, T: T3, S: S3 },
        { P: P4, V: V1, T: T4, S: S4 },
      ];
    }
    case "Diesel": {
      // 1->2: adiabatic compression
      // 2->3: isobaric heat addition
      // 3->4: adiabatic expansion
      // 4->1: isochoric heat rejection
      const T1 = TC;
      const P1 = N_MOL * R_GAS * T1 / V1;
      const S1 = N_MOL * Cv * Math.log(T1) + N_MOL * R_GAS * Math.log(V1);

      const T2 = T1 * Math.pow(r, GAMMA - 1);
      const P2 = N_MOL * R_GAS * T2 / V2;
      const S2 = S1;

      // Isobaric 2->3: P=P2, heat added to reach TH
      const T3 = TH;
      const V3 = V2 * (T3 / T2);
      const P3 = P2;
      const S3 = S2 + N_MOL * Cp * Math.log(T3 / T2);

      // Adiabatic 3->4: expand to V1
      const T4 = T3 * Math.pow(V3 / V1, GAMMA - 1);
      const P4 = N_MOL * R_GAS * T4 / V1;
      const S4 = S3;

      return [
        { P: P1, V: V1, T: T1, S: S1 },
        { P: P2, V: V2, T: T2, S: S2 },
        { P: P3, V: V3, T: T3, S: S3 },
        { P: P4, V: V1, T: T4, S: S4 },
      ];
    }
    case "Stirling": {
      // 1->2: isothermal compression at TC
      // 2->3: isochoric heat addition TC->TH
      // 3->4: isothermal expansion at TH
      // 4->1: isochoric heat rejection TH->TC
      const T1 = TC;
      const P1 = N_MOL * R_GAS * T1 / V1;
      const S1 = N_MOL * Cv * Math.log(T1) + N_MOL * R_GAS * Math.log(V1);

      const T2 = TC;
      const P2 = N_MOL * R_GAS * T2 / V2;
      const S2 = N_MOL * Cv * Math.log(T2) + N_MOL * R_GAS * Math.log(V2);

      const T3 = TH;
      const P3 = N_MOL * R_GAS * T3 / V2;
      const S3 = S2 + N_MOL * Cv * Math.log(T3 / T2);

      const T4 = TH;
      const P4 = N_MOL * R_GAS * T4 / V1;
      const S4 = N_MOL * Cv * Math.log(T4) + N_MOL * R_GAS * Math.log(V1);

      return [
        { P: P1, V: V1, T: T1, S: S1 },
        { P: P2, V: V2, T: T2, S: S2 },
        { P: P3, V: V2, T: T3, S: S3 },
        { P: P4, V: V1, T: T4, S: S4 },
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Process types per cycle (for color coding)
// ---------------------------------------------------------------------------

function processTypes(mode: CycleMode): ("isothermal" | "adiabatic" | "isochoric" | "isobaric")[] {
  switch (mode) {
    case "Carnot": return ["isothermal", "adiabatic", "isothermal", "adiabatic"];
    case "Otto": return ["adiabatic", "isochoric", "adiabatic", "isochoric"];
    case "Diesel": return ["adiabatic", "isobaric", "adiabatic", "isochoric"];
    case "Stirling": return ["isothermal", "isochoric", "isothermal", "isochoric"];
  }
}

function processColor(type: string, C: Colors): string {
  switch (type) {
    case "isothermal": return C.isothermal;
    case "adiabatic": return C.adiabatic;
    case "isochoric": return C.isochoric;
    case "isobaric": return C.isobaric;
    default: return C.fg;
  }
}

// ---------------------------------------------------------------------------
// Interpolate between two state points along a thermodynamic process
// ---------------------------------------------------------------------------

function interpolateProcess(
  A: StatePoint, B: StatePoint, t: number,
  type: "isothermal" | "adiabatic" | "isochoric" | "isobaric"
): StatePoint {
  // t goes from 0 (at A) to 1 (at B)
  const clamp = Math.max(0, Math.min(1, t));

  switch (type) {
    case "isothermal": {
      const T = A.T;
      const logV = Math.log(A.V) + clamp * (Math.log(B.V) - Math.log(A.V));
      const V = Math.exp(logV);
      const P = N_MOL * R_GAS * T / V;
      const S = A.S + clamp * (B.S - A.S);
      return { P, V, T, S };
    }
    case "adiabatic": {
      const logV = Math.log(A.V) + clamp * (Math.log(B.V) - Math.log(A.V));
      const V = Math.exp(logV);
      // PV^gamma = const
      const P = A.P * Math.pow(A.V / V, GAMMA);
      const T = P * V / (N_MOL * R_GAS);
      const S = A.S + clamp * (B.S - A.S);
      return { P, V, T, S };
    }
    case "isochoric": {
      const V = A.V;
      const T = A.T + clamp * (B.T - A.T);
      const P = N_MOL * R_GAS * T / V;
      const S = A.S + clamp * (B.S - A.S);
      return { P, V, T, S };
    }
    case "isobaric": {
      const P = A.P;
      const V = A.V + clamp * (B.V - A.V);
      const T = P * V / (N_MOL * R_GAS);
      const S = A.S + clamp * (B.S - A.S);
      return { P, V, T, S };
    }
  }
}

// ---------------------------------------------------------------------------
// Compute work and heat for a cycle
// ---------------------------------------------------------------------------

function computeCycleThermo(points: StatePoint[], mode: CycleMode) {
  const types = processTypes(mode);
  let Qadd = 0;
  let Qrej = 0;

  for (let i = 0; i < 4; i++) {
    const A = points[i];
    const B = points[(i + 1) % 4];
    const type = types[i];
    let Q = 0;

    switch (type) {
      case "isothermal":
        Q = N_MOL * R_GAS * A.T * Math.log(B.V / A.V);
        break;
      case "adiabatic":
        Q = 0;
        break;
      case "isochoric":
        Q = N_MOL * Cv * (B.T - A.T);
        break;
      case "isobaric":
        Q = N_MOL * Cp * (B.T - A.T);
        break;
    }

    if (Q > 0) Qadd += Q;
    else Qrej += Math.abs(Q);
  }

  const W = Qadd - Qrej;
  const eta = Qadd > 0 ? W / Qadd : 0;
  const etaCarnot = 1 - points[0].T / Math.max(...points.map(p => p.T));

  return { Qadd, Qrej, W, eta, etaCarnot };
}

// ---------------------------------------------------------------------------
// Efficiency formula per cycle
// ---------------------------------------------------------------------------

function cycleEfficiency(mode: CycleMode, TH: number, TC: number, r: number): number {
  switch (mode) {
    case "Carnot": return 1 - TC / TH;
    case "Otto": return 1 - 1 / Math.pow(r, GAMMA - 1);
    case "Diesel": {
      const points = computeCyclePoints(mode, TH, TC, r);
      const rc = points[2].V / points[1].V; // cutoff ratio
      return 1 - (1 / Math.pow(r, GAMMA - 1)) * (Math.pow(rc, GAMMA) - 1) / (GAMMA * (rc - 1));
    }
    case "Stirling": return 1 - TC / TH; // with ideal regenerator
  }
}

// ---------------------------------------------------------------------------
// Engine schematic drawing — shows piston, cylinder, crankshaft, valves
// ---------------------------------------------------------------------------

function drawEngineSchematic(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  points: StatePoint[],
  types: string[],
  progress: number,
  mode: CycleMode,
  C: ReturnType<typeof getColors>
) {
  const nPts = points.length;
  const totalProgress = progress * nPts;
  const segIdx = Math.min(Math.floor(totalProgress), nPts - 1);
  const segFrac = totalProgress - segIdx;
  const p0 = points[segIdx];
  const p1 = points[(segIdx + 1) % nPts];
  const currentV = p0.V + (p1.V - p0.V) * segFrac;
  const currentT = p0.T + (p1.T - p0.T) * segFrac;
  const minV = Math.min(...points.map(p => p.V));
  const maxV = Math.max(...points.map(p => p.V));
  const vFrac = maxV > minV ? (currentV - minV) / (maxV - minV) : 0.5;
  const processType = types[segIdx];
  const procColor = processType === "isothermal" ? "#2563eb"
    : processType === "adiabatic" ? "#dc2626"
    : processType === "isochoric" ? "#16a34a" : "#ea580c";
  const fg = C.fg;
  const mt = C.muted;
  const tempNorm = Math.max(0, Math.min(1, (currentT - 200) / 800));
  const gasClr = `rgba(${Math.round(60 + tempNorm * 190)}, ${Math.round(60 + (1-tempNorm)*40)}, ${Math.round(190 - tempNorm * 150)}, 0.18)`;

  // --- Helpers ---
  function drawHorizCylinder(
    x: number, y: number, cylW: number, cylH: number,
    pistonFrac: number, label: string, gasColor: string
  ) {
    const pistonX = x + 8 + pistonFrac * (cylW - 24);
    // Cylinder
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, cylW, cylH);
    // Gas
    ctx.fillStyle = gasColor;
    ctx.fillRect(x + 1, y + 1, pistonX - x - 1, cylH - 2);
    // Piston
    ctx.fillStyle = C.fg;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(pistonX, y + 2, 10, cylH - 4);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(pistonX, y + 2, 10, cylH - 4);
    // Rod
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pistonX + 10, y + cylH / 2);
    ctx.lineTo(x + cylW + 20, y + cylH / 2);
    ctx.stroke();
    // Label
    ctx.fillStyle = C.muted;
    ctx.font = "italic 10px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + cylW / 2, y + cylH + 4);
  }

  // Helper: heat flow arrow
  function heatArrow(x1: number, y1: number, x2: number, y2: number, color: string, label: string) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / len, uy = dy / len;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * 8 - uy * 4, y2 - uy * 8 + ux * 4);
    ctx.lineTo(x2 - ux * 8 + uy * 4, y2 - uy * 8 - ux * 4);
    ctx.closePath();
    ctx.fill();
    ctx.font = "italic 11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, (x1 + x2) / 2, Math.min(y1, y2) - 4);
  }

  function drawArrowLine(x1: number, y1: number, x2: number, y2: number, color: string, lw: number = 2) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const dx = x2-x1, dy = y2-y1, len = Math.sqrt(dx*dx+dy*dy);
    if (len < 4) return;
    const ux = dx/len, uy = dy/len, hl = 7;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2-ux*hl-uy*3, y2-uy*hl+ux*3);
    ctx.lineTo(x2-ux*hl+uy*3, y2-uy*hl-ux*3);
    ctx.closePath();
    ctx.fill();
  }

  function drawFlames(x: number, y: number, count: number, spread: number) {
    for (let i = 0; i < count; i++) {
      const fx = x - spread/2 + (i/(count-1)) * spread;
      const fl = Math.sin(progress * 18 + i * 1.5) * 3;
      ctx.fillStyle = `rgba(255, ${140 + Math.round(fl*8)}, 0, 0.55)`;
      ctx.beginPath();
      ctx.moveTo(fx - 5, y);
      ctx.quadraticCurveTo(fx - 2, y + 12 + fl, fx, y + 16 + fl);
      ctx.quadraticCurveTo(fx + 2, y + 12 - fl, fx + 5, y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Draw animated gas particles inside a region
  function drawGasParticles(
    rx: number, ry: number, rw: number, rh: number,
    temp: number, particleKey: string
  ) {
    const numP = 30;
    const speed = 0.5 + (temp / 400) * 2.5; // faster = hotter
    // Use a deterministic seed from particleKey + progress for positions
    // Simulate simple bouncing particles
    const t = progress * 200;
    for (let i = 0; i < numP; i++) {
      const seed1 = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const seed2 = Math.sin(i * 269.5 + 183.3) * 43758.5453;
      const phase1 = (seed1 - Math.floor(seed1));
      const phase2 = (seed2 - Math.floor(seed2));
      // Bouncing motion
      const freq1 = 0.3 + phase1 * speed * 0.8;
      const freq2 = 0.4 + phase2 * speed * 0.7;
      const px = rx + 4 + ((Math.sin(t * freq1 + phase1 * 100) + 1) / 2) * (rw - 8);
      const py = ry + 4 + ((Math.sin(t * freq2 + phase2 * 100) + 1) / 2) * (rh - 8);
      // Color by temperature
      const tNorm = Math.max(0, Math.min(1, (temp - 200) / 600));
      const pr = Math.round(40 + tNorm * 215);
      const pg = Math.round(80 + (1-tNorm) * 40 - tNorm * 40);
      const pb = Math.round(220 - tNorm * 180);
      ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, 0.7)`;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawCylinder(cx2: number, cy2: number, cw: number, ch: number, pistonFrac: number, vertical: boolean, particleKey?: string) {
    const pistonThk = 16;
    const wallThk = 6; // visible wall thickness
    if (!vertical) return cy2;

    // Outer cylinder block (thick walls)
    ctx.fillStyle = fg; ctx.globalAlpha = 0.04;
    ctx.fillRect(cx2 - wallThk, cy2 - 8, cw + wallThk * 2, ch + 8);
    ctx.globalAlpha = 1;
    // Left wall
    ctx.fillStyle = fg; ctx.globalAlpha = 0.08;
    ctx.fillRect(cx2 - wallThk, cy2, wallThk, ch);
    // Right wall
    ctx.fillRect(cx2 + cw, cy2, wallThk, ch);
    ctx.globalAlpha = 1;
    // Wall outlines — inner bore
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx2, cy2); ctx.lineTo(cx2, cy2 + ch); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2 + cw, cy2); ctx.lineTo(cx2 + cw, cy2 + ch); ctx.stroke();
    // Outer outlines
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx2 - wallThk, cy2 - 8); ctx.lineTo(cx2 - wallThk, cy2 + ch); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx2 + cw + wallThk, cy2 - 8); ctx.lineTo(cx2 + cw + wallThk, cy2 + ch); ctx.stroke();
    // Head — thick top plate
    ctx.fillStyle = fg; ctx.globalAlpha = 0.08;
    ctx.fillRect(cx2 - wallThk, cy2 - 8, cw + wallThk * 2, 10);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx2 - wallThk, cy2 - 8, cw + wallThk * 2, 10);
    // Head bolts
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx2 - wallThk/2, cy2 - 3, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx2 + cw + wallThk/2, cy2 - 3, 2, 0, Math.PI*2); ctx.fill();

    // Piston position
    const pistonY = cy2 + 6 + (1 - pistonFrac) * (ch - pistonThk - 10);
    // Gas fill
    ctx.fillStyle = gasClr;
    ctx.fillRect(cx2 + 1, cy2 + 2, cw - 2, pistonY - cy2 - 2);
    // Gas particles
    if (particleKey) {
      drawGasParticles(cx2 + 2, cy2 + 3, cw - 4, Math.max(4, pistonY - cy2 - 6), currentT, particleKey);
    }
    // Piston — solid block with rings
    ctx.fillStyle = fg; ctx.globalAlpha = 0.12;
    ctx.fillRect(cx2 + 2, pistonY, cw - 4, pistonThk);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx2 + 2, pistonY, cw - 4, pistonThk);
    // Compression rings (3 grooves)
    ctx.strokeStyle = mt; ctx.lineWidth = 0.8;
    for (let r = 0; r < 3; r++) {
      const ry = pistonY + 3 + r * 3.5;
      ctx.beginPath(); ctx.moveTo(cx2 + 4, ry); ctx.lineTo(cx2 + cw - 4, ry); ctx.stroke();
    }
    // Wrist pin (visible circle in piston center)
    const wristY = pistonY + pistonThk - 4;
    ctx.strokeStyle = fg; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx2 + cw/2, wristY, 3.5, 0, Math.PI*2); ctx.stroke();

    return wristY;
  }

  function drawConRod(fromX: number, fromY: number, toX: number, toY: number, rodWidth: number) {
    // Draw an I-beam shaped connecting rod between two pin joints
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len < 2) return;
    const ux = dx/len, uy = dy/len;
    const nx = -uy, ny = ux; // perpendicular

    // Rod body — narrow center, wider at ends
    const endW = rodWidth, midW = rodWidth * 0.5;
    ctx.fillStyle = fg; ctx.globalAlpha = 0.06;
    ctx.beginPath();
    ctx.moveTo(fromX + nx*endW, fromY + ny*endW);
    ctx.lineTo(fromX + ux*len*0.2 + nx*midW, fromY + uy*len*0.2 + ny*midW);
    ctx.lineTo(toX - ux*len*0.2 + nx*midW, toY - uy*len*0.2 + ny*midW);
    ctx.lineTo(toX + nx*endW, toY + ny*endW);
    ctx.lineTo(toX - nx*endW, toY - ny*endW);
    ctx.lineTo(toX - ux*len*0.2 - nx*midW, toY - uy*len*0.2 - ny*midW);
    ctx.lineTo(fromX + ux*len*0.2 - nx*midW, fromY + uy*len*0.2 - ny*midW);
    ctx.lineTo(fromX - nx*endW, fromY - ny*endW);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg; ctx.lineWidth = 1.2;
    ctx.stroke();

    // Pin joints at each end
    ctx.strokeStyle = fg; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(fromX, fromY, 4, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(toX, toY, 4, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(fromX, fromY, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(toX, toY, 1.5, 0, Math.PI*2); ctx.fill();
  }

  function drawCrankshaft(cx2: number, cy2: number, r: number, connectToY: number, connectFromX: number) {
    const ang = progress * Math.PI * 2;
    const pinX = cx2 + Math.cos(ang) * r;
    const pinY = cy2 + Math.sin(ang) * r;

    // Flywheel — rim with spokes
    const fwR = r + 14;
    ctx.strokeStyle = fg; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx2, cy2, fwR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = fg; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx2, cy2, fwR - 4, 0, Math.PI * 2); ctx.stroke();
    // Spokes
    ctx.strokeStyle = mt; ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const sa = ang + (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx2 + Math.cos(sa) * 6, cy2 + Math.sin(sa) * 6);
      ctx.lineTo(cx2 + Math.cos(sa) * (fwR - 5), cy2 + Math.sin(sa) * (fwR - 5));
      ctx.stroke();
    }
    // Hub
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx2, cy2, 7, 0, Math.PI*2); ctx.stroke();

    // Crank arm — thick solid bar
    ctx.fillStyle = fg; ctx.globalAlpha = 0.1;
    const armW = 5;
    const nx2 = -(pinY - cy2) / r, ny2 = (pinX - cx2) / r;
    ctx.beginPath();
    ctx.moveTo(cx2 + nx2*armW, cy2 + ny2*armW);
    ctx.lineTo(pinX + nx2*armW, pinY + ny2*armW);
    ctx.lineTo(pinX - nx2*armW, pinY - ny2*armW);
    ctx.lineTo(cx2 - nx2*armW, cy2 - ny2*armW);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
    ctx.stroke();

    // Counterweight (opposite side of crank pin)
    const cwAng = ang + Math.PI;
    const cwR = r * 0.7;
    ctx.fillStyle = fg; ctx.globalAlpha = 0.08;
    ctx.beginPath();
    ctx.arc(cx2, cy2, cwR + 6, cwAng - 0.6, cwAng + 0.6);
    ctx.lineTo(cx2 + Math.cos(cwAng) * 4, cy2 + Math.sin(cwAng) * 4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = fg; ctx.lineWidth = 1;
    ctx.stroke();

    // Connecting rod (I-beam shape)
    drawConRod(connectFromX, connectToY, pinX, pinY, 5);

    // Main journal (center)
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx2, cy2, 3, 0, Math.PI*2); ctx.fill();
  }

  if (mode === "Carnot") {
    // --- Watt beam engine with boiler + condenser ---
    const cx = w / 2;

    // Boiler (hot reservoir) — large box on left
    const bx = 40, by = h - 140, bw = 120, bh = 80;
    ctx.fillStyle = "rgba(220, 60, 60, 0.06)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    // Brick pattern
    ctx.strokeStyle = mt; ctx.lineWidth = 0.5;
    for (let row = 0; row < 4; row++) {
      const ry = by + bh + 4 + row * 10;
      ctx.beginPath(); ctx.moveTo(bx - 6, ry); ctx.lineTo(bx + bw + 6, ry); ctx.stroke();
      for (let col = 0; col < 7; col++) {
        const rx = bx - 6 + col * 20 + (row % 2) * 10;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry + 10); ctx.stroke();
      }
    }
    drawFlames(bx + bw / 2, by + bh, 6, bw - 20);
    ctx.fillStyle = "#dc2626";
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("boiler (T_H)", bx + bw / 2, by - 6);

    // Condenser — right side with water cooling
    const condx = w - 160, condy = by, condw = 120, condh = 80;
    ctx.fillStyle = "rgba(40, 80, 200, 0.06)";
    ctx.fillRect(condx, condy, condw, condh);
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.strokeRect(condx, condy, condw, condh);
    // Cooling water lines inside
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 0.8;
    for (let i = 0; i < 5; i++) {
      const ly = condy + 12 + i * 14;
      ctx.beginPath();
      ctx.moveTo(condx + 8, ly);
      for (let sx = 0; sx < condw - 16; sx += 8) {
        ctx.lineTo(condx + 8 + sx + 4, ly + (sx % 16 < 8 ? 3 : -3));
      }
      ctx.stroke();
    }
    ctx.fillStyle = "#2563eb";
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("condenser (T_C)", condx + condw / 2, condy - 6);

    // Beam — the rocking beam at top
    const pivotY = 55, pivotX = cx;
    const beamLen = Math.min(w * 0.35, 180);
    const beamAngle = (vFrac - 0.5) * 0.15;
    // Support column
    ctx.strokeStyle = fg; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX, pivotY - 30); ctx.stroke();
    // Support base triangle
    ctx.beginPath();
    ctx.moveTo(pivotX - 16, pivotY - 30);
    ctx.lineTo(pivotX + 16, pivotY - 30);
    ctx.lineTo(pivotX, pivotY - 46);
    ctx.closePath();
    ctx.stroke();
    // Beam
    const lx = pivotX - Math.cos(beamAngle) * beamLen;
    const ly = pivotY + Math.sin(beamAngle) * beamLen;
    const rx = pivotX + Math.cos(beamAngle) * beamLen;
    const ry2 = pivotY - Math.sin(beamAngle) * beamLen;
    ctx.strokeStyle = fg; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry2); ctx.stroke();
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(pivotX, pivotY, 5, 0, Math.PI*2); ctx.fill();

    // Left piston (power cylinder) under beam
    const pcW2 = 50, pcH2 = 100;
    const pcX2 = lx - pcW2/2, pcY2 = ly + 20;
    const pistonPos = drawCylinder(pcX2, pcY2, pcW2, pcH2, vFrac, true, "power");
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx, pistonPos); ctx.stroke();

    // Right pump cylinder
    const ppX2 = rx - pcW2/2, ppY2 = ry2 + 20;
    const pumpPos = drawCylinder(ppX2, ppY2, pcW2, pcH2, 1-vFrac, true, "pump");
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(rx, ry2); ctx.lineTo(rx, pumpPos); ctx.stroke();

    // Steam pipes
    ctx.strokeStyle = mt; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(bx + bw, by + 20);
    ctx.lineTo(bx + bw + 15, by + 20);
    ctx.lineTo(pcX2 + pcW2/2 - 15, pcY2 + pcH2);
    ctx.lineTo(pcX2 + pcW2/2, pcY2 + pcH2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ppX2 + pcW2/2, ppY2 + pcH2);
    ctx.lineTo(ppX2 + pcW2/2 + 15, ppY2 + pcH2);
    ctx.lineTo(condx - 15, condy + 20);
    ctx.lineTo(condx, condy + 20);
    ctx.stroke();
    ctx.setLineDash([]);

    // Heat flow arrows
    const expanding = currentV > (minV + maxV) / 2;
    if (processType === "isothermal") {
      if (expanding) {
        drawArrowLine(bx + bw/2, by - 12, bx + bw/2, by - 35, "#dc2626", 2.5);
        ctx.fillStyle = "#dc2626"; ctx.font = "italic 12px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("Q_H in", bx + bw/2 + 30, by - 20);
      } else {
        drawArrowLine(condx + condw/2, condy - 35, condx + condw/2, condy - 12, "#2563eb", 2.5);
        ctx.fillStyle = "#2563eb"; ctx.font = "italic 12px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
        ctx.fillText("Q_C out", condx + condw/2 + 32, condy - 20);
      }
    }

    // Labels
    ctx.fillStyle = mt; ctx.font = "italic 11px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("power cylinder", lx, pcY2 + pcH2 + 6);
    ctx.fillText("pump", rx, ppY2 + pcH2 + 6);

  } else if (mode === "Otto" || mode === "Diesel") {
    // --- Detailed 4-stroke ICE ---
    const cx = w / 2;
    const cylW2 = 100, cylH2 = 160;
    const cylX2 = cx - cylW2 / 2, cylTop2 = 60;
    const pistonMid = drawCylinder(cylX2, cylTop2, cylW2, cylH2, vFrac, true, "main");

    // Connecting rod + crankshaft
    const crankY2 = cylTop2 + cylH2 + 55;
    drawCrankshaft(cx, crankY2, 28, pistonMid, cx);

    // Intake manifold (left, curved pipe)
    const intakeOpen = segIdx === 0;
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cylX2 + 18, cylTop2 - 6);
    ctx.quadraticCurveTo(cylX2 - 10, cylTop2 - 20, cylX2 - 40, cylTop2 - 50);
    ctx.stroke();
    // Intake port/valve
    ctx.fillStyle = intakeOpen ? "#16a34a" : mt;
    ctx.globalAlpha = intakeOpen ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(cylX2 + 12, cylTop2);
    ctx.lineTo(cylX2 + 24, cylTop2);
    ctx.lineTo(cylX2 + 21, cylTop2 - (intakeOpen ? 10 : 3));
    ctx.lineTo(cylX2 + 15, cylTop2 - (intakeOpen ? 10 : 3));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Air filter box
    ctx.strokeStyle = mt; ctx.lineWidth = 1.5;
    ctx.strokeRect(cylX2 - 60, cylTop2 - 65, 40, 20);
    ctx.fillStyle = mt; ctx.font = "9px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("air", cylX2 - 40, cylTop2 - 55);

    // Exhaust manifold (right, curved pipe)
    const exhaustOpen = segIdx === 3;
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cylX2 + cylW2 - 18, cylTop2 - 6);
    ctx.quadraticCurveTo(cylX2 + cylW2 + 10, cylTop2 - 20, cylX2 + cylW2 + 40, cylTop2 - 50);
    ctx.stroke();
    // Exhaust valve
    ctx.fillStyle = exhaustOpen ? "#dc2626" : mt;
    ctx.globalAlpha = exhaustOpen ? 1 : 0.35;
    ctx.beginPath();
    ctx.moveTo(cylX2 + cylW2 - 24, cylTop2);
    ctx.lineTo(cylX2 + cylW2 - 12, cylTop2);
    ctx.lineTo(cylX2 + cylW2 - 15, cylTop2 - (exhaustOpen ? 10 : 3));
    ctx.lineTo(cylX2 + cylW2 - 21, cylTop2 - (exhaustOpen ? 10 : 3));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // Exhaust pipe end
    ctx.strokeStyle = mt; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cylX2 + cylW2 + 40, cylTop2 - 50);
    ctx.lineTo(cylX2 + cylW2 + 60, cylTop2 - 60);
    ctx.stroke();
    ctx.fillStyle = mt; ctx.font = "9px Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("exhaust", cylX2 + cylW2 + 42, cylTop2 - 68);

    // Spark plug or fuel injector
    if (mode === "Otto") {
      const sparking = segIdx === 1;
      // Spark plug body
      ctx.fillStyle = mt; ctx.fillRect(cx - 3, cylTop2 - 20, 6, 16);
      ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.strokeRect(cx - 3, cylTop2 - 20, 6, 16);
      // Electrode
      ctx.strokeStyle = fg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(cx, cylTop2 - 4); ctx.lineTo(cx, cylTop2 + 6); ctx.stroke();
      if (sparking) {
        ctx.strokeStyle = "#facc15"; ctx.lineWidth = 1.5;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + progress * 15;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * 4, cylTop2 + 4 + Math.sin(a) * 4);
          ctx.lineTo(cx + Math.cos(a) * 14, cylTop2 + 4 + Math.sin(a) * 14);
          ctx.stroke();
        }
        ctx.fillStyle = "#facc15"; ctx.globalAlpha = 0.3;
        ctx.beginPath(); ctx.arc(cx, cylTop2 + 4, 16, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = mt; ctx.font = "italic 10px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("spark plug", cx, cylTop2 - 24);
    } else {
      const injecting = segIdx === 1;
      ctx.fillStyle = mt; ctx.fillRect(cx - 4, cylTop2 - 22, 8, 18);
      ctx.strokeStyle = fg; ctx.lineWidth = 1; ctx.strokeRect(cx - 4, cylTop2 - 22, 8, 18);
      // Nozzle
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.moveTo(cx - 2, cylTop2 - 4); ctx.lineTo(cx + 2, cylTop2 - 4); ctx.lineTo(cx, cylTop2 + 2); ctx.closePath(); ctx.fill();
      if (injecting) {
        ctx.fillStyle = "rgba(234, 88, 12, 0.35)";
        ctx.beginPath();
        ctx.moveTo(cx, cylTop2 + 2);
        ctx.lineTo(cx - 16, cylTop2 + 35);
        ctx.lineTo(cx + 16, cylTop2 + 35);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = mt; ctx.font = "italic 10px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("fuel injector", cx, cylTop2 - 26);
    }

    // Stroke label + description on the right
    const strokeNames = mode === "Otto"
      ? ["1. compression", "2. combustion", "3. power stroke", "4. exhaust"]
      : ["1. compression", "2. fuel injection", "3. power stroke", "4. exhaust"];
    ctx.fillStyle = procColor;
    ctx.font = "14px Georgia, serif";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText(strokeNames[segIdx], cylX2 + cylW2 + 50, cylTop2 + cylH2 / 2 - 10);
    ctx.fillStyle = mt; ctx.font = "italic 12px Georgia, serif";
    ctx.fillText(processType, cylX2 + cylW2 + 50, cylTop2 + cylH2 / 2 + 10);

    // Valve labels
    ctx.fillStyle = mt; ctx.font = "italic 10px Georgia, serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("intake valve", cylX2 + 18, cylTop2 - 8);
    ctx.fillText("exhaust valve", cylX2 + cylW2 - 18, cylTop2 - 8);

  } else {
    // --- Alpha-type Stirling engine with two opposed cylinders ---
    const cx = w / 2;
    const hotCylW = 70, hotCylH = 140;
    const coldCylW = 70, coldCylH = 140;
    const cylTop2 = 80;
    const spacing = 160;

    // Hot cylinder (left, vertical)
    const hcx = cx - spacing / 2 - hotCylW / 2;
    const hotPistonPos = drawCylinder(hcx, cylTop2, hotCylW, hotCylH, vFrac, true, "hot");

    // Cold cylinder (right, vertical)
    const ccx = cx + spacing / 2 - coldCylW / 2;
    const coldPistonPos = drawCylinder(ccx, cylTop2, coldCylW, coldCylH, 1 - vFrac, true, "cold");

    // Heater head around hot cylinder top (red glow)
    ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hcx + hotCylW / 2, cylTop2 - 6, hotCylW / 2 + 12, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = "#dc2626"; ctx.lineWidth = 1.5;
    // Heat fins
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const ir = hotCylW / 2 + 14, or = hotCylW / 2 + 24;
      ctx.beginPath();
      ctx.moveTo(hcx + hotCylW/2 + Math.cos(a)*ir, cylTop2 - 6 + Math.sin(a)*ir);
      ctx.lineTo(hcx + hotCylW/2 + Math.cos(a)*or, cylTop2 - 6 + Math.sin(a)*or);
      ctx.stroke();
    }
    drawFlames(hcx + hotCylW / 2, cylTop2 - 40, 5, 60);
    ctx.fillStyle = "#dc2626"; ctx.font = "italic 12px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("heat source (T_H)", hcx + hotCylW / 2, cylTop2 - 48);

    // Cooler around cold cylinder top (blue)
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ccx + coldCylW / 2, cylTop2 - 6, coldCylW / 2 + 12, Math.PI, 0);
    ctx.stroke();
    // Cooling fins
    ctx.strokeStyle = "#2563eb"; ctx.lineWidth = 1.5;
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      const ir = coldCylW / 2 + 14, or = coldCylW / 2 + 24;
      ctx.beginPath();
      ctx.moveTo(ccx + coldCylW/2 + Math.cos(a)*ir, cylTop2 - 6 + Math.sin(a)*ir);
      ctx.lineTo(ccx + coldCylW/2 + Math.cos(a)*or, cylTop2 - 6 + Math.sin(a)*or);
      ctx.stroke();
    }
    ctx.fillStyle = "#2563eb"; ctx.font = "italic 12px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("heat sink (T_C)", ccx + coldCylW / 2, cylTop2 - 48);

    // Regenerator — central box with mesh pattern
    const regW = 36, regH = 80;
    const regX = cx - regW / 2, regY = cylTop2 + 10;
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.strokeRect(regX, regY, regW, regH);
    // Mesh pattern
    ctx.strokeStyle = mt; ctx.lineWidth = 0.6;
    for (let ry = regY + 6; ry < regY + regH - 2; ry += 5) {
      ctx.beginPath(); ctx.moveTo(regX + 3, ry); ctx.lineTo(regX + regW - 3, ry); ctx.stroke();
    }
    for (let rx2 = regX + 6; rx2 < regX + regW - 2; rx2 += 7) {
      ctx.beginPath(); ctx.moveTo(rx2, regY + 3); ctx.lineTo(rx2, regY + regH - 3); ctx.stroke();
    }
    ctx.fillStyle = fg; ctx.font = "italic 11px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("regenerator", cx, regY + regH + 6);

    // Connecting tubes from cylinders to regenerator
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    // Hot side tube
    ctx.beginPath();
    ctx.moveTo(hcx + hotCylW, cylTop2 + 20);
    ctx.lineTo(hcx + hotCylW + 10, cylTop2 + 20);
    ctx.lineTo(regX - 5, regY + 15);
    ctx.lineTo(regX, regY + 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hcx + hotCylW, cylTop2 + 30);
    ctx.lineTo(hcx + hotCylW + 10, cylTop2 + 30);
    ctx.lineTo(regX - 5, regY + 25);
    ctx.lineTo(regX, regY + 25);
    ctx.stroke();
    // Cold side tube
    ctx.beginPath();
    ctx.moveTo(regX + regW, regY + 15);
    ctx.lineTo(regX + regW + 5, regY + 15);
    ctx.lineTo(ccx - 10, cylTop2 + 20);
    ctx.lineTo(ccx, cylTop2 + 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(regX + regW, regY + 25);
    ctx.lineTo(regX + regW + 5, regY + 25);
    ctx.lineTo(ccx - 10, cylTop2 + 30);
    ctx.lineTo(ccx, cylTop2 + 30);
    ctx.stroke();

    // Crankshaft + flywheel at bottom center
    const crankY3 = cylTop2 + hotCylH + 55;
    const crankR3 = 25;
    const ang2 = progress * Math.PI * 2;
    // Flywheel
    ctx.strokeStyle = mt; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, crankY3, crankR3 + 12, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, crankY3); ctx.lineTo(cx + Math.cos(ang2)*crankR3, crankY3 + Math.sin(ang2)*crankR3); ctx.stroke();
    // Hot side connecting rod
    const hpinX = cx + Math.cos(ang2) * crankR3;
    const hpinY = crankY3 + Math.sin(ang2) * crankR3;
    ctx.strokeStyle = fg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hcx + hotCylW/2, hotPistonPos); ctx.lineTo(hpinX, hpinY); ctx.stroke();
    // Cold side connecting rod (90 degrees offset)
    const cpinX = cx + Math.cos(ang2 + Math.PI/2) * crankR3;
    const cpinY = crankY3 + Math.sin(ang2 + Math.PI/2) * crankR3;
    ctx.beginPath(); ctx.moveTo(ccx + coldCylW/2, coldPistonPos); ctx.lineTo(cpinX, cpinY); ctx.stroke();
    // Journals
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, crankY3, 4, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(hpinX, hpinY, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cpinX, cpinY, 3, 0, Math.PI*2); ctx.fill();

    // Labels
    ctx.fillStyle = mt; ctx.font = "italic 11px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillText("hot piston", hcx + hotCylW/2, cylTop2 + hotCylH + 6);
    ctx.fillText("cold piston", ccx + coldCylW/2, cylTop2 + coldCylH + 6);
    ctx.fillText("flywheel", cx, crankY3 + crankR3 + 18);
  }

  // Process label at bottom
  ctx.fillStyle = procColor;
  ctx.font = "italic 13px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(processType, w / 2, h - 6);

  // Title
  ctx.fillStyle = C.fg;
  ctx.font = "13px Georgia, serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const titles: Record<CycleMode, string> = {
    Carnot: "Watt beam engine (Carnot cycle)",
    Otto: "4-stroke petrol engine (Otto cycle)",
    Diesel: "Compression-ignition engine (Diesel cycle)",
    Stirling: "Alpha-type Stirling engine",
  };
  ctx.fillText(titles[mode], 12, 8);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANIM_SPEED = 0.3; // fraction of cycle per second

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ThermodynamicCyclesPage() {
  const { theme, toggle } = useTheme();
  const [mode, setMode] = useState<CycleMode>("Carnot");
  const [TH, setTH] = useState(600);
  const [TC, setTC] = useState(300);
  const [compressionRatio, setCompressionRatio] = useState(8);
  const [running, setRunning] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  const pvCanvasRef = useRef<HTMLCanvasElement>(null);
  const pistonCanvasRef = useRef<HTMLCanvasElement>(null);
  const tsCanvasRef = useRef<HTMLCanvasElement>(null);
  const engineCanvasRef = useRef<HTMLCanvasElement>(null);
  // Gas particles for engine schematic
  const engineParticlesRef = useRef<{ x: number; y: number; vx: number; vy: number }[]>([]);

  const animRef = useRef(0); // 0-4 progress around cycle
  const rafRef = useRef(0);
  const runningRef = useRef(running);
  const lastTimeRef = useRef(0);
  const colorsRef = useRef<Colors | null>(null);
  const paramsRef = useRef({ mode, TH, TC, compressionRatio });

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { paramsRef.current = { mode, TH, TC, compressionRatio }; }, [mode, TH, TC, compressionRatio]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const reset = useCallback(() => {
    animRef.current = 0;
    lastTimeRef.current = 0;
  }, []);

  useEffect(() => { reset(); }, [mode, TH, TC, compressionRatio, reset]);

  const cycleMode = useCallback(() => {
    const modes: CycleMode[] = ["Carnot", "Otto", "Diesel", "Stirling"];
    setMode(m => modes[(modes.indexOf(m) + 1) % modes.length]);
  }, []);

  // --- Drawing helpers ---

  function drawPVDiagram(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    points: StatePoint[], types: string[], progress: number, C: Colors
  ) {
    if (w < 1 || h < 1) return;
    ctx.clearRect(0, 0, w, h);

    const margin = { left: 52, right: 20, top: 20, bottom: 36 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    // Compute bounds
    const allPoints: StatePoint[] = [];
    for (let i = 0; i < 4; i++) {
      const A = points[i];
      const B = points[(i + 1) % 4];
      const type = types[i] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
      for (let t = 0; t <= 1; t += 0.02) {
        allPoints.push(interpolateProcess(A, B, t, type));
      }
    }

    let minV = Infinity, maxV = -Infinity, minP = Infinity, maxP = -Infinity;
    for (const p of allPoints) {
      if (p.V < minV) minV = p.V;
      if (p.V > maxV) maxV = p.V;
      if (p.P < minP) minP = p.P;
      if (p.P > maxP) maxP = p.P;
    }
    const padV = (maxV - minV) * 0.1;
    const padP = (maxP - minP) * 0.1;
    minV -= padV; maxV += padV;
    minP -= padP; maxP += padP;

    const toX = (V: number) => margin.left + ((V - minV) / (maxV - minV)) * plotW;
    const toY = (P: number) => margin.top + plotH - ((P - minP) / (maxP - minP)) * plotH;

    // Grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
      const x = margin.left + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotH); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = C.muted;
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("V", margin.left + plotW / 2, h - 6);
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("P", 0, 0);
    ctx.restore();

    // Draw cycle paths
    for (let i = 0; i < 4; i++) {
      const A = points[i];
      const B = points[(i + 1) % 4];
      const type = types[i] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
      ctx.strokeStyle = processColor(type, C);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = 60;
      for (let s = 0; s <= steps; s++) {
        const pt = interpolateProcess(A, B, s / steps, type);
        const px = toX(pt.V);
        const py = toY(pt.P);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Direction arrow at midpoint
      const mid = interpolateProcess(A, B, 0.5, type);
      const midNext = interpolateProcess(A, B, 0.52, type);
      const ax = toX(midNext.V) - toX(mid.V);
      const ay = toY(midNext.P) - toY(mid.P);
      const alen = Math.sqrt(ax * ax + ay * ay);
      if (alen > 0.5) {
        const ux = ax / alen;
        const uy = ay / alen;
        const mx = toX(mid.V);
        const my = toY(mid.P);
        ctx.fillStyle = processColor(type, C);
        ctx.beginPath();
        ctx.moveTo(mx + ux * 6, my + uy * 6);
        ctx.lineTo(mx - ux * 3 - uy * 4, my - uy * 3 + ux * 4);
        ctx.lineTo(mx - ux * 3 + uy * 4, my - uy * 3 - ux * 4);
        ctx.closePath();
        ctx.fill();
      }
    }

    // State point labels
    for (let i = 0; i < 4; i++) {
      const px = toX(points[i].V);
      const py = toY(points[i].P);
      ctx.fillStyle = C.fg;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${i + 1}`, px, py - 8);
    }

    // Animate state point
    const seg = Math.floor(progress) % 4;
    const frac = progress - Math.floor(progress);
    const type = types[seg] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
    const current = interpolateProcess(points[seg], points[(seg + 1) % 4], frac, type);
    const cx = toX(current.V);
    const cy = toY(current.P);
    ctx.fillStyle = C.accent;
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawTSDiagram(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    points: StatePoint[], types: string[], progress: number, C: Colors
  ) {
    if (w < 1 || h < 1) return;
    ctx.clearRect(0, 0, w, h);

    const margin = { left: 52, right: 20, top: 20, bottom: 36 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    // Compute bounds
    const allPoints: StatePoint[] = [];
    for (let i = 0; i < 4; i++) {
      const A = points[i];
      const B = points[(i + 1) % 4];
      const type = types[i] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
      for (let t = 0; t <= 1; t += 0.02) {
        allPoints.push(interpolateProcess(A, B, t, type));
      }
    }

    let minS = Infinity, maxS = -Infinity, minT = Infinity, maxT = -Infinity;
    for (const p of allPoints) {
      if (p.S < minS) minS = p.S;
      if (p.S > maxS) maxS = p.S;
      if (p.T < minT) minT = p.T;
      if (p.T > maxT) maxT = p.T;
    }
    const padS = (maxS - minS) * 0.1 || 1;
    const padT = (maxT - minT) * 0.1 || 1;
    minS -= padS; maxS += padS;
    minT -= padT; maxT += padT;

    const toX = (S: number) => margin.left + ((S - minS) / (maxS - minS)) * plotW;
    const toY = (T: number) => margin.top + plotH - ((T - minT) / (maxT - minT)) * plotH;

    // Grid
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(margin.left, y); ctx.lineTo(margin.left + plotW, y); ctx.stroke();
      const x = margin.left + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, margin.top); ctx.lineTo(x, margin.top + plotH); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();

    // Labels
    ctx.fillStyle = C.muted;
    ctx.font = "italic 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("S", margin.left + plotW / 2, h - 6);
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("T", 0, 0);
    ctx.restore();

    // Draw cycle paths
    for (let i = 0; i < 4; i++) {
      const A = points[i];
      const B = points[(i + 1) % 4];
      const type = types[i] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
      ctx.strokeStyle = processColor(type, C);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = 60;
      for (let s = 0; s <= steps; s++) {
        const pt = interpolateProcess(A, B, s / steps, type);
        const px = toX(pt.S);
        const py = toY(pt.T);
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // State labels
    for (let i = 0; i < 4; i++) {
      const px = toX(points[i].S);
      const py = toY(points[i].T);
      ctx.fillStyle = C.fg;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "bold 12px Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`${i + 1}`, px, py - 8);
    }

    // Animated point
    const seg = Math.floor(progress) % 4;
    const frac = progress - Math.floor(progress);
    const type = types[seg] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
    const current = interpolateProcess(points[seg], points[(seg + 1) % 4], frac, type);
    ctx.fillStyle = C.accent;
    ctx.strokeStyle = C.bg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(toX(current.S), toY(current.T), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawPiston(
    ctx: CanvasRenderingContext2D, w: number, h: number,
    points: StatePoint[], types: string[], progress: number, C: Colors
  ) {
    if (w < 1 || h < 1) return;
    ctx.clearRect(0, 0, w, h);

    const seg = Math.floor(progress) % 4;
    const frac = progress - Math.floor(progress);
    const type = types[seg] as "isothermal" | "adiabatic" | "isochoric" | "isobaric";
    const current = interpolateProcess(points[seg], points[(seg + 1) % 4], frac, type);

    // Normalize volume for display
    const allV = points.map(p => p.V);
    const minV = Math.min(...allV) * 0.8;
    const maxV = Math.max(...allV) * 1.1;
    const normV = (current.V - minV) / (maxV - minV);

    // Temperature for color
    const allT = points.map(p => p.T);
    const minT = Math.min(...allT);
    const maxT = Math.max(...allT);
    const normT = maxT > minT ? (current.T - minT) / (maxT - minT) : 0;

    // Cylinder dimensions
    const cylLeft = w * 0.15;
    const cylRight = w * 0.85;
    const cylTop = h * 0.15;
    const cylBottom = h * 0.75;
    const cylW = cylRight - cylLeft;
    const cylH = cylBottom - cylTop;

    // Piston position (moves right with volume)
    const pistonX = cylLeft + normV * cylW;

    // Gas fill - color based on temperature (blue cold, red hot)
    const r = Math.round(100 + normT * 155);
    const g = Math.round(100 - normT * 60);
    const b = Math.round(255 - normT * 155);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.25)`;
    ctx.fillRect(cylLeft, cylTop, pistonX - cylLeft, cylH);

    // Cylinder walls
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cylLeft, cylTop);
    ctx.lineTo(cylLeft, cylBottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cylLeft, cylTop);
    ctx.lineTo(cylRight, cylTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cylLeft, cylBottom);
    ctx.lineTo(cylRight, cylBottom);
    ctx.stroke();

    // Piston
    ctx.fillStyle = C.fg;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(pistonX - 4, cylTop, 8, cylH);
    ctx.globalAlpha = 1;

    // Piston rod
    ctx.strokeStyle = C.fg;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pistonX + 4, cylTop + cylH / 2);
    ctx.lineTo(cylRight + 10, cylTop + cylH / 2);
    ctx.stroke();

    // Hatching on left wall
    ctx.strokeStyle = C.muted;
    ctx.lineWidth = 1;
    const step = 8;
    for (let i = 0; i < cylH + step; i += step) {
      ctx.beginPath();
      ctx.moveTo(cylLeft, cylTop + i);
      ctx.lineTo(cylLeft - 8, cylTop + i + step);
      ctx.stroke();
    }

    // Labels
    ctx.fillStyle = C.fg;
    ctx.font = "italic 13px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(`T = ${current.T.toFixed(0)} K`, w / 2, cylBottom + 16);
    ctx.fillText(`P = ${(current.P / 1000).toFixed(1)} kPa`, w / 2, cylBottom + 34);

    // Process label
    ctx.fillStyle = processColor(type, C);
    ctx.font = "bold 12px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(type, w / 2, 8);
  }

  // --- Animation loop ---
  useEffect(() => {
    const pvCanvas = pvCanvasRef.current;
    const pistonCanvas = pistonCanvasRef.current;
    const tsCanvas = tsCanvasRef.current;
    const engineCanvas = engineCanvasRef.current;
    if (!pvCanvas || !pistonCanvas || !tsCanvas || !engineCanvas) return;

    const pvCtx = pvCanvas.getContext("2d")!;
    const pistonCtx = pistonCanvas.getContext("2d")!;
    const tsCtx = tsCanvas.getContext("2d")!;
    const engineCtx = engineCanvas.getContext("2d")!;

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
      resizeCanvas(pvCanvas!);
      resizeCanvas(pistonCanvas!);
      resizeCanvas(tsCanvas!);
      resizeCanvas(engineCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    function loop(timestamp: number) {
      if (!colorsRef.current) colorsRef.current = getColors();
      const C = colorsRef.current;

      if (runningRef.current && lastTimeRef.current > 0) {
        const dt = (timestamp - lastTimeRef.current) / 1000;
        animRef.current = (animRef.current + dt * ANIM_SPEED) % 4;
      }
      lastTimeRef.current = timestamp;

      const { mode: m, TH: th, TC: tc, compressionRatio: cr } = paramsRef.current;
      const points = computeCyclePoints(m, th, tc, cr);
      const types = processTypes(m);
      const progress = animRef.current;

      const pvW = pvCanvas!.getBoundingClientRect().width;
      const pvH = pvCanvas!.getBoundingClientRect().height;
      drawPVDiagram(pvCtx, pvW, pvH, points, types, progress, C);

      const pistonW = pistonCanvas!.getBoundingClientRect().width;
      const pistonH = pistonCanvas!.getBoundingClientRect().height;
      drawPiston(pistonCtx, pistonW, pistonH, points, types, progress, C);

      const tsW = tsCanvas!.getBoundingClientRect().width;
      const tsH = tsCanvas!.getBoundingClientRect().height;
      drawTSDiagram(tsCtx, tsW, tsH, points, types, progress, C);

      // Draw engine schematic
      const engW = engineCanvas!.getBoundingClientRect().width;
      const engH = engineCanvas!.getBoundingClientRect().height;
      if (engW > 1 && engH > 1) {
        engineCtx.clearRect(0, 0, engW, engH);
        drawEngineSchematic(engineCtx, engW, engH, points, types, progress, m, C);
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute current values for display
  const points = computeCyclePoints(mode, TH, TC, compressionRatio);
  const thermo = computeCycleThermo(points, mode);

  const modeColor = (m: CycleMode) => {
    switch (m) {
      case "Carnot": return "var(--accent)";
      case "Otto": return "var(--ke-color)";
      case "Diesel": return "var(--accel-color)";
      case "Stirling": return "var(--total-color)";
    }
  };

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
            <span style={{ color: "var(--foreground)" }}>Thermodynamic Cycles</span>
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
            Thermodynamic Cycles
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Ideal heat engine cycles on PV and TS diagrams with a synchronized piston-cylinder animation. Compare Carnot, Otto, Diesel, and Stirling cycles.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* PV diagram — sticky, collapsible, controls inside */}
        <div
          className="mt-8 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Top bar — always visible */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}
          >
            <button
              onClick={cycleMode}
              className="text-sm font-medium px-3 py-1 rounded border cursor-pointer"
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
                className="text-sm px-3 py-1 rounded border transition-colors cursor-pointer"
                style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
              >
                {running ? "Pause" : "Play"}
              </button>
              <button
                onClick={reset}
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
                {collapsed ? "show \u2193" : "hide \u2191"}
              </button>
            </div>
          </div>
          {/* Full panel */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <canvas
                ref={pvCanvasRef}
                className="w-full"
                style={{ height: 280, background: "var(--canvas-bg)" }}
              />
              {/* Legend */}
              <div className="absolute top-2 left-2 flex flex-col gap-1">
                {[
                  { label: "isothermal", color: "#2563eb" },
                  { label: "adiabatic", color: "#dc2626" },
                  { label: "isochoric", color: "#16a34a" },
                  { label: "isobaric", color: "#ea580c" },
                ].map(({ label, color }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span style={{ width: 12, height: 3, background: color, display: "inline-block", borderRadius: 1 }} />
                    <span className="text-xs" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl label="Hot reservoir" symbol="T_H" unit="K" min={350} max={1200} step={10} value={TH} onChange={setTH} />
              <SliderControl label="Cold reservoir" symbol="T_C" unit="K" min={200} max={500} step={10} value={TC} onChange={setTC} />
              <SliderControl label="Compression ratio" symbol="r" unit="" min={2} max={20} step={0.5} value={compressionRatio} onChange={setCompressionRatio} />
            </div>
          </div>
        </div>

        {/* Piston-cylinder */}
        <figure className="mt-12">
          <canvas
            ref={pistonCanvasRef}
            className="w-full rounded border"
            style={{ height: 240, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Piston-cylinder visualization synchronized with the PV diagram. Gas color indicates temperature.
          </figcaption>
        </figure>

        {/* Efficiency + real-time values */}
        <div
          className="mt-10 rounded border p-6 mx-auto"
          style={{ background: "var(--panel)", borderColor: "var(--border)", maxWidth: "65ch" }}
        >
          <h3 className="text-lg font-semibold mb-4">Cycle performance</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <ValueDisplay label="Net work" value={`${thermo.W.toFixed(1)} J`} color="var(--foreground)" />
            <ValueDisplay label="Heat added" value={`${thermo.Qadd.toFixed(1)} J`} color="var(--ke-color)" />
            <ValueDisplay label="Heat rejected" value={`${thermo.Qrej.toFixed(1)} J`} color="var(--pe-color)" />
            <ValueDisplay label={`${mode} efficiency`} value={`${(thermo.eta * 100).toFixed(1)}%`} color="var(--accent)" />
            <ValueDisplay label="Carnot efficiency" value={`${(thermo.etaCarnot * 100).toFixed(1)}%`} color="var(--total-color)" />
            <ValueDisplay label="Relative to Carnot" value={thermo.etaCarnot > 0 ? `${((thermo.eta / thermo.etaCarnot) * 100).toFixed(1)}%` : "---"} color="var(--muted)" />
          </div>
        </div>

        {/* TS diagram */}
        <figure className="mt-12">
          <canvas
            ref={tsCanvasRef}
            className="w-full rounded border"
            style={{ height: 300, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Temperature-entropy diagram. The enclosed area equals the net work output of the cycle.
          </figcaption>
        </figure>

        {/* --- Derivation --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The first law and heat engines</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              For a closed system undergoing a cyclic process, the first law of thermodynamics requires
              that the net heat input equal the net work output:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\oint \\delta Q = \\oint \\delta W`}</Tex>
            </div>

            <p>
              A heat engine operates between a hot reservoir at temperature <Tex>{`T_H`}</Tex> and a
              cold reservoir at <Tex>{`T_C`}</Tex>. It absorbs heat <Tex>{`Q_H`}</Tex>,
              rejects heat <Tex>{`Q_C`}</Tex>, and produces net work:
            </p>

            <div className="text-center py-1">
              <Tex display>{`W_{\\text{net}} = Q_H - Q_C`}</Tex>
            </div>

            <p>
              The thermal efficiency is the fraction of heat input converted to useful work:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\eta = \\frac{W_{\\text{net}}}{Q_H} = 1 - \\frac{Q_C}{Q_H}`}</Tex>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Carnot cycle</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The Carnot cycle consists of four reversible processes: isothermal expansion at <Tex>{`T_H`}</Tex>,
              adiabatic expansion from <Tex>{`T_H`}</Tex> to <Tex>{`T_C`}</Tex>,
              isothermal compression at <Tex>{`T_C`}</Tex>, and adiabatic compression back to <Tex>{`T_H`}</Tex>.
            </p>

            <p>
              For isothermal processes in an ideal gas, the heat transferred
              equals the work done: <Tex>{`Q = nRT\\ln(V_f/V_i)`}</Tex>. For the
              adiabatic legs, <Tex>{`Q = 0`}</Tex> and <Tex>{`TV^{\\gamma-1} = \\text{const}`}</Tex>.
              Combining these gives the Carnot efficiency:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\eta_{\\text{Carnot}} = 1 - \\frac{T_C}{T_H}`}</Tex>
            </div>

            <p>
              This is the maximum possible efficiency for any engine operating between
              these two temperatures. No real engine can exceed it — this is a direct
              consequence of the second law of thermodynamics.
            </p>

            <p style={{ color: "var(--muted)" }}>
              <strong>In practice:</strong> No real engine operates on the Carnot cycle because
              isothermal heat transfer requires infinitely slow processes. It serves as the
              theoretical benchmark against which all real engines are measured. However,
              the concept appears in heat pumps, refrigerators, and the analysis of
              power plant efficiency.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Otto cycle</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The Otto cycle models <strong>spark-ignition engines</strong> — the kind found in most
              petrol/gasoline cars. A piston compresses the air-fuel mixture adiabatically,
              a spark plug ignites it (rapid isochoric heat addition), the hot gas expands
              adiabatically pushing the piston down (the power stroke), and then the exhaust
              valve opens (isochoric heat rejection).
            </p>

            <p>
              The efficiency depends only on the compression ratio <Tex>r</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\eta_{\\text{Otto}} = 1 - \\frac{1}{r^{\\,\\gamma - 1}}`}</Tex>
            </div>

            <p>
              Typical petrol engines have <Tex>{`r \\approx 8\\text{--}12`}</Tex>, giving
              theoretical efficiencies of 50-60%. Real-world efficiency is 25-35% after
              accounting for friction, heat loss, and incomplete combustion. Higher compression
              ratios improve efficiency but risk engine knock (premature detonation).
            </p>

            <p style={{ color: "var(--muted)" }}>
              <strong>Real-world examples:</strong> Car engines, motorcycle engines, lawnmowers,
              portable generators — any engine where fuel is ignited by a spark. The four strokes
              (intake, compression, power, exhaust) map to the four processes of the cycle, with
              the crankshaft converting the piston&rsquo;s linear motion to rotation.
            </p>
          </div>

          {/* Cycle comparison cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10 -mx-4 sm:-mx-16">
            <CycleCard
              title="Diesel cycle"
              processes="adiabatic, isobaric, adiabatic, isochoric"
              equation={`\\eta_{\\text{Diesel}} = 1 - \\frac{1}{r^{\\,\\gamma-1}} \\cdot \\frac{r_c^{\\,\\gamma} - 1}{\\gamma(r_c - 1)}`}
              description="Models compression-ignition engines (trucks, ships, generators). Air is compressed so hot that injected fuel ignites spontaneously — no spark plug needed. Higher compression ratios (14-25) give better efficiency than Otto. Powers most heavy transport and diesel generators."
              borderColor="var(--accel-color)"
            />
            <CycleCard
              title="Stirling cycle"
              processes="isothermal, isochoric, isothermal, isochoric"
              equation={`\\eta_{\\text{Stirling}} = 1 - \\frac{T_C}{T_H}`}
              description="Uses an external heat source — any fuel or even solar/nuclear heat works. With an ideal regenerator it matches Carnot efficiency. Used in submarines (quiet operation), solar dish generators, cryocoolers, and spacecraft power systems."
              borderColor="var(--total-color)"
            />
          </div>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">Comparing cycles</h3>
            <p>
              The Carnot cycle sets the upper bound on efficiency for given reservoir temperatures.
              The Otto and Diesel cycles fall short because their heat addition and rejection
              processes are not isothermal — heat is exchanged across finite temperature differences,
              generating entropy.
            </p>
            <p>
              On the TS diagram, the area enclosed by the cycle path equals the net
              work <Tex>{`W_{\\text{net}} = \\oint T\\,dS`}</Tex>. The Carnot cycle forms a
              rectangle in TS space, enclosing the maximum area for given temperature bounds.
              The Otto cycle, with its curved isochoric legs, necessarily encloses less area.
            </p>
            <p>
              The Stirling cycle is remarkable: with an ideal regenerator it matches Carnot
              efficiency despite using isochoric (not adiabatic) processes. The regenerator
              internally shuttles heat between the two constant-volume stages, so
              no <em>external</em> heat transfer occurs across a temperature gradient during
              these legs.
            </p>
          </div>

          <figure className="mt-10">
            <canvas
              ref={engineCanvasRef}
              className="w-full rounded border"
              style={{ height: 420, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
            />
            <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
              Schematic piston-cylinder engine for the current cycle. The piston position, crankshaft rotation,
              and gas temperature are synchronized with the PV diagram above.
            </figcaption>
          </figure>

          <div className="mt-14 space-y-3 text-base leading-relaxed">
            <h3 className="text-xl font-semibold">The ideal gas assumption</h3>
            <p>
              Throughout this simulation we model the working fluid as an ideal diatomic
              gas with <Tex>{`\\gamma = C_p/C_v = 1.4`}</Tex>. The equation of
              state <Tex>{`PV = nRT`}</Tex> relates pressure, volume, and temperature at
              every state point. For an adiabatic process in an ideal gas:
            </p>

            <div className="text-center py-1">
              <Tex display>{`PV^{\\gamma} = \\text{const} \\quad \\Longleftrightarrow \\quad TV^{\\gamma - 1} = \\text{const}`}</Tex>
            </div>

            <p>
              The internal energy depends only on temperature: <Tex>{`U = nC_v T`}</Tex>.
              For isothermal processes, <Tex>{`\\Delta U = 0`}</Tex> and all heat goes
              directly to work. For isochoric processes, <Tex>{`W = 0`}</Tex> and all heat
              goes to changing the internal energy.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Cycle comparison card
// ---------------------------------------------------------------------------

function CycleCard({
  title, processes, equation, description, borderColor,
}: {
  title: string;
  processes: string;
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
        {processes}
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
// Value display
// ---------------------------------------------------------------------------

function ValueDisplay({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{label}</div>
      <div className="text-base font-medium tabular-nums" style={{ color, fontFamily: "var(--font-geist-mono), monospace" }}>
        {value}
      </div>
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
