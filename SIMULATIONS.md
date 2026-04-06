# Physics Simulations

15 interactive physics simulations, ordered from simple to complex.

---

## 1. Ideal Gas Law (PV = nRT)

**Complexity:** Beginner

**Prompt:** Build an interactive ideal gas law simulation. Show a container of animated particles (circles) bouncing around. Provide sliders for pressure (P), volume (V), number of moles (n), and temperature (T). When one variable changes, the others update according to PV = nRT. Volume visually resizes the container. Temperature changes particle speed. Pressure is derived from collision frequency with walls. Display the equation and current values in real time. Use a dark background with glowing particles colored by velocity (blue = slow, red = fast).

---

## 2. Projectile Motion

**Complexity:** Beginner

**Prompt:** Build a projectile motion simulator. The user sets launch angle (0-90 degrees), initial velocity, and gravitational acceleration via sliders. On launch, animate a projectile following the parabolic trajectory with a fading trail. Show real-time readouts of x position, y position, velocity components, time elapsed, max height, and range. Draw the theoretical parabola as a dashed overlay for comparison. Allow toggling air resistance (quadratic drag) on/off to compare ideal vs realistic trajectories. Include a "trace" mode that shows multiple launches overlaid with different colors.

---

## 3. Simple Harmonic Oscillator

**Complexity:** Beginner

**Prompt:** Build a spring-mass simple harmonic oscillator simulation. Show a mass on a horizontal spring that oscillates back and forth. Below it, display synchronized real-time plots of position x(t), velocity v(t), and acceleration a(t) as scrolling waveforms. Provide sliders for spring constant k, mass m, damping coefficient b, and initial displacement. Support underdamped, critically damped, and overdamped regimes — visually label which regime is active. Show a phase-space plot (x vs v) that traces an ellipse (or spiral for damped). Add energy bar charts showing kinetic, potential, and total energy updating in real time.

---

## 4. Wave Interference (Double Slit)

**Complexity:** Beginner-Intermediate

**Prompt:** Build a 2D wave interference simulation inspired by the double-slit experiment. Two point sources emit circular wavefronts rendered as animated concentric rings on a dark canvas. The user controls slit separation, wavelength (mapped to color), and phase difference. Show constructive and destructive interference patterns using color intensity. On the right edge, display an intensity graph showing the interference pattern (I = I0 cos^2(delta/2)). Include a single-slit mode for comparison. Render wavefronts using a 2D grid where each pixel's brightness is computed from the superposition of both sources.

---

## 5. Pendulum (Simple + Double)

**Complexity:** Intermediate

**Prompt:** Build a pendulum simulation with two modes: simple pendulum and double (chaotic) pendulum. For the simple pendulum, animate a bob on a rod, show the phase portrait (theta vs omega), and compare small-angle approximation to exact numerical solution. For the double pendulum, use RK4 integration to solve the coupled equations of motion. Render the double pendulum with a colorful fading trail behind the second bob. Add a "chaos" demo: place two double pendulums with initial angles differing by 0.001 radians and watch them diverge. Show energy conservation as a diagnostic. Dark theme with neon-colored trails.

---

## 6. Electromagnetic Wave Propagation

**Complexity:** Intermediate

**Prompt:** Build a 3D-perspective visualization of an electromagnetic wave propagating through space using Canvas 2D with pseudo-3D projection. Show the E-field oscillating in one plane and the B-field oscillating perpendicular to it, both perpendicular to the propagation direction. Animate the wave traveling forward. Use red/orange for E-field and blue for B-field with semi-transparent filled curves. Provide controls for wavelength, amplitude, and polarization (linear, circular, elliptical). For circular polarization, show the E-field vector rotating as the wave propagates. Display Maxwell's equations relevant to the current configuration.

---

## 7. Orbital Mechanics (Two-Body + Lagrange Points)

**Complexity:** Intermediate

**Prompt:** Build a gravitational two-body orbit simulator. Show a central star and an orbiting planet with a fading trail. The user sets initial position and velocity by click-dragging (direction = velocity vector, length = speed). Compute orbits using Verlet integration. Display orbital parameters: eccentricity, semi-major axis, period, specific energy, specific angular momentum. Color the trail by speed (blue = slow at apoapsis, red = fast at periapsis) to illustrate Kepler's second law. Add a mode that shows the 5 Lagrange points for a two-body system with test particles placed near each. Include a barycenter visualization.

---

## 8. Fluid Dynamics (Lattice Boltzmann)

**Complexity:** Intermediate-Advanced

**Prompt:** Build a real-time 2D fluid dynamics simulation using the Lattice Boltzmann Method (LBM) with D2Q9 lattice. Render the velocity field as a color map (magnitude mapped to a thermal colormap). The user draws obstacles by clicking/dragging on the canvas. Fluid flows from left to right with configurable inlet velocity. Show vortex shedding (von Karman vortex street) behind circular obstacles. Provide controls for viscosity (Reynolds number), flow speed, and visualization mode (velocity magnitude, vorticity, pressure, streamlines). Use a pre-placed cylinder obstacle as the default. Optimize with typed arrays and requestAnimationFrame for 60fps on a ~400x200 grid.

---

## 9. Electrostatics Field Visualizer

**Complexity:** Intermediate-Advanced

