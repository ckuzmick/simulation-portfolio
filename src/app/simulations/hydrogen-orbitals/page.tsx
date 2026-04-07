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

interface Preset {
  label: string;
  n: number;
  l: number;
  m: number;
}

const PRESETS: Preset[] = [
  { label: "1s (ground)", n: 1, l: 0, m: 0 },
  { label: "2p_z", n: 2, l: 1, m: 0 },
  { label: "2p_x", n: 2, l: 1, m: 1 },
  { label: "3d_z\u00B2", n: 3, l: 2, m: 0 },
  { label: "3d_xy", n: 3, l: 2, m: 2 },
  { label: "4f", n: 4, l: 3, m: 0 },
];

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
// Draw padded label helper
// ---------------------------------------------------------------------------

function drawPaddedLabel(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number,
  textColor: string, bgColor: string,
  align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "bottom",
) {
  ctx.save();
  ctx.font = "italic 12px Georgia, serif";
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const tw = ctx.measureText(text).width;
  const th = 14, pad = 4;
  let lx = x;
  if (align === "center") lx = x - tw / 2;
  else if (align === "right") lx = x - tw;
  let ly = y - th;
  if (baseline === "top") ly = y;
  else if (baseline === "middle") ly = y - th / 2;
  ctx.fillStyle = bgColor;
  ctx.globalAlpha = 0.82;
  ctx.fillRect(lx - pad, ly - pad, tw + pad * 2, th + pad * 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = textColor;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hydrogen wave function: radial part R_nl(r)
// ---------------------------------------------------------------------------

function radialR(n: number, l: number, r: number): number {
  const rho = r; // r in units of a0
  switch (n) {
    case 1:
      // R_10
      return 2.0 * Math.exp(-rho);
    case 2:
      if (l === 0) {
        // R_20 = (1/(2*sqrt(2))) * (2 - r) * exp(-r/2)
        return (1.0 / (2.0 * Math.sqrt(2))) * (2.0 - rho) * Math.exp(-rho / 2.0);
      } else {
        // R_21 = (1/(2*sqrt(6))) * r * exp(-r/2)
        return (1.0 / (2.0 * Math.sqrt(6))) * rho * Math.exp(-rho / 2.0);
      }
    case 3:
      if (l === 0) {
        // R_30 = (2/(81*sqrt(3))) * (27 - 18r + 2r^2) * exp(-r/3)
        return (2.0 / (81.0 * Math.sqrt(3))) * (27.0 - 18.0 * rho + 2.0 * rho * rho) * Math.exp(-rho / 3.0);
      } else if (l === 1) {
        // R_31 = (8/(27*sqrt(6))) * r * (6 - r) * exp(-r/3)
        return (8.0 / (27.0 * Math.sqrt(6))) * rho * (6.0 - rho) * Math.exp(-rho / 3.0);
      } else {
        // R_32 = (4/(81*sqrt(30))) * r^2 * exp(-r/3)
        return (4.0 / (81.0 * Math.sqrt(30))) * rho * rho * Math.exp(-rho / 3.0);
      }
    case 4:
      if (l === 0) {
        // R_40 = (1/768) * (192 - 144r + 24r^2 - r^3) * exp(-r/4)
        return (1.0 / 768.0) * (192.0 - 144.0 * rho + 24.0 * rho * rho - rho * rho * rho) * Math.exp(-rho / 4.0);
      } else if (l === 1) {
        // R_41 = (1/(256*sqrt(15))) * r * (80 - 20r + r^2) * exp(-r/4)
        // Simplified from sqrt(5)/(16*sqrt(3)) * (1/16) * r(80-20r+r^2)exp(-r/4)
        return (1.0 / (256.0 * Math.sqrt(15))) * rho * (80.0 - 20.0 * rho + rho * rho) * Math.exp(-rho / 4.0);
      } else if (l === 2) {
        // R_42 = (1/(768*sqrt(5))) * r^2 * (12 - r) * exp(-r/4)
        return (1.0 / (768.0 * Math.sqrt(5))) * rho * rho * (12.0 - rho) * Math.exp(-rho / 4.0);
      } else {
        // R_43 = (1/(768*sqrt(35))) * r^3 * exp(-r/4)
        return (1.0 / (768.0 * Math.sqrt(35))) * rho * rho * rho * Math.exp(-rho / 4.0);
      }
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Spherical harmonics: real forms Y_lm(theta, phi)
// ---------------------------------------------------------------------------

function realYlm(l: number, m: number, theta: number, phi: number): number {
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  if (l === 0) {
    // Y_00 = 1/sqrt(4pi)
    return 1.0 / Math.sqrt(4.0 * Math.PI);
  }

  if (l === 1) {
    if (m === 0) return Math.sqrt(3.0 / (4.0 * Math.PI)) * ct;
    if (m === 1) return Math.sqrt(3.0 / (4.0 * Math.PI)) * st * Math.cos(phi);
    if (m === -1) return Math.sqrt(3.0 / (4.0 * Math.PI)) * st * Math.sin(phi);
  }

  if (l === 2) {
    const st2 = st * st;
    if (m === 0) return Math.sqrt(5.0 / (16.0 * Math.PI)) * (3.0 * ct * ct - 1.0);
    if (m === 1) return Math.sqrt(15.0 / (4.0 * Math.PI)) * st * ct * Math.cos(phi);
    if (m === -1) return Math.sqrt(15.0 / (4.0 * Math.PI)) * st * ct * Math.sin(phi);
    if (m === 2) return Math.sqrt(15.0 / (16.0 * Math.PI)) * st2 * Math.cos(2.0 * phi);
    if (m === -2) return Math.sqrt(15.0 / (16.0 * Math.PI)) * st2 * Math.sin(2.0 * phi);
  }

  if (l === 3) {
    const st2 = st * st;
    const ct2 = ct * ct;
    if (m === 0) return Math.sqrt(7.0 / (16.0 * Math.PI)) * (5.0 * ct2 * ct - 3.0 * ct);
    if (m === 1) return Math.sqrt(21.0 / (64.0 * Math.PI)) * st * (5.0 * ct2 - 1.0) * Math.cos(phi);
    if (m === -1) return Math.sqrt(21.0 / (64.0 * Math.PI)) * st * (5.0 * ct2 - 1.0) * Math.sin(phi);
    if (m === 2) return Math.sqrt(105.0 / (16.0 * Math.PI)) * st2 * ct * Math.cos(2.0 * phi);
    if (m === -2) return Math.sqrt(105.0 / (16.0 * Math.PI)) * st2 * ct * Math.sin(2.0 * phi);
    if (m === 3) return Math.sqrt(35.0 / (32.0 * Math.PI)) * st2 * st * Math.cos(3.0 * phi);
    if (m === -3) return Math.sqrt(35.0 / (32.0 * Math.PI)) * st2 * st * Math.sin(3.0 * phi);
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Full wave function psi(x,y,z)
// ---------------------------------------------------------------------------

function hydrogenPsi(x: number, y: number, z: number, n: number, l: number, m: number): number {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r < 1e-12) {
    // Only s-orbitals (l=0) are nonzero at the origin
    if (l === 0) {
      const R = radialR(n, l, 0);
      const Y = realYlm(l, m, 0, 0);
      return R * Y;
    }
    return 0;
  }
  const theta = Math.acos(Math.max(-1, Math.min(1, z / r)));
  const phi = Math.atan2(y, x);
  return radialR(n, l, r) * realYlm(l, m, theta, phi);
}

// ---------------------------------------------------------------------------
// Grid extent: how far to sample for each n
// ---------------------------------------------------------------------------

function gridExtent(n: number): number {
  return 4.0 * n * n;
}

// ---------------------------------------------------------------------------
// Marching cubes tables (compact)
// ---------------------------------------------------------------------------

const MC_EDGE_TABLE: number[] = [
  0x0,0x109,0x203,0x30a,0x406,0x50f,0x605,0x70c,0x80c,0x905,0xa0f,0xb06,0xc0a,0xd03,0xe09,0xf00,
  0x190,0x99,0x393,0x29a,0x596,0x49f,0x795,0x69c,0x99c,0x895,0xb9f,0xa96,0xd9a,0xc93,0xf99,0xe90,
  0x230,0x339,0x33,0x13a,0x636,0x73f,0x435,0x53c,0xa3c,0xb35,0x83f,0x936,0xe3a,0xf33,0xc39,0xd30,
  0x3a0,0x2a9,0x1a3,0xaa,0x7a6,0x6af,0x5a5,0x4ac,0xbac,0xaa5,0x9af,0x8a6,0xfaa,0xea3,0xda9,0xca0,
  0x460,0x569,0x663,0x76a,0x66,0x16f,0x265,0x36c,0xc6c,0xd65,0xe6f,0xf66,0x86a,0x963,0xa69,0xb60,
  0x5f0,0x4f9,0x7f3,0x6fa,0x1f6,0xff,0x3f5,0x2fc,0xdfc,0xcf5,0xfff,0xef6,0x9fa,0x8f3,0xbf9,0xaf0,
  0x650,0x759,0x453,0x55a,0x256,0x35f,0x55,0x15c,0xe5c,0xf55,0xc5f,0xd56,0xa5a,0xb53,0x859,0x950,
  0x7c0,0x6c9,0x5c3,0x4ca,0x3c6,0x2cf,0x1c5,0xcc,0xfcc,0xec5,0xdcf,0xcc6,0xbca,0xac3,0x9c9,0x8c0,
  0x8c0,0x9c9,0xac3,0xbca,0xcc6,0xdcf,0xec5,0xfcc,0xcc,0x1c5,0x2cf,0x3c6,0x4ca,0x5c3,0x6c9,0x7c0,
  0x950,0x859,0xb53,0xa5a,0xd56,0xc5f,0xf55,0xe5c,0x15c,0x55,0x35f,0x256,0x55a,0x453,0x759,0x650,
  0xaf0,0xbf9,0x8f3,0x9fa,0xef6,0xfff,0xcf5,0xdfc,0x2fc,0x3f5,0xff,0x1f6,0x6fa,0x7f3,0x4f9,0x5f0,
  0xb60,0xa69,0x963,0x86a,0xf66,0xe6f,0xd65,0xc6c,0x36c,0x265,0x16f,0x66,0x76a,0x663,0x569,0x460,
  0xca0,0xda9,0xea3,0xfaa,0x8a6,0x9af,0xaa5,0xbac,0x4ac,0x5a5,0x6af,0x7a6,0xaa,0x1a3,0x2a9,0x3a0,
  0xd30,0xc39,0xf33,0xe3a,0x936,0x83f,0xb35,0xa3c,0x53c,0x435,0x73f,0x636,0x13a,0x33,0x339,0x230,
  0xe90,0xf99,0xc93,0xd9a,0xa96,0xb9f,0x895,0x99c,0x69c,0x795,0x49f,0x596,0x29a,0x393,0x99,0x190,
  0xf00,0xe09,0xd03,0xc0a,0xb06,0xa0f,0x905,0x80c,0x70c,0x605,0x50f,0x406,0x30a,0x203,0x109,0x0,
];

const MC_EDGES: [number, number][] = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],
];

const MC_CORNERS: [number,number,number][] = [
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1],
];

// ---------------------------------------------------------------------------
// Full marching cubes triangle table
// ---------------------------------------------------------------------------

function buildTriTable(): number[][] {
  const t: number[][] = [
    [],
    [0,8,3],
    [0,1,9],
    [1,8,3,9,8,1],
    [1,2,10],
    [0,8,3,1,2,10],
    [9,2,10,0,2,9],
    [2,8,3,2,10,8,10,9,8],
    [3,11,2],
    [0,11,2,8,11,0],
    [1,9,0,2,3,11],
    [1,11,2,1,9,11,9,8,11],
    [3,10,1,11,10,3],
    [0,10,1,0,8,10,8,11,10],
    [3,9,0,3,11,9,11,10,9],
    [9,8,10,10,8,11],
    [4,7,8],
    [4,3,0,7,3,4],
    [0,1,9,8,4,7],
    [4,1,9,4,7,1,7,3,1],
    [1,2,10,8,4,7],
    [3,4,7,3,0,4,1,2,10],
    [9,2,10,9,0,2,8,4,7],
    [2,10,9,2,9,7,2,7,3,7,9,4],
    [8,4,7,3,11,2],
    [11,4,7,11,2,4,2,0,4],
    [9,0,1,8,4,7,2,3,11],
    [4,7,11,9,4,11,9,11,2,9,2,1],
    [3,10,1,3,11,10,7,8,4],
    [1,11,10,1,4,11,1,0,4,7,11,4],
    [4,7,8,9,0,11,9,11,10,11,0,3],
    [4,7,11,4,11,9,9,11,10],
    [9,5,4],
    [9,5,4,0,8,3],
    [0,5,4,1,5,0],
    [8,5,4,8,3,5,3,1,5],
    [1,2,10,9,5,4],
    [3,0,8,1,2,10,4,9,5],
    [5,2,10,5,4,2,4,0,2],
    [2,10,5,3,2,5,3,5,4,3,4,8],
    [9,5,4,2,3,11],
    [0,11,2,0,8,11,4,9,5],
    [0,5,4,0,1,5,2,3,11],
    [2,1,5,2,5,8,2,8,11,4,8,5],
    [10,3,11,10,1,3,9,5,4],
    [4,9,5,0,8,1,8,10,1,8,11,10],
    [5,4,0,5,0,11,5,11,10,11,0,3],
    [5,4,8,5,8,10,10,8,11],
    [9,7,8,5,7,9],
    [9,3,0,9,5,3,5,7,3],
    [0,7,8,0,1,7,1,5,7],
    [1,5,3,3,5,7],
    [9,7,8,9,5,7,10,1,2],
    [10,1,2,9,5,0,5,3,0,5,7,3],
    [8,0,2,8,2,5,8,5,7,10,5,2],
    [2,10,5,2,5,3,3,5,7],
    [7,9,5,7,8,9,3,11,2],
    [9,5,7,9,7,2,9,2,0,2,7,11],
    [2,3,11,0,1,8,1,7,8,1,5,7],
    [11,2,1,11,1,7,7,1,5],
    [9,5,8,8,5,7,10,1,3,10,3,11],
    [5,7,0,5,0,9,7,11,0,1,0,10,11,10,0],
    [11,10,0,11,0,3,10,5,0,8,0,7,5,7,0],
    [11,10,5,7,11,5],
    [10,6,5],
    [0,8,3,5,10,6],
    [9,0,1,5,10,6],
    [1,8,3,1,9,8,5,10,6],
    [1,6,5,2,6,1],
    [1,6,5,1,2,6,3,0,8],
    [9,6,5,9,0,6,0,2,6],
    [5,9,8,5,8,2,5,2,6,3,2,8],
    [2,3,11,10,6,5],
    [11,0,8,11,2,0,10,6,5],
    [0,1,9,2,3,11,5,10,6],
    [5,10,6,1,9,2,9,11,2,9,8,11],
    [6,3,11,6,5,3,5,1,3],
    [0,8,11,0,11,5,0,5,1,5,11,6],
    [3,11,6,0,3,6,0,6,5,0,5,9],
    [6,5,9,6,9,11,11,9,8],
    [5,10,6,4,7,8],
    [4,3,0,4,7,3,6,5,10],
    [1,9,0,5,10,6,8,4,7],
    [10,6,5,1,9,7,1,7,3,7,9,4],
    [6,1,2,6,5,1,4,7,8],
    [1,2,5,5,2,6,3,0,4,3,4,7],
    [8,4,7,9,0,5,0,6,5,0,2,6],
    [7,3,9,7,9,4,3,2,9,5,9,6,2,6,9],
    [3,11,2,7,8,4,10,6,5],
    [5,10,6,4,7,2,4,2,0,2,7,11],
    [0,1,9,4,7,8,2,3,11,5,10,6],
    [9,2,1,9,11,2,9,4,11,7,11,4,5,10,6],
    [8,4,7,3,11,5,3,5,1,5,11,6],
    [5,1,11,5,11,6,1,0,11,7,11,4,0,4,11],
    [0,5,9,0,6,5,0,3,6,11,6,3,8,4,7],
    [6,5,9,6,9,11,4,7,9,7,11,9],
    [10,4,9,6,4,10],
    [4,10,6,4,9,10,0,8,3],
    [10,0,1,10,6,0,6,4,0],
    [8,3,1,8,1,6,8,6,4,6,1,10],
    [1,4,9,1,2,4,2,6,4],
    [3,0,8,1,2,9,2,4,9,2,6,4],
    [0,2,4,4,2,6],
    [8,3,2,8,2,4,4,2,6],
    [10,4,9,10,6,4,11,2,3],
    [0,8,2,2,8,11,4,9,10,4,10,6],
    [3,11,2,0,1,6,0,6,4,6,1,10],
    [6,4,1,6,1,10,4,8,1,2,1,11,8,11,1],
    [9,6,4,9,3,6,9,1,3,11,6,3],
    [8,11,1,8,1,0,11,6,1,9,1,4,6,4,1],
    [3,11,6,3,6,0,0,6,4],
    [6,4,8,11,6,8],
    [7,10,6,7,8,10,8,9,10],
    [0,7,3,0,10,7,0,9,10,6,7,10],
    [10,6,7,1,10,7,1,7,8,1,8,0],
    [10,6,7,10,7,1,1,7,3],
    [1,2,6,1,6,8,1,8,9,8,6,7],
    [2,6,9,2,9,1,6,7,9,0,9,3,7,3,9],
    [7,8,0,7,0,6,6,0,2],
    [7,3,2,6,7,2],
    [2,3,11,10,6,8,10,8,9,8,6,7],
    [2,0,7,2,7,11,0,9,7,6,7,10,9,10,7],
    [1,8,0,1,7,8,1,10,7,6,7,10,2,3,11],
    [11,2,1,11,1,7,10,6,1,6,7,1],
    [8,9,6,8,6,7,9,1,6,11,6,3,1,3,6],
    [0,9,1,11,6,7],
    [7,8,0,7,0,6,3,11,0,11,6,0],
    [7,11,6],
    [7,6,11],
    [3,0,8,11,7,6],
    [0,1,9,11,7,6],
    [8,1,9,8,3,1,11,7,6],
    [10,1,2,6,11,7],
    [1,2,10,3,0,8,6,11,7],
    [2,9,0,2,10,9,6,11,7],
    [6,11,7,2,10,3,10,8,3,10,9,8],
    [7,2,3,6,2,7],
    [7,0,8,7,6,0,6,2,0],
    [2,7,6,2,3,7,0,1,9],
    [1,6,2,1,8,6,1,9,8,8,7,6],
    [10,7,6,10,1,7,1,3,7],
    [10,7,6,1,7,10,1,8,7,1,0,8],
    [0,3,7,0,7,10,0,10,9,6,10,7],
    [7,6,10,7,10,8,8,10,9],
    [6,8,4,11,8,6],
    [3,6,11,3,0,6,0,4,6],
    [8,6,11,8,4,6,9,0,1],
    [9,4,6,9,6,3,9,3,1,11,3,6],
    [6,8,4,6,11,8,2,10,1],
    [1,2,10,3,0,11,0,6,11,0,4,6],
    [4,11,8,4,6,11,0,2,9,2,10,9],
    [10,9,3,10,3,2,9,4,3,11,3,6,4,6,3],
    [8,2,3,8,4,2,4,6,2],
    [0,4,2,4,6,2],
    [1,9,0,2,3,4,2,4,6,4,3,8],
    [1,9,4,1,4,2,2,4,6],
    [8,1,3,8,6,1,8,4,6,6,10,1],
    [10,1,0,10,0,6,6,0,4],
    [4,6,3,4,3,8,6,10,3,0,3,9,10,9,3],
    [10,9,4,6,10,4],
    [4,9,5,7,6,11],
    [0,8,3,4,9,5,11,7,6],
    [5,0,1,5,4,0,7,6,11],
    [11,7,6,8,3,4,3,5,4,3,1,5],
    [9,5,4,10,1,2,7,6,11],
    [6,11,7,1,2,10,0,8,3,4,9,5],
    [7,6,11,5,4,10,4,2,10,4,0,2],
    [3,4,8,3,5,4,3,2,5,10,5,2,11,7,6],
    [7,2,3,7,6,2,5,4,9],
    [9,5,4,0,8,6,0,6,2,6,8,7],
    [3,6,2,3,7,6,1,5,0,5,4,0],
    [6,2,8,6,8,7,2,1,8,4,8,5,1,5,8],
    [9,5,4,10,1,6,1,7,6,1,3,7],
    [1,6,10,1,7,6,1,0,7,8,7,0,9,5,4],
    [4,0,10,4,10,5,0,3,10,6,10,7,3,7,10],
    [7,6,10,7,10,8,5,4,10,4,8,10],
    [6,9,5,6,11,9,11,8,9],
    [3,6,11,0,6,3,0,5,6,0,9,5],
    [0,11,8,0,5,11,0,1,5,5,6,11],
    [6,11,3,6,3,5,5,3,1],
    [1,2,10,9,5,11,9,11,8,11,5,6],
    [0,11,3,0,6,11,0,9,6,5,6,9,1,2,10],
    [11,8,5,11,5,6,8,0,5,10,5,2,0,2,5],
    [6,11,3,6,3,5,2,10,3,10,5,3],
    [5,8,9,5,2,8,5,6,2,3,8,2],
    [9,5,6,9,6,0,0,6,2],
    [1,5,8,1,8,0,5,6,8,3,8,2,6,2,8],
    [1,5,6,2,1,6],
    [1,3,6,1,6,10,3,8,6,5,6,9,8,9,6],
    [10,1,0,10,0,6,9,5,0,5,6,0],
    [0,3,8,5,6,10],
    [10,5,6],
    [11,5,10,7,5,11],
    [11,5,10,11,7,5,8,3,0],
    [5,11,7,5,10,11,1,9,0],
    [10,7,5,10,11,7,9,8,1,8,3,1],
    [11,1,2,11,7,1,7,5,1],
    [0,8,3,1,2,7,1,7,5,7,2,11],
    [9,7,5,9,2,7,9,0,2,2,11,7],
    [7,5,2,7,2,11,5,9,2,3,2,8,9,8,2],
    [2,5,10,2,3,5,3,7,5],
    [8,2,0,8,5,2,8,7,5,10,2,5],
    [9,0,1,5,10,3,5,3,7,3,10,2],
    [9,8,2,9,2,1,8,7,2,10,2,5,7,5,2],
    [1,3,5,3,7,5],
    [0,8,7,0,7,1,1,7,5],
    [9,0,3,9,3,5,5,3,7],
    [9,8,7,5,9,7],
    [5,8,4,5,10,8,10,11,8],
    [5,0,4,5,11,0,5,10,11,11,3,0],
    [0,1,9,8,4,10,8,10,11,10,4,5],
    [10,11,4,10,4,5,11,3,4,9,4,1,3,1,4],
    [2,5,1,2,8,5,2,11,8,4,5,8],
    [0,4,11,0,11,3,4,5,11,2,11,1,5,1,11],
    [0,2,5,0,5,9,2,11,5,4,5,8,11,8,5],
    [9,4,5,2,11,3],
    [2,5,10,3,5,2,3,4,5,3,8,4],
    [5,10,2,5,2,4,4,2,0],
    [3,10,2,3,5,10,3,8,5,4,5,8,0,1,9],
    [5,10,2,5,2,4,1,9,2,9,4,2],
    [8,4,5,8,5,3,3,5,1],
    [0,4,5,1,0,5],
    [8,4,5,8,5,3,9,0,5,0,3,5],
    [9,4,5],
    [4,11,7,4,9,11,9,10,11],
    [0,8,3,4,9,7,9,11,7,9,10,11],
    [1,10,11,1,11,4,1,4,0,7,4,11],
    [3,1,4,3,4,8,1,10,4,7,4,11,10,11,4],
    [4,11,7,9,11,4,9,2,11,9,1,2],
    [9,7,4,9,11,7,9,1,11,2,11,1,0,8,3],
    [11,7,4,11,4,2,2,4,0],
    [11,7,4,11,4,2,8,3,4,3,2,4],
    [2,9,10,2,7,9,2,3,7,7,4,9],
    [9,10,7,9,7,4,10,2,7,8,7,0,2,0,7],
    [3,7,10,3,10,2,7,4,10,1,10,0,4,0,10],
    [1,10,2,8,7,4],
    [4,9,1,4,1,7,7,1,3],
    [4,9,1,4,1,7,0,8,1,8,7,1],
    [4,0,3,7,4,3],
    [4,8,7],
    [9,10,8,10,11,8],
    [3,0,9,3,9,11,11,9,10],
    [0,1,10,0,10,8,8,10,11],
    [3,1,10,11,3,10],
    [1,2,11,1,11,9,9,11,8],
    [3,0,9,3,9,11,1,2,9,2,11,9],
    [0,2,11,8,0,11],
    [3,2,11],
    [2,3,8,2,8,10,10,8,9],
    [9,10,2,0,9,2],
    [2,3,8,2,8,10,0,1,8,1,10,8],
    [1,10,2],
    [1,3,8,9,1,8],
    [0,9,1],
    [0,3,8],
    [],
  ];
  return t;
}

const TRI_TABLE = buildTriTable();

// ---------------------------------------------------------------------------
// Isosurface extraction via marching cubes
// ---------------------------------------------------------------------------

function extractIsosurface(
  field: Float32Array,
  signField: Float32Array,
  gridSize: number,
  threshold: number,
): { positions: Float32Array; normals: Float32Array; colors: Float32Array } {
  const vertices: number[] = [];
  const vertexColors: number[] = [];
  const step = 1 / gridSize;

  const getVal = (i: number, j: number, k: number) =>
    field[i * (gridSize + 1) * (gridSize + 1) + j * (gridSize + 1) + k];
  const getSign = (i: number, j: number, k: number) =>
    signField[i * (gridSize + 1) * (gridSize + 1) + j * (gridSize + 1) + k];

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      for (let k = 0; k < gridSize; k++) {
        const vals: number[] = [];
        const signs: number[] = [];
        for (let c = 0; c < 8; c++) {
          const ci = i + MC_CORNERS[c][0];
          const cj = j + MC_CORNERS[c][1];
          const ck = k + MC_CORNERS[c][2];
          vals.push(getVal(ci, cj, ck));
          signs.push(getSign(ci, cj, ck));
        }

        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          if (vals[c] >= threshold) cubeIndex |= (1 << c);
        }

        if (MC_EDGE_TABLE[cubeIndex] === 0) continue;

        const edgeVerts: [number, number, number][] = [];
        const edgeSigns: number[] = [];

        for (let e = 0; e < 12; e++) {
          if (MC_EDGE_TABLE[cubeIndex] & (1 << e)) {
            const [c0, c1] = MC_EDGES[e];
            const v0 = vals[c0];
            const v1 = vals[c1];
            const t = (v0 - threshold) / (v0 - v1 + 1e-10);
            const x = (i + MC_CORNERS[c0][0] + t * (MC_CORNERS[c1][0] - MC_CORNERS[c0][0])) * step;
            const y = (j + MC_CORNERS[c0][1] + t * (MC_CORNERS[c1][1] - MC_CORNERS[c0][1])) * step;
            const z = (k + MC_CORNERS[c0][2] + t * (MC_CORNERS[c1][2] - MC_CORNERS[c0][2])) * step;
            edgeVerts[e] = [x, y, z];
            edgeSigns[e] = signs[c0] * (1 - t) + signs[c1] * t;
          }
        }

        const triList = TRI_TABLE[cubeIndex];
        for (let t = 0; t < triList.length; t += 3) {
          const e0 = triList[t];
          const e1 = triList[t + 1];
          const e2 = triList[t + 2];
          if (e0 === undefined || !edgeVerts[e0] || !edgeVerts[e1] || !edgeVerts[e2]) continue;

          for (const ei of [e0, e1, e2]) {
            const [vx, vy, vz] = edgeVerts[ei];
            // Center the mesh at origin
            vertices.push(vx - 0.5, vy - 0.5, vz - 0.5);
            const sign = edgeSigns[ei];
            vertexColors.push(sign >= 0 ? 1 : 0, 0, sign < 0 ? 1 : 0);
          }
        }
      }
    }
  }

  const positions = new Float32Array(vertices);
  const colors = new Float32Array(vertexColors);

  // Compute face normals
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i + 3] - positions[i];
    const ay = positions[i + 4] - positions[i + 1];
    const az = positions[i + 5] - positions[i + 2];
    const bx = positions[i + 6] - positions[i];
    const by = positions[i + 7] - positions[i + 1];
    const bz = positions[i + 8] - positions[i + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let j = 0; j < 3; j++) {
      normals[i + j * 3] = nx;
      normals[i + j * 3 + 1] = ny;
      normals[i + j * 3 + 2] = nz;
    }
  }

  return { positions, normals, colors };
}

