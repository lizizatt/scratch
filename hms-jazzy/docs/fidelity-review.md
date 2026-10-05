# Simulation fidelity review — 2026-10-05

## Finding and design target

The previous model constrained motion to east/north/yaw, disabled gravity, and
used a uniform current with no waves or orbital flow. Consequently it could not
rock, pitch, lift out of the water, or lose thrust through propeller exposure.
Its surge coefficients were also optimistic relative to the requested design target.

Two 10 lbf motors supply at most 88.964 N. For aligned, fully submerged motors
in steady calm water, the old drag law gives:

$$88.964 = 8v + 16v^2 \quad\Rightarrow\quad v = 2.121\ \mathrm{m/s} = 4.12\ \mathrm{kn}.$$

At 2 knots it resisted with only 25.17 N. Reducing 45 N per motor to exactly
10 lbf barely changes that result. The important correction was drag, not thrust.
The new provisional coefficients give:

$$88.964 = 30v + 80v^2 \quad\Rightarrow\quad v = 0.884\ \mathrm{m/s} = 1.72\ \mathrm{kn}.$$

That equation describes the hull alone. With the newly modeled passive motor
housings, the current full-thrust speed is 0.863 m/s (1.68 kn).

These coefficients encode the user's expectation that the configuration cannot
overcome a current above 2 knots. They are **not identified from measurements**.
There is no artificial ground-speed clamp: following current can still carry the
board faster than its through-water speed. A 2-knot current is substantial relative
to this motor authority, regardless of whether it feels weak compared with local tides.

## Implemented model

Source: [physics.py](../src/hms_jazzy/physics.py), [water.py](../src/hms_jazzy/water.py),
[config.py](../src/hms_jazzy/config.py), and [board.toml](../board.toml).

- MuJoCo free joint: three world translations and a scalar-first quaternion;
  body-local angular velocity. No roll, pitch, or heave constraint.
- Gravity: 9.81 m/s². Loaded mass defaults to 110 kg; seawater density 1025 kg/m³.
- Fifteen equal-area buoyancy columns on a 5×3 grid. Effective waterplane area
  is length × width × 0.72, not the visible ellipsoid's cross-section. Each column
  displaces area × submerged depth, clipped to the 0.18 m hull thickness.
- Column buoyancy acts vertically at its location, yielding heave force and
  restoring roll/pitch torque. Calm equilibrium draft is about 5.48 cm. The
  fixed COM is 20 cm above the hull midplane, not a standing-rider measurement.
- Each column samples water-relative velocity including rigid-body rotational
  velocity. Body-frame surge/sway/heave drag is rotated back to world space and
  applied with its moment arm. Wet-area scaling is depth / equilibrium draft,
  capped at 2; dry columns contribute no drag. Extra body-axis angular damping
  is also scaled by mean wetness.
- Passive drag on both motor capsules at their actual mounts, with local wave/current
  flow and rotational point velocity. Housing drag and its moment remain present
  with neutral motors; they are independent of maximum thrust strength.
- Two deterministic linear deep-water wave trains, satisfying
  $\omega^2=gk$. Main height is 0.30 m crest-to-trough, period 2.4 s, traveling
  toward 110°. The second has 35% of the height, 1.3× the period, and a heading
  offset of 65°. It is a repeatable crossing sea, not a random ocean spectrum.
- Surface elevation and depth-decaying orbital flow drive submergence and drag.
  Current is superposed as uniform flow; it does not refract or advect the wave field.
- Parallel, reversible site actuators at configurable symmetric locations.
  Default body coordinates: X = −0.6 m, Y = ±0.5 m, Z = −0.35 m relative to COM.
  A 12 cm propeller immersion ramp scales thrust from zero to full; this is a
  ventilation proxy, not propeller CFD. Motor lag is separate from delivered thrust.
