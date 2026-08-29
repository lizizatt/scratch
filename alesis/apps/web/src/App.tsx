import { useEffect, useState, type ChangeEvent } from "react";
import {
  Download,
  Headphones,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Settings,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { EngineCommand, EngineSnapshot, Settings as EngineSettings, Take } from "@alesis/protocol";
import { useControlSocket } from "./use-control-socket";

type Pane = "settings" | "synth" | "loops";

export function App() {
  const { snapshot, connection, lastError, send } = useControlSocket();
  const [pane, setPane] = useState<Pane>("loops");

  if (!snapshot) {
    return <main className="boot"><span className={`connection-dot ${connection}`} /> CONNECTING TO HOST ENGINE</main>;
  }

  return (
    <main className="app-shell">
      <div className="connection-line"><span className={`connection-dot ${connection}`} /> {connection} // rev {snapshot.revision} // MIDI {snapshot.engine.midiEventsReceived}{snapshot.engine.lastMidiEvent ? ` ${snapshot.engine.lastMidiEvent}` : ""}</div>
      {lastError && <div className="error-line" role="alert">{lastError}</div>}
      {pane === "settings" && <SettingsPane snapshot={snapshot} send={send} />}
      {pane === "synth" && <SynthPane snapshot={snapshot} send={send} />}
      {pane === "loops" && <LoopPane snapshot={snapshot} send={send} />}
      <nav className="app-nav" aria-label="Application sections">
        <NavButton active={pane === "settings"} label="Options" onClick={() => setPane("settings")}><Settings /></NavButton>
        <NavButton active={pane === "synth"} label="Synth" onClick={() => setPane("synth")}><Music2 /></NavButton>
        <NavButton active={pane === "loops"} label="Loops" onClick={() => setPane("loops")}><Repeat2 /></NavButton>
      </nav>
    </main>
  );
}

function SettingsPane({ snapshot, send }: PaneProps) {
  const [draft, setDraft] = useState(snapshot.settings);
  const [numberDraft, setNumberDraft] = useState(() => numberDraftFrom(snapshot.settings));
  useEffect(() => setDraft(snapshot.settings), [
    snapshot.settings.bpm,
    snapshot.settings.beatsPerMeasure,
    snapshot.settings.loopMeasures,
    snapshot.settings.midiInputId,
    snapshot.settings.audioOutputId,
    snapshot.settings.metronomeEnabled,
    snapshot.settings.metronomeVolume,
    snapshot.settings.countInEnabled,
  ]);
  useEffect(() => setNumberDraft(numberDraftFrom(snapshot.settings)), [
    snapshot.settings.bpm,
    snapshot.settings.beatsPerMeasure,
    snapshot.settings.loopMeasures,
    snapshot.settings.metronomeVolume,
  ]);

  const setNumber = (field: NumberField) => (event: ChangeEvent<HTMLInputElement>) => {
    setNumberDraft((current) => ({ ...current, [field]: event.target.value }));
  };
  const commitNumber = (field: NumberField, scale = 1) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value) * scale;
    if (event.target.value.trim() === "" || !event.target.validity.valid || !Number.isFinite(value)) {
      setNumberDraft((current) => ({ ...current, [field]: displayNumber(snapshot.settings[field], scale) }));
      return;
    }
    if (value === snapshot.settings[field]) return;
    const timingChange = field === "bpm" || field === "beatsPerMeasure" || field === "loopMeasures";
    const hasAudio = snapshot.promoted.length > 0 || snapshot.capture.staged !== null;
    if (timingChange && hasAudio && !confirm("Changing timing clears all recorded audio. Continue?")) {
      setDraft(snapshot.settings);
      return;
    }
    send({ type: "configure", settings: { [field]: value }, clearAudio: timingChange && hasAudio });
  };
  const commitOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };
  const updateBoolean = (field: "metronomeEnabled" | "countInEnabled") => (event: ChangeEvent<HTMLInputElement>) => {
    const checked = event.target.checked;
    setDraft((current) => ({ ...current, [field]: checked }));
    send({ type: "configure", settings: { [field]: checked } });
  };
  const updateDevice = (field: "midiInputId" | "audioOutputId") => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setDraft((current) => ({ ...current, [field]: value }));
    send({ type: "configure", settings: { [field]: value } });
  };

  return (
    <section className="pane settings-pane" aria-label="Options">
      <div className="settings-list">
        <Setting label="BPM"><input aria-label="BPM" type="number" min="30" max="300" value={numberDraft.bpm} onChange={setNumber("bpm")} onBlur={commitNumber("bpm")} onKeyDown={commitOnEnter} /></Setting>
        <Setting label="Beats per measure"><input aria-label="Beats per measure" type="number" min="1" max="16" value={numberDraft.beatsPerMeasure} onChange={setNumber("beatsPerMeasure")} onBlur={commitNumber("beatsPerMeasure")} onKeyDown={commitOnEnter} /></Setting>
        <Setting label="Loop measures"><input aria-label="Loop measures" type="number" min="1" max="128" value={numberDraft.loopMeasures} onChange={setNumber("loopMeasures")} onBlur={commitNumber("loopMeasures")} onKeyDown={commitOnEnter} /></Setting>
        <Setting label="Input device"><select aria-label="Input device" value={draft.midiInputId} onChange={updateDevice("midiInputId")}><option value={draft.midiInputId}>{draft.midiInputId.startsWith("alsa:") ? "Vortex Wireless 2" : "Software Vortex"}</option></select></Setting>
        <Setting label="Output device"><select aria-label="Output device" value={draft.audioOutputId} onChange={updateDevice("audioOutputId")}><option value={draft.audioOutputId}>{draft.audioOutputId.startsWith("pulse:") ? "System Speakers" : "Simulated output"}</option></select></Setting>
        <Setting label="Metronome"><input aria-label="Metronome" type="checkbox" checked={draft.metronomeEnabled} onChange={updateBoolean("metronomeEnabled")} /></Setting>
        <Setting label="Click volume"><input aria-label="Click volume" type="range" min="0" max="100" value={numberDraft.metronomeVolume} onChange={setNumber("metronomeVolume")} onBlur={commitNumber("metronomeVolume", 0.01)} /></Setting>
        <Setting label="Count-in"><input aria-label="Count-in" type="checkbox" checked={draft.countInEnabled} onChange={updateBoolean("countInEnabled")} /></Setting>
      </div>
    </section>
  );
}

