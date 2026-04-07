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

type Scenario = "rest" | "time-dilation" | "length-contraction" | "twin-paradox" | "simultaneity";

interface SpacetimeEvent {
  x: number;
  ct: number;
  label: string;
  color: string;
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
// Lorentz transformation
// ---------------------------------------------------------------------------

function gamma(beta: number): number {
  return 1 / Math.sqrt(1 - beta * beta);
}

function lorentz(x: number, ct: number, beta: number): { xp: number; ctp: number } {
  const g = gamma(beta);
  return {
    xp: g * (x - beta * ct),
    ctp: g * (ct - beta * x),
  };
}

// ---------------------------------------------------------------------------
// Scenario presets
// ---------------------------------------------------------------------------

function scenarioEvents(scenario: Scenario, C: Colors): SpacetimeEvent[] {
  switch (scenario) {
    case "rest":
      return [
        { x: 0, ct: 0, label: "O", color: C.position },
        { x: 2, ct: 3, label: "A", color: C.velocity },
        { x: -1.5, ct: 2, label: "B", color: C.total },
      ];
    case "time-dilation":
      return [
        { x: 0, ct: 0, label: "tick 0", color: C.position },
        { x: 0, ct: 2, label: "tick 1", color: C.velocity },
        { x: 0, ct: 4, label: "tick 2", color: C.total },
      ];
    case "length-contraction":
      return [
        { x: -1.5, ct: 0, label: "left end", color: C.position },
        { x: 1.5, ct: 0, label: "right end", color: C.velocity },
        { x: 0, ct: 0, label: "center", color: C.total },
      ];
    case "twin-paradox":
      return [
        { x: 0, ct: 0, label: "departure", color: C.position },
        { x: 0, ct: 6, label: "reunion", color: C.velocity },
      ];
    case "simultaneity":
      return [
        { x: -2, ct: 2, label: "E\u2081", color: C.position },
        { x: 0, ct: 2, label: "E\u2082", color: C.velocity },
        { x: 2, ct: 2, label: "E\u2083", color: C.total },
      ];
  }
}

// ---------------------------------------------------------------------------
// Helper: CSS color string -> THREE.Color
// ---------------------------------------------------------------------------

function cssToThree(css: string): THREE.Color {
  const c = new THREE.Color();
  if (css.startsWith("#")) { c.set(css); }
  else if (css.startsWith("rgb")) {
    const m = css.match(/[\d.]+/g);
    if (m && m.length >= 3) c.setRGB(+m[0] / 255, +m[1] / 255, +m[2] / 255);
  } else if (css.startsWith("hsl")) {
    const m = css.match(/[\d.]+/g);
    if (m && m.length >= 3) c.setHSL(+m[0] / 360, +m[1] / 100, +m[2] / 100);
  } else { c.set(css || "#888888"); }
  return c;
}

// ---------------------------------------------------------------------------
// Helper: draw padded label on 2D canvas (no overlap with lines)
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
// Component
// ---------------------------------------------------------------------------

export default function SpecialRelativityPage() {
  const { theme, toggle } = useTheme();
  const [beta, setBeta] = useState(0);
  const [scenario, setScenario] = useState<Scenario>("rest");
  const [collapsed, setCollapsed] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const threeRafRef = useRef<number>(0);
  const overlayRef = useRef<HTMLDivElement>(null);
  const boostedGroupRef = useRef<THREE.Group | null>(null);
  const eventsGroupRef = useRef<THREE.Group | null>(null);
  const worldlinesGroupRef = useRef<THREE.Group | null>(null);
  const twinCanvasRef = useRef<HTMLCanvasElement>(null);
  const additionCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRafRef = useRef<number>(0);
  const colorsRef = useRef<Colors | null>(null);
  const betaRef = useRef(beta);
  const scenarioRef = useRef(scenario);

  useEffect(() => { betaRef.current = beta; }, [beta]);
  useEffect(() => { scenarioRef.current = scenario; }, [scenario]);

  useEffect(() => {
    const t = setTimeout(() => { colorsRef.current = getColors(); }, 50);
    return () => clearTimeout(t);
  }, [theme]);

  const applyScenario = useCallback((s: Scenario) => {
    setScenario(s);
    if (s === "rest") setBeta(0);
    else if (s === "time-dilation") setBeta(0.6);
    else if (s === "length-contraction") setBeta(0.6);
    else if (s === "twin-paradox") setBeta(0.6);
    else if (s === "simultaneity") setBeta(0.5);
  }, []);

  // ---------------------------------------------------------------------------
  // Three.js Minkowski diagram setup
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    colorsRef.current = getColors();
    const C = colorsRef.current;

    // Scene
    const scene = new THREE.Scene();
    scene.background = cssToThree(C.bg);
    sceneRef.current = scene;

    // Camera
    const w = container.clientWidth;
    const h = 450;
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    camera.position.set(8, 10, 12);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 6;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2.3;
    controls.minPolarAngle = 0.2;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(5, 15, 10);
    scene.add(dirLight);

    // --- Static elements: rest frame grid (xz plane, z = ct axis) ---
    const gridColor = cssToThree(C.grid);
    const gridHelper = new THREE.GridHelper(16, 16, gridColor, gridColor);
    gridHelper.material.opacity = 0.3;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Rest frame axes
    const fgColor = cssToThree(C.fg);
    const axisLen = 8;
    const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-axisLen, 0.01, 0),
      new THREE.Vector3(axisLen, 0.01, 0),
    ]);
    const xAxisMat = new THREE.LineBasicMaterial({ color: fgColor, linewidth: 2 });
    scene.add(new THREE.Line(xAxisGeo, xAxisMat));

    // ct-axis (along z)
    const ctAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.01, -axisLen),
      new THREE.Vector3(0, 0.01, axisLen),
    ]);
    const ctAxisMat = new THREE.LineBasicMaterial({ color: fgColor, linewidth: 2 });
    scene.add(new THREE.Line(ctAxisGeo, ctAxisMat));

    function makeTextSprite(text: string, color: THREE.Color, size = 0.4): THREE.Sprite {
      const cvs = document.createElement("canvas"); cvs.width = 128; cvs.height = 64;
      const cx = cvs.getContext("2d")!;
      cx.clearRect(0, 0, 128, 64);
      cx.font = "italic 36px Georgia, serif";
      cx.fillStyle = `#${color.getHexString()}`;
      cx.textAlign = "center"; cx.textBaseline = "middle";
      cx.fillText(text, 64, 32);
      const tex = new THREE.CanvasTexture(cvs); tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(size * 2, size, 1);
      return sprite;
    }

    const xLabel = makeTextSprite("x", fgColor);
    xLabel.position.set(axisLen + 0.5, 0.3, 0);
    scene.add(xLabel);

    const ctLabel = makeTextSprite("ct", fgColor);
    ctLabel.position.set(0, 0.3, axisLen + 0.5);
    scene.add(ctLabel);

    // Light cone lines (45 deg on xz plane)
    const accelColor = cssToThree(C.accel);
    const lcLen = 8;
    const lcMat = new THREE.LineBasicMaterial({ color: accelColor, linewidth: 2 });
    const lc1Geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-lcLen, 0.02, -lcLen), new THREE.Vector3(lcLen, 0.02, lcLen),
    ]);
    scene.add(new THREE.Line(lc1Geo, lcMat));
    const lc2Geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(lcLen, 0.02, -lcLen), new THREE.Vector3(-lcLen, 0.02, lcLen),
    ]);
    scene.add(new THREE.Line(lc2Geo, lcMat));
    const lcLabel1 = makeTextSprite("x = ct", accelColor, 0.35);
    lcLabel1.position.set(5.5, 0.4, 5.5); scene.add(lcLabel1);
    const lcLabel2 = makeTextSprite("x = \u2013ct", accelColor, 0.35);
    lcLabel2.position.set(-5.5, 0.4, 5.5); scene.add(lcLabel2);

    // Light cone surfaces (semi-transparent cones, 45 deg opening)
    const coneH = 7;
    const coneGeo = new THREE.ConeGeometry(coneH, coneH, 64, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: accelColor, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const futureCone = new THREE.Mesh(coneGeo, coneMat);
    futureCone.rotation.x = -Math.PI / 2;
    futureCone.position.set(0, 0, coneH / 2);
    scene.add(futureCone);
    const pastCone = new THREE.Mesh(coneGeo.clone(), coneMat.clone());
    pastCone.rotation.x = Math.PI / 2;
    pastCone.position.set(0, 0, -coneH / 2);
    scene.add(pastCone);

    const boostedGroup = new THREE.Group(); scene.add(boostedGroup); boostedGroupRef.current = boostedGroup;
    const eventsGroup = new THREE.Group(); scene.add(eventsGroup); eventsGroupRef.current = eventsGroup;
    const worldlinesGroup = new THREE.Group(); scene.add(worldlinesGroup); worldlinesGroupRef.current = worldlinesGroup;

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width < 1) return;
      camera.aspect = rect.width / 450; camera.updateProjectionMatrix();
      renderer.setSize(rect.width, 450);
    });
    ro.observe(container);

    const animate = () => { controls.update(); renderer.render(scene, camera); threeRafRef.current = requestAnimationFrame(animate); };
    threeRafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(threeRafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
        if (obj instanceof THREE.Sprite) {
          obj.material.map?.dispose();
          obj.material.dispose();
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Update Three.js scene when beta/scenario/theme changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const scene = sceneRef.current;
    const boostedGroup = boostedGroupRef.current;
    const eventsGroup = eventsGroupRef.current;
    const worldlinesGroup = worldlinesGroupRef.current;
    if (!scene || !boostedGroup || !eventsGroup || !worldlinesGroup) return;

    const C = colorsRef.current || getColors();

    // Update scene background on theme change
    scene.background = cssToThree(C.bg);

    const disposeGroup = (group: THREE.Group) => {
      while (group.children.length > 0) {
        const child = group.children[0]; group.remove(child);
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry.dispose();
          const m = child.material; if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m.dispose();
        }
        if (child instanceof THREE.Sprite) { child.material.map?.dispose(); child.material.dispose(); }
      }
    };
    disposeGroup(boostedGroup); disposeGroup(eventsGroup); disposeGroup(worldlinesGroup);

    const b = beta;
    const g = gamma(b);
    const phaseColor = cssToThree(C.phase);
    const axLen = 7;

    // --- Boosted frame axes and grid ---
    if (Math.abs(b) > 0.001) {
      // ct' axis: direction (b, 1) in (x, ct) space -> (b, 0, 1) in Three.js (x, y, z)
      const ctpAxisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-b * axLen, 0.03, -axLen),
        new THREE.Vector3(b * axLen, 0.03, axLen),
      ]);
      const ctpAxisMat = new THREE.LineBasicMaterial({ color: phaseColor, linewidth: 2 });
      boostedGroup.add(new THREE.Line(ctpAxisGeo, ctpAxisMat));

      // x' axis: direction (1, b) in (x, ct) space -> (1, 0, b) in Three.js
      const xpAxisGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-axLen, 0.03, -b * axLen),
        new THREE.Vector3(axLen, 0.03, b * axLen),
      ]);
      const xpAxisMat = new THREE.LineBasicMaterial({ color: phaseColor, linewidth: 2 });
      boostedGroup.add(new THREE.Line(xpAxisGeo, xpAxisMat));

      const makeBoostedSprite = (text: string): THREE.Sprite => {
        const cvs = document.createElement("canvas"); cvs.width = 128; cvs.height = 64;
        const cx = cvs.getContext("2d")!;
        cx.clearRect(0, 0, 128, 64); cx.font = "italic 34px Georgia, serif";
        cx.fillStyle = `#${phaseColor.getHexString()}`; cx.textAlign = "center"; cx.textBaseline = "middle";
        cx.fillText(text, 64, 32);
        const tex = new THREE.CanvasTexture(cvs); tex.minFilter = THREE.LinearFilter;
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat); sprite.scale.set(0.7, 0.35, 1);
        return sprite;
      };
      const ctpLabel = makeBoostedSprite("ct\u2032"); ctpLabel.position.set(b * 5, 0.5, 5); boostedGroup.add(ctpLabel);
      const xpLabel = makeBoostedSprite("x\u2032"); xpLabel.position.set(5, 0.5, b * 5); boostedGroup.add(xpLabel);

      // Boosted grid lines
      const gridRange = 7;
      const boostedGridMat = new THREE.LineBasicMaterial({
        color: phaseColor,
        transparent: true,
        opacity: 0.25,
      });

      for (let i = -gridRange; i <= gridRange; i++) {
        if (i === 0) continue;
        // Lines of constant x' = i (parallel to ct' axis)
        const baseX = g * i;
        const baseCt = g * b * i;
        const cxGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(baseX - b * axLen, 0.02, baseCt - axLen),
          new THREE.Vector3(baseX + b * axLen, 0.02, baseCt + axLen),
        ]);
        boostedGroup.add(new THREE.Line(cxGeo, boostedGridMat));

        // Lines of constant ct' = i (parallel to x' axis)
        const baseX2 = g * b * i;
        const baseCt2 = g * i;
        const ctGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(baseX2 - axLen, 0.02, baseCt2 - b * axLen),
          new THREE.Vector3(baseX2 + axLen, 0.02, baseCt2 + b * axLen),
        ]);
        boostedGroup.add(new THREE.Line(ctGeo, boostedGridMat));
      }
    }

    // --- Events ---
    const events = scenarioEvents(scenario, C);
    events.forEach((ev) => {
      const sphereGeo = new THREE.SphereGeometry(0.18, 16, 16);
      const evCol = cssToThree(ev.color);
      const sphereMat = new THREE.MeshPhongMaterial({ color: evCol, emissive: evCol, emissiveIntensity: 0.3 });
      const sphere = new THREE.Mesh(sphereGeo, sphereMat);
      sphere.position.set(ev.x, 0.18, ev.ct); eventsGroup.add(sphere);

      // Label sprite above event
      const { xp, ctp } = lorentz(ev.x, ev.ct, b);
      const labelText = Math.abs(b) > 0.001
        ? `${ev.label} \u2192 (${xp.toFixed(1)}, ${ctp.toFixed(1)})`
        : `${ev.label} (${ev.x.toFixed(1)}, ${ev.ct.toFixed(1)})`;

      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, 512, 64);
      // Background pad
      ctx.font = "italic 28px Georgia, serif";
      const tw = ctx.measureText(labelText).width;
      const bgCol = cssToThree(C.bg);
      ctx.fillStyle = `rgba(${Math.round(bgCol.r * 255)}, ${Math.round(bgCol.g * 255)}, ${Math.round(bgCol.b * 255)}, 0.8)`;
      ctx.fillRect(256 - tw / 2 - 8, 8, tw + 16, 48);
      ctx.fillStyle = ev.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, 256, 32);

      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(2.5, 0.32, 1);
      sprite.position.set(ev.x, 0.7, ev.ct);
      eventsGroup.add(sprite);
    });

    // --- Worldlines ---
    const scn = scenario;

    // Stationary observer worldline at x=0 (always)
    const stationaryGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.05, -8),
      new THREE.Vector3(0, 0.05, 8),
    ]);
    const stationaryMat = new THREE.LineBasicMaterial({
      color: cssToThree(C.position),
      linewidth: 2,
    });
    worldlinesGroup.add(new THREE.Line(stationaryGeo, stationaryMat));

    if (scn === "twin-paradox") {
      const travelBeta = Math.abs(b) > 0.01 ? Math.abs(b) : 0.6;
      const T = 6;
      const d = travelBeta * T / 2;

      // Traveling twin path: (0,0) -> (d, T/2) -> (0, T)
      // In Three.js: x is x, z is ct
      const twinGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0.06, 0),
        new THREE.Vector3(d, 0.06, T / 2),
        new THREE.Vector3(0, 0.06, T),
      ]);
      const twinMat = new THREE.LineBasicMaterial({
        color: cssToThree(C.velocity),
        linewidth: 2,
      });
      worldlinesGroup.add(new THREE.Line(twinGeo, twinMat));

      // Turnaround point
      const turnGeo = new THREE.SphereGeometry(0.15, 12, 12);
      const turnMat = new THREE.MeshPhongMaterial({
        color: cssToThree(C.accel),
        emissive: cssToThree(C.accel),
        emissiveIntensity: 0.4,
      });
      const turnSphere = new THREE.Mesh(turnGeo, turnMat);
      turnSphere.position.set(d, 0.15, T / 2);
      worldlinesGroup.add(turnSphere);

      // Proper time labels
      const tauTravel = T * Math.sqrt(1 - travelBeta * travelBeta);
      const tauCanvas = document.createElement("canvas");
      tauCanvas.width = 512;
      tauCanvas.height = 64;
      const tauCtx = tauCanvas.getContext("2d")!;
      tauCtx.clearRect(0, 0, 512, 64);
      tauCtx.font = "italic 26px Georgia, serif";
      const tauText = `\u03C4_travel = ${tauTravel.toFixed(2)}`;
      const ttw = tauCtx.measureText(tauText).width;
      const bgc = cssToThree(C.bg);
      tauCtx.fillStyle = `rgba(${Math.round(bgc.r * 255)}, ${Math.round(bgc.g * 255)}, ${Math.round(bgc.b * 255)}, 0.8)`;
      tauCtx.fillRect(256 - ttw / 2 - 8, 8, ttw + 16, 48);
      tauCtx.fillStyle = C.velocity;
      tauCtx.textAlign = "center";
      tauCtx.textBaseline = "middle";
      tauCtx.fillText(tauText, 256, 32);
      const tauTex = new THREE.CanvasTexture(tauCanvas);
      tauTex.minFilter = THREE.LinearFilter;
      const tauSpriteMat = new THREE.SpriteMaterial({ map: tauTex, transparent: true, depthTest: false });
      const tauSprite = new THREE.Sprite(tauSpriteMat);
      tauSprite.scale.set(2.2, 0.28, 1);
      tauSprite.position.set(d / 2 + 0.5, 0.6, T / 4);
      worldlinesGroup.add(tauSprite);
    }

    // Update HTML overlay for coordinate readouts
    updateOverlay();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beta, scenario, theme]);

  // ---------------------------------------------------------------------------
  // HTML overlay for event coordinates (projected from 3D -> 2D)
  // ---------------------------------------------------------------------------

  const updateOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    if (!overlay || !camera || !renderer) return;
    // Clear existing overlays (handled by React re-renders via the dependency on beta/scenario)
    // The sprites handle labels directly in Three.js, so overlay is kept minimal
  }, []);

  // ---------------------------------------------------------------------------
  // 2D Canvases: twin paradox and velocity addition
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const twinCanvas = twinCanvasRef.current;
    const additionCanvas = additionCanvasRef.current;
    if (!twinCanvas || !additionCanvas) return;

    const twinCtx = twinCanvas.getContext("2d")!;
    const addCtx = additionCanvas.getContext("2d")!;

    colorsRef.current = getColors();

    function resizeCanvas(c: HTMLCanvasElement) {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizeAll() {
      resizeCanvas(twinCanvas!);
      resizeCanvas(additionCanvas!);
      colorsRef.current = getColors();
    }

    resizeAll();
    window.addEventListener("resize", resizeAll);

    // -----------------------------------------------------------------
    // Draw twin paradox detail
    // -----------------------------------------------------------------
    function drawTwin() {
      const C = colorsRef.current!;
      const c = twinCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      twinCtx.clearRect(0, 0, w, h);

      const b = betaRef.current;
      const travelBeta = Math.abs(b) > 0.01 ? Math.abs(b) : 0.6;
      const T = 6;
      const d = travelBeta * T / 2;
      const tauHome = T;
      const tauTravel = T * Math.sqrt(1 - travelBeta * travelBeta);

      const margin = { left: 60, right: 40, top: 30, bottom: 40 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      const xRange = Math.max(d + 1, 3);
      const ctRange = T + 1;
      const sx = plotW / (2 * xRange);
      const sy = plotH / ctRange;
      const scale = Math.min(sx, sy);

      const originX = margin.left + plotW / 2;
      const originY = h - margin.bottom;

      const toC = (x: number, ct: number): [number, number] => {
        return [originX + x * scale, originY - ct * scale];
      };

      // Grid
      twinCtx.strokeStyle = C.grid;
      twinCtx.lineWidth = 0.5;
      for (let i = 0; i <= Math.ceil(ctRange); i++) {
        const [, gy] = toC(0, i);
        twinCtx.beginPath();
        twinCtx.moveTo(margin.left, gy);
        twinCtx.lineTo(w - margin.right, gy);
        twinCtx.stroke();
      }

      // Axes
      twinCtx.strokeStyle = C.fg;
      twinCtx.lineWidth = 1;
      twinCtx.beginPath();
      twinCtx.moveTo(originX, originY);
      twinCtx.lineTo(originX, margin.top);
      twinCtx.stroke();
      twinCtx.beginPath();
      twinCtx.moveTo(margin.left, originY);
      twinCtx.lineTo(w - margin.right, originY);
      twinCtx.stroke();

      // Axis labels with background padding
      drawPaddedLabel(twinCtx, "x", w - margin.right + 15, originY + 4, C.fg, C.bg, "center", "top");
      drawPaddedLabel(twinCtx, "ct", originX, margin.top - 10, C.fg, C.bg, "center", "bottom");

      // Stay-at-home twin worldline
      twinCtx.strokeStyle = C.position;
      twinCtx.lineWidth = 2.5;
      twinCtx.beginPath();
      const [hx0, hy0] = toC(0, 0);
      const [hx1, hy1] = toC(0, T);
      twinCtx.moveTo(hx0, hy0);
      twinCtx.lineTo(hx1, hy1);
      twinCtx.stroke();

      // Proper time ticks on home twin
      twinCtx.fillStyle = C.position;
      for (let i = 1; i < T; i++) {
        const [px, py] = toC(0, i);
        twinCtx.beginPath();
        twinCtx.arc(px, py, 3, 0, Math.PI * 2);
        twinCtx.fill();
      }

      // Traveling twin worldline
      twinCtx.strokeStyle = C.velocity;
      twinCtx.lineWidth = 2.5;
      twinCtx.beginPath();
      const [tx0, ty0] = toC(0, 0);
      const [txm, tym] = toC(d, T / 2);
      const [tx1, ty1] = toC(0, T);
      twinCtx.moveTo(tx0, ty0);
      twinCtx.lineTo(txm, tym);
      twinCtx.lineTo(tx1, ty1);
      twinCtx.stroke();

      // Proper time ticks on traveler
      twinCtx.fillStyle = C.velocity;
      const numTravelTicks = Math.floor(tauTravel);
      for (let i = 1; i <= numTravelTicks; i++) {
        const frac = i / tauTravel;
        const ctCoord = frac * T;
        let xCoord: number;
        if (ctCoord <= T / 2) {
          xCoord = travelBeta * ctCoord;
        } else {
          xCoord = d - travelBeta * (ctCoord - T / 2);
        }
        const [px, py] = toC(xCoord, ctCoord);
        twinCtx.beginPath();
        twinCtx.arc(px, py, 3, 0, Math.PI * 2);
        twinCtx.fill();
      }

      // Departure and reunion dots
      twinCtx.fillStyle = C.total;
      [[0, 0], [0, T]].forEach(([x, ct]) => {
        const [px, py] = toC(x, ct);
        twinCtx.beginPath();
        twinCtx.arc(px, py, 5, 0, Math.PI * 2);
        twinCtx.fill();
      });

      // Turnaround dot
      twinCtx.fillStyle = C.accel;
      const [tpx, tpy] = toC(d, T / 2);
      twinCtx.beginPath();
      twinCtx.arc(tpx, tpy, 5, 0, Math.PI * 2);
      twinCtx.fill();

      // Labels with background padding — positioned AWAY from lines
      drawPaddedLabel(
        twinCtx,
        `\u03C4_home = ${tauHome.toFixed(1)}`,
        originX - 16, hy1 + 2,
        C.position, C.bg, "right", "bottom",
      );
      const [labx, laby] = toC(d / 2 + 0.4, T / 4);
      drawPaddedLabel(
        twinCtx,
        `\u03C4_travel = ${tauTravel.toFixed(2)}`,
        labx + 10, laby - 10,
        C.velocity, C.bg, "left", "bottom",
      );

      // Turnaround label
      drawPaddedLabel(
        twinCtx,
        "turnaround",
        tpx + 12, tpy - 10,
        C.accel, C.bg, "left", "bottom",
      );

      // Numeric summary
      drawPaddedLabel(
        twinCtx,
        `v = ${travelBeta.toFixed(2)}c,  \u03B3 = ${gamma(travelBeta).toFixed(3)}`,
        margin.left + 4, margin.top - 10,
        C.muted, C.bg, "left", "bottom",
      );
      drawPaddedLabel(
        twinCtx,
        `\u0394\u03C4 = ${(tauHome - tauTravel).toFixed(2)}  (traveler ages less)`,
        margin.left + 4, margin.top + 6,
        C.muted, C.bg, "left", "top",
      );
    }

    // -----------------------------------------------------------------
    // Draw velocity addition
    // -----------------------------------------------------------------
    function drawAddition() {
      const C = colorsRef.current!;
      const c = additionCanvas!;
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      if (w < 1 || h < 1) return;
      addCtx.clearRect(0, 0, w, h);

      const b1 = betaRef.current;
      const b2 = 0.5;
      const galilean = b1 + b2;
      const relativistic = (b1 + b2) / (1 + b1 * b2);

      const margin = { left: 50, right: 20, top: 30, bottom: 35 };
      const plotW = w - margin.left - margin.right;
      const plotH = h - margin.top - margin.bottom;

      // Number line from -1.5 to 1.5
      const vMin = -1.5;
      const vMax = 1.5;
      const toX = (v: number) => margin.left + ((v - vMin) / (vMax - vMin)) * plotW;
      const barY = margin.top + plotH * 0.3;
      const barH = plotH * 0.2;

      // Draw number line
      addCtx.strokeStyle = C.fg;
      addCtx.lineWidth = 1;
      const lineY = margin.top + plotH * 0.7;
      addCtx.beginPath();
      addCtx.moveTo(margin.left, lineY);
      addCtx.lineTo(w - margin.right, lineY);
      addCtx.stroke();

      // Tick marks
      for (let v = -1; v <= 1; v += 0.5) {
        const x = toX(v);
        addCtx.beginPath();
        addCtx.moveTo(x, lineY - 4);
        addCtx.lineTo(x, lineY + 4);
        addCtx.stroke();
        drawPaddedLabel(addCtx, v.toFixed(1) + "c", x, lineY + 8, C.muted, C.bg, "center", "top");
      }

      // Light speed boundaries
      addCtx.save();
      addCtx.setLineDash([4, 3]);
      addCtx.strokeStyle = C.accel;
      addCtx.lineWidth = 1;
      [toX(-1), toX(1)].forEach((x) => {
        addCtx.beginPath();
        addCtx.moveTo(x, margin.top);
        addCtx.lineTo(x, lineY - 6);
        addCtx.stroke();
      });
      addCtx.restore();
      drawPaddedLabel(addCtx, "c", toX(1), margin.top - 4, C.accel, C.bg, "center", "bottom");
      drawPaddedLabel(addCtx, "\u2013c", toX(-1), margin.top - 4, C.accel, C.bg, "center", "bottom");

      // Galilean bar
      const galX = toX(0);
      const galW = toX(galilean) - galX;
      addCtx.fillStyle = C.pe;
      addCtx.globalAlpha = 0.6;
      addCtx.fillRect(galX, barY - barH / 2, galW, barH / 2 - 1);
      addCtx.globalAlpha = 1;
      // Relativistic bar
      const relW = toX(relativistic) - galX;
      addCtx.fillStyle = C.ke;
      addCtx.globalAlpha = 0.6;
      addCtx.fillRect(galX, barY + 1, relW, barH / 2 - 1);
      addCtx.globalAlpha = 1;

      // Markers on number line
      addCtx.fillStyle = C.pe;
      const galPx = toX(galilean);
      addCtx.beginPath();
      addCtx.moveTo(galPx, lineY - 10);
      addCtx.lineTo(galPx - 4, lineY - 18);
      addCtx.lineTo(galPx + 4, lineY - 18);
      addCtx.closePath();
      addCtx.fill();

      addCtx.fillStyle = C.ke;
      const relPx = toX(relativistic);
      addCtx.beginPath();
      addCtx.moveTo(relPx, lineY - 10);
      addCtx.lineTo(relPx - 4, lineY - 18);
      addCtx.lineTo(relPx + 4, lineY - 18);
      addCtx.closePath();
      addCtx.fill();

      // Legend with padded labels
      addCtx.fillStyle = C.pe;
      addCtx.fillRect(margin.left, margin.top - 14, 12, 3);
      drawPaddedLabel(
        addCtx,
        `Galilean: ${b1.toFixed(2)} + ${b2.toFixed(2)} = ${galilean.toFixed(2)}c`,
        margin.left + 18, margin.top - 6,
        C.pe, C.bg, "left", "bottom",
      );
      addCtx.fillStyle = C.ke;
      addCtx.fillRect(margin.left, margin.top + 2, 12, 3);
      drawPaddedLabel(
        addCtx,
        `Relativistic: (${b1.toFixed(2)} + ${b2.toFixed(2)})/(1 + ${b1.toFixed(2)}\u00D7${b2.toFixed(2)}) = ${relativistic.toFixed(3)}c`,
        margin.left + 18, margin.top + 10,
        C.ke, C.bg, "left", "top",
      );

      // Axis label
      drawPaddedLabel(addCtx, "v/c \u2192", w - margin.right, lineY + 24, C.muted, C.bg, "right", "top");
    }

    // -----------------------------------------------------------------
    // Render loop for 2D canvases
    // -----------------------------------------------------------------
    function loop() {
      if (!colorsRef.current) colorsRef.current = getColors();
      drawTwin();
      drawAddition();
      canvasRafRef.current = requestAnimationFrame(loop);
    }

    canvasRafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(canvasRafRef.current);
      window.removeEventListener("resize", resizeAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scenarioLabels: { key: Scenario; label: string }[] = [
    { key: "rest", label: "Rest frame" },
    { key: "time-dilation", label: "Time dilation" },
    { key: "length-contraction", label: "Length contraction" },
    { key: "twin-paradox", label: "Twin paradox" },
    { key: "simultaneity", label: "Simultaneity" },
  ];

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
            <span style={{ color: "var(--foreground)" }}>Special Relativity</span>
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
            Spacetime and the Lorentz Transformation
          </h1>
          <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--muted)" }}>
            An interactive Minkowski diagram showing how space and time mix under Lorentz boosts.
            Drag the velocity slider and watch simultaneity, time dilation, and length contraction emerge.
          </p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-24">
        {/* ================================================================= */}
        {/*  MOTIVATION TEXT — before any visuals                              */}
        {/* ================================================================= */}
        <section className="mt-12 mx-auto" style={{ maxWidth: "65ch" }}>
          <h2 className="text-2xl font-semibold tracking-tight mb-5">Why spacetime?</h2>
          <div className="space-y-3 text-base leading-relaxed">
            <p>
              In Newtonian physics, space and time are separate and absolute: clocks tick at the same
              rate everywhere, and rulers measure the same length regardless of who holds them. Einstein
              showed that this picture breaks down when the speed of light enters the story.
            </p>
            <p>
              If the speed of light is the same for <em>all</em> observers &mdash; regardless of their
              motion &mdash; then space and time can no longer be independent. They must mix when you
              change from one reference frame to another. A time interval for you becomes a combination
              of time <em>and</em> space for me.
            </p>
            <p>
              The <strong>Minkowski diagram</strong> is the tool for visualizing this. Plot position
              (<Tex>x</Tex>) horizontally and time (<Tex>{`ct`}</Tex>) vertically. Light always travels
              at 45&deg; on this diagram because it covers one unit of space per unit of <Tex>{`ct`}</Tex>.
              The 45&deg; lines form the <em>light cone</em>, dividing spacetime into causally connected
              and causally disconnected regions.
            </p>
            <p>
              When you boost to a moving frame &mdash; increasing the velocity parameter <Tex>{`\\beta`}</Tex> below
              &mdash; the coordinate axes <em>tilt</em>. The ct&prime; axis tilts toward the light cone,
              and the x&prime; axis tilts by the same amount from the other side. This tilt encodes all
              of special relativity: time dilation, length contraction, the relativity of simultaneity,
              and the twin paradox all follow from the geometry of the diagram.
            </p>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The Lorentz transformation</h2>
          <div className="space-y-3 text-base leading-relaxed">
            <p>
              An event in spacetime has coordinates <Tex>{`(x, ct)`}</Tex> in frame <Tex>S</Tex>.
              An observer moving at velocity <Tex>{`v = \\beta c`}</Tex> relative to <Tex>S</Tex> assigns
              different coordinates <Tex>{`(x', ct')`}</Tex> to the same event. The two sets of
              coordinates are related by the Lorentz transformation:
            </p>

            <div className="text-center py-1">
              <Tex display>{`x' = \\gamma(x - \\beta\\, ct), \\qquad ct' = \\gamma(ct - \\beta\\, x)`}</Tex>
            </div>

            <p>
              where <Tex>{`\\beta = v/c`}</Tex> is the velocity as a fraction of the speed of light, and
              the Lorentz factor is:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\gamma = \\frac{1}{\\sqrt{1 - \\beta^2}}`}</Tex>
            </div>

            <p>
              This transformation <em>mixes</em> space and time coordinates. What was purely a
              time interval in one frame becomes a combination of space and time in another.
              The 3D Minkowski diagram below makes this mixing visible: as <Tex>{`\\beta`}</Tex> increases,
              the boosted axes tilt toward the light cone, and the boosted grid lines of
              constant <Tex>{`x'`}</Tex> and <Tex>{`ct'`}</Tex> skew away from the rest-frame grid.
            </p>
          </div>
        </section>

        {/* ================================================================= */}
        {/*  INTERACTIVE DIAGRAM — after motivation text                       */}
        {/* ================================================================= */}

        {/* Scenario preset buttons */}
        <div className="mt-12 flex flex-wrap items-center gap-2 mx-auto" style={{ maxWidth: "65ch" }}>
          {scenarioLabels.map((s) => (
            <button
              key={s.key}
              onClick={() => applyScenario(s.key)}
              className="text-sm font-medium px-3 py-1.5 rounded border cursor-pointer transition-colors"
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                borderColor: scenario === s.key ? "var(--foreground)" : "var(--border)",
                color: scenario === s.key ? "var(--foreground)" : "var(--muted)",
                background: scenario === s.key ? "var(--panel)" : "transparent",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Main 3D diagram + controls — sticky, collapsible */}
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
                Minkowski spacetime diagram &mdash; {"\u03B2"} = {beta.toFixed(2)}
              </span>
              <span className="text-xs font-medium tracking-wide" style={{ color: "var(--muted)", fontFamily: "var(--font-geist-mono), monospace" }}>
                show &darr;
              </span>
            </div>
          )}
          {/* Full panel */}
          <div style={{ display: collapsed ? "none" : "block" }}>
            <div className="relative">
              <div
                ref={containerRef}
                className="w-full"
                style={{ height: 450 }}
              />
              <div ref={overlayRef} className="absolute inset-0 pointer-events-none" />
              <button
                onClick={() => setCollapsed(true)}
                className="absolute top-2 right-2 text-xs px-2 py-1 rounded border cursor-pointer"
                style={{ background: "var(--panel)", borderColor: "var(--border)", color: "var(--muted)" }}
              >
                hide &uarr;
              </button>
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 p-6"
              style={{ borderTop: "1px solid var(--border)" }}
            >
              <SliderControl
                label="Velocity"
                symbol={"\u03B2"}
                unit="c"
                min={-0.9}
                max={0.9}
                step={0.01}
                value={beta}
                onChange={setBeta}
                displayValue={(v) => v.toFixed(2)}
              />
              <div className="flex items-end">
                <div className="text-sm tabular-nums" style={{ fontFamily: "var(--font-geist-mono), monospace", color: "var(--muted)" }}>
                  {"\u03B3"} = {gamma(beta).toFixed(4)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/*  MORE TEXT — interleaved with visuals                              */}
        {/* ================================================================= */}

        <section className="mt-20 mx-auto" style={{ maxWidth: "65ch" }}>
          {/* Simultaneity is relative */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">Simultaneity is relative</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              Two events that occur at the same time (<Tex>{`\\Delta ct = 0`}</Tex>) in frame <Tex>S</Tex> will
              generally <em>not</em> be simultaneous in frame <Tex>{`S'`}</Tex>. The time separation in the
              boosted frame is:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\Delta ct' = \\gamma(\\Delta ct - \\beta\\,\\Delta x) = -\\gamma\\,\\beta\\,\\Delta x`}</Tex>
            </div>

            <p>
              Unless the events are also at the same location (<Tex>{`\\Delta x = 0`}</Tex>), they are
              separated in time in <Tex>{`S'`}</Tex>. In the Minkowski diagram, the boosted
              simultaneity lines (lines of constant <Tex>{`ct'`}</Tex>) are tilted relative to the
              horizontal. Events along a tilted line are simultaneous in <Tex>{`S'`}</Tex> but not
              in <Tex>S</Tex>. Select the &ldquo;Simultaneity&rdquo; scenario to see three events
              that share the same <Tex>{`ct`}</Tex> in the rest frame separate in the boosted frame.
            </p>
          </div>

          {/* Time dilation */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">Time dilation</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A clock at rest in <Tex>{`S'`}</Tex> ticks at intervals <Tex>{`\\Delta\\tau`}</Tex> (proper time).
              In frame <Tex>S</Tex>, these ticks are separated by a longer interval:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\Delta t = \\gamma\\,\\Delta\\tau > \\Delta\\tau`}</Tex>
            </div>

            <p>
              &ldquo;Moving clocks run slow.&rdquo; The factor <Tex>{`\\gamma`}</Tex> is always greater than
              or equal to one, so the dilated time is always at least as large as the proper time.
              In the Minkowski diagram, the &ldquo;Time dilation&rdquo; scenario shows three events on
              the <Tex>{`ct`}</Tex> axis. As you increase <Tex>{`\\beta`}</Tex>, notice how their
              boosted time coordinates <Tex>{`ct'`}</Tex> increase &mdash; a moving observer measures
              a larger time interval between them.
            </p>
          </div>

          {/* Info cards */}
          <div className="grid sm:grid-cols-3 gap-5 mt-10 -mx-4 sm:-mx-28 lg:-mx-44">
            <InfoCard
              title="Time dilation"
              formula={`\\Delta t = \\gamma\\,\\Delta\\tau`}
              description="Moving clocks tick slower by a factor of \u03B3. At \u03B2 = 0.87, a clock runs at half speed."
              borderColor="var(--position-color)"
            />
            <InfoCard
              title="Length contraction"
              formula={`L = \\frac{L_0}{\\gamma}`}
              description="Moving objects are shorter along the direction of motion by a factor of \u03B3."
              borderColor="var(--velocity-color)"
            />
            <InfoCard
              title="Velocity addition"
              formula={`\\beta_{\\text{total}} = \\frac{\\beta_1 + \\beta_2}{1 + \\beta_1\\beta_2}`}
              description="Velocities do not simply add. Even adding 0.9c + 0.9c gives only 0.994c, never exceeding c."
              borderColor="var(--accel-color)"
            />
          </div>
        </section>

        {/* --- Twin paradox detail --- */}
        <figure className="mt-16">
          <canvas
            ref={twinCanvasRef}
            className="w-full rounded border"
            style={{ height: 300, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Twin paradox worldlines. The stay-at-home twin (vertical) accumulates more proper time than the
            traveling twin. Dots mark unit proper-time ticks.
          </figcaption>
        </figure>

        <section className="mt-10 mx-auto" style={{ maxWidth: "65ch" }}>
          {/* The twin paradox */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">The twin paradox</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              One twin stays at home while the other makes a round trip at relativistic speed.
              When they reunite, the traveling twin has aged less. This is not a paradox &mdash; the
              key asymmetry is that the traveling twin must <em>accelerate</em> at the turnaround,
              breaking the symmetry between inertial frames.
            </p>

            <p>
              The proper time along any worldline is given by the integral:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\tau = \\int \\sqrt{c^2\\,dt^2 - dx^2} = \\int \\sqrt{1 - \\beta^2(t)}\\;c\\,dt`}</Tex>
            </div>

            <p>
              For the stay-at-home twin on a straight (inertial) worldline, the proper time is
              simply <Tex>{`\\tau_1 = T`}</Tex>. For the traveling twin making a symmetric round trip
              at speed <Tex>{`v = \\beta c`}</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`\\tau_2 = T\\sqrt{1 - \\beta^2} = \\frac{T}{\\gamma} < T`}</Tex>
            </div>

            <p>
              The straight worldline through spacetime always has the <em>longest</em> proper time &mdash;
              the opposite of the Euclidean case, where straight lines are shortest. This is a
              consequence of the minus sign in the spacetime metric.
            </p>
          </div>
        </section>

        {/* --- Velocity addition --- */}
        <figure className="mt-16">
          <canvas
            ref={additionCanvasRef}
            className="w-full rounded border"
            style={{ height: 200, background: "var(--canvas-bg)", borderColor: "var(--border)" }}
          />
          <figcaption className="text-sm mt-1.5 italic" style={{ color: "var(--muted)" }}>
            Relativistic velocity addition: an object moving at 0.5c in a frame that itself moves at {"\u03B2"}c.
            The Galilean result can exceed <Tex>c</Tex>; the relativistic result never does.
          </figcaption>
        </figure>

        <section className="mt-10 mx-auto" style={{ maxWidth: "65ch" }}>
          {/* Length contraction */}
          <h2 className="text-2xl font-semibold tracking-tight mb-5">Length contraction</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              A rod of proper length <Tex>{`L_0`}</Tex> at rest in <Tex>{`S'`}</Tex> has a contracted
              length in frame <Tex>S</Tex>:
            </p>

            <div className="text-center py-1">
              <Tex display>{`L = \\frac{L_0}{\\gamma}`}</Tex>
            </div>

            <p>
              Measuring a length means locating both ends <em>simultaneously</em>. Because simultaneity
              differs between frames, the measurements disagree. In the Minkowski diagram, the
              &ldquo;Length contraction&rdquo; scenario places two events (the rod&rsquo;s endpoints) on
              the <Tex>x</Tex>-axis. In the boosted frame, these endpoints are <em>not</em> simultaneous &mdash;
              the <Tex>{`x'`}</Tex>-axis is tilted &mdash; so the observer in <Tex>{`S'`}</Tex> must measure them
              at the same <Tex>{`ct'`}</Tex>, yielding a shorter result.
            </p>
          </div>

          {/* The invariant interval */}
          <h2 className="text-2xl font-semibold tracking-tight mt-16 mb-5">The invariant interval</h2>

          <div className="space-y-3 text-base leading-relaxed">
            <p>
              The spacetime interval between two events is the same in all inertial frames:
            </p>

            <div className="text-center py-1">
              <Tex display>{`s^2 = -(ct)^2 + x^2 = -(ct')^2 + x'^2`}</Tex>
            </div>

            <p>
              This is the fundamental invariant of special relativity &mdash; the Lorentz transformation
              is precisely the set of coordinate changes that preserve <Tex>{`s^2`}</Tex>.
            </p>

            <p>
              The sign of <Tex>{`s^2`}</Tex> classifies the causal relationship between events:
            </p>

            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Timelike</strong> (<Tex>{`s^2 < 0`}</Tex>): The events can be connected by a
                signal traveling slower than light. There exists a frame in which they occur at
                the same place. All observers agree on their time ordering.
              </li>
              <li>
                <strong>Spacelike</strong> (<Tex>{`s^2 > 0`}</Tex>): The events cannot be causally
                connected. There exists a frame in which they are simultaneous. Different
                observers may disagree about which happened first.
              </li>
              <li>
                <strong>Lightlike</strong> (<Tex>{`s^2 = 0`}</Tex>): The events are connected by a
                light signal. They lie on each other&rsquo;s light cone.
              </li>
            </ul>

            <p>
              In the Minkowski diagram, the light cone (the diagonal lines) divides spacetime
              into these three regions. Events inside the cone from the origin are timelike-separated
              from it; events outside are spacelike-separated. The semi-transparent cone surface in
              the 3D view makes this boundary tangible &mdash; rotate the diagram to see how the cone
              extends into the future and past.
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
  title, formula, description, borderColor,
}: {
  title: string;
  formula: string;
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
        <Tex display>{formula}</Tex>
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
