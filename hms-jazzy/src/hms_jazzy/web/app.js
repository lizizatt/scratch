(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("chart");
  const ctx = canvas.getContext("2d");
  let scene = null;
  try {
    scene = Jazzy3D.createScene($("scene"));
  } catch (error) {
    $("scene-help").textContent = "3D rendering unavailable; the chart and controls still work. " + error.message;
  }
  const sliders = { port: $("port"), starboard: $("starboard") };
  const held = new Set();
  const steeringKeys = new Set(["w", "s", "a", "d", "q", "e"]);
  const retryDelays = [1000, 2000, 4000, 8000];
  const maxTrailPoints = 2400;
  let socket = null;
  let retryTimer = null;
  let retryCount = 0;
  let liveSince = null;
  let lastReceivedAt = 0;
  let ready = false;
  let neutralPending = true;
  let policyBlocked = false;
  let latest = null;
  let trail = [];
  let trailTime = -Infinity;
  let forceSync = true;
  let camera = { east: 0, north: 0 };
  let follow = true;
  let pixelsPerMeter = 17;
  let chartWidth = 1;
  let chartHeight = 1;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const wrap = (degrees) => ((degrees % 360) + 360) % 360;
  const fixed = (value, digits = 1) => value.toFixed(digits);
  const signed = (value, digits = 1) => `${value > 0 ? "+" : ""}${fixed(value, digits)}`;
  const text = (id, value) => { $(id).textContent = value; };
  const isOpen = () => socket && socket.readyState === WebSocket.OPEN;
  const canControl = () => ready && isOpen() && !neutralPending && !document.hidden;

  function connection(status, label) {
    $("connection").dataset.status = status;
    text("connection-label", label);
  }

  function showError(message) {
    text("error-banner", message);
    $("error-banner").hidden = !message;
  }

  function notice(message) {
    text("safety-banner", message);
    $("safety-banner").hidden = !message;
  }

  function updateAvailability() {
    for (const id of ["manual-controls", "heading-controls", "waypoint-controls", "current-controls", "mount-controls", "waves-controls", "motor-strength-controls"]) {
      $(id).disabled = !canControl();
    }
    $("pause").disabled = !canControl();
    $("reset").disabled = !canControl();
    $("stop").disabled = !isOpen();
  }

  function sliderLabel(side) {
    const value = Number(sliders[side].value);
    text(`${side}-value`, `${value > 0 ? "+" : ""}${value}%`);
    sliders[side].setAttribute("aria-valuetext", `${Math.abs(value)} percent ${value < 0 ? "reverse" : value > 0 ? "forward" : "neutral"}`);
  }

  function setSliders(port, starboard, force = false) {
    for (const [side, value] of Object.entries({ port, starboard })) {
      if (force || (document.activeElement !== sliders[side] && held.size === 0)) {
        sliders[side].value = String(Math.round(value * 100));
        sliderLabel(side);
      }
    }
  }

  function clearLocalControls() {
    held.clear();
    setSliders(0, 0, true);
    forceSync = true;
  }

  function send(message) {
    if (!isOpen()) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      connection("error", "Connection lost · controls neutral");
      ready = false;
      neutralPending = true;
      clearLocalControls();
      updateAvailability();
      socket.close();
      return false;
    }
  }

  function neutral(reason = "Neutral requested · autopilot cancelled.") {
    clearLocalControls();
    neutralPending = true;
    send({ type: "stop" });
    notice(reason);
    updateAvailability();
  }

  function reset() {
    if (!canControl()) return;
    clearLocalControls();
    $("waypoint-form").reset();
    updateDraft();
    neutralPending = true;
    send({ type: "reset" });
    notice("Reset requested · waiting for simulator confirmation.");
    updateAvailability();
  }

  function manual(port, starboard) {
    if (!canControl()) return;
    if (send({ type: "control", port: clamp(port, -1, 1), starboard: clamp(starboard, -1, 1) })) {
      notice("");
    }
  }

  function validState(state) {
    const numbers = (object, keys) => object && keys.every((key) => finite(object[key]));
    return state && state.type === "state"
      && numbers(state, ["time_s", "target_heading_deg", "throttle", "revision"])
      && numbers(state.water, ["height_m", "period_s", "direction_deg"])
      && Array.isArray(state.water.components) && state.water.components.length === 2
      && state.water.components.every((wave) => numbers(wave, ["amplitude_m", "wave_number_rad_m", "omega_rad_s", "east", "north", "phase_rad"]))
      && typeof state.paused === "boolean" && typeof state.watchdog === "boolean"
      && ["manual", "heading", "waypoint"].includes(state.mode)
      && (state.mode !== "waypoint" || (
        numbers(state.waypoint, ["east_m", "north_m", "max_throttle", "arrival_radius_m", "distance_m"])
        && ["navigating", "arrived"].includes(state.waypoint.status)
        && state.waypoint.arrival_radius_m > 0
      ))
      && numbers(state.navigation, ["time_s", "latitude_deg", "longitude_deg", "east_m", "north_m", "heading_deg", "speed_mps", "yaw_rate_deg_s"])
      && (state.navigation.course_deg === null || finite(state.navigation.course_deg))
      && numbers(state.truth, ["east_m", "north_m", "heading_deg", "speed_mps", "up_m", "roll_deg", "pitch_deg"])
      && Array.isArray(state.truth.quaternion_wxyz) && state.truth.quaternion_wxyz.length === 4
      && state.truth.quaternion_wxyz.every(finite)
      && numbers(state.command, ["port", "starboard"])
      && Math.abs(state.command.port) <= 1 && Math.abs(state.command.starboard) <= 1
      && numbers(state.thrust_n, ["port", "starboard"])
      && numbers(state.current, ["east_mps", "north_mps"])
      && numbers(state.config, ["mass_kg", "max_thrust_n", "length_m", "width_m", "thruster_arm_m", "thruster_x_m", "thickness_m", "com_height_m", "sensor_hz"])
      && state.config.length_m > 0 && state.config.width_m > 0
      && state.config.max_thrust_n > 0 && state.config.thruster_arm_m >= 0;
  }

  function syncInput(id, value, force = false) {
    if (force || document.activeElement !== $(id)) $(id).value = String(value);
  }

  function receiveState(state) {
    const previous = latest;
    const first = !ready;
    const resetDetected = previous !== null && (state.revision !== previous.revision || state.time_s < previous.time_s);
    const modeChanged = previous !== null && previous.mode !== state.mode;
    const watchdogChanged = state.watchdog && (!previous || !previous.watchdog);
    lastReceivedAt = performance.now();
    if (liveSince === null) liveSince = lastReceivedAt;
    ready = true;
    latest = state;
    if (scene) {
      try { scene.update(state); } catch (error) {
        $("scene-help").textContent = "3D view stopped: " + error.message;
        scene = null;
      }
    }

    if (first || resetDetected) {
      trail = [];
      trailTime = -Infinity;
      $("waypoint-form").reset();
      updateDraft();
    }
    // Mode snapshots can lag newer keyboard input. Only explicit safety events
    // clear held keys; otherwise keyup must still send the release command.
    if (resetDetected || watchdogChanged) held.clear();
    if (state.time_s > trailTime && (state.time_s - trailTime >= .1 || trail.length === 0)) {
      trail.push({ east: state.truth.east_m, north: state.truth.north_m });
      if (trail.length > maxTrailPoints) trail.splice(0, trail.length - maxTrailPoints);
      trailTime = state.time_s;
    }

    // A new connection must acknowledge neutral before it accepts new helm input.
    if (neutralPending && state.mode === "manual" && state.command.port === 0 && state.command.starboard === 0) {
      neutralPending = false;
      forceSync = true;
    }
    if (neutralPending) {
      setSliders(0, 0, true);
    } else {
      setSliders(state.command.port, state.command.starboard,
        forceSync || resetDetected || state.watchdog);
      forceSync = false;
    }

    if (watchdogChanged) {
      notice("Control lease expired · drives neutral, autopilot disabled. Apply a new command to continue.");
    } else if (resetDetected) {
      notice("Simulation reset · drives neutral; trail cleared and configured sea defaults restored.");
    } else if (first) {
      notice(neutralPending ? "Connected · waiting for neutral confirmation." : "Helm connected · drives neutral. Ready for a new command.");
    }
    connection("live", document.hidden ? "Connected · tab inactive" : neutralPending ? "Connected · neutralizing" : "Helm connected");
    $("reconnect").hidden = true;
    text("mode", neutralPending ? "NEUTRALIZING" : state.mode === "waypoint" ? (state.waypoint.status === "arrived" ? "ARRIVED" : "WAYPOINT") : state.mode === "heading" ? "HEADING HOLD" : "MANUAL");
    text("waypoint-status", state.mode === "waypoint"
      ? `${state.waypoint.status === "arrived" ? "Arrived · neutral, may drift" : "Navigating"} · ${fixed(state.waypoint.distance_m)} m to active target (${fixed(state.waypoint.east_m)} E, ${fixed(state.waypoint.north_m)} N)`
      : "No active waypoint");
    text("pause", state.paused ? "Resume" : "Pause");
    $("pause").setAttribute("aria-label", state.paused ? "Resume simulation" : "Pause simulation");

    const nav = state.navigation;
    const heading = wrap(nav.heading_deg);
    const cardinal = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(heading / 22.5) % 16];
    text("heading", fixed(heading, 1));
    text("heading-cardinal", `${cardinal} · true north`);
    text("speed", fixed(nav.speed_mps, 2));
    text("speed-knots", fixed(nav.speed_mps * 1.9438444924406, 2));
    text("yaw", signed(nav.yaw_rate_deg_s));
    text("truth-roll", `${signed(state.truth.roll_deg)}°`);
    text("truth-pitch", `${signed(state.truth.pitch_deg)}°`);
    text("truth-up", `${signed(state.truth.up_m, 2)} m`);
    text("scene-state", state.paused ? "PAUSED" : "LIVE · GROUND TRUTH");
    text("latitude", `${fixed(nav.latitude_deg, 6)}°`);
    text("longitude", `${fixed(nav.longitude_deg, 6)}°`);
    text("course", nav.course_deg === null ? "— / no course" : `${fixed(wrap(nav.course_deg))}°`);
    text("position", `${signed(nav.east_m)} / ${signed(nav.north_m)} m`);
    text("sample-time", `${fixed(nav.time_s, 2)} s`);
    text("sim-time", `${fixed(state.time_s, 2)} s`);
    text("port-force", `${signed(state.thrust_n.port)} N / ${signed(state.thrust_n.port / 4.4482216152605)} lbf`);
    text("starboard-force", `${signed(state.thrust_n.starboard)} N / ${signed(state.thrust_n.starboard / 4.4482216152605)} lbf`);
    text("current-readout", `E ${signed(state.current.east_mps, 2)} / N ${signed(state.current.north_mps, 2)} m/s · ${fixed(Math.hypot(state.current.east_mps, state.current.north_mps) / .514444444, 2)} kn`);
    text("wave-readout", `Applied: ${state.water.height_m} m / ${state.water.period_s} s toward ${fixed(state.water.direction_deg, 0)}°`);
    text("mount-readout", `Active: ${signed(state.config.thruster_x_m, 2)} m fore/aft · ${fixed(state.config.thruster_arm_m * 2, 2)} m full spacing`);
    text("motor-strength-readout", `Active per motor: ${fixed(state.config.max_thrust_n / 4.4482216152605, 2)} lbf / ${fixed(state.config.max_thrust_n, 2)} N`);
    text("sensor-rate", `GPS / IMU · ${state.config.sensor_hz} Hz`);
    text("vessel-spec", `${fixed(state.config.length_m)} × ${fixed(state.config.width_m, 2)} m · ${fixed(state.config.mass_kg, 0)} kg · Each motor: ${fixed(state.config.max_thrust_n)} N (${fixed(state.config.max_thrust_n / 4.4482216152605)} lbf)`);
    if (first || resetDetected || modeChanged) {
      syncInput("target-heading", state.target_heading_deg);
      syncInput("cruise-throttle", Math.round(state.throttle * 100));
    }
    // Forms keep unsent edits until submission; the readout always shows server state.
    if (first || resetDetected) {
      syncInput("current-east", state.current.east_mps);
      syncInput("current-north", state.current.north_mps);
      syncInput("mount-x", state.config.thruster_x_m, true);
      $("mount-x").min = -state.config.length_m / 2;
      $("mount-x").max = state.config.length_m / 2;
      syncInput("mount-spacing", state.config.thruster_arm_m * 2, true);
      syncInput("wave-height", state.water.height_m, true);
      syncInput("wave-period", state.water.period_s, true);
      syncInput("wave-direction", state.water.direction_deg, true);
      validatePositive($("wave-period"));
    }
    if (first || resetDetected || previous?.config.max_thrust_n !== state.config.max_thrust_n) {
      syncInput("motor-strength", state.config.max_thrust_n / 4.4482216152605, true);
      validatePositive($("motor-strength"));
    }
    updateMountPreview();
    $("chart-empty").hidden = true;
    $("chart-state").hidden = !state.paused;
    text("chart-state", "PAUSED");
    updateAvailability();
  }

  function connect() {
    clearTimeout(retryTimer);
    ready = false;
    neutralPending = true;
    liveSince = null;
    lastReceivedAt = performance.now();
    clearLocalControls();
    connection("connecting", "Connecting to helm…");
    $("reconnect").hidden = true;
    text("mode", "OFFLINE");
    if (!["http:", "https:"].includes(location.protocol)) {
      connection("error", "Backend connection required");
      showError("Open this helm through the simulator's HTTP server. Static file previews cannot connect to /ws.");
      updateAvailability();
      return;
    }
    const url = new URL("/ws", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url);
    socket = ws;
    updateAvailability();
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      lastReceivedAt = performance.now();
      showError("");
      connection("connecting", "Connected · awaiting simulator");
      send({ type: "stop" });
      if (!document.hidden) send({ type: "heartbeat" });
      updateAvailability();
    });
    ws.addEventListener("message", (event) => {
      if (socket !== ws) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        showError("The simulator sent invalid JSON. Controls were neutralized.");
        neutral("Invalid simulator message · neutral requested.");
        return;
      }
      if (message?.type === "error") {
        showError(typeof message.message === "string" ? message.message : "The simulator rejected a request.");
      } else if (validState(message)) {
        receiveState(message);
      } else {
        showError("The simulator sent an unsupported state. Check the frontend/backend contract.");
        neutral("Invalid simulator state · neutral requested.");
      }
    });
    ws.addEventListener("error", () => {
      if (socket === ws) connection("error", "WebSocket connection error");
    });
    ws.addEventListener("close", (event) => {
      if (socket !== ws) return;
      const wasStable = liveSince !== null && performance.now() - liveSince >= 10000;
      ready = false;
      neutralPending = true;
      socket = null;
      clearLocalControls();
      updateAvailability();
      text("mode", "OFFLINE");
      text("waypoint-status", "Disconnected · waypoint state is stale");
      text("scene-state", "DISCONNECTED · LAST STATE");
      $("chart-state").hidden = !latest;
      text("chart-state", "DISCONNECTED · LAST STATE");
      notice("Disconnected · local controls cleared. The backend lease stops thrust within 1 second. Reconnection starts neutral.");
      if (event.code === 1008) {
        policyBlocked = true;
        connection("error", "Helm already in use");
        showError("Helm already in use by another client (1008). Close the other helm, then reconnect here.");
        $("reconnect").hidden = false;
        return;
      }
      if (wasStable) retryCount = 0;
      if (retryCount < retryDelays.length) {
        const delay = retryDelays[retryCount++];
        connection("connecting", `Disconnected · retry ${retryCount}/${retryDelays.length} in ${delay / 1000}s`);
        retryTimer = setTimeout(connect, delay);
      } else {
        connection("error", "Disconnected · retries exhausted");
        showError("Could not reach the simulator. Check that the backend is running, then reconnect.");
        $("reconnect").hidden = false;
      }
    });
  }

  for (const [side, slider] of Object.entries(sliders)) {
    sliderLabel(side);
    slider.addEventListener("input", () => {
      if (!canControl()) { clearLocalControls(); return; }
      held.clear();
      sliderLabel(side);
      manual(Number(sliders.port.value) / 100, Number(sliders.starboard.value) / 100);
    });
    slider.addEventListener("blur", () => {
      if (latest && canControl()) setSliders(latest.command.port, latest.command.starboard);
    });
  }
  $("stop").addEventListener("click", () => neutral());
  $("reset").addEventListener("click", reset);
  $("pause").addEventListener("click", () => {
    if (canControl()) send({ type: "pause", paused: !latest.paused });
  });
  $("reconnect").addEventListener("click", () => {
    if (socket) return;
    policyBlocked = false;
    retryCount = 0;
    showError("");
    connect();
  });
  $("heading-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    held.clear();
    send({ type: "heading", heading_deg: Number($("target-heading").value), throttle: Number($("cruise-throttle").value) / 100 });
    notice("Demo heading hold requested · manual input or Neutral cancels it.");
  });
  $("current-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    send({ type: "current", east_mps: Number($("current-east").value), north_mps: Number($("current-north").value) });
  });

  function updateMountPreview() {
    if (!latest) return;
    const c = latest.config;
    const x = $("mount-x").valueAsNumber, spacing = $("mount-spacing").valueAsNumber;
    if (!finite(x) || !finite(spacing)) return;
    const scale = Math.min(45, 160 / c.length_m);
    const draftX = 140 + clamp(x, -c.length_m / 2, c.length_m / 2) * scale;
    const half = clamp(spacing / 2, .05, 2) * scale;
    $("mount-hull").setAttribute("rx", c.length_m * scale / 2);
    $("mount-hull").setAttribute("ry", c.width_m * scale / 2);
    for (const [id, sign] of [["port", -1], ["starboard", 1]]) {
      $("mount-" + id).setAttribute("x", draftX - 8);
      $("mount-" + id).setAttribute("y", 110 + sign * half - 4);
      $("mount-active-" + id).setAttribute("cx", 140 + c.thruster_x_m * scale);
      $("mount-active-" + id).setAttribute("cy", 110 + sign * c.thruster_arm_m * scale);
    }
    for (const [attribute, value] of Object.entries({x1:draftX, x2:draftX, y1:110-half, y2:110+half})) {
      $("mount-beam").setAttribute(attribute, value);
    }
  }
  $("mount-form").addEventListener("input", updateMountPreview);
  $("mount-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    const request = {type:"mounts", longitudinal_m:$("mount-x").valueAsNumber,
      half_spacing_m:$("mount-spacing").valueAsNumber / 2};
    neutral("Applying symmetric mounts · resetting the simulation.");
    send(request);
  });
  function validatePositive(input) {
    input.setCustomValidity(finite(input.valueAsNumber) && input.valueAsNumber > 0
      ? "" : "Enter a finite number greater than zero.");
  }
  $("motor-strength").addEventListener("input", () => validatePositive($("motor-strength")));
  $("motor-strength-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("motor-strength");
    validatePositive(input);
    const thrust = input.valueAsNumber * 4.4482216152605;
    if (!finite(thrust)) input.setCustomValidity("The converted thrust must be finite.");
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    showError("");
    neutral("Applying motor strength · autopilot cancelled; pose and sea state preserved.");
    send({type:"motor_strength", max_thrust_n:thrust});
  });
  $("wave-period").addEventListener("input", () => validatePositive($("wave-period")));
  $("waves-form").addEventListener("submit", (event) => {
    event.preventDefault();
    validatePositive($("wave-period"));
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    showError("");
    send({type:"waves", height_m:$("wave-height").valueAsNumber,
      period_s:$("wave-period").valueAsNumber, direction_deg:$("wave-direction").valueAsNumber});
  });
  $("calm-water").addEventListener("click", () => {
    if (!canControl()) return;
    $("wave-height").value = "0";
    showError("");
    send({type:"waves", height_m:0, period_s:latest.water.period_s, direction_deg:latest.water.direction_deg});
  });

  function draftWaypoint() {
    const east = $("waypoint-east").valueAsNumber;
    const north = $("waypoint-north").valueAsNumber;
    return finite(east) && finite(north) && Math.max(Math.abs(east), Math.abs(north)) <= 10000
      ? { east, north } : null;
  }

  function updateDraft() {
    const draft = draftWaypoint();
    text("waypoint-draft", draft
      ? `Draft: ${fixed(draft.east)} m east / ${fixed(draft.north)} m north · press Go to engage`
      : "Enter valid target coordinates (±10,000 m).");
  }
  $("waypoint-form").addEventListener("input", updateDraft);
  $("waypoint-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!canControl() || !event.currentTarget.reportValidity()) return;
    held.clear();
    const draft = draftWaypoint();
    if (!draft) return;
    send({ type: "waypoint", east_m: draft.east, north_m: draft.north,
      max_throttle: $("waypoint-throttle").valueAsNumber / 100,
      arrival_radius_m: $("waypoint-radius").valueAsNumber });
    notice("Waypoint requested · manual input or Neutral cancels navigation.");
  });
  canvas.addEventListener("click", (event) => {
    if (!canControl()) return;
    const rect = canvas.getBoundingClientRect();
    const east = camera.east + (event.clientX - rect.left - chartWidth / 2) / pixelsPerMeter;
    const north = camera.north - (event.clientY - rect.top - chartHeight / 2) / pixelsPerMeter;
    $("waypoint-east").value = fixed(clamp(east, -10000, 10000), 2);
    $("waypoint-north").value = fixed(clamp(north, -10000, 10000), 2);
    updateDraft();
    notice("Chart target drafted · press Go to waypoint to engage. Active navigation is unchanged.");
  });

  function editing(target) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));
  }

  function keyboardThrust() {
    const ahead = (held.has("w") ? .5 : 0) - (held.has("s") ? .5 : 0);
    const turn = (held.has("d") ? .5 : 0) - (held.has("a") ? .5 : 0);
    // Positive differential (port > starboard) turns clockwise in ENU.
    const port = clamp(ahead + turn + (held.has("q") ? .5 : 0), -1, 1);
    const starboard = clamp(ahead - turn + (held.has("e") ? .5 : 0), -1, 1);
    setSliders(port, starboard, true);
    manual(port, starboard);
  }

  document.addEventListener("keydown", (event) => {
    if (editing(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key === " ") {
      event.preventDefault();
      if (!event.repeat) neutral();
    } else if (key === "r") {
      event.preventDefault();
      if (!event.repeat) reset();
    } else if (steeringKeys.has(key) && canControl()) {
      event.preventDefault();
      if (event.repeat || held.has(key)) return;
      held.add(key);
      keyboardThrust();
    }
  });
  document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (!held.delete(key)) return;
    if (editing(event.target)) { neutral("Keyboard thrust released · drives neutral."); return; }
    event.preventDefault();
    if (canControl()) keyboardThrust();
    else clearLocalControls();
  });
  document.addEventListener("focusin", (event) => {
    if (editing(event.target) && held.size) neutral("Editing controls · keyboard thrust stopped.");
  });
  window.addEventListener("blur", () => neutral("Window inactive · drives neutral, held keys cleared."));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) neutral("Tab hidden · drives neutral, held keys cleared.");
    else {
      if (isOpen()) {
        neutral("Welcome back · apply a new command to get underway.");
        send({ type: "heartbeat" });
      }
      updateAvailability();
    }
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(retryTimer);
    neutral("");
    // Suppress retries while the page is being discarded or enters the back/forward cache.
    const closing = socket;
    socket = null;
    ready = false;
    if (closing) closing.close(1000, "Helm page left");
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted && !socket && !policyBlocked) connect();
  });

  setInterval(() => {
    if (document.hidden) return;
    if (isOpen()) {
      if (performance.now() - lastReceivedAt > 3500) {
        showError("Simulator state stream stalled. Controls cleared; reconnecting without restoring thrust.");
        neutral("State stream stalled · neutral requested.");
        ready = false;
        updateAvailability();
        socket.close(4000, "State stream stalled");
        return;
      }
      send({ type: "heartbeat" });
    } else if (socket?.readyState === WebSocket.CONNECTING && performance.now() - lastReceivedAt > 8000) {
      socket.close();
    }
  }, 250);

  $("follow").addEventListener("click", () => {
    follow = !follow;
    $("follow").setAttribute("aria-pressed", String(follow));
    $("follow").classList.toggle("active", follow);
  });
  $("home-view").addEventListener("click", () => {
    follow = false;
    camera = { east: 0, north: 0 };
    $("follow").setAttribute("aria-pressed", "false");
    $("follow").classList.remove("active");
  });
  function zoom(factor) {
    pixelsPerMeter = clamp(pixelsPerMeter * factor, 2, 90);
    $("zoom-out").disabled = pixelsPerMeter <= 2;
    $("zoom-in").disabled = pixelsPerMeter >= 90;
  }
  $("zoom-in").addEventListener("click", () => zoom(1.3));
  $("zoom-out").addEventListener("click", () => zoom(1 / 1.3));

  function resize() {
    const rect = canvas.getBoundingClientRect();
    chartWidth = rect.width;
    chartHeight = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(chartWidth * dpr);
    canvas.height = Math.round(chartHeight * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe($("chart-stage"));
  window.addEventListener("resize", resize);
  resize();

  const screen = (east, north) => ({ x: chartWidth / 2 + (east - camera.east) * pixelsPerMeter, y: chartHeight / 2 - (north - camera.north) * pixelsPerMeter });

  function line(x1, y1, x2, y2, color, width = 1) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function grid() {
    const targetMeters = 65 / pixelsPerMeter;
    const decade = 10 ** Math.floor(Math.log10(targetMeters));
    const spacing = [1, 2, 5, 10].map((value) => value * decade).find((value) => value >= targetMeters);
    const left = camera.east - chartWidth / (2 * pixelsPerMeter);
    const right = camera.east + chartWidth / (2 * pixelsPerMeter);
    const bottom = camera.north - chartHeight / (2 * pixelsPerMeter);
    const top = camera.north + chartHeight / (2 * pixelsPerMeter);
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = "#789399";
    ctx.textAlign = "left";
    for (let i = Math.ceil(left / spacing); i <= Math.floor(right / spacing); i++) {
      const east = i * spacing;
      const x = screen(east, 0).x;
      line(x, 0, x, chartHeight, i === 0 ? "#35515b" : "#203b45", i === 0 ? 1.2 : .6);
      ctx.fillText(`${fixed(east, spacing < 1 ? 1 : 0)} E`, x + 5, chartHeight - 68);
    }
    for (let i = Math.ceil(bottom / spacing); i <= Math.floor(top / spacing); i++) {
      const north = i * spacing;
      const y = screen(0, north).y;
      line(0, y, chartWidth, y, i === 0 ? "#35515b" : "#203b45", i === 0 ? 1.2 : .6);
      if (y > 28 && y < chartHeight - 75) ctx.fillText(`${fixed(north, spacing < 1 ? 1 : 0)} N`, 9, y - 5);
    }
    text("grid-label", `${spacing} m grid`);
  }

  function compass() {
    const x = chartWidth - 52;
    const y = 56;
    ctx.beginPath();
    ctx.arc(x, y, 28, 0, 2 * Math.PI);
    ctx.fillStyle = "#112830e8";
    ctx.fill();
    ctx.strokeStyle = "#49636b";
    ctx.lineWidth = 1;
    ctx.stroke();
    line(x, y - 19, x, y + 19, "#647e84");
    line(x - 19, y, x + 19, y, "#647e84");
    ctx.beginPath();
    ctx.moveTo(x, y - 21);
    ctx.lineTo(x - 5, y - 5);
    ctx.lineTo(x + 5, y - 5);
    ctx.closePath();
    ctx.fillStyle = "#73d7c2";
    ctx.fill();
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = "#eeeadd";
    ctx.fillText("N", x, y - 35);
    ctx.fillStyle = "#a5b6b7";
    ctx.fillText("E", x + 37, y + 3);
    ctx.fillText("W", x - 37, y + 3);
    ctx.fillText("S", x, y + 42);
  }

  function home() {
    const point = screen(0, 0);
    ctx.strokeStyle = "#f6a08a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, 2 * Math.PI);
    ctx.stroke();
    line(point.x - 11, point.y, point.x + 11, point.y, "#f6a08a88");
    line(point.x, point.y - 11, point.x, point.y + 11, "#f6a08a88");
    ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    ctx.fillStyle = "#f6b8a7";
    ctx.fillText("HOME", point.x + 14, point.y + 4);
  }

  function waypoints() {
    const draft = draftWaypoint();
    const active = latest.mode === "waypoint" ? latest.waypoint : null;
    ctx.save();
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = "left";
    if (active) {
      const point = screen(active.east_m, active.north_m);
      const boat = screen(latest.navigation.east_m, latest.navigation.north_m);
      ctx.setLineDash([5, 5]);
      line(boat.x, boat.y, point.x, point.y, "#eddbb6", 1);
      ctx.setLineDash([]);
      ctx.strokeStyle = "#eddbb6";
      ctx.beginPath();
      ctx.arc(point.x, point.y, active.arrival_radius_m * pixelsPerMeter, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#eddbb6";
      ctx.fillRect(point.x - 4, point.y - 4, 8, 8);
      ctx.fillText(active.status === "arrived" ? "ARRIVED" : "ACTIVE TARGET", point.x + 10, point.y - 10);
    }
    if (draft && (!active || Math.hypot(draft.east - active.east_m, draft.north - active.north_m) > .01)) {
      const point = screen(draft.east, draft.north);
      line(point.x - 6, point.y - 6, point.x + 6, point.y + 6, "#a5b6b7");
      line(point.x - 6, point.y + 6, point.x + 6, point.y - 6, "#a5b6b7");
      ctx.fillStyle = "#a5b6b7";
      ctx.fillText("DRAFT · NOT ENGAGED", point.x + 10, point.y - 10);
    }
    ctx.restore();
  }

  function board() {
    const state = latest;
    const point = screen(state.truth.east_m, state.truth.north_m);
    // Local canvas bow is -Y and port is -X. Positive canvas rotation is clockwise.
    const heading = wrap(state.truth.heading_deg) * Math.PI / 180;
    const length = state.config.length_m * pixelsPerMeter;
    const width = state.config.width_m * pixelsPerMeter;
    const arm = state.config.thruster_arm_m * pixelsPerMeter;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(heading);
    ctx.setLineDash([5, 6]);
    line(0, -length * .5, 0, -length * .5 - 75, "#73d7c288");
    ctx.setLineDash([]);
    ctx.fillStyle = "#73d7c2";
    ctx.beginPath();
    ctx.moveTo(0, -length * .5 - 78);
    ctx.lineTo(-3, -length * .5 - 70);
    ctx.lineTo(3, -length * .5 - 70);
    ctx.closePath();
    ctx.fill();

    for (const [side, x, color] of [["port", -arm, "#f6a08a"], ["starboard", arm, "#73d7c2"]]) {
      const y = -state.config.thruster_x_m * pixelsPerMeter;
      line(0, y, x, y, "#91a4a3", 3);
      const thrust = state.thrust_n[side] / state.config.max_thrust_n;
      if (Math.abs(thrust) > .005) {
        // The plume points opposite the force, including when the drive reverses.
        const end = y + Math.sign(thrust) * (12 + Math.min(Math.abs(thrust), 1) * 32);
        ctx.globalAlpha = .55;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - 3, y);
        ctx.lineTo(x + 3, y);
        ctx.lineTo(x + 6, end);
        ctx.lineTo(x - 6, end);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#10252c";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(3, pixelsPerMeter * .09), Math.max(5, pixelsPerMeter * .19), 0, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(0, -length * .5);
    ctx.bezierCurveTo(width * .36, -length * .43, width * .52, -length * .12, width * .5, length * .25);
    ctx.quadraticCurveTo(width * .48, length * .49, width * .25, length * .5);
    ctx.lineTo(-width * .25, length * .5);
    ctx.quadraticCurveTo(-width * .48, length * .49, -width * .5, length * .25);
    ctx.bezierCurveTo(-width * .52, -length * .12, -width * .36, -length * .43, 0, -length * .5);
    ctx.closePath();
    ctx.fillStyle = "#e8e4d4";
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#93c6be";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#234a51";
    ctx.fillRect(-width * .28, -length * .13, width * .56, length * .43);
    line(0, -length * .39, 0, -length * .19, "#234a51", Math.max(1.5, width * .1));
    line(-width * .3, length * .38, width * .3, length * .38, "#f6a08a", 2);
    ctx.restore();

    // Screen-space side labels remain legible at every heading and zoom.
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    for (const [label, direction, color] of [["P", -1, "#f6a08a"], ["S", 1, "#73d7c2"]]) {
      const x = direction * (Math.max(arm, width / 2) + 13);
      const y = -state.config.thruster_x_m * pixelsPerMeter;
      ctx.fillStyle = color;
      ctx.fillText(label, point.x + x * Math.cos(heading) - y * Math.sin(heading), point.y + x * Math.sin(heading) + y * Math.cos(heading) + 3);
    }
  }

  function draw() {
    if (!document.hidden && scene) {
      try { scene.render(); } catch (error) {
        $("scene-help").textContent = "3D view stopped: " + error.message;
        scene = null;
      }
    }
    if (!document.hidden && ctx) {
      if (follow && latest) camera = { east: latest.truth.east_m, north: latest.truth.north_m };
      ctx.clearRect(0, 0, chartWidth, chartHeight);
      const water = ctx.createRadialGradient(chartWidth * .48, chartHeight * .45, 0, chartWidth * .48, chartHeight * .45, Math.max(chartWidth, chartHeight));
      water.addColorStop(0, "#153640");
      water.addColorStop(1, "#0a1b23");
      ctx.fillStyle = water;
      ctx.fillRect(0, 0, chartWidth, chartHeight);
      grid();
      if (latest) {
        if (trail.length > 1) {
          ctx.beginPath();
          trail.forEach((entry, index) => {
            const point = screen(entry.east, entry.north);
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
          });
          ctx.strokeStyle = "#73d7c280";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
        home();
        waypoints();
        board();
      }
      compass();
    }
    requestAnimationFrame(draw);
  }

  if (!ctx) showError("This browser cannot create a 2D canvas. Telemetry and helm controls remain available.");
  requestAnimationFrame(draw);
  connect();
})();