- Fixed-step core and independent seeded navigation noise. Browser receives
  quaternions and wave components; the rendered surface uses simulation time.
  Controls still consume sampled horizontal navigation, never 3D ground truth.

## Mount-location interpretation

For fore/aft thrust $F_x$, the body yaw moment is $-yF_x$. Increasing symmetric
half-spacing increases differential steering leverage. Moving the same parallel
motors fore/aft does not change that ideal yaw moment. Fore/aft placement matters
here because pitching changes the motors' immersion and wave exposure, and because
sideways housing drag has the yaw moment $xF_y$.

The UI therefore shows the geometry without inventing a longitudinal yaw benefit.
It deliberately rebuilds and neutralizes the simulation on mount changes; pose,
sea overrides, and controllers do not survive that rebuild. Normal Reset retains
the applied mounts, but reconnect restores file defaults. Save chosen X and half
spacing in the TOML configuration to retain a design.

The model **does not** adjust mass, inertia, brackets, or flexibility when the
motors move. Passive housing forces use the new locations, including their
rotational velocities and moment arms. Bracket drag, interaction between housings
and hull, and real structural costs remain unmodeled. Do not optimize a real design
from this comparison alone.

## Rotational drag and current-induced yaw

The symmetric hull already resisted roll, pitch, and yaw through distributed
point drag and supplemental angular damping. However, it generated no yaw torque
from uniform sideways current at level attitude. A 0.5 m/s eastward current with
the boat initially north-facing produced 8.998 m of eastward drift and zero heading
change after 20 s, regardless of motor fore/aft position. Passive motor drag was
missing; adding an arbitrary current-dependent yaw rate would not fix that physics.

Each motor now uses its MuJoCo capsule radius $r=0.085$ m and cylindrical length
$L=0.36$ m. The provisional projected areas are $A_x=\pi r^2$ and
$A_\perp=2rL+\pi r^2$. At the motor center, body-frame water-relative velocity is
$u=R^T(v+\omega_{world}\times r_{world}-v_{water})$. Housing drag is

$$F_x=-\tfrac12\rho C_x A_x u_x|u_x|,\qquad
F_{y,z}=-\tfrac12\rho C_\perp A_\perp\sqrt{u_y^2+u_z^2}\,u_{y,z}.$$

Defaults are $C_x=0.2$ and $C_\perp=1.0$, configurable and **not calibrated**.
The circular crossflow model does not favor body Y over body Z. Forces are rotated
to world space and summed with $r_{world}\times F_{world}$ about the loaded COM.
This law dissipates energy relative to uniform water flow; the moving water can
still transfer energy to the board in the ground frame.

Immersion is a linear wetted-area proxy across the tilted capsule's vertical
extent, using water elevation at its center. It is not exact submerged projected
area, and wave variation along one housing is not integrated. Housing force is
lumped at its center, so its own distributed rotational resistance is omitted.
Existing hull drag and supplemental angular damping remain; their coefficients
must be fitted together to avoid double-counting measured overall damping.

From rest facing north in a 0.5 m/s eastward current, the two default aft housings
initially add 21.50 N eastward force and +12.90 N·m body yaw torque (counterclockwise,
decreasing navigation heading). The boat turns west of north by 1.42° after 1 s,
4.78° after 5 s, and 5.29° after 20 s, drifting 9.20 m east by 20 s. By 60 s yaw
rate is effectively zero as it catches up with the flow. Centered mounts produce
no yaw in this uniform-current case; forward mounts reverse the turn. This is a
transient, not a guarantee of alignment with current, and not perpetual spin.

[Rotational tests](../tests/test_rotational_drag.py) check cardinal mount moments,
gradual current turning, roll/pitch/yaw damping signs, yaw coast-down, relative-flow
passivity at tilted attitudes, quadratic scaling, crossflow symmetry, immersion,
local wave velocities, disabled coefficients, reset repeatability, and timestep
convergence. Differential thrust can now cause small lateral drift as well as yaw
because both housings are aft; the previous exact-zero-translation assumption
was removed from the spin test.

