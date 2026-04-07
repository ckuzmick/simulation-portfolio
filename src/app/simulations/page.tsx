"use client";

import Link from "next/link";
import { useTheme } from "../theme-provider";

interface SimulationMeta {
  slug: string;
  title: string;
  description: string;
  tags: string[];
}

const simulations: SimulationMeta[] = [
  {
    slug: "simple-harmonic-oscillator",
    title: "Simple Harmonic Oscillator",
    description:
      "Spring-mass system with damping. Explore underdamped, critically damped, and overdamped regimes with real-time phase portraits and energy diagrams.",
    tags: ["Classical Mechanics", "Oscillations", "Damping"],
  },
  {
    slug: "wave-interference",
    title: "Wave Interference",
    description:
      "Double-slit interference from point sources with animated wavefronts. Explore single slit, double slit, and diffraction grating patterns with tunable wavelength and geometry.",
    tags: ["Waves", "Optics", "Interference"],
  },
  {
    slug: "projectile-motion",
    title: "Projectile Motion",
    description:
      "Launch a projectile at any angle and watch it trace a parabolic arc under gravity. Compare ideal trajectories with quadratic air drag using real-time position plots and analytical overlays.",
    tags: ["Classical Mechanics", "Kinematics", "Drag"],
  },
  {
    slug: "ideal-gas",
    title: "Ideal Gas Law",
    description:
      "Bouncing particles in a box linked by PV=nRT. Explore isothermal, isobaric, and isochoric processes with a live Maxwell-Boltzmann speed distribution and PV diagram.",
    tags: ["Thermodynamics", "Statistical Mechanics", "Kinetic Theory"],
  },
  {
    slug: "schrodinger-equation",
    title: "Schr\u00F6dinger Equation",
    description:
      "Gaussian wave packet propagating through tunable potentials, solved with the split-operator FFT method. Watch quantum tunneling, reflection, and wave packet spreading in real time.",
    tags: ["Quantum Mechanics", "Wave Functions", "Tunneling"],
  },
  {
    slug: "thermodynamic-cycles",
    title: "Thermodynamic Cycles",
    description:
      "Animated PV and TS diagrams for Carnot, Otto, Diesel, and Stirling cycles with a synchronized piston-cylinder visualization. Compare efficiencies and explore the thermodynamics of ideal heat engines.",
    tags: ["Thermodynamics", "Heat Engines", "Efficiency"],
  },
  {
    slug: "pythagorean-theorem",
    title: "Pythagorean Theorem",
    description:
      "A visual, interactive proof of the Pythagorean theorem using the classic rearrangement argument. Drag the triangle's legs and watch the areas balance in real time.",
    tags: ["Geometry", "Proofs", "Euclidean"],
  },
  {
    slug: "matrix-composition",
    title: "Composition of Matrices",
    description:
      "See how 2\u00D72 matrices reshape the plane and how composition corresponds to multiplication. Explore rotations, reflections, shears, and the determinant as signed area.",
    tags: ["Linear Algebra", "Transformations", "Matrices"],
  },
  {
    slug: "special-relativity",
    title: "Special Relativity",
    description:
      "An interactive Minkowski spacetime diagram. Drag the velocity slider to apply a Lorentz boost and watch simultaneity, time dilation, and length contraction emerge in real time.",
    tags: ["Special Relativity", "Spacetime", "Lorentz Transformation"],
  },
  {
    slug: "quantum-box-3d",
    title: "3D Quantum Box",
    description:
      "Visualise stationary states of a particle in a cubic infinite potential well. Explore probability density isosurfaces, nodal planes, degeneracy, and cross-section heatmaps.",
    tags: ["Quantum Mechanics", "3D Visualization", "Stationary States"],
  },
  {
    slug: "schwarzschild-geodesics",
    title: "Schwarzschild Geodesics",
    description:
      "Visualise orbits around a non-rotating black hole on a 3D embedding diagram. Explore bound orbits, plunges, and perihelion precession with an interactive effective potential.",
    tags: ["General Relativity", "Black Holes", "Geodesics"],
  },
];

export default function SimulationsGallery() {
  const { theme, toggle } = useTheme();

  return (
    <main className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">
              Physics Simulations
            </h1>
            <p className="mt-3 text-lg leading-relaxed" style={{ color: "var(--muted)", maxWidth: "50ch" }}>
              Interactive explorations of fundamental physics, from classical mechanics to quantum theory.
            </p>
          </div>
          <button
            onClick={toggle}
            className="text-sm px-3 py-1.5 rounded border transition-colors cursor-pointer mt-2"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mt-12">
          {simulations.map((sim) => (
            <Link
              key={sim.slug}
              href={`/simulations/${sim.slug}`}
              className="group block rounded border p-6 transition-all hover:shadow-md"
              style={{ background: "var(--panel)", borderColor: "var(--border)" }}
            >
              <h2 className="text-lg font-semibold group-hover:underline">
                {sim.title}
              </h2>
              <p className="text-sm leading-relaxed mt-2" style={{ color: "var(--muted)" }}>
                {sim.description}
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                {sim.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 rounded border"
                    style={{ borderColor: "var(--border-light)", color: "var(--muted-2)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
