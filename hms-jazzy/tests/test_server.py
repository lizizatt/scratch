import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from hms_jazzy.config import SimulationConfig
from hms_jazzy.navigation import ThrusterCommand
from hms_jazzy.server import MESSAGE_ADAPTER, HelmSession, create_app


def message(**values):
    return MESSAGE_ADAPTER.validate_python(values)


def until(socket, predicate):
    for _ in range(30):
        state = socket.receive_json()
        if predicate(state):
            return state
    pytest.fail("expected websocket state not received")


def test_watchdog_cuts_heading_and_heartbeat_does_not_restore_it():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(message(type="heading", heading_deg=90, throttle=0.4), now=0)
    session.advance(20, now=0.1)
    assert session.snapshot()["mode"] == "heading"
    session.advance(1, now=1.1)
    assert session.watchdog
    assert session.command == ThrusterCommand()
    assert session.snapshot()["thrust_n"] == {"port": 0, "starboard": 0}
    assert session.controller is None
    session.receive(message(type="heartbeat"), now=1.2)
    session.advance(1, now=1.3)
    assert session.watchdog
    assert session.command == ThrusterCommand()


def test_pause_freezes_time_but_not_watchdog_and_reset_restores_defaults():
    session = HelmSession(SimulationConfig(), now=0)
    session.receive(message(type="control", port=1, starboard=1), now=0)
    session.advance(20, now=0.1)
    session.receive(message(type="pause", paused=True), now=0.2)
    session.advance(100, now=2)
    assert session.sim.time_s == 0.2
    assert session.command == ThrusterCommand()
    session.receive(message(type="current", east_mps=1, north_mps=2), now=2)
    session.receive(message(type="reset"), now=2)
    assert session.sim.time_s == 0
    assert not session.paused
    assert not session.watchdog
    assert session.sim.current_east_mps == 0


@pytest.mark.parametrize("payload", [
    '{"type":"control","port":NaN,"starboard":0}',
    '{"type":"control","port":2,"starboard":0}',
    '{"type":"control","port":"0","starboard":0}',
    '{"type":"pause","paused":"false"}',
    '{"type":"heading","heading_deg":12}',
    '{"type":"current","east_mps":4,"north_mps":0}',
    '{"type":"reset","extra":1}', 'null', '[]', 'invalid',
])
def test_invalid_transport_messages(payload):
    with pytest.raises(ValueError):
        MESSAGE_ADAPTER.validate_json(payload)


def test_http_and_websocket_roundtrip():
    with TestClient(create_app(SimulationConfig(wave_height_m=0))) as client:
        assert client.get("/health").json()["engine"] == "MuJoCo"
        assert "HMS Jazzy" in client.get("/").text
        assert client.get("/static/app.js").status_code == 200
        with client.websocket_connect("/ws") as socket:
            assert socket.receive_json()["time_s"] == 0
            socket.send_json({"type": "control", "port": 0.5, "starboard": 0.5})
            state = until(socket, lambda s: s.get("command", {}).get("port") == 0.5)
            assert state["truth"]["north_m"] > 0
            socket.send_json({"type": "pause", "paused": True})
            state = until(socket, lambda s: s.get("paused"))
            assert socket.receive_json()["time_s"] == state["time_s"]
            socket.send_text("invalid")
            assert until(socket, lambda s: s["type"] == "error")["message"]
            socket.send_json({"type": "reset"})
            state = until(socket, lambda s: not s.get("paused", True))
            assert state["command"] == {"port": 0, "starboard": 0}
            assert state["truth"]["north_m"] == pytest.approx(0, abs=1e-12)


def test_waypoint_websocket_arrival_and_manual_override():
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as socket:
        assert socket.receive_json()["waypoint"] is None
        socket.send_json({"type": "waypoint", "east_m": 0, "north_m": 0})
        state = until(socket, lambda s: s.get("mode") == "waypoint")
        assert state["waypoint"]["status"] == "arrived"
        assert state["waypoint"]["max_throttle"] == 0.5
        assert state["command"] == {"port": 0, "starboard": 0}
        socket.send_json({"type": "control", "port": 0.25, "starboard": 0.25})
        state = until(socket, lambda s: s.get("mode") == "manual")
        assert state["waypoint"] is None
        assert state["command"] == {"port": 0.25, "starboard": 0.25}


def test_wave_and_mount_websocket_validation_and_rebuild():
    with TestClient(create_app()) as client, client.websocket_connect("/ws") as socket:
        assert client.get("/static/scene.bundle.js").status_code == 200
        assert client.get("/static/THREE-LICENSE.txt").status_code == 200
        socket.receive_json()
        socket.send_json({"type": "waves", "height_m": 0.6, "period_s": 0,
                          "direction_deg": 0})
        assert until(socket, lambda s: s["type"] == "error")["message"]
        socket.send_json({"type": "waves", "height_m": 0, "period_s": 2.4,
                          "direction_deg": 0})
        state = until(socket, lambda s: s.get("water", {}).get("height_m") == 0)
        assert len(state["truth"]["quaternion_wxyz"]) == 4
        socket.send_json({"type": "mounts", "longitudinal_m": 100, "half_spacing_m": 0.8})
        assert until(socket, lambda s: s["type"] == "error")["message"]
        socket.send_json({"type": "mounts", "longitudinal_m": 1, "half_spacing_m": 0.8})
        state = until(socket, lambda s: s.get("revision") == 1)
        assert state["config"]["thruster_x_m"] == 1
        assert state["config"]["thruster_arm_m"] == 0.8
        assert state["water"]["height_m"] == 0.3
        assert state["command"] == {"port": 0, "starboard": 0}
        assert state["mode"] == "manual"


def test_single_helm_disconnect_and_reconnect():
    app = create_app()
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as first:
            first.receive_json()
            with pytest.raises(WebSocketDisconnect) as exc:
                with client.websocket_connect("/ws") as second:
                    second.receive_json()
            assert exc.value.code == 1008
            first.send_json({"type": "control", "port": 1, "starboard": 1})
            until(first, lambda s: s.get("command", {}).get("port") == 1)
        with client.websocket_connect("/ws") as reconnected:
            state = reconnected.receive_json()
            assert state["time_s"] == 0
            assert state["command"] == {"port": 0, "starboard": 0}


def test_foreign_origin_rejected():
    with TestClient(create_app()) as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/ws", headers={"origin": "https://example.com"}):
                pass