## Verification evidence

One-minute deterministic runs using the default configuration, except where noted:

| Experiment | Observed model result |
| --- | --- |
| Calm water, full equal thrust | 0.8633 m/s through water, 1.678 kn |
| Calm water, full thrust facing 2 kn head current | −0.1656 m/s forward ground velocity, 9.93 m backward displacement in 60 s |
| Default waves, neutral motors | 0.396 m peak-to-peak COM elevation, 19.03° peak-to-peak roll, 8.96° peak-to-peak pitch |
| Same wave run | 10.17° maximum absolute roll; bounded motion without synthetic random torques |

Wave statistics include the initial transient from spawning at mean-water
equilibrium. They demonstrate that motion is no longer planar; they are not
validated response-amplitude operators or predictions for a real board.

Automated checks in [test_3d.py](../tests/test_3d.py) cover calm equilibrium,
small-angle restoring behavior, freefall when dry, exact cardinal site moments,
tilted projected heading rate, current authority, repeatability, wave descriptor
consistency, and fore/aft and rolled partial-propeller exposure. Existing force,
water-relative drag, waypoint, heading, transport, and watchdog tests also remain.

Browser checks verify visible wave/attitude motion, draft versus active mounting,
reset-on-apply, calm-water selection, pause, and
responsive layout. Native MuJoCo uses the same dynamics but shows a mean-sea-level
plane rather than the browser's wave mesh.

## Unrestricted tuning

The wave height ceiling, 1.5–8 s period range, and steepness rejection were removed
at user request. Finite nonnegative heights and finite positive periods are accepted
without those policy limits; nonrepresentable floating-point wave coefficients are
still rejected. This does **not** extend the model's physical validity. Short periods
may be under-resolved by the physics timestep and browser mesh; extreme waves can
cause inaccurate or unstable dynamics.

Motor strength is editable in lbf per motor, with no upper cap and a positive finite
value required. It scales both actual actuator forces, cancels autopilot, and cuts
thrust without resetting the pose or sea. Strength persists through Reset and mount
changes within the session. The speed/current figures above apply only to the
default 10 lbf per motor. [Tuning tests](../tests/test_tuning.py) check force/moment
scaling, state preservation, input validity, and acceptance beyond the former wave limits.

## Fidelity limits and next measurements

This is a small-wave, moderate-attitude, lumped hydrodynamics model. The rectangular
column approximation is not valid displacement geometry at large heel; large-angle
capsize or recovery is not reliable. There is no collision response, rider balance,
added mass, radiation damping, wave scattering, slamming, breaking waves, wind,
battery/voltage effects, calibrated propeller advance curves, thrust interaction,
sensor dropout, or timing latency. Near-vertical bow heading is ill-conditioned.

Most useful next measurements, in order:

1. **Thrust and straight-line speed:** actual loaded forward/reverse bollard pull,
   several throttle-to-speed points in calm water, and opposite-direction runs
   to estimate current. Fit drag rather than keeping the chosen target coefficients.
2. **Coast-down and turning:** speed decay and yaw-rate response at known motor
   spacing. Separate drag/inertia from controller tuning; do not tune both to hide errors.
3. **Load and flotation:** board thickness/waterline, all-up mass, rider posture,
   fixed COM estimate, and static heel/trim response. The current low COM may be
   a poor stand-in for a standing rider.
4. **Wave response:** synchronized roll/pitch/heave and measured sea state. Use
   the same trial to check damping, submergence, and thrust-loss assumptions.
5. **Mount tradeoffs:** measure housing/bracket drag, changed inertia, flex, propeller
  interaction, and fore/aft wave exposure. The model includes only provisional
  capsule drag and geometry-dependent immersion, not a complete mounting model.

Until calibrated, use this simulator to compare controller behavior and verify
coordinate/force signs—not to establish a safe operating envelope or the best mount.
