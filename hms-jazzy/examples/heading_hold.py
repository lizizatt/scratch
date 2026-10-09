"""Run 30 simulated seconds with no browser, renderer, or wall-clock pacing."""

import json
from dataclasses import asdict

from hms_jazzy.controllers import Controller, HeadingHold
from hms_jazzy.physics import Simulator


def main() -> None:
    sim = Simulator()
    controller: Controller = HeadingHold(heading_deg=90, throttle=0.35)
    steps_per_second = round(1 / sim.config.timestep_s)
    for step in range(30 * steps_per_second):
        command = controller.update(sim.navigation, sim.config.timestep_s)
        sim.step(command)
        if (step + 1) % steps_per_second == 0:
            print(json.dumps({
                "navigation": asdict(sim.navigation),
                "command": asdict(command),
                "truth": asdict(sim.truth),
            }))


if __name__ == "__main__":
    main()
