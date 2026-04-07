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

type SlicePlane = "xy" | "xz" | "yz";

interface Preset {
  label: string;
  nx: number;
  ny: number;
  nz: number;
}

const PRESETS: Preset[] = [
  { label: "Ground state (1,1,1)", nx: 1, ny: 1, nz: 1 },
  { label: "First excited (2,1,1)", nx: 2, ny: 1, nz: 1 },
  { label: "Degenerate (1,2,1)", nx: 1, ny: 2, nz: 1 },
  { label: "Higher mode (2,2,2)", nx: 2, ny: 2, nz: 2 },
  { label: "Complex (3,2,1)", nx: 3, ny: 2, nz: 1 },
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
// Wave function helpers (natural units: L=1, hbar^2 pi^2 / 2m = 1)
// ---------------------------------------------------------------------------

function psi(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  return 2 * Math.sqrt(2) * Math.sin(nx * Math.PI * x) * Math.sin(ny * Math.PI * y) * Math.sin(nz * Math.PI * z);
}

function psiSq(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const v = psi(x, y, z, nx, ny, nz);
  return v * v;
}

function energy(nx: number, ny: number, nz: number): number {
  return nx * nx + ny * ny + nz * nz;
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

// Edge vertex indices: each edge connects two corners
const MC_EDGES: [number, number][] = [
  [0,1],[1,2],[2,3],[3,0], // bottom face
  [4,5],[5,6],[6,7],[7,4], // top face
  [0,4],[1,5],[2,6],[3,7], // vertical edges
];

// Corner offsets in (i,j,k)
const MC_CORNERS: [number,number,number][] = [
  [0,0,0],[1,0,0],[1,1,0],[0,1,0],
  [0,0,1],[1,0,1],[1,1,1],[0,1,1],
];

// ---------------------------------------------------------------------------
// Isosurface extraction using marching cubes with full triangle table
// ---------------------------------------------------------------------------

// Full marching cubes triangle table (classic Lorensen & Cline)
// We encode this compactly: for each of 256 cases, a list of edge triples
function buildTriTable(): number[][] {
  // This is the classic MC tri table. We include all 256 entries.
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

function extractIsosurface(
  field: Float32Array,
  signField: Float32Array,
  gridSize: number,
  threshold: number,
): { positions: Float32Array; normals: Float32Array; colors: Float32Array; posColor: string; negColor: string } & { posColor: string; negColor: string } {
  const vertices: number[] = [];
  const vertexColors: number[] = [];
  const step = 1 / gridSize;

  // Parse colors later - for now collect sign at each vertex
  const getVal = (i: number, j: number, k: number) => {
    return field[i * (gridSize + 1) * (gridSize + 1) + j * (gridSize + 1) + k];
  };
  const getSign = (i: number, j: number, k: number) => {
    return signField[i * (gridSize + 1) * (gridSize + 1) + j * (gridSize + 1) + k];
  };

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      for (let k = 0; k < gridSize; k++) {
        // Get the 8 corner values
        const vals: number[] = [];
        const signs: number[] = [];
        for (let c = 0; c < 8; c++) {
          const ci = i + MC_CORNERS[c][0];
          const cj = j + MC_CORNERS[c][1];
          const ck = k + MC_CORNERS[c][2];
          vals.push(getVal(ci, cj, ck));
          signs.push(getSign(ci, cj, ck));
        }

        // Compute cube index
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          if (vals[c] >= threshold) cubeIndex |= (1 << c);
        }

        if (MC_EDGE_TABLE[cubeIndex] === 0) continue;

        // Interpolate edge vertices
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

        // Generate triangles from tri table
        const triList = TRI_TABLE[cubeIndex];
        for (let t = 0; t < triList.length; t += 3) {
          const e0 = triList[t];
          const e1 = triList[t + 1];
          const e2 = triList[t + 2];
          if (e0 === undefined || !edgeVerts[e0] || !edgeVerts[e1] || !edgeVerts[e2]) continue;

          // Push triangle vertices (centered: subtract 0.5 to center the box)
          for (const ei of [e0, e1, e2]) {
            const [vx, vy, vz] = edgeVerts[ei];
            vertices.push(vx - 0.5, vy - 0.5, vz - 0.5);
            // Color based on sign of psi: >0 = positive (blue), <0 = negative (red)
            const sign = edgeSigns[ei];
            vertexColors.push(sign >= 0 ? 1 : 0, 0, sign < 0 ? 1 : 0);
          }
        }
      }
    }
  }

  const positions = new Float32Array(vertices);
  const colors = new Float32Array(vertexColors);

  // Compute normals
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

  return { positions, normals, colors, posColor: "", negColor: "" };
}

