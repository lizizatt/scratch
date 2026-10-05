"""Local browser transport and real-time pacing; the simulation owns its own clock."""

import asyncio
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from .config import SimulationConfig
from .controllers import Controller, GoToWaypoint, HeadingHold, Waypoint
from .navigation import ThrusterCommand
from .physics import Simulator


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class ControlMessage(Message):
    type: Literal["control"]
    port: float = Field(ge=-1, le=1)
    starboard: float = Field(ge=-1, le=1)


class HeadingMessage(Message):
    type: Literal["heading"]
    heading_deg: float = Field(ge=0, le=360)
    throttle: float = Field(ge=-1, le=1)


class WaypointMessage(Message):
    type: Literal["waypoint"]
    east_m: float = Field(ge=-10_000, le=10_000)
    north_m: float = Field(ge=-10_000, le=10_000)
    max_throttle: float = Field(default=0.5, gt=0, le=1)
    arrival_radius_m: float = Field(default=1.5, ge=0.5, le=20)


class CurrentMessage(Message):
    type: Literal["current"]
    east_mps: float = Field(ge=-3, le=3)
    north_mps: float = Field(ge=-3, le=3)


class WavesMessage(Message):
    type: Literal["waves"]
    height_m: float = Field(ge=0)
    period_s: float = Field(gt=0)
    direction_deg: float = Field(ge=0, lt=360)


class MountsMessage(Message):
    type: Literal["mounts"]
    longitudinal_m: float
    half_spacing_m: float = Field(ge=0.05, le=2)


class MotorStrengthMessage(Message):
    type: Literal["motor_strength"]
    max_thrust_n: float = Field(gt=0)


class PauseMessage(Message):
    type: Literal["pause"]
    paused: bool


class SimpleMessage(Message):
    type: Literal["reset", "stop", "heartbeat"]


Incoming = Annotated[
    ControlMessage | HeadingMessage | WaypointMessage
    | CurrentMessage | WavesMessage | MountsMessage | MotorStrengthMessage
    | PauseMessage | SimpleMessage,
    Field(discriminator="type"),
]
MESSAGE_ADAPTER = TypeAdapter(Incoming)


class HelmSession:
    def __init__(self, config: SimulationConfig, now: float) -> None:
        self.sim = Simulator(config)
        self.paused = False
        self.controller: Controller | None = None
        self.command = ThrusterCommand()
        self.target_heading_deg = config.initial_heading_deg
        self.throttle = 0.0
        self.last_heartbeat = now
        self.watchdog = False
        self.revision = 0

    def stop(self) -> None:
        self.controller = None
        self.command = ThrusterCommand()
        self.throttle = 0.0
        self.sim.cut_thrust()

    def receive(self, message: Incoming, now: float) -> None:
        if isinstance(message, ControlMessage):
            self.controller = None
            self.command = ThrusterCommand(message.port, message.starboard)
            self.last_heartbeat, self.watchdog = now, False
        elif isinstance(message, HeadingMessage):
            self.controller = HeadingHold(message.heading_deg, message.throttle)
            self.target_heading_deg = message.heading_deg % 360
            self.throttle = message.throttle
            self.last_heartbeat, self.watchdog = now, False
        elif isinstance(message, WaypointMessage):
            self.stop()
            self.controller = GoToWaypoint(Waypoint(
                message.east_m, message.north_m, message.max_throttle, message.arrival_radius_m
            ))
            self.last_heartbeat, self.watchdog = now, False
        elif isinstance(message, CurrentMessage):
            self.sim.set_current(message.east_mps, message.north_mps)
        elif isinstance(message, WavesMessage):
            self.sim.set_waves(message.height_m, message.period_s, message.direction_deg)
        elif isinstance(message, MotorStrengthMessage):
            self.sim.set_motor_strength(message.max_thrust_n)
            self.stop()
            self.last_heartbeat, self.watchdog = now, False
        elif isinstance(message, MountsMessage):
            config = SimulationConfig.model_validate({
                **self.sim.config.model_dump(), "thruster_x_m": message.longitudinal_m,
                "thruster_arm_m": message.half_spacing_m,
            })
            replacement = Simulator(config)
            self.stop()
            self.sim = replacement
            self.paused = False
            self.target_heading_deg = config.initial_heading_deg
            self.last_heartbeat, self.watchdog = now, False
            self.revision += 1
        elif isinstance(message, PauseMessage):
            self.paused = message.paused
        elif message.type == "reset":
            self.stop()
            self.sim.reset()
            self.paused = False
            self.target_heading_deg = self.sim.config.initial_heading_deg
            self.last_heartbeat, self.watchdog = now, False
            self.revision += 1
        elif message.type == "stop":
            self.stop()
            self.last_heartbeat, self.watchdog = now, False
        elif message.type == "heartbeat":
            self.last_heartbeat = now

    def advance(self, steps: int, now: float) -> None:
        if now - self.last_heartbeat > 1.0:
            self.stop()
            self.watchdog = True
        if not self.paused:
            for _ in range(steps):
                if self.controller is not None:
                    self.command = self.controller.update(
                        self.sim.navigation, self.sim.config.timestep_s
                    )
                    if isinstance(self.controller, GoToWaypoint) and self.controller.arrived:
                        self.sim.cut_thrust()
                self.sim.step(self.command)

    def snapshot(self) -> dict:
        waypoint = None
        if isinstance(self.controller, GoToWaypoint):
            waypoint = {
                **asdict(self.controller.target),
                "distance_m": self.controller.target.distance(self.sim.navigation),
                "status": "arrived" if self.controller.arrived else "navigating",
            }
        return {
            "type": "state", "time_s": self.sim.time_s, "paused": self.paused,
            "revision": self.revision,
            "water": self.sim.water.snapshot(),
            "mode": "waypoint" if waypoint else "heading" if self.controller else "manual",
            "waypoint": waypoint,
            "navigation": asdict(self.sim.navigation), "truth": asdict(self.sim.truth),
            "command": asdict(self.command),
            "thrust_n": {
                "port": float(self.sim.data.ctrl[0]) * self.sim.config.max_thrust_n,
                "starboard": float(self.sim.data.ctrl[1]) * self.sim.config.max_thrust_n,
            },
            "current": {
                "east_mps": self.sim.current_east_mps,
                "north_mps": self.sim.current_north_mps,
            },
            "config": self.sim.config.model_dump(),
            "target_heading_deg": self.target_heading_deg,
            "throttle": self.throttle, "watchdog": self.watchdog,
        }