function SynthPane({ snapshot, send }: PaneProps) {
  return (
    <section className="pane synth-pane" aria-label="Synth controls">
      <select className="synth-select" aria-label="Synthesizer" value={snapshot.synth.selectedId} onChange={(event) => send({ type: "select-synth", synthId: event.target.value })}>
        {snapshot.synth.available.map((synth) => <option key={synth.id} value={synth.id}>{synth.name}</option>)}
      </select>
      <section className="synth-module" aria-label="Synth parameter module">
        {snapshot.synth.parameters.map((parameter) => (
          <label className="parameter" key={parameter.id}>
            <span>{parameter.label}</span>
            <input type="range" min={parameter.minimum} max={parameter.maximum} step={(parameter.maximum - parameter.minimum) / 200} value={parameter.value} onChange={(event) => send({ type: "set-synth-parameter", parameterId: parameter.id, value: Number(event.target.value) })} />
            <output>{formatParameter(parameter.value, parameter.unit)}</output>
          </label>
        ))}
      </section>
    </section>
  );
}

function LoopPane({ snapshot, send }: PaneProps) {
  const isPlaying = snapshot.transport.state !== "stopped";
  const beatCount = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  return (
    <section className="pane loop-pane" aria-label="Looper">
      <header className="loop-toolbar">
        <div className="transport-controls">
          <IconButton label="Stop" onClick={() => send({ type: "stop" })}><Square /></IconButton>
          <IconButton label={isPlaying ? "Pause unavailable; stop transport" : "Play"} active={isPlaying} onClick={() => send({ type: "play" })}>{isPlaying ? <Pause /> : <Play />}</IconButton>
          <IconButton label="Monitor only" active={snapshot.monitorOnly} pressed={snapshot.monitorOnly} onClick={() => send({ type: "set-monitor-only", enabled: !snapshot.monitorOnly })}><Headphones /></IconButton>
          <IconButton label={snapshot.settings.metronomeEnabled ? "Mute metronome" : "Unmute metronome"} active={snapshot.settings.metronomeEnabled} pressed={snapshot.settings.metronomeEnabled} onClick={() => send({ type: "configure", settings: { metronomeEnabled: !snapshot.settings.metronomeEnabled } })}>{snapshot.settings.metronomeEnabled ? <Volume2 /> : <VolumeX />}</IconButton>
        </div>
        <div className="transport-status">{snapshot.transport.state} // cycle {String(snapshot.transport.cycle + 1).padStart(2, "0")}</div>
        <IconButton label="Download promoted mix as MP3" onClick={() => send({ type: "export-mp3" })}><Download /></IconButton>
      </header>

      <div className="signal-stack">
        <section className="current-capture">
          <span className="lane-label">Current capture // live</span>
          <Waveform samples={snapshot.capture.currentWaveform} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} live progress={snapshot.transport.progress} />
        </section>
        <section className="staged-capture">
          <Waveform samples={snapshot.capture.staged?.waveform ?? []} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} emptyLabel="Waiting for rollover" />
          <div className="take-actions">
            <IconButton label="Promote staged take" disabled={!snapshot.capture.staged} onClick={() => send({ type: "promote-staged" })}><Plus /></IconButton>
            <IconButton label={snapshot.capture.stagedAudible ? "Mute staged take" : "Unmute staged take"} active={snapshot.capture.stagedAudible} pressed={snapshot.capture.stagedAudible} onClick={() => send({ type: "set-staged-audible", audible: !snapshot.capture.stagedAudible })}>{snapshot.capture.stagedAudible ? <Volume2 /> : <VolumeX />}</IconButton>
          </div>
        </section>
        <div className="divider" />
        <section className="promoted-list" aria-label="Promoted takes">
          {snapshot.promoted.length === 0 && <div className="empty-list">PROMOTED TAKES APPEAR HERE</div>}
          {snapshot.promoted.map((take, index) => <TakeRow key={take.id} take={take} index={index} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} send={send} />)}
        </section>
      </div>
      {snapshot.canUndoDelete && <button className="undo-button" type="button" onClick={() => send({ type: "undo-delete" })}><RotateCcw /> Undo delete</button>}
    </section>
  );
}

