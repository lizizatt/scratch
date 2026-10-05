# HMS Jazzy

This is a standalone simulation project. There are no hardware connections.
Keep the deterministic MuJoCo core independent of the browser and wall clock.
Use SI units internally, ENU world coordinates, and a body frame with +X forward,
+Y port, +Z up. Navigation heading is clockwise from north in degrees.
Controllers consume immutable navigation samples and return normalized port/starboard
commands. Keep ground truth distinct from sampled sensor telemetry.
When changing dynamics, test force signs, cardinal headings, and water-relative drag.

## Setup progress

- [x] Verify workspace and requirements.
- [x] Scaffold Python package and virtual environment.
- [x] Verify required Python extensions.
- [x] Implement simulator and browser helm.
- [x] Install dependencies and validate: 44 tests, Ruff, package build, and OpenGL smoke test.
- [x] Create and run VS Code task; verify controls against the live browser backend.
- [x] Finish documentation and launch instructions.