def create_app(config: SimulationConfig | None = None) -> FastAPI:
    config = config or SimulationConfig()
    app = FastAPI(title="HMS Jazzy")
    app.state.occupied = False
    web = Path(__file__).parent / "web"
    app.mount("/static", StaticFiles(directory=web), name="static")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(web / "index.html")

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "engine": "MuJoCo"}

    @app.websocket("/ws")
    async def helm(socket: WebSocket) -> None:
        origin = socket.headers.get("origin")
        if origin and urlsplit(origin).netloc != socket.headers.get("host"):
            await socket.close(code=1008, reason="same-origin connections only")
            return
        await socket.accept()
        if app.state.occupied:
            await socket.close(code=1008, reason="helm already in use")
            return
        app.state.occupied = True
        session: HelmSession | None = None
        tasks: list[asyncio.Task] = []
        send_lock = asyncio.Lock()

        async def send(payload: dict) -> None:
            async with send_lock:
                await asyncio.wait_for(socket.send_json(payload), timeout=1.0)

        try:
            loop = asyncio.get_running_loop()
            session = HelmSession(config, loop.time())
            await send(session.snapshot())

            async def receive() -> None:
                while True:
                    raw = await socket.receive_text()
                    try:
                        if len(raw) > 4096:
                            raise ValueError("message too large")
                        message = MESSAGE_ADAPTER.validate_json(raw)
                    except (ValidationError, ValueError):
                        await send({"type": "error", "message": "Invalid helm command"})
                        continue
                    try:
                        session.receive(message, loop.time())
                    except ValueError as error:
                        await send({"type": "error", "message": str(error)})

            async def tick() -> None:
                steps = max(1, round(0.05 / config.timestep_s))
                interval = steps * config.timestep_s
                while True:
                    start = loop.time()
                    session.advance(steps, start)
                    await send(session.snapshot())
                    # Slow clients slow presentation, never enlarge the physics time step.
                    await asyncio.sleep(max(0, interval - (loop.time() - start)))

            tasks = [asyncio.create_task(receive()), asyncio.create_task(tick())]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
        except (WebSocketDisconnect, TimeoutError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            try:
                if session is not None:
                    session.stop()
            finally:
                app.state.occupied = False

    return app