// ---------------------------------------------------------------------------
// Sample |psi|^2 on a 3D Cartesian grid
// ---------------------------------------------------------------------------

function sampleHydrogenField(
  n: number, l: number, m: number, gridSize: number,
): { field: Float32Array; signField: Float32Array; maxVal: number } {
  const nn = gridSize + 1;
  const field = new Float32Array(nn * nn * nn);
  const signField = new Float32Array(nn * nn * nn);
  let maxVal = 0;
  const rMax = gridExtent(n);

  for (let i = 0; i < nn; i++) {
    const x = -rMax + (2 * rMax * i) / gridSize;
    for (let j = 0; j < nn; j++) {
      const y = -rMax + (2 * rMax * j) / gridSize;
      for (let k = 0; k < nn; k++) {
        const z = -rMax + (2 * rMax * k) / gridSize;
        const idx = i * nn * nn + j * nn + k;
        const psiVal = hydrogenPsi(x, y, z, n, l, m);
        const psiSqVal = psiVal * psiVal;
        field[idx] = psiSqVal;
        signField[idx] = psiVal >= 0 ? 1 : -1;
        if (psiSqVal > maxVal) maxVal = psiSqVal;
      }
    }
  }

  return { field, signField, maxVal };
}

// ---------------------------------------------------------------------------
// Orbital letter for l
// ---------------------------------------------------------------------------