// ---------------------------------------------------------------------------
// Sample 3D field
// ---------------------------------------------------------------------------

function sampleField(nx: number, ny: number, nz: number, gridSize: number): { field: Float32Array; signField: Float32Array; maxVal: number } {
  const n = gridSize + 1;
  const field = new Float32Array(n * n * n);
  const signField = new Float32Array(n * n * n);
  let maxVal = 0;

  for (let i = 0; i < n; i++) {
    const x = i / gridSize;
    for (let j = 0; j < n; j++) {
      const y = j / gridSize;
      for (let k = 0; k < n; k++) {
        const z = k / gridSize;
        const idx = i * n * n + j * n + k;
        const psiVal = psi(x, y, z, nx, ny, nz);
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
// Energy levels for diagram
// ---------------------------------------------------------------------------

function computeEnergyLevels(maxE: number): { e: number; states: [number, number, number][]; degeneracy: number }[] {
  const map = new Map<number, [number, number, number][]>();
  for (let a = 1; a <= 5; a++) {
    for (let b = 1; b <= 5; b++) {
      for (let c = 1; c <= 5; c++) {
        const e = a * a + b * b + c * c;
        if (e <= maxE) {
          if (!map.has(e)) map.set(e, []);
          map.get(e)!.push([a, b, c]);
        }
      }
    }
  }
  const levels: { e: number; states: [number, number, number][]; degeneracy: number }[] = [];
  for (const [e, states] of map.entries()) {
    levels.push({ e, states, degeneracy: states.length });
  }
  levels.sort((a, b) => a.e - b.e);
  return levels;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function QuantumBox3DPage() {
  const { theme, toggle } = useTheme();
  const [nx, setNx] = useState(1);
  const [ny, setNy] = useState(1);
  const [nz, setNz] = useState(1);
  const [isoLevel, setIsoLevel] = useState(0.3);
  const [showNodal, setShowNodal] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [slicePlane, setSlicePlane] = useState<SlicePlane>("xy");
  const [slicePos, setSlicePos] = useState(0.5);

  // Refs for Three.js
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const threeRafRef = useRef<number>(0);
  const isoMeshesRef = useRef<THREE.Mesh[]>([]);
  const nodalMeshesRef = useRef<THREE.Mesh[]>([]);
  const wireframeRef = useRef<THREE.LineSegments | null>(null);

  // Refs for 2D canvases
  const sliceCanvasRef = useRef<HTMLCanvasElement>(null);
  const energyCanvasRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef<Colors | null>(null);

  // ---------------------------------------------------------------------------
  // Three.js setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    colorsRef.current = getColors();
    const C = colorsRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(C.bg || "#0a0a0a");
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / 420, 0.1, 100);
    camera.position.set(1.2, 1.0, 1.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, 420);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.8;
    controls.maxDistance = 5;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 3, 2);
    scene.add(dirLight);

    // Wireframe cube
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: C.muted || "#666666", linewidth: 1 });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    scene.add(wireframe);
    wireframeRef.current = wireframe;
    boxGeo.dispose();

    // Animation loop
    function animate() {
      threeRafRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      camera.aspect = w / 420;
      camera.updateProjectionMatrix();
      renderer.setSize(w, 420);
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
            obj.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            (obj.material as THREE.Material).dispose();
          }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Update Three.js scene when quantum numbers or iso level change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!colorsRef.current) colorsRef.current = getColors();
    const C = colorsRef.current;

    // Remove old isosurface meshes
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

    // Remove old nodal planes
    for (const m of nodalMeshesRef.current) {
      scene.remove(m);
      m.geometry.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach((mat: THREE.Material) => mat.dispose());
      } else {
        (m.material as THREE.Material).dispose();
      }
    }
    nodalMeshesRef.current = [];

    // Sample the field
    const GRID = 44;
    const { field, signField, maxVal } = sampleField(nx, ny, nz, GRID);

    // Parse theme colors for positive/negative regions
    const posColorHex = C.position || "#3b82f6";
    const negColorHex = C.velocity || "#ef4444";
    const posColor3 = new THREE.Color(posColorHex);
    const negColor3 = new THREE.Color(negColorHex);

    // Create isosurfaces at multiple levels
    const levels = [0.2, 0.4, 0.65, 0.85];
    const opacities = [0.08, 0.15, 0.3, 0.5];

    for (let li = 0; li < levels.length; li++) {
      const threshold = levels[li] * isoLevel * maxVal + (1 - levels[li]) * isoLevel * maxVal * 0.1;
      const actualThreshold = isoLevel * maxVal * levels[li];

      const { positions, normals } = extractIsosurface(field, signField, GRID, actualThreshold);

      if (positions.length === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

      // Color vertices based on sign of psi at that location
      const vertexColors = new Float32Array(positions.length);
      for (let v = 0; v < positions.length; v += 3) {
        const px = positions[v] + 0.5;
        const py = positions[v + 1] + 0.5;
        const pz = positions[v + 2] + 0.5;
        const psiVal = psi(px, py, pz, nx, ny, nz);
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
        shininess: 30,
      });

      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      isoMeshesRef.current.push(mesh);
    }

    // Nodal planes
    if (showNodal) {
      const nodalColor = new THREE.Color(C.muted || "#888888");

      // x-nodal planes: x = k/nx for k = 1..nx-1
      for (let k = 1; k < nx; k++) {
        const xPos = k / nx - 0.5;
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        const planeMat = new THREE.MeshBasicMaterial({
          color: nodalColor,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(xPos, 0, 0);
        plane.rotation.y = Math.PI / 2;
        scene.add(plane);
        nodalMeshesRef.current.push(plane);
      }

      // y-nodal planes: y = k/ny for k = 1..ny-1
      for (let k = 1; k < ny; k++) {
        const yPos = k / ny - 0.5;
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        const planeMat = new THREE.MeshBasicMaterial({
          color: nodalColor,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(0, yPos, 0);
        plane.rotation.x = Math.PI / 2;
        scene.add(plane);
        nodalMeshesRef.current.push(plane);
      }

      // z-nodal planes: z = k/nz for k = 1..nz-1
      for (let k = 1; k < nz; k++) {
        const zPos = k / nz - 0.5;
        const planeGeo = new THREE.PlaneGeometry(1, 1);
        const planeMat = new THREE.MeshBasicMaterial({
          color: nodalColor,
          transparent: true,
          opacity: 0.15,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.position.set(0, 0, zPos);
        scene.add(plane);
        nodalMeshesRef.current.push(plane);
      }
    }
  }, [nx, ny, nz, isoLevel, showNodal]);

  // ---------------------------------------------------------------------------
  // Update Three.js background on theme change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const t = setTimeout(() => {
      const C = getColors();
      colorsRef.current = C;
      if (sceneRef.current) {
        sceneRef.current.background = new THREE.Color(C.bg || "#0a0a0a");
      }
      if (wireframeRef.current) {
        (wireframeRef.current.material as THREE.LineBasicMaterial).color.set(C.muted || "#666666");
      }
    }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  // ---------------------------------------------------------------------------
  // 2D slice canvas drawing
  // ---------------------------------------------------------------------------

  const drawSlice = useCallback(() => {
    const canvas = sliceCanvasRef.current;
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

    // Fill background
    ctx.fillStyle = C.bg || "#0a0a0a";
    ctx.fillRect(0, 0, w, h);

    const margin = { left: 40, right: 20, top: 20, bottom: 30 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const res = 120;

    // Compute max for normalization
    let maxPsiSq = 0;
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        let x: number, y: number, z: number;
        const u = i / res;
        const v = j / res;
        if (slicePlane === "xy") { x = u; y = v; z = slicePos; }
        else if (slicePlane === "xz") { x = u; y = slicePos; z = v; }
        else { x = slicePos; y = u; z = v; }
        const val = psiSq(x, y, z, nx, ny, nz);
        if (val > maxPsiSq) maxPsiSq = val;
      }
    }

    // Parse colors
    const posCol = C.position || "#3b82f6";
    const pr = parseInt(posCol.slice(1, 3), 16) || 59;
    const pg = parseInt(posCol.slice(3, 5), 16) || 130;
    const pb = parseInt(posCol.slice(5, 7), 16) || 246;

    // Draw heatmap
    const cellW = plotW / res;
    const cellH = plotH / res;
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        let x: number, y: number, z: number;
        const u = i / res;
        const v = j / res;
        if (slicePlane === "xy") { x = u; y = v; z = slicePos; }
        else if (slicePlane === "xz") { x = u; y = slicePos; z = v; }
        else { x = slicePos; y = u; z = v; }
        const val = psiSq(x, y, z, nx, ny, nz);
        const t = maxPsiSq > 0 ? val / maxPsiSq : 0;

        // Color from dark to the position color
        const r = Math.round(pr * t);
        const g = Math.round(pg * t);
        const b = Math.round(pb * t);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(margin.left + i * cellW, margin.top + (res - j) * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Axis labels
    ctx.fillStyle = C.muted || "#888";
    ctx.font = "italic 11px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const axes = slicePlane === "xy" ? ["x", "y"] : slicePlane === "xz" ? ["x", "z"] : ["y", "z"];
    ctx.fillText(axes[0], margin.left + plotW / 2, h - 12);
    ctx.save();
    ctx.translate(12, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(axes[1], 0, 0);
    ctx.restore();

    // Border
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(margin.left, margin.top, plotW, plotH);

    // Scale labels
    ctx.fillStyle = C.muted || "#888";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText("0", margin.left - 4, margin.top + plotH);
    ctx.fillText("L", margin.left - 4, margin.top);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText("0", margin.left, margin.top + plotH + 4);
    ctx.fillText("L", margin.left + plotW, margin.top + plotH + 4);
  }, [nx, ny, nz, slicePlane, slicePos]);

  // ---------------------------------------------------------------------------
  // Energy level diagram
  // ---------------------------------------------------------------------------

  const drawEnergy = useCallback(() => {
    const canvas = energyCanvasRef.current;
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

    const margin = { left: 50, right: 80, top: 15, bottom: 15 };
    const plotH = h - margin.top - margin.bottom;
    const plotW = w - margin.left - margin.right;

    const levels = computeEnergyLevels(50);
    if (levels.length === 0) return;
    const maxE = levels[levels.length - 1].e;
    const currentE = energy(nx, ny, nz);

    // y-axis
    ctx.strokeStyle = C.grid || "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, h - margin.bottom);
    ctx.stroke();

    // Energy label
    ctx.fillStyle = C.muted || "#888";
    ctx.font = "italic 12px Georgia, serif";
    ctx.save();
    ctx.translate(14, margin.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("E / (pi^2 h^2 / 2mL^2)", 0, 0);
    ctx.restore();

    for (const level of levels) {
      const yFrac = 1 - (level.e - 3) / (maxE - 3 + 1);
      const y = margin.top + yFrac * plotH;

      const isCurrent = level.e === currentE;

      ctx.strokeStyle = isCurrent ? (C.total || "#22c55e") : (C.grid || "#333");
      ctx.lineWidth = isCurrent ? 2.5 : 1;
      ctx.beginPath();
      ctx.moveTo(margin.left + 4, y);
      ctx.lineTo(margin.left + plotW, y);
      ctx.stroke();

      // Energy value
      ctx.fillStyle = isCurrent ? (C.total || "#22c55e") : (C.muted || "#888");
      ctx.font = isCurrent ? "bold 11px monospace" : "10px monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`${level.e}`, margin.left - 6, y);

      // Degeneracy
      ctx.textAlign = "left";
      ctx.font = "10px monospace";
      ctx.fillStyle = isCurrent ? (C.total || "#22c55e") : (C.muted || "#888");
      const degLabel = level.degeneracy > 1 ? `g = ${level.degeneracy}` : "";
      ctx.fillText(degLabel, margin.left + plotW + 6, y);
    }
  }, [nx, ny, nz]);

  // ---------------------------------------------------------------------------
  // Redraw 2D canvases
  // ---------------------------------------------------------------------------

  useEffect(() => {
    drawSlice();
    drawEnergy();
  }, [drawSlice, drawEnergy]);

  // Resize handler for 2D canvases
  useEffect(() => {
    const handleResize = () => {
      drawSlice();
      drawEnergy();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawSlice, drawEnergy]);

  // Redraw on theme change
  useEffect(() => {
    const t = setTimeout(() => {
      colorsRef.current = getColors();
      drawSlice();
      drawEnergy();
    }, 60);
    return () => clearTimeout(t);
  }, [theme, drawSlice, drawEnergy]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const currentEnergy = energy(nx, ny, nz);

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
            <span style={{ color: "var(--foreground)" }}>3D Quantum Box</span>
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
            Particle in a 3D Box
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            Stationary states of a quantum particle confined to a cubic infinite potential well, visualized
            as probability-density isosurfaces in three dimensions.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* 3D view — sticky, collapsible */}
        <div
          className="mt-8 rounded border overflow-hidden sticky top-4 z-10 transition-all"
          style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium" style={{ fontFamily: "var(--font-geist-mono), monospace" }}>
                <Tex>{`(n_x, n_y, n_z) = (${nx}, ${ny}, ${nz})`}</Tex>
              </span>
              <span className="text-sm" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
                E = {currentEnergy}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowNodal((s) => !s)}
                className="text-sm px-3 py-1 rounded border transition-colors cursor-pointer"
                style={{
                  borderColor: showNodal ? "var(--phase-color)" : "var(--border)",
                  color: showNodal ? "var(--phase-color)" : "var(--foreground)",
                }}
              >
                {showNodal ? "Nodal On" : "Nodal Off"}
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

          <div style={{ display: collapsed ? "none" : "block" }}>
            {/* Three.js container */}
            <div ref={containerRef} className="w-full" style={{ height: 420, background: "var(--canvas-bg)" }} />

            {/* Preset buttons */}
            <div
              className="flex flex-wrap gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              {PRESETS.map((p) => {
                const active = p.nx === nx && p.ny === ny && p.nz === nz;
                return (
                  <button
                    key={p.label}
                    onClick={() => { setNx(p.nx); setNy(p.ny); setNz(p.nz); }}
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
                label="Quantum number" symbol="n_x" unit=""
                min={1} max={5} step={1}
                value={nx}
                onChange={(v) => setNx(v)}
              />
              <SliderControl
                label="Quantum number" symbol="n_y" unit=""
                min={1} max={5} step={1}
                value={ny}
                onChange={(v) => setNy(v)}
              />
              <SliderControl
                label="Quantum number" symbol="n_z" unit=""
                min={1} max={5} step={1}
                value={nz}
                onChange={(v) => setNz(v)}
              />
              <SliderControl
                label="Iso level" symbol="\u03b1" unit=""
                min={0.1} max={0.9} step={0.05}
                value={isoLevel}
                onChange={(v) => setIsoLevel(v)}
                displayValue={(v) => v.toFixed(2)}
              />
            </div>
          </div>
        </div>

        {/* 2D cross-section heatmap */}
        <figure className="mt-16">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Cross-section: <Tex>{`|\\psi|^2`}</Tex></h3>
            <div className="flex items-center gap-2">
              {(["xy", "xz", "yz"] as SlicePlane[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setSlicePlane(p)}
                  className="text-xs px-2.5 py-1 rounded border cursor-pointer"
                  style={{
                    borderColor: slicePlane === p ? "var(--foreground)" : "var(--border)",
                    color: slicePlane === p ? "var(--foreground)" : "var(--muted)",
                    fontFamily: "var(--font-geist-mono), monospace",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <canvas
            ref={sliceCanvasRef}
            className="w-full rounded border"
            style={{ height: 260, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <div className="mt-3" style={{ maxWidth: 300 }}>
            <SliderControl
              label="Slice position" symbol={slicePlane === "xy" ? "z" : slicePlane === "xz" ? "y" : "x"} unit="/ L"
              min={0.01} max={0.99} step={0.01}
              value={slicePos}
              onChange={(v) => setSlicePos(v)}
              displayValue={(v) => v.toFixed(2)}
            />
          </div>
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Heatmap of <Tex>{`|\\psi|^2`}</Tex> in the {slicePlane}-plane at {slicePlane === "xy" ? "z" : slicePlane === "xz" ? "y" : "x"} = {slicePos.toFixed(2)}L. Brighter regions indicate higher probability density.
          </figcaption>
        </figure>

        {/* Energy level diagram */}
        <figure className="mt-16">
          <h3 className="text-lg font-semibold mb-3">Energy levels</h3>
          <canvas
            ref={energyCanvasRef}
            className="w-full rounded border"
            style={{ height: 220, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Energy spectrum of the 3D box. The current state (<Tex>{`n_x=${nx}, n_y=${ny}, n_z=${nz}`}</Tex>) is highlighted. Degeneracy <Tex>g</Tex> counts the number of distinct states sharing each energy.
          </figcaption>
        </figure>

        {/* --- Text sections --- */}
        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>

          <h2 className="text-2xl font-semibold tracking-tight mb-5">The infinite potential well in three dimensions</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Consider a particle of mass <Tex>m</Tex> confined inside a cube of
              side <Tex>L</Tex>. The potential is zero inside and infinite outside, so the
              particle cannot escape. The time-independent Schr&ouml;dinger equation
              inside the box is
            </p>

            <div className="text-center py-1">
              <Tex display>{`-\\frac{\\hbar^2}{2m}\\nabla^2\\psi = E\\psi`}</Tex>
            </div>

            <p>
              Because the boundary conditions are separable in Cartesian coordinates,
              we write <Tex>{`\\psi(x,y,z) = X(x)\\,Y(y)\\,Z(z)`}</Tex> and obtain three
              independent one-dimensional problems. Each has the well-known
              solution <Tex>{`\\sin(n\\pi x/L)`}</Tex> with <Tex>{`n = 1, 2, 3, \\ldots`}</Tex>.
              The full wave function is therefore
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\psi_{n_x n_y n_z}(x,y,z) = \\left(\\frac{2}{L}\\right)^{3/2} \\sin\\!\\left(\\frac{n_x\\pi x}{L}\\right) \\sin\\!\\left(\\frac{n_y\\pi y}{L}\\right) \\sin\\!\\left(\\frac{n_z\\pi z}{L}\\right)`}</Tex>
            </div>

            <p>
              Each direction contributes <Tex>{`n^2\\pi^2\\hbar^2 / 2mL^2`}</Tex> to the energy.
              The total energy eigenvalue is
            </p>

            <div className="text-center py-1">
              <Tex display>{`E_{n_x n_y n_z} = \\frac{\\pi^2\\hbar^2}{2mL^2}\\left(n_x^2 + n_y^2 + n_z^2\\right)`}</Tex>
            </div>

            <p>
              In the natural units of this simulation (<Tex>{`L = 1`}</Tex>, <Tex>{`\\pi^2\\hbar^2/2m = 1`}</Tex>),
              the energy reduces simply to <Tex>{`E = n_x^2 + n_y^2 + n_z^2`}</Tex>. The
              ground state <Tex>{`(1,1,1)`}</Tex> has <Tex>{`E = 3`}</Tex>.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Degeneracy</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A striking feature of the cubic box is <em>degeneracy</em>: multiple
              quantum states can share the same energy. This occurs whenever
              different combinations of <Tex>{`(n_x, n_y, n_z)`}</Tex> yield the same
              value of <Tex>{`n_x^2 + n_y^2 + n_z^2`}</Tex>.
            </p>

            <p>
              The simplest example is the first excited level, <Tex>{`E = 6`}</Tex>.
              The three states <Tex>{`(2,1,1)`}</Tex>, <Tex>{`(1,2,1)`}</Tex>,
              and <Tex>{`(1,1,2)`}</Tex> are physically distinct &mdash; they have different
              spatial probability distributions &mdash; yet they all have the same energy.
              This threefold degeneracy is a direct consequence of the cubic symmetry:
              the box looks the same along all three axes, so permuting the quantum
              numbers among the axes cannot change the energy.
            </p>

            <p>
              At higher energies the degeneracy pattern becomes richer. For instance, <Tex>{`E = 27`}</Tex> includes
              both <Tex>{`(3,3,3)`}</Tex> and <Tex>{`(1,1,5)`}</Tex> (plus its
              permutations), giving a total of four degenerate states. Such &ldquo;accidental&rdquo;
              degeneracies arise when different sums of squares happen to coincide and
              are not simply related to axis permutations.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-2 gap-5 mt-10 -mx-4 sm:-mx-16">
            <InfoCard
              title="Nodal structure"
              borderColor="var(--phase-color)"
              content={`The wave function vanishes on (n_x - 1) + (n_y - 1) + (n_z - 1) interior planes. These are the nodal surfaces where the standing wave crosses zero. For the state (n_x, n_y, n_z), there are n_x - 1 planes perpendicular to x, n_y - 1 perpendicular to y, and n_z - 1 perpendicular to z. Higher quantum numbers produce finer spatial oscillations and more nodes.`}
            />
            <InfoCard
              title="Probability density"
              borderColor="var(--position-color)"
              content={`The quantity |psi|^2 gives the probability per unit volume of finding the particle at each point in space. The 3D isosurfaces above are surfaces of equal probability density. The inner (more opaque) surfaces enclose regions of higher density, while the outer (more transparent) surfaces trace the weaker tails of the distribution. Blue regions correspond to positive psi, red to negative.`}
            />
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Nodal surfaces and probability density</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Since the wave function is a product of sines, its zeros form
              planes perpendicular to the coordinate axes. The
              factor <Tex>{`\\sin(n_x \\pi x / L)`}</Tex> vanishes
              at <Tex>{`x = k L / n_x`}</Tex> for <Tex>{`k = 1, \\ldots, n_x - 1`}</Tex>,
              giving a total of <Tex>{`(n_x - 1) + (n_y - 1) + (n_z - 1)`}</Tex> interior
              nodal planes. These are shown as translucent sheets in the 3D view.
            </p>

            <p>
              The quantity <Tex>{`|\\psi(\\mathbf{r})|^2\\,d^3r`}</Tex> gives the probability of
              finding the particle in a small volume element. The 3D isosurfaces are surfaces of
              constant <Tex>{`|\\psi|^2`}</Tex>. The 2D cross-section shows the same quantity
              as a heatmap in a chosen plane.
              The normalization <Tex>{`\\int |\\psi|^2 d^3r = 1`}</Tex> is ensured by
              the prefactor <Tex>{`(2/L)^{3/2}`}</Tex>.
            </p>
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
