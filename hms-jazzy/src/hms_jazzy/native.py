"""Optional desktop view of the same dynamics, independent of the browser session."""

import queue
import time

import mujoco.viewer

from .config import SimulationConfig
from .navigation import ThrusterCommand
from .physics import Simulator


def run(config: SimulationConfig) -> None:
    sim = Simulator(config)
    keys: queue.SimpleQueue[int] = queue.SimpleQueue()
    command = ThrusterCommand()
    paused = False
    print("W/S: both ±10%; A/D: turn ±10%; Space: neutral; R: reset; P: pause")
    print("Native controls latch until changed; close the window to exit.")
    with mujoco.viewer.launch_passive(sim.model, sim.data, key_callback=keys.put) as viewer:
        with viewer.lock():
            viewer.cam.distance = 12
            viewer.cam.elevation = -65
            viewer.cam.azimuth = 90
        while viewer.is_running():
            started = time.monotonic()
            with viewer.lock():
                while not keys.empty():
                    key = keys.get()
                    port, starboard = command.port, command.starboard
                    if key == ord("W"):
                        port, starboard = port + 0.1, starboard + 0.1
                    elif key == ord("S"):
                        port, starboard = port - 0.1, starboard - 0.1
                    elif key == ord("A"):
                        port, starboard = port - 0.1, starboard + 0.1
                    elif key == ord("D"):
                        port, starboard = port + 0.1, starboard - 0.1
                    elif key == ord(" "):
                        port = starboard = 0
                        sim.cut_thrust()
                    elif key == ord("R"):
                        sim.reset()
                        port = starboard = 0
                    elif key == ord("P"):
                        paused = not paused
                    command = ThrusterCommand(
                        max(-1, min(1, port)), max(-1, min(1, starboard))
                    )
                if not paused:
                    sim.step(command)
                viewer.cam.lookat[:] = sim.data.body("board").xpos
            viewer.sync()
            time.sleep(max(0, config.timestep_s - (time.monotonic() - started)))