function orbitalLetter(l: number): string {
  return ["s", "p", "d", "f"][l] || `l=${l}`;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HydrogenOrbitalsPage() {
  const { theme, toggle } = useTheme();
  const [qn, setQn] = useState(1);
  const [ql, setQl] = useState(0);
  const [qm, setQm] = useState(0);
  const [isoLevel, setIsoLevel] = useState(0.15);
  const [collapsed, setCollapsed] = useState(false);

  // Refs for Three.js
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const threeRafRef = useRef<number>(0);
  const isoMeshesRef = useRef<THREE.Mesh[]>([]);
  const axesRef = useRef<THREE.Group | null>(null);
  const nucleusRef = useRef<THREE.Mesh | null>(null);
  const bohrSphereRef = useRef<THREE.LineSegments | null>(null);

  // Refs for 2D canvases
  const radialCanvasRef = useRef<HTMLCanvasElement>(null);
  const angularCanvasRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef<Colors | null>(null);

  // Enforce quantum number constraints
  const handleSetN = useCallback((newN: number) => {
    setQn(newN);
    setQl((prevL) => {
      const maxL = newN - 1;
      const nextL = Math.min(prevL, maxL);
      setQm((prevM) => {
        const maxM = nextL;
        return Math.max(-maxM, Math.min(maxM, prevM));
      });
      return nextL;
    });
  }, []);

  const handleSetL = useCallback((newL: number) => {
    setQl(newL);
    setQm((prevM) => Math.max(-newL, Math.min(newL, prevM)));
  }, []);

  // ---------------------------------------------------------------------------
  // Three.js setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    colorsRef.current = getColors();
    const C = colorsRef.current;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.bg || "#0a0a0a");
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / 450, 0.1, 100);
    camera.position.set(1.2, 0.9, 1.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, 450);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.5;
    controls.maxDistance = 6;
    controlsRef.current = controls;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
    dir1.position.set(2, 3, 2);
    scene.add(dir1);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dir2.position.set(-2, -1, -1);
    scene.add(dir2);

    // Coordinate axes (faint)
    const axesGroup = new THREE.Group();
    const axisLen = 0.6;
    const axisMat = new THREE.LineBasicMaterial({ color: C.muted || "#666666", transparent: true, opacity: 0.35 });
    for (const dir of [[axisLen, 0, 0], [0, axisLen, 0], [0, 0, axisLen]] as [number, number, number][]) {
      const geom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-dir[0], -dir[1], -dir[2]),
        new THREE.Vector3(dir[0], dir[1], dir[2]),
      ]);
      const line = new THREE.Line(geom, axisMat);
      axesGroup.add(line);
    }
    scene.add(axesGroup);
    axesRef.current = axesGroup;

    // Nucleus
    const nucleusGeo = new THREE.SphereGeometry(0.012, 16, 16);
    const nucleusMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nucleus = new THREE.Mesh(nucleusGeo, nucleusMat);
    scene.add(nucleus);
    nucleusRef.current = nucleus;

    // Animation loop
    function animate() {
      threeRafRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      camera.aspect = w / 450;
      camera.updateProjectionMatrix();
      renderer.setSize(w, 450);
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
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((mat: THREE.Material) => mat.dispose());
          } else {
            (obj.material as THREE.Material).dispose();
          }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Update isosurface when quantum numbers or iso level change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!colorsRef.current) colorsRef.current = getColors();
    const C = colorsRef.current;

    // Remove old meshes
    for (const m of isoMeshesRef.current) {
      scene.remove(m);
      m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach((mat: THREE.Material) => mat.dispose());
      } else {
        (m.material as THREE.Material).dispose();
      }
    }
    isoMeshesRef.current = [];

    // Remove old Bohr sphere
    if (bohrSphereRef.current) {
      scene.remove(bohrSphereRef.current);
      bohrSphereRef.current.geometry.dispose();
      (bohrSphereRef.current.material as THREE.Material).dispose();
      bohrSphereRef.current = null;
    }

    // Sample field
    const GRID = 56;
    const { field, signField, maxVal } = sampleHydrogenField(qn, ql, qm, GRID);
    const rMax = gridExtent(qn);

    // Parse theme colors
    const posColorHex = C.position || "#3b82f6";
    const negColorHex = C.velocity || "#ef4444";
    const posColor3 = new THREE.Color(posColorHex);
    const negColor3 = new THREE.Color(negColorHex);

    // Create isosurfaces at multiple levels
    const levels = [0.15, 0.4, 0.75];
    const opacities = [0.08, 0.2, 0.45];

    for (let li = 0; li < levels.length; li++) {
      const actualThreshold = isoLevel * maxVal * levels[li];
      if (actualThreshold <= 0) continue;

      const { positions, normals } = extractIsosurface(field, signField, GRID, actualThreshold);
      if (positions.length === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

      // Color vertices by sign of psi
      const vertexColors = new Float32Array(positions.length);
      for (let v = 0; v < positions.length; v += 3) {
        // Convert from [-.5, .5] mesh coords back to real space
        const px = (positions[v] + 0.5) * 2 * rMax - rMax;
        const py = (positions[v + 1] + 0.5) * 2 * rMax - rMax;
        const pz = (positions[v + 2] + 0.5) * 2 * rMax - rMax;
        const psiVal = hydrogenPsi(px, py, pz, qn, ql, qm);
        const col = psiVal >= 0 ? posColor3 : negColor3;
        vertexColors[v] = col.r;
        vertexColors[v + 1] = col.g;
        vertexColors[v + 2] = col.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));

      const mat = new THREE.MeshPhongMaterial({
        vertexColors: true,
        transparent: true,
        opacity: opacities[li],
        side: THREE.DoubleSide,
        depthWrite: false,
        shininess: 40,
      });

      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      isoMeshesRef.current.push(mesh);
    }

    // Bohr sphere: r = n^2 * a0, map to mesh coordinates [-.5, .5]
    const bohrR = qn * qn;
    const bohrFrac = bohrR / (2 * rMax); // fraction of the box half
    if (bohrFrac < 0.5 && bohrFrac > 0.01) {
      const sphereGeo = new THREE.SphereGeometry(bohrFrac, 32, 24);
      const edgesGeo = new THREE.EdgesGeometry(sphereGeo);
      const edgesMat = new THREE.LineBasicMaterial({
        color: C.muted || "#666666",
        transparent: true,
        opacity: 0.12,
      });
      const wireframe = new THREE.LineSegments(edgesGeo, edgesMat);
      scene.add(wireframe);
      bohrSphereRef.current = wireframe;
      sphereGeo.dispose();
    }
  }, [qn, ql, qm, isoLevel]);

  // ---------------------------------------------------------------------------
  // Theme-reactive Three.js background
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const t = setTimeout(() => {
      const C = getColors();
      colorsRef.current = C;
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(C.bg || "#0a0a0a");
      }
    }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  // ---------------------------------------------------------------------------
  // 2D Canvas: radial probability distribution
  // ---------------------------------------------------------------------------

  const drawRadial = useCallback(() => {
    const canvas = radialCanvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) colorsRef.current = getColors();
    const C = colorsRef.current;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 1 || h < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = C.bg || "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const margin = { left: 50, right: 20, top: 20, bottom: 36 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    const rMaxPlot = gridExtent(qn) * 1.1;
    const nPts = 300;

    // Compute r^2 |R_nl(r)|^2
    const values: number[] = [];
    let maxY = 0;
    for (let i = 0; i <= nPts; i++) {
      const r = (i / nPts) * rMaxPlot;
      const R = radialR(qn, ql, r);
      const val = r * r * R * R;
      values.push(val);
      if (val > maxY) maxY = val;
    }

    // Axes
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.stroke();

    // Curve
    ctx.beginPath();
    ctx.strokeStyle = C.position || "#3b82f6";
    ctx.lineWidth = 2;
    for (let i = 0; i <= nPts; i++) {
      const x = margin.left + (i / nPts) * plotW;
      const y = margin.top + plotH - (maxY > 0 ? (values[i] / maxY) * plotH : 0);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill under curve with transparency
    ctx.lineTo(margin.left + plotW, margin.top + plotH);
    ctx.lineTo(margin.left, margin.top + plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = C.position || "#3b82f6";
    ctx.fill();
    ctx.globalAlpha = 1;

    // Bohr model prediction: r = n^2 a_0
    const bohrR = qn * qn;
    if (bohrR < rMaxPlot) {
      const bohrX = margin.left + (bohrR / rMaxPlot) * plotW;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.velocity || "#ef4444";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bohrX, margin.top);
      ctx.lineTo(bohrX, margin.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      drawPaddedLabel(ctx, `n\u00B2a\u2080 = ${bohrR}`, bohrX + 4, margin.top + 16, C.velocity || "#ef4444", C.bg || "#0a0a0a", "left", "top");
    }

    // Axis labels
    drawPaddedLabel(ctx, "r / a\u2080", margin.left + plotW / 2, margin.top + plotH + 22, C.muted || "#888", C.bg || "#0a0a0a", "center", "top");
    drawPaddedLabel(ctx, "r\u00B2|R(r)|\u00B2", margin.left - 6, margin.top + plotH / 2, C.muted || "#888", C.bg || "#0a0a0a", "right", "middle");

    // Tick labels on r axis
    ctx.fillStyle = C.muted || "#888";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const r = (i / nTicks) * rMaxPlot;
      const x = margin.left + (i / nTicks) * plotW;
      ctx.fillText(r.toFixed(0), x, margin.top + plotH + 4);
    }

    // Border
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);
  }, [qn, ql]);

  // ---------------------------------------------------------------------------
  // 2D Canvas: angular distribution polar plot
  // ---------------------------------------------------------------------------

  const drawAngular = useCallback(() => {
    const canvas = angularCanvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) colorsRef.current = getColors();
    const C = colorsRef.current;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w < 1 || h < 1) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = C.bg || "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 30;

    // Compute |Y_lm(theta, phi=0)|^2 as function of theta
    // In the xz plane (phi=0), polar angle theta goes from 0 to 2pi
    const nPts = 360;
    const vals: number[] = [];
    const signVals: number[] = [];
    let maxVal = 0;

    for (let i = 0; i <= nPts; i++) {
      const theta = (i / nPts) * Math.PI; // 0 to pi
      const Y = realYlm(ql, qm, theta, 0);
      const Ysq = Y * Y;
      vals.push(Ysq);
      signVals.push(Y >= 0 ? 1 : -1);
      if (Ysq > maxVal) maxVal = Ysq;
    }

    // Draw reference circles
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.3;
    for (const frac of [0.25, 0.5, 0.75, 1.0]) {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * frac, 0, 2 * Math.PI);
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - maxR - 10, cy);
    ctx.lineTo(cx + maxR + 10, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - maxR - 10);
    ctx.lineTo(cx, cy + maxR + 10);
    ctx.stroke();

    // Draw the angular distribution as a filled polar plot
    // Upper half: theta from 0 to pi, draw in the upper half of the plot
    // The polar angle is theta, and we map it so theta=0 points up, theta=pi points down
    if (maxVal > 0) {
      // Draw filled regions with positive/negative coloring
      // Upper half (theta = 0 to pi, right side of xz plane)
      ctx.beginPath();
      for (let i = 0; i <= nPts; i++) {
        const theta = (i / nPts) * Math.PI;
        const rr = (vals[i] / maxVal) * maxR;
        // In polar plot: angle measured from +z (up), so display angle is -pi/2 + theta
        // x = r*sin(theta), z = r*cos(theta) -> on canvas: px = cx + rr*sin(theta), py = cy - rr*cos(theta)
        const px = cx + rr * Math.sin(theta);
        const py = cy - rr * Math.cos(theta);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      // Color by dominant sign
      const upperSign = signVals[Math.floor(nPts / 4)]; // sample at theta ~ 45 deg
      ctx.fillStyle = upperSign >= 0 ? (C.position || "#3b82f6") : (C.velocity || "#ef4444");
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = upperSign >= 0 ? (C.position || "#3b82f6") : (C.velocity || "#ef4444");
      ctx.lineWidth = 2;
      ctx.stroke();

      // Left side / mirror (theta from 0 to pi, phi=pi equivalent -> sin(theta) is reflected)
      ctx.beginPath();
      for (let i = 0; i <= nPts; i++) {
        const theta = (i / nPts) * Math.PI;
        // At phi=pi: Y changes sign for odd m
        const Ypi = realYlm(ql, qm, theta, Math.PI);
        const YsqPi = Ypi * Ypi;
        const rr = (YsqPi / maxVal) * maxR;
        const px = cx - rr * Math.sin(theta); // mirror on left side
        const py = cy - rr * Math.cos(theta);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const Ypi_sample = realYlm(ql, qm, Math.PI / 4, Math.PI);
      const leftSign = Ypi_sample >= 0 ? 1 : -1;
      ctx.fillStyle = leftSign >= 0 ? (C.position || "#3b82f6") : (C.velocity || "#ef4444");
      ctx.globalAlpha = 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = leftSign >= 0 ? (C.position || "#3b82f6") : (C.velocity || "#ef4444");
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Labels
    drawPaddedLabel(ctx, "z", cx + 4, cy - maxR - 12, C.muted || "#888", C.bg || "#0a0a0a", "left", "bottom");
    drawPaddedLabel(ctx, "x", cx + maxR + 12, cy - 4, C.muted || "#888", C.bg || "#0a0a0a", "left", "bottom");
    drawPaddedLabel(ctx, `|Y_${ql}${qm}|\u00B2`, w - 14, 18, C.muted || "#888", C.bg || "#0a0a0a", "right", "top");
  }, [ql, qm]);

  // ---------------------------------------------------------------------------
  // Redraw 2D canvases
  // ---------------------------------------------------------------------------

  useEffect(() => {
    drawRadial();
    drawAngular();
  }, [drawRadial, drawAngular]);

  useEffect(() => {
    const handleResize = () => {
      drawRadial();
      drawAngular();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawRadial, drawAngular]);

  useEffect(() => {
    const t = setTimeout(() => {
      colorsRef.current = getColors();
      drawRadial();
      drawAngular();
    }, 60);
    return () => clearTimeout(t);
  }, [theme, drawRadial, drawAngular]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const energyEv = (-13.6 / (qn * qn)).toFixed(2);
  const orbLabel = `${qn}${orbitalLetter(ql)}`;
  const nodesRadial = qn - ql - 1;

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
            <span style={{ color: "var(--foreground)" }}>Hydrogen Orbitals</span>
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
            Hydrogen Atom Orbitals
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            The quantum states of the simplest atom, visualised as three-dimensional probability clouds.
            Each orbital&rsquo;s shape is determined by three quantum numbers.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">

        {/* --- Motivation text BEFORE visuals --- */}
        <section className="mt-10 mx-auto" style={{ maxWidth: "65ch" }}>
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The quantum numbers</h2>
          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The hydrogen atom is the simplest quantum system with a Coulomb
              potential: a single electron bound to a single proton. Solving the
              time-independent Schr&ouml;dinger equation in spherical coordinates yields
              a family of stationary states, each labelled by three quantum numbers.
            </p>
            <p>
              The <strong>principal quantum number</strong> <Tex>n = 1, 2, 3, \ldots</Tex> determines the
              energy of the state:
            </p>
            <div className="text-center py-1">
              <Tex display>{`E_n = -\\frac{13.6\\text{ eV}}{n^2}`}</Tex>
            </div>
            <p>
              The <strong>angular momentum quantum number</strong> <Tex>{`l = 0, 1, \\ldots, n{-}1`}</Tex> determines
              the shape of the orbital. By convention the letters s, p, d, f denote <Tex>{`l = 0, 1, 2, 3`}</Tex>.
            </p>
            <p>
              The <strong>magnetic quantum number</strong> <Tex>{`m = -l, -l{+}1, \\ldots, l`}</Tex> determines
              the orientation of the orbital in space.
            </p>
            <p>
              The full wave function factorises as
            </p>
            <div className="text-center py-1">
              <Tex display>{`\\psi_{nlm}(r,\\theta,\\varphi) = R_{nl}(r)\\,Y_l^m(\\theta,\\varphi)`}</Tex>
            </div>
            <p>
              where <Tex>{`R_{nl}(r)`}</Tex> is the radial wave function
              and <Tex>{`Y_l^m(\\theta,\\varphi)`}</Tex> is a spherical harmonic.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The radial wave function</h2>
          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The radial part <Tex>{`R_{nl}(r)`}</Tex> involves the associated
              Laguerre polynomials <Tex>{`L_{n-l-1}^{2l+1}`}</Tex>:
            </p>
            <div className="text-center py-1">
              <Tex display>{`R_{nl}(r) = -\\sqrt{\\left(\\frac{2}{na_0}\\right)^3 \\frac{(n-l-1)!}{2n\\,[(n+l)!]^3}}\\; e^{-r/(na_0)}\\left(\\frac{2r}{na_0}\\right)^l L_{n-l-1}^{2l+1}\\!\\left(\\frac{2r}{na_0}\\right)`}</Tex>
            </div>
            <p>
              The number of radial nodes (zeros of <Tex>{`R_{nl}`}</Tex> excluding <Tex>{`r = 0`}</Tex> and <Tex>{`r \\to \\infty`}</Tex>)
              is <Tex>{`n - l - 1`}</Tex>.
              For example the ground state 1s has no radial nodes, while 2s has one.
            </p>
          </div>
        </section>

        {/* --- 3D view: sticky collapsible panel --- */}
        <div
          className="mt-12 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                <Tex>{`(n, l, m) = (${qn}, ${ql}, ${qm})`}</Tex>
              </span>
              <span className="text-sm" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
                {orbLabel} &middot; E = {energyEv} eV
              </span>
            </div>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="text-xs px-2 py-1 rounded border cursor-pointer"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              {collapsed ? "show \u2193" : "hide \u2191"}
            </button>
          </div>

          <div style={{ display: collapsed ? "none" : "block" }}>
            {/* Three.js container */}
            <div ref={containerRef} className="w-full" style={{ height: 450, background: "var(--canvas-bg)" }} />

            {/* Preset buttons */}
            <div
              className="flex flex-wrap gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {PRESETS.map((p) => {
                const active = p.n === qn && p.l === ql && p.m === qm;
                return (
                  <button
                    key={p.label}
                    onClick={() => { setQn(p.n); setQl(p.l); setQm(p.m); }}
                    className="text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer"
                    style={{
                      borderColor: active ? "var(--foreground)" : "var(--border)",
                      color: active ? "var(--foreground)" : "var(--muted)",
                      fontFamily: "var(--font-geist-mono), monospace",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Sliders */}
            <div
              className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Principal" symbol="n" unit=""
                min={1} max={4} step={1}
                value={qn}
                onChange={handleSetN}
              />
              <SliderControl
                label="Angular momentum" symbol="l" unit=""
                min={0} max={qn - 1} step={1}
                value={ql}
                onChange={handleSetL}
              />
              <SliderControl
                label="Magnetic" symbol="m" unit=""
                min={-ql} max={ql} step={1}
                value={qm}
                onChange={setQm}
              />
              <SliderControl
                label="Iso level" symbol={"\u03b1"} unit=""
                min={0.05} max={0.5} step={0.01}
                value={isoLevel}
                onChange={setIsoLevel}
                displayValue={(v) => v.toFixed(2)}
              />
            </div>
          </div>
        </div>

        {/* --- Radial probability distribution --- */}
        <figure className="mt-16">
          <h3 className="text-lg font-semibold mb-3">
            Radial probability density: <Tex>{`r^2|R_{${qn}${ql}}(r)|^2`}</Tex>
          </h3>
          <canvas
            ref={radialCanvasRef}
            className="w-full rounded border"
            style={{ height: 240, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            The radial probability density shows where the electron is most likely to be found
            as a function of distance from the nucleus. The dashed line marks the Bohr model
            prediction <Tex>{`r = n^2 a_0`}</Tex>. Radial nodes: {nodesRadial}.
          </figcaption>
        </figure>

        {/* --- Angular distribution --- */}
        <figure className="mt-16">
          <h3 className="text-lg font-semibold mb-3">
            Angular distribution: <Tex>{`|Y_{${ql}}^{${qm}}(\\theta,\\varphi)|^2`}</Tex> in the xz plane
          </h3>
          <canvas
            ref={angularCanvasRef}
            className="w-full rounded border"
            style={{ height: 240, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Polar plot of the angular probability density in the xz plane (<Tex>{`\\varphi = 0`}</Tex> and <Tex>{`\\varphi = \\pi`}</Tex>).
            Blue regions indicate positive <Tex>{`Y_l^m`}</Tex>, red regions indicate negative.
          </figcaption>
        </figure>

        {/* --- Text sections after visuals --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          <h2 className="text-2xl font-semibold tracking-tight mb-5">Spherical harmonics and orbital shapes</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The angular part of the wave function, <Tex>{`Y_l^m(\\theta,\\varphi)`}</Tex>,
              determines the shape of the orbital.
            </p>
            <p>
              <strong>s orbitals</strong> (<Tex>{`l = 0`}</Tex>) are perfectly spherical &mdash;
              the angular part is simply a constant <Tex>{`1/\\sqrt{4\\pi}`}</Tex>. All
              directionality comes from the radial part alone.
            </p>
            <p>
              <strong>p orbitals</strong> (<Tex>{`l = 1`}</Tex>) have two lobes pointing
              in opposite directions. The three p orbitals (<Tex>{`m = -1, 0, +1`}</Tex>)
              point along the z, x, and y axes respectively (in the real-valued basis).
            </p>
            <p>
              <strong>d orbitals</strong> (<Tex>{`l = 2`}</Tex>) have four lobes (or a
              torus-plus-lobes shape for <Tex>{`m = 0`}</Tex>). The five d orbitals have
              characteristic cloverleaf patterns oriented in different planes.
            </p>
            <p>
              The <em>sign</em> of the wave function (the colour of positive versus negative lobes)
              is physically significant: it determines how orbitals on adjacent atoms can
              overlap constructively or destructively when forming molecular bonds.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Energy levels and degeneracy</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The energy of a hydrogen orbital depends <em>only</em> on the principal
              quantum number:
            </p>
            <div className="text-center py-1">
              <Tex display>{`E_n = -\\frac{13.6\\text{ eV}}{n^2}`}</Tex>
            </div>
            <p>
              For a given <Tex>n</Tex>, there
              are <Tex>{`n^2`}</Tex> degenerate states (ignoring spin): all values
              of <Tex>l</Tex> from 0 to <Tex>{`n{-}1`}</Tex>, and for
              each <Tex>l</Tex> all values of <Tex>m</Tex> from <Tex>{`{-}l`}</Tex> to <Tex>{`l`}</Tex>.
              The total count is <Tex>{`\\sum_{l=0}^{n-1}(2l+1) = n^2`}</Tex>.
            </p>
            <p>
              This <Tex>{`n^2`}</Tex>-fold degeneracy is special to the pure Coulomb
              potential &mdash; it is sometimes called <em>accidental degeneracy</em> because
              it cannot be explained by the obvious rotational symmetry alone (which accounts
              only for the <Tex>{`2l+1`}</Tex> degeneracy within a given <Tex>l</Tex>).
              It is ultimately a consequence of a hidden symmetry related to the
              Laplace&ndash;Runge&ndash;Lenz vector.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Bohr model comparison</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              In 1913, Bohr proposed a model in which the electron orbits the nucleus
              in well-defined circular orbits at radii <Tex>{`r_n = n^2 a_0`}</Tex>,
              where <Tex>{`a_0 \\approx 0.529\\,\\text{\\AA}`}</Tex> is the Bohr radius.
            </p>
            <p>
              Quantum mechanics replaces these sharp orbits with diffuse probability
              clouds. Nevertheless, the <em>most probable radius</em> for the 1s ground
              state (the peak of <Tex>{`r^2|R_{10}|^2`}</Tex>) is exactly <Tex>{`a_0`}</Tex>,
              in perfect agreement with the Bohr prediction.
            </p>
            <p>
              For higher-<Tex>n</Tex> states the correspondence weakens. The radial
              probability distribution develops multiple peaks (one for each radial
              antinode), and the most probable radius no longer coincides neatly
              with <Tex>{`n^2 a_0`}</Tex>. The Bohr radius is shown as a dashed line on the
              radial plot above for comparison.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-3 gap-5 mt-10 -mx-4 sm:-mx-16">
            <InfoCard
              title="Energy levels"
              borderColor="var(--position-color)"
              content={`The hydrogen energy levels follow E_n = -13.6 eV / n\u00B2. The ground state (n=1) has E = -13.6 eV. As n increases the levels converge toward zero (the ionization threshold). The spacing decreases as 1/n\u00B2, giving the familiar Lyman, Balmer, and Paschen spectral series.`}
            />
            <InfoCard
              title="Orbital notation"
              borderColor="var(--phase-color)"
              content={`Orbitals are labelled by n followed by a letter for l: s (l=0), p (l=1), d (l=2), f (l=3). These letters originated from early spectroscopic terminology: sharp, principal, diffuse, and fundamental. Beyond f the letters continue alphabetically: g, h, i, and so on.`}
            />
            <InfoCard
              title="Selection rules"
              borderColor="var(--velocity-color)"
              content={`Electric dipole transitions between hydrogen orbitals obey the selection rule \u0394l = \u00B11. This means an s orbital can transition to a p orbital (and vice versa), but not directly to another s or to a d orbital. The rule \u0394m = 0, \u00B11 also applies. These rules arise from the angular integral of the dipole matrix element.`}
            />
          </div>

        </section>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Info card component
// ---------------------------------------------------------------------------

function InfoCard({
  title,
  borderColor,
  content,
}: {
  title: string;
  borderColor: string;
  content: string;
}) {
  return (
    <div
      className="rounded-lg border-l-4 p-6 sm:p-8 space-y-3"
      style={{
        borderLeftColor: borderColor,
        borderTop: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
      }}
    >
      <div className="text-base font-semibold">{title}</div>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {content}
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
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
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