function TakeRow({ take, index, beatCount, beatsPerMeasure, send }: { take: Take; index: number; beatCount: number; beatsPerMeasure: number; send: SendCommand }) {
  return (
    <article className="take-row">
      <span className="take-number">{String(index + 1).padStart(2, "0")}</span>
      <Waveform samples={take.waveform} beatCount={beatCount} beatsPerMeasure={beatsPerMeasure} />
      <label className="level-control">LEVEL<input aria-label={`Level take ${index + 1}`} type="range" min="0" max="100" value={take.level * 100} onChange={(event) => send({ type: "set-take-level", takeId: take.id, level: Number(event.target.value) / 100 })} /></label>
      <IconButton label={take.muted ? `Unmute take ${index + 1}` : `Mute take ${index + 1}`} active={!take.muted} pressed={!take.muted} onClick={() => send({ type: "set-take-muted", takeId: take.id, muted: !take.muted })}>{take.muted ? <VolumeX /> : <Volume2 />}</IconButton>
      <IconButton label={`Delete take ${index + 1}`} danger onClick={() => send({ type: "delete-take", takeId: take.id })}><Trash2 /></IconButton>
    </article>
  );
}

function Waveform({ samples, beatCount, beatsPerMeasure, live = false, progress, emptyLabel }: { samples: number[]; beatCount: number; beatsPerMeasure: number; live?: boolean; progress?: number; emptyLabel?: string }) {
  const amplitudes = samples.map((sample) => Math.abs(sample));
  return (
    <div className={`waveform ${live ? "live" : ""}`}>
      <div className="beat-grid" aria-hidden="true">
        {Array.from({ length: Math.max(0, beatCount - 1) }, (_, index) => <i key={index} className={(index + 1) % beatsPerMeasure === 0 ? "measure" : ""} style={{ left: `${(index + 1) / beatCount * 100}%` }} />)}
      </div>
      {samples.length > 0 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{amplitudes.map((sample, index) => {
        const x = amplitudes.length === 1 ? 50 : index / (amplitudes.length - 1) * 100;
        return <line className="intensity-sample" key={index} x1={x} x2={x} y1={50 - sample * 44} y2={50 + sample * 44} />;
      })}</svg> : <span>{emptyLabel}</span>}
      {progress !== undefined && <i className="playhead" style={{ left: `${progress * 100}%` }} />}
    </div>
  );
}

function Setting({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="setting"><span>{label}</span>{children}</label>;
}

function NavButton({ active, label, onClick, children }: ButtonProps) {
  return <button className={active ? "active" : ""} type="button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function IconButton({ active, pressed, danger, disabled, label, onClick, children }: ButtonProps & { pressed?: boolean; danger?: boolean; disabled?: boolean }) {
  return <button className={`icon-button ${active ? "active" : ""} ${danger ? "danger" : ""}`} type="button" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{children}</button>;
}

function formatParameter(value: number, unit: string): string {
  if (unit === "%") return `${Math.round(value * 100)}%`;
  return `${Number(value.toFixed(2))}${unit ? ` ${unit}` : ""}`;
}

type NumberField = "bpm" | "beatsPerMeasure" | "loopMeasures" | "metronomeVolume";
type NumberDraft = Record<NumberField, string>;

function numberDraftFrom(settings: EngineSettings): NumberDraft {
  return {
    bpm: displayNumber(settings.bpm),
    beatsPerMeasure: displayNumber(settings.beatsPerMeasure),
    loopMeasures: displayNumber(settings.loopMeasures),
    metronomeVolume: displayNumber(settings.metronomeVolume, 0.01),
  };
}

function displayNumber(value: number, scale = 1): string {
  return String(value / scale);
}

type SendCommand = (command: EngineCommand) => string | null;
interface PaneProps { snapshot: EngineSnapshot; send: SendCommand }
interface ButtonProps { active?: boolean; label: string; onClick: () => void; children: React.ReactNode }