**Prompt:** Build an interactive electrostatics simulation. The user places positive and negative point charges on a 2D canvas by clicking (left = positive, right = negative, scroll = adjust magnitude). Render electric field lines using a streamline integration algorithm (RK4 from seed points around each charge). Overlay an equipotential contour map using a marching squares algorithm with a cool-warm diverging colormap. Show the electric potential as a 3D surface plot in a secondary view (isometric projection). Display the force vectors on each charge from all other charges. Support dragging charges and watch field lines update in real time. Add preset configurations: dipole, quadrupole, parallel plate capacitor.

---

## 10. Thermodynamic Engine Cycles

**Complexity:** Intermediate-Advanced

**Prompt:** Build an interactive PV-diagram simulator for thermodynamic engine cycles. Support Carnot, Otto, Diesel, and Stirling cycles. Animate a piston-cylinder assembly synchronized with the current position on the PV diagram. As the cycle progresses, highlight the current process (isothermal, adiabatic, isochoric, isobaric) with color coding. Display real-time values: work done (area under/in curve), heat added/rejected, efficiency, and entropy change. Show a TS-diagram alongside the PV-diagram. Allow the user to adjust hot/cold reservoir temperatures and compression ratio. Compare actual efficiency to Carnot efficiency with a gauge visualization.

---

## 11. N-Body Gravitational Simulation

**Complexity:** Advanced

**Prompt:** Build an N-body gravitational simulation supporting up to 500 particles. Initialize with presets: random cloud collapse, galaxy collision (two rotating discs), solar system, figure-8 three-body. Use Barnes-Hut tree algorithm (quad-tree) for O(n log n) force computation. Integrate with leapfrog (Verlet). Render particles as points with fading trails; color by velocity. Include a softening parameter to prevent singularities. Show total energy, momentum, and angular momentum as conservation diagnostics. Add a "create" mode where the user clicks to place bodies with mass (scroll to adjust) and velocity (drag direction). Use Web Workers for the force computation to keep the UI responsive.

---

## 12. Schrödinger Equation (1D Time-Dependent)

**Complexity:** Advanced

**Prompt:** Build a 1D time-dependent Schrödinger equation solver and visualizer. Show a wave packet (Gaussian initial condition) propagating and interacting with potential barriers. Render |psi(x,t)|^2 as a filled area plot (probability density), and overlay Re(psi) and Im(psi) as separate colored lines. Use the split-operator FFT method or Crank-Nicolson finite difference for time evolution. Provide preset potentials: free particle, single barrier (show tunneling), double barrier (resonant tunneling), harmonic oscillator, step potential. Show the potential V(x) as a shaded region. Display expectation values <x>, <p>, and uncertainty products in real time. Allow the user to draw custom potentials with the mouse.

---

## 13. Special Relativity Spacetime Visualizer

**Complexity:** Advanced

**Prompt:** Build an interactive Minkowski spacetime diagram. Show the (x, ct) plane with light cones rendered as diagonal lines. The user places "events" and draws worldlines. Provide a slider for the relative velocity (beta) of a boosted frame — when adjusted, apply the Lorentz transformation to all events and worldlines in real time, showing how simultaneity, time dilation, and length contraction emerge. Demonstrate the twin paradox: show two worldlines diverging and reconverging with proper time computed along each. Include a relativistic velocity addition calculator. Show the invariant spacetime interval between selected event pairs. Add a secondary view showing a 1+1D "relativistic train" scenario with platform and train observers. Use geometric units (c=1).

---

## 14. General Relativity: Geodesics on Curved Spacetime

**Complexity:** Very Advanced

**Prompt:** Build a visualization of geodesics in Schwarzschild spacetime (non-rotating black hole). Use Three.js to render a 3D embedding diagram (Flamm's paraboloid) of the spatial geometry near the event horizon. On this curved surface, animate test particles following geodesics computed by numerically integrating the geodesic equation using RK4 with Schwarzschild metric components. Show the event horizon as a dark sphere, the photon sphere at r=3M, and the ISCO at r=6M. The user sets initial position and velocity of a test particle — render its orbit (bound orbits, scattering, plunge). Show orbital precession for near-circular orbits (perihelion advance). Include a 2D effective potential plot (V_eff vs r) with the particle's energy level marked. Add a "photon mode" showing light ray bending and the Einstein ring. Use OrbitControls for camera.

---

## 15. 3D Quantum Mechanics: Cubic Infinite Potential Well

**Complexity:** Expert

**Prompt:** Build a Three.js visualization of stationary states of a particle in a 3D cubic infinite potential well (particle in a box). The solutions are psi(x,y,z) = (2/L)^(3/2) sin(n_x pi x/L) sin(n_y pi y/L) sin(n_z pi z/L) with energy E = (pi^2 hbar^2 / 2mL^2)(n_x^2 + n_y^2 + n_z^2). Render |psi|^2 as a 3D volumetric probability density using semi-transparent isosurfaces at multiple threshold levels (like nested shells). Use Three.js MarchingCubes or custom marching cubes to generate the isosurface geometry. Provide controls for quantum numbers (n_x, n_y, n_z) from 1-5. Color isosurfaces by the sign of the real part of psi (positive = blue, negative = red) to show nodal structure. Display nodal planes as semi-transparent sheets. Show the energy level, degeneracy of the current level, and a sidebar energy level diagram with degeneracies labeled. Add a "superposition" mode where the user mixes two states with a slider controlling the mixing coefficient and animates the time evolution |psi(t)|^2 = |c1 psi1 e^(-iE1t/hbar) + c2 psi2 e^(-iE2t/hbar)|^2 showing the probability density sloshing between configurations. Support cross-section slicing planes (xy, xz, yz) with 2D heatmap views. Use OrbitControls, ambient + directional lighting, and a clean dark background.
