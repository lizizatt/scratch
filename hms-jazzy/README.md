# HMS Jazzy

Drive a twin-thruster electric paddleboard in MuJoCo, with a browser helm and a
sensor-only interface for experimenting with an autopilot. Simulation only:
there are no GPS devices, serial ports, motor drivers, or hardware connections.

## Start here

In this configured VS Code workspace, choose **Terminal → Run Task → HMS Jazzy:
browser helm**, then open **http://127.0.0.1:8000**. The task uses
[board.toml](board.toml). Stop it with Ctrl+C in its terminal.

For a fresh checkout, use Python 3.11 or newer:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
.venv/bin/python -m hms_jazzy --config board.toml
```

The MuJoCo wheel includes the engine. The 3D browser view uses WebGL2 and locally
bundled Three.js; it needs no Node.js at runtime, cloud services, map tiles, or CDN.
The 2D chart and controls remain available if WebGL is unavailable. If your shell inherits a private
package index with expired credentials, this standalone project can use public
PyPI without changing your global pip configuration:

```sh
PIP_CONFIG_FILE=/dev/null PIP_INDEX_URL=https://pypi.org/simple PIP_EXTRA_INDEX_URL= \
	.venv/bin/python -m pip install -e '.[dev]'
```

To debug, stop the running task, select **HMS Jazzy: browser helm** in Run and
Debug, then press F5. The debug configuration uses the same board file. If port
8000 is occupied, use `--port 8001` on the command line.

## Driving

| Control | Action |
| --- | --- |
| Port / starboard sliders | Independent latched throttle: reverse −100% to forward +100% |
| Hold W / S | Both motors ahead / astern at 50% |
| Hold A / D | Differential thrust left / right |
| Hold Q / E | Port / starboard motor ahead |
| Release steering keys | Zero keyboard throttle, with modeled motor rundown |
| Space or Neutral | Immediately cut both motors and cancel either autopilot; the board still coasts |
| Pause / Resume | Freeze / resume simulated time |
| R or Reset | Restore initial pose, configured waves/current, sensor seed, and neutral controls; retain applied mounts |
| Follow / home / zoom | Change the north-up chart view |
| Drag / scroll in 3D view | Orbit / zoom the camera without changing physics |

Typing in form fields does not steer. Leaving the browser tab requests immediate
neutral. A server-side one-second heartbeat timeout also cuts thrust and cancels
either autopilot mode, even while paused. Heartbeats never restore a cancelled command.
Resume after an ordinary pause retains commands unless that timeout occurred.

Only one browser helm can connect at a time. Every new connection gets a fresh
simulation; reconnecting does **not** preserve position or replay old commands.
The server binds to loopback only and rejects cross-origin browser WebSockets.
It has no authentication and is not intended to be exposed to a network.

**Heading hold** is a demonstration PD controller. Set a true heading and cruise
throttle, then engage. It uses shortest-angle error and reduces forward thrust
when needed to turn. This is not speed control, waypoint following, or station
keeping. Manual thrust and Neutral override it.

### Go to waypoint

Click the chart to draft a destination, or enter **Target east / Target north**
in metres relative to the fixed home origin. For example, east 20 / north 0 is
20 m east of home, not 20 m east of the current board. Then press **Go to waypoint**.
Clicking or editing the draft never changes an already active destination.
The chart distinguishes the draft cross from the active marker and arrival circle;
the waypoint panel reports sampled distance and navigation/arrival status.

The demo controller uses sampled GPS position, heading, ground speed, and course.
It turns toward the target, reduces speed near it, and can reverse thrust to brake.
**Motor limit** caps each motor in both directions, including differential steering
(default 50%). Arrival requires a sample within the **Arrival radius** (default
1.5 m) at no more than 0.1 m/s. Arrival latches neutral; subsequent drift does not
restart navigation. It is not station keeping, path planning, or obstacle avoidance.
Strong currents and wave motion can prevent arrival; no reachability guarantee is
provided. Calm-water arrival tests do not establish rough-water performance.
Manual input, heading hold, Neutral, reset, disconnect, or heartbeat expiry cancels
waypoint mode. Pausing retains it unless the heartbeat expires.

For headless use, construct `GoToWaypoint(Waypoint(east_m=20, north_m=20))` and
call its `update` method like `HeadingHold`. Construct a new controller for each
mission or simulator reset because arrival is latched. WebSocket clients can send
`{"type":"waypoint","east_m":20,"north_m":20,"max_throttle":0.5,"arrival_radius_m":1.5}`.
Targets are bounded to ±10,000 m on each axis; radius is 0.5–20 m and motor limit
is greater than zero up to 1.0. State includes `mode: "waypoint"` and a `waypoint`
object with target, distance, and `status` (`navigating` or `arrived`); other modes
report `waypoint: null`. Arrival keeps the target visible until cancelled.

## Wave tank and thruster layout

The **6DOF wave tank** shows the simulated rigid body, submerged motors, and the
same two-component wave surface used by the physics. Camera orbiting works even
while paused; vessel and water motion freeze with simulation time. Roll, pitch,
and COM elevation below the view are explicitly **ground truth**, not GPS/IMU data.
Positive roll raises the port edge; positive pitch lowers the bow (right-hand body axes).

The camera follows the board, but the water grid is anchored to ENU world coordinates
at 0.64 m spacing, with bright, alternately shaded square divisions every 3.2 m. Gold crosses vary in
position and size to provide distinctive points to track as the boat passes them;
their layout is deterministic in world coordinates. Unlike a uniform triangular
wireframe, the reference does not look identical after moving one small grid cell.
Grid elevations follow the simulated waves; the lines and crosses are a ground-reference
overlay, not water particles advected by current. The finite water patch recenters
in whole grid cells so nearby lines, markings, and wave phase do not slide with the boat.

**Wave conditions** controls the primary crest-to-trough height, period, and
travel-toward heading (clockwise from north). A crossing train at 35% of the primary
height and 1.3 times its period adds irregular rocking. This height is **not**
significant wave height. Defaults: 0.30 m, 2.4 s, toward 110°. Use **Calm water**
for design comparisons. Wave changes are immediate and can produce transients;
there are no height, period-range, or steepness caps. Height must be finite and
nonnegative; period must be finite and positive. Floating-point coefficient
overflow is rejected without changing the active sea state. Large/steep waves or
periods near or below the fixed physics timestep may be inaccurate or unstable;
accepting a setting does not validate the small-wave model outside its assumptions.
Current is independently set in ENU m/s; its magnitude is also displayed in knots.
Two knots is about 1.03 m/s.

**Thruster layout** sets the common longitudinal location and the **full distance
between motors**. Negative longitudinal position is aft; positive is forward.
The preview shows draft mounts and faded active positions. Nothing changes until
**Apply mounts & reset** rebuilds the MuJoCo model, clears autopilot/thrust, resets
pose and telemetry, and restores configured waves/current. Applied mounts survive
ordinary Reset, but a new connection restores the configuration file. UI changes
are session-only; save `thruster_x_m` and `thruster_arm_m` (half spacing) in
[board.toml](board.toml) for persistence.

**Motor strength** sets maximum thrust in **lbf per motor**, identically on both
sides and in forward/reverse. The applied readout also shows newtons. Values must
be finite and positive; there is no upper strength cap. **Apply strength & neutral**
changes both actual MuJoCo actuator force scales, cuts thrust and cancels autopilot,
but preserves pose, velocity, time, pause state, current, and waves. The strength
survives Reset and mount rebuilds; reconnect reloads the file default. Save
`max_thrust_n` in [board.toml](board.toml) to persist it (1 lbf = 4.4482216152605 N).
Throttle percentages remain normalized to the newly selected maximum force.

Both motors remain parallel to body +X with symmetric Y offsets; their fixed
center depth is 6 cm below the nominal hull bottom. Wider spacing increases
differential yaw leverage. Moving parallel motors fore/aft **does not directly
change their thrust yaw moment**; it changes exposure in pitch/waves and the
moment arm of passive sideways housing drag.
Motor/mount mass, inertia, bracket drag, and flex are not recomputed.

## Model and telemetry

MuJoCo integrates a **six-degree-of-freedom** body (translation plus quaternion
orientation) at a fixed 100 Hz. Gravity is balanced by 15 distributed buoyancy
columns over an effective rectangular waterplane. Their local submergence
produces heave and restoring roll/pitch moments. Distributed linear/quadratic
drag uses local **water-relative** velocity, including current, wave orbital
motion, and body rotation. Additional angular damping limits rotational motion.
Passive motor-housing drag acts at each mount, including when motors are off;
off-center current/wave forces can turn the boat as well as translate it.
Two site-transmission actuators apply thrust at their actual 3D locations, with
motor lag and a simple immersion-dependent thrust loss proxy.

### Current-induced turning and rotational drag

Roll, pitch, and yaw are damped by distributed hull forces, motor-housing forces,
and supplemental angular damping. A side current pushes aft-mounted housings off
the center of mass, producing a gradual turn. Centered mounts do not create that
yaw moment in uniform flow, and forward mounts reverse it. Waves can also produce
unequal loads. A uniform current is not a source of perpetual spin: as a freely
drifting board catches up with it, relative flow and turning torque fade.

For example, from rest facing north, in calm water with neutral motors and an
eastward 0.5 m/s current, the default aft-mounted model turns about **5.3° west of
north** and drifts **9.2 m east in 20 s**. This is an illustrative model response,
not measured paddleboard behavior. Select **Calm water** and apply that current
to isolate the effect from waves.

In [board.toml](board.toml), `motor_axial_drag_coefficient` (default 0.2) and
`motor_crossflow_drag_coefficient` (default 1.0) are provisional dimensionless
housing drag coefficients. Set both to zero for a bare-hull comparison. The
`roll_linear_drag`, `pitch_linear_drag`, `yaw_linear_drag`, and
`yaw_quadratic_drag` values are supplemental damping, not the total rotational
resistance. Fit them together with hull and housing drag to avoid double-counting.

- World: ENU, +X east, +Y north, +Z up.
- Body: +X bow/forward, +Y port, +Z up.
- Navigation heading: degrees clockwise from north; 0° north, 90° east.
- MuJoCo yaw: radians counterclockwise from east; heading = (90° − yaw) mod 360°.
- Positive port thrust produces a clockwise/starboard turn; positive starboard
	thrust produces a counterclockwise/port turn.
- Controller commands are immutable normalized values in [−1, 1], not newtons or PWM.

The chart's board and trail show **ground truth**; the waypoint guidance line
starts at the sampled position. Instruments and controllers use separate,
immutable **sampled navigation** at 10 Hz, held between samples. The seeded sensor
model adds independent Gaussian position, heading, velocity, and yaw-rate noise.
Heading remains observable at rest; course over ground is absent below 0.05 m/s.
GPS latitude/longitude use a local spherical tangent approximation around a
configurable synthetic origin. They are suitable for local experiments, not
long-distance geodesy. The navigation interface stays horizontal; roll/pitch/heave
are simulated but not added to sensor telemetry. Heading is the horizontal bow
azimuth, and its sampled rate is the derivative of that projection, not merely
body-Z angular velocity when tilted. Heading is ill-conditioned near a vertical bow.

### Tune it to your board

Edit [board.toml](board.toml), then restart the server. The defaults are illustrative:
110 kg loaded mass, 3.2 × 0.85 m board, and 0.5 m centerline-to-thruster arm.
Each motor defaults to **10 lbf (44.4822 N)** based on the estimated maximum;
this is almost the same as the original 45 N default, not a ten-newton motor.
Both newtons and pounds-force appear in the helm. These are **not measured
specifications** of your board or its GPS.

Measure or estimate loaded mass, yaw inertia, motor spacing, forward/reverse
thrust curves, motor response, and coast-down drag before trusting predictions.
The current model assumes symmetric forward/reverse thrust with no deadband.
Position and heading noise settings are configurable, not a GPS accuracy claim.

The provisional hull surge drag is `30*v + 80*v*abs(v)` N, plus passive housing
drag. Calm-water tests settle at about **0.863 m/s (1.68 kn)** at the default
10 lbf per motor; a 2 kn head current carries the board backward at about
**0.166 m/s (0.32 kn)**. These coefficients encode the
expected limited authority, not a measured drag curve or a hard ground-speed cap.
A following current can produce ground speeds above 2 kn. Raising motor strength
also changes this balance and may allow overcoming that current.

This is a **small-wave, moderate-attitude approximation**, not CFD or a validated
sea-keeping model. The visible ellipsoid is not the displacement geometry. The
effective waterplane, inertia, and fixed COM (20 cm above the hull midplane) are
assumptions; in particular, they do not establish the stability of a standing
rider. There is no rider balance, added mass, radiation/scattering, slamming,
breaking waves, wind, wave/current refraction, battery limit, propeller interaction,
bracket drag, sensor latency/dropouts, or collision response. Large-angle motion and
capsize recovery are not trustworthy. See the [fidelity review](docs/fidelity-review.md)
for equations, measurements, and calibration priorities.

## Native MuJoCo view

```sh
.venv/bin/python -m hms_jazzy --native --config board.toml
```

This opens a separate desktop simulation of the same model, not a second view
of the browser session. It requires a working desktop/OpenGL environment.
W/S adjust both throttles by 10%; A/D adjust differential thrust by 10%; Space
cuts thrust; R resets; P pauses. **Native controls latch** until changed, unlike
the browser's hold-to-steer keys. Close the window to exit. Use the mouse to
orbit/zoom. The orange marker is the bow, red is port, green is starboard.
The native viewer's flat plane marks mean sea level; use the browser view for
the animated wave surface. Both integrate the same 6DOF model.

## Add an autopilot

Implement `Controller.update(navigation: NavigationSample, dt_s: float) ->
ThrusterCommand` from [controllers.py](src/hms_jazzy/controllers.py). The navigation
sample contains its acquisition timestamp; repeated calls can see the same sample.
`dt_s` is the physics/controller interval, not the age of the GPS fix. A controller
needing fresh observations should check `navigation.time_s`.

[examples/heading_hold.py](examples/heading_hold.py) runs a controller without a
browser, renderer, or real-time pacing and prints one JSON record per simulated
second. Resetting the simulator resets the sensor RNG; reset any stateful custom
controller separately. In the browser, the heading command creates `HeadingHold`
inside `HelmSession.receive`; replace that construction to try your own controller.

```sh
.venv/bin/python examples/heading_hold.py
```

The stepping API is deterministic for a fixed model, seed, command sequence, and
engine version. The browser adds wall-clock pacing and a control lease outside
that core. Do not bypass `Simulator.step` with `mj_step` or MuJoCo's rollout helper:
those alone omit buoyancy, wave forces, custom drag, motor lag, and sensor sampling.

### Browser asset development

The generated bundle and license files ship with the Python package. Rebuild
after editing [scene.js](src/hms_jazzy/web/scene.js):

```sh
npm ci
npm run test:web
npm run build:web
```

WebSocket additions: `{"type":"waves","height_m":0.3,"period_s":2.4,"direction_deg":110}`
and `{"type":"mounts","longitudinal_m":-0.6,"half_spacing_m":0.5}`. Motor tuning uses
`{"type":"motor_strength","max_thrust_n":88.96443230521}` (20 lbf each). State includes
`water` (parameters and exact spectral components), a reset `revision`, and
`truth.up_m`, `truth.roll_deg`, `truth.pitch_deg`, `truth.quaternion_wxyz`. Quaternions
are scalar-first; free-joint translational velocity is world-frame, angular velocity
is body-frame. Browser wave rendering uses received `time_s` and these components,
never a separate wave clock. Invalid geometric/wave combinations leave the session
unchanged and return an error.

## Tests and checks

```sh
.venv/bin/python -m pytest
.venv/bin/python -m ruff check .
.venv/bin/python -m build
```

Tests cover cardinal body/site transforms, actuator force and torque, reverse and
spin signs, current-relative drag, coasting, motor response, sampled telemetry,
repeatability, heading convergence, input validation, pause/reset, watchdogs,
HTTP assets, single-helm ownership, reconnect, and cross-origin rejection.
Waypoint tests cover noisy arrivals in all cardinal directions, approach braking,
motor limits, arrival latching, invalid targets, overrides, and lease expiry.
3D regressions cover flotation, freefall, restoring moments, tilted heading rate,
mount-site transforms, partial propeller exposure, deterministic wave response,
current authority, and atomic configuration changes. The 3D browser view needs
WebGL2; headless physics and transport tests do not.
Tuning tests cover unrestricted wave ranges, invalid values, actuator-force scaling
at cardinal headings, and motor-strength changes without resetting the session.
