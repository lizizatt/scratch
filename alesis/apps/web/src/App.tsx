import { useEffect, useState, type ChangeEvent } from "react";
import {
  Download,
  Drum,
  Headphones,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
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

type Pane = "settings" | "synth" | "pads" | "loops";

export function App() {
  const { snapshot, readiness, connection, lastError, lastMessage, send } = useControlSocket();
  const [pane, setPane] = useState<Pane>("loops");

  if (!snapshot) {
    return <main className="boot"><span className={`connection-dot ${connection}`} /> CONNECTING TO HOST ENGINE</main>;
  }
  const failures = readiness
    ? Object.entries(readiness).filter(([, dependency]) => !dependency.ready)
    : [];

  return (
    <main className="app-shell">
      <div className="connection-line"><span className={`connection-dot ${connection}`} /> {connection} // rev {snapshot.revision} // MIDI {snapshot.engine.midiEventsReceived}{snapshot.engine.lastMidiEvent ? ` ${snapshot.engine.lastMidiEvent}` : ""}</div>
      {failures.length > 0 && <div className="readiness-line" role="alert"><strong>NOT READY</strong>{failures.map(([name, dependency]) => <span key={name}>{name}: {dependency.reason ?? "Unavailable"}</span>)}</div>}
      {lastError && <div className="error-line" role="alert">{lastError}</div>}
      {lastMessage && <div className="success-line" role="status">{lastMessage}</div>}
      {pane === "settings" && <SettingsPane snapshot={snapshot} send={send} />}
      {pane === "synth" && <SynthPane snapshot={snapshot} send={send} />}
      {pane === "pads" && <PadsPane snapshot={snapshot} send={send} />}
      {pane === "loops" && <LoopPane snapshot={snapshot} send={send} />}
      <nav className="app-nav" aria-label="Application sections">
        <NavButton active={pane === "settings"} label="Options" onClick={() => setPane("settings")}><Settings /></NavButton>
        <NavButton active={pane === "synth"} label="Synth" onClick={() => setPane("synth")}><Music2 /></NavButton>
        <NavButton active={pane === "pads"} label="Pads" onClick={() => setPane("pads")}><Drum /></NavButton>
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
    snapshot.settings.velocityCurve,
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
    const hasAudio = snapshot.capture.hasCurrentEvents || snapshot.promoted.length > 0 || snapshot.capture.staged !== null || snapshot.capture.previousStaged !== null;
    if (timingChange && hasAudio && !confirm("Changing timing clears all recorded audio. Continue?")) {
      setNumberDraft(numberDraftFrom(snapshot.settings));
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
  const updateSelection = (field: "midiInputId" | "audioOutputId" | "velocityCurve") => (event: ChangeEvent<HTMLSelectElement>) => {
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
        <Setting label="Input device"><select aria-label="Input device" value={draft.midiInputId} onChange={updateSelection("midiInputId")}><option value={draft.midiInputId}>{draft.midiInputId.startsWith("alsa") ? "Vortex Wireless 2" : "Software Vortex"}</option></select></Setting>
        <Setting label="Output device"><select aria-label="Output device" value={draft.audioOutputId} onChange={updateSelection("audioOutputId")}><option value={draft.audioOutputId}>{draft.audioOutputId.startsWith("alsa:") ? "CM108 USB audio" : "Simulated output"}</option></select></Setting>
        <Setting label="Key response"><select aria-label="Key response" value={draft.velocityCurve} onChange={updateSelection("velocityCurve")}><option value="linear">Linear</option><option value="responsive">Responsive</option><option value="strong">Strong</option><option value="fixed">Fixed 127</option></select></Setting>
        <Setting label="Metronome"><input aria-label="Metronome" type="checkbox" checked={draft.metronomeEnabled} onChange={updateBoolean("metronomeEnabled")} /></Setting>
        <Setting label="Click volume"><input aria-label="Click volume" type="range" min="0" max="100" value={numberDraft.metronomeVolume} onChange={setNumber("metronomeVolume")} onBlur={commitNumber("metronomeVolume", 0.01)} /></Setting>
        <Setting label="Count-in"><input aria-label="Count-in" type="checkbox" checked={draft.countInEnabled} onChange={updateBoolean("countInEnabled")} /></Setting>
      </div>
    </section>
  );
}

function SynthPane({ snapshot, send }: PaneProps) {
  const instrument = snapshot.synth.instruments.find(({ id }) => id === snapshot.synth.selectedId)!;
  const primaryControls = instrument.controls.filter(({ advanced, group }) => !advanced && group !== "effects");
  const reverbControls = instrument.controls.filter(({ id }) => id.startsWith("reverb-"));
  const renderControl = (control: typeof instrument.controls[number]) => (
    <label className={`parameter parameter-${control.group}`} key={control.id}>
      <span>{control.label}</span>
      <input type="range" min={control.minimum} max={control.maximum} step={control.step} value={snapshot.synth.parameterValues[control.id]!} onChange={(event) => send({ type: "set-synth-parameter", parameterId: control.id, value: Number(event.target.value) })} />
      <output>{formatParameter(snapshot.synth.parameterValues[control.id]!, control.unit)}</output>
    </label>
  );
  const renderEffect = (name: string, controls: typeof instrument.controls) => {
    const mix = controls.find(({ advanced }) => !advanced);
    if (!mix) return null;
    const value = snapshot.synth.parameterValues[mix.id]!;
    const advancedControls = controls.filter(({ advanced }) => advanced);
    return (
      <section className="effect-module" aria-label={`${name} effect`} key={name}>
        <div className="effect-heading">
          <h2>{name}</h2>
          <label className="effect-toggle">On<input aria-label={`${name} enabled`} type="checkbox" checked={value > 0} onChange={(event) => send({ type: "set-synth-parameter", parameterId: mix.id, value: event.target.checked ? mix.defaultValue : 0 })} /></label>
        </div>
        <label className="effect-mix">
          <span>Mix</span>
          <input aria-label={`${name} mix`} type="range" min={mix.minimum} max={mix.maximum} step={mix.step} value={value} onChange={(event) => send({ type: "set-synth-parameter", parameterId: mix.id, value: Number(event.target.value) })} />
          <output>{formatParameter(value, mix.unit)}</output>
        </label>
        {advancedControls.length > 0 && <details className="effect-advanced">
          <summary>Shape</summary>
          <div className="effects-controls">{advancedControls.map(renderControl)}</div>
        </details>}
      </section>
    );
  };
  return (
    <section className="pane synth-pane" aria-label="Synth controls">
      <div className="synth-selectors">
        <select className="synth-select" aria-label="Synthesizer" value={snapshot.synth.selectedId} onChange={(event) => send({ type: "select-synth", synthId: event.target.value })}>
          {snapshot.synth.instruments.map((synth) => <option key={synth.id} value={synth.id}>{synth.name}</option>)}
        </select>
        {snapshot.synth.selectedId === "soundfont" && <div className="soundfont-picker">
          <select className="soundfont-select" aria-label="SoundFont" value={snapshot.synth.selectedSoundFontId ?? ""} disabled={snapshot.synth.soundFonts.length === 0} onChange={(event) => send({ type: "select-soundfont", soundFontId: event.target.value })}>
            {snapshot.synth.soundFonts.length === 0 && <option value="">No SoundFonts found</option>}
            {snapshot.synth.soundFonts.map((soundFont) => <option key={soundFont.id} value={soundFont.id}>{soundFont.name}</option>)}
          </select>
          <IconButton label="Refresh SoundFonts" onClick={() => send({ type: "refresh-soundfonts" })}><RefreshCw /></IconButton>
        </div>}
        {snapshot.synth.selectedId === "soundfont" && <select className="soundfont-preset-select" aria-label="SoundFont preset" value={snapshot.synth.selectedSoundFontPresetId ?? ""} disabled={snapshot.synth.soundFontPresets.length === 0} onChange={(event) => send({ type: "select-soundfont-preset", presetId: event.target.value })}>
          {snapshot.synth.soundFontPresets.length === 0 && <option value="">No presets found</option>}
          {snapshot.synth.soundFontPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>}
      </div>
      <section className="synth-module" aria-label="Synth parameter module">
        {primaryControls.map(renderControl)}
        {snapshot.synth.selectedId === "soundfont" && <div className="effects-rack">
          {renderEffect("Reverb", reverbControls)}
        </div>}
      </section>
      <details className="midi-effect arpeggiator-controls">
        <summary>Arpeggiator</summary>
        <div className="midi-effect-grid">
          <label>Enabled<input aria-label="Arpeggiator enabled" type="checkbox" checked={snapshot.arpeggiator.enabled} onChange={(event) => send({ type: "configure-arpeggiator", settings: { enabled: event.target.checked } })} /></label>
          <label>Mode<select aria-label="Arpeggiator mode" value={snapshot.arpeggiator.mode} onChange={(event) => send({ type: "configure-arpeggiator", settings: { mode: event.target.value as EngineSnapshot["arpeggiator"]["mode"] } })}>{["up", "down", "up-down", "up-to-root-then-down", "played", "random"].map((mode) => <option key={mode} value={mode}>{mode}</option>)}</select></label>
          <label>Rate<select aria-label="Arpeggiator rate" value={snapshot.arpeggiator.rate} onChange={(event) => send({ type: "configure-arpeggiator", settings: { rate: event.target.value as EngineSnapshot["arpeggiator"]["rate"] } })}>{["1/4", "1/8", "1/16", "1/8T", "1/16T"].map((rate) => <option key={rate} value={rate}>{rate}</option>)}</select></label>
          <label>Octaves<input aria-label="Arpeggiator octaves" type="number" min="1" max="4" value={snapshot.arpeggiator.octaves} onChange={(event) => send({ type: "configure-arpeggiator", settings: { octaves: Number(event.target.value) } })} /></label>
          <label>Gate<input aria-label="Arpeggiator gate" type="range" min="10" max="100" value={snapshot.arpeggiator.gate * 100} onChange={(event) => send({ type: "configure-arpeggiator", settings: { gate: Number(event.target.value) / 100 } })} /></label>
          <label>Swing<input aria-label="Arpeggiator swing" type="range" min="0" max="50" value={snapshot.arpeggiator.swing * 100} onChange={(event) => send({ type: "configure-arpeggiator", settings: { swing: Number(event.target.value) / 100 } })} /></label>
          <label>Latch<input aria-label="Arpeggiator latch" type="checkbox" checked={snapshot.arpeggiator.latch} onChange={(event) => send({ type: "configure-arpeggiator", settings: { latch: event.target.checked } })} /></label>
        </div>
      </details>
      <details className="midi-effect drum-controls">
        <summary>Drums</summary>
        <div className="midi-effect-grid drum-effect-grid">
          <label>Enabled<input aria-label="Drums enabled" type="checkbox" checked={snapshot.drums.enabled} onChange={(event) => send({ type: "configure-drums", settings: { enabled: event.target.checked } })} /></label>
          <label>Pattern<select aria-label="Drum pattern" value={snapshot.drums.pattern} onChange={(event) => send({ type: "configure-drums", settings: { pattern: event.target.value as EngineSnapshot["drums"]["pattern"] } })}>{["four-on-floor", "backbeat", "breakbeat"].map((pattern) => <option key={pattern} value={pattern}>{pattern}</option>)}</select></label>
          <label>Volume<input aria-label="Drum volume" type="range" min="0" max="100" value={snapshot.drums.volume * 100} onChange={(event) => send({ type: "configure-drums", settings: { volume: Number(event.target.value) / 100 } })} /></label>
        </div>
      </details>
    </section>
  );
}

function PadsPane({ snapshot, send }: PaneProps) {
  const pads = snapshot.pads;
  const currentBank = snapshot.synth.soundFontPresets.find(({ id }) => id === snapshot.synth.selectedSoundFontPresetId)?.bank ?? 0;
  const voices = snapshot.synth.soundFontPresets
    .filter(({ bank }) => bank === currentBank)
    .sort((left, right) => left.program - right.program || left.name.localeCompare(right.name));
  const drumKits = [...pads.drumKits].sort((left, right) => left.bank - right.bank || left.program - right.program || left.name.localeCompare(right.name));
  const entries = pads.navigationTarget === "voices" ? voices : pads.navigationTarget === "drum-kits" ? drumKits : [];
  const selectedEntry = entries[pads.navigationIndex];
  const currentLabel = pads.navigationTarget === "sample-pages"
    ? pads.samplePageCount > 0 ? `Sample page ${pads.samplePageIndex + 1}` : "No sample pages"
    : selectedEntry?.name ?? (pads.navigationTarget === "voices" ? "No voices available" : "No drum kits available");
  const targetLabel = pads.navigationTarget === "voices" ? "voice" : pads.navigationTarget === "drum-kits" ? "drum kit" : "sample page";
  const sampleStatus = pads.sampleLibraryStatus;
  const samplePads = pads.samplePage;

  return (
    <section className="pane pads-pane" aria-label="Pad controls">
      <header className="pads-heading">
        <div>
          <span className="lane-label">Performance controls</span>
          <h1>PAD BANK</h1>
        </div>
        <div className="pad-settings">
          <label>Pad mode
            <select aria-label="Pad mode" value={pads.mode} onChange={(event) => send({ type: "set-pad-mode", mode: event.target.value as EngineSnapshot["pads"]["mode"] })}>
              <option value="drums">Drums</option>
              <option value="samples">Samples</option>
            </select>
          </label>
          <label>+ / − target
            <select aria-label="Pad navigation target" value={pads.navigationTarget} onChange={(event) => send({ type: "set-pad-navigation-target", target: event.target.value as EngineSnapshot["pads"]["navigationTarget"] })}>
              <option value="voices">Voices</option>
              <option value="drum-kits">Drum kits</option>
              <option value="sample-pages">Sample pages</option>
            </select>
          </label>
        </div>
      </header>

      <section className="pad-navigation" aria-label="Pad navigation">
        <IconButton label={`Previous ${targetLabel}`} disabled={pads.navigationCount === 0} onClick={() => send({ type: "step-pad-navigation", direction: -1 })}><span aria-hidden="true">−</span></IconButton>
        <label className="pad-entry-picker">Current entry
          <select aria-label="Current pad navigation entry" value={pads.navigationIndex} disabled={pads.navigationCount === 0} onChange={(event) => send({ type: "select-pad-program", program: Number(event.target.value) })}>
            {pads.navigationCount === 0
              ? <option value={0}>{currentLabel}</option>
              : pads.navigationTarget === "sample-pages"
                ? Array.from({ length: pads.navigationCount }, (_, index) => <option key={index} value={index}>Sample page {index + 1}</option>)
                : entries.map((entry, index) => <option key={entry.id} value={index}>{entry.name}</option>)}
          </select>
        </label>
        <IconButton label={`Next ${targetLabel}`} disabled={pads.navigationCount === 0} onClick={() => send({ type: "step-pad-navigation", direction: 1 })}><span aria-hidden="true">+</span></IconButton>
        <output className="pad-position" aria-live="polite" aria-label="Current pad navigation position">
          {String(pads.navigationCount === 0 ? 0 : pads.navigationIndex + 1).padStart(2, "0")} / {currentLabel} / {String(pads.navigationCount).padStart(2, "0")}
        </output>
      </section>

      <section className="sample-bank" aria-label="Sample pads">
        <div className="sample-bank-heading">
          <div>
            <span className="lane-label">{pads.mode === "samples" ? "Live sample triggers" : "Sample triggers inactive in drum mode"}</span>
            {sampleStatus === "loading" && <span className="sample-state" role="status">Loading sample library…</span>}
            {sampleStatus === "error" && <span className="sample-state sample-error" role="alert">Sample library error: {pads.sampleLibraryError ?? "Unable to load samples"}</span>}
            {sampleStatus === "ready" && pads.samplePageCount === 0 && <span className="sample-state" role="status">No MP3 samples found. Add files to the configured folder, then refresh.</span>}
            {sampleStatus === "ready" && pads.samplePageCount > 0 && <span className="sample-state" role="status">{samplePads.filter((sample) => sample !== null).length} samples loaded on this page.</span>}
          </div>
          <IconButton label="Refresh samples" disabled={sampleStatus === "loading"} onClick={() => send({ type: "refresh-samples" })}><RefreshCw /></IconButton>
        </div>
        <div className="sample-pad-grid">
          {samplePads.map((sample, index) => {
            const enabled = pads.mode === "samples" && sampleStatus === "ready" && sample !== null;
            const name = sample?.name ?? "Empty slot";
            return <button className={`sample-pad ${enabled ? "loaded" : ""}`} type="button" key={index} aria-label={`Pad ${index + 1} — ${name}`} disabled={!enabled} onClick={() => send({ type: "trigger-sample-pad", pad: index, velocity: 100 })}>
              <span className="sample-pad-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="sample-pad-name">{name}</span>
            </button>;
          })}
        </div>
        <p className="sample-folder-note">Set <code>SAMPLE_LIBRARY_DIR</code> on the host to use another folder (default <code>~/.local/share/alesis/samples</code>); add MP3 files, then refresh. See sample-pad help for format limits.</p>
      </section>

      <details className="pad-help">
        <summary>Vortex display, pad mapping &amp; capture limits</summary>
        <p>Vortex +/− loads onboard presets. For matching host navigation, configure identical mappings with <strong>Program Change Send On Load</strong> and programs 0…N−1. The Vortex display indicates its onboard controller preset only. Host UI navigation cannot write that display and does not synchronize it.</p>
        <p>Selecting an entry under <strong>Voices</strong> changes the selected SoundFont voice. It does not switch synthesizers; if Neon is selected, Neon stays active.</p>
        <p>Physical sample pads use MIDI channel 10 (wire channel 9), notes 36–43. Live sample triggers are not included in loop capture or MP3 exports.</p>
      </details>
    </section>
  );
}

function LoopPane({ snapshot, send }: PaneProps) {
  const isPlaying = snapshot.transport.state !== "stopped";
  const beatCount = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const [saving, setSaving] = useState(false);
  const [exportName, setExportName] = useState("");
  const saveExport = (): void => {
    if (!exportName.trim()) return;
    send({ type: "export-mp3", name: exportName.trim() });
    setSaving(false);
    setExportName("");
  };
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
        <IconButton label="Save promoted tracks as MP3 files" disabled={snapshot.promoted.length === 0} onClick={() => setSaving(true)}><Download /></IconButton>
      </header>

      {saving && <div className="dialog-backdrop" onMouseDown={() => setSaving(false)}>
        <form className="save-dialog" role="dialog" aria-modal="true" aria-labelledby="save-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); saveExport(); }}>
          <h2 id="save-title">Save MP3 session</h2>
          <label>Folder name<input autoFocus required maxLength={80} pattern="[A-Za-z0-9][-A-Za-z0-9 _]*" value={exportName} onChange={(event) => setExportName(event.target.value)} /></label>
          <div className="dialog-actions"><button type="button" onClick={() => setSaving(false)}>Cancel</button><button type="submit">Save</button></div>
        </form>
      </div>}

      <div className="signal-stack">
        <section className="current-capture">
          <span className="lane-label">Current capture // live</span>
          <Waveform samples={snapshot.capture.currentWaveform} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} live progress={snapshot.transport.progress} />
        </section>
        <section className="staged-capture">
          <div className="staging-lane">
            <span className="lane-label">Staged // {snapshot.capture.quantization === "off" ? "raw timing" : `quantized ${snapshot.capture.quantization}`}</span>
            <Waveform samples={snapshot.capture.staged?.waveform ?? []} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} emptyLabel="Waiting for rollover" />
          </div>
          <div className="take-actions">
            <select className="quantization-select" aria-label="Staged quantization" value={snapshot.capture.quantization} onChange={(event) => send({ type: "set-quantization", mode: event.target.value as EngineSnapshot["capture"]["quantization"] })}>
              <option value="off">Quantize off</option>
              <option value="1/4">1/4</option>
              <option value="1/8">1/8</option>
              <option value="1/16">1/16</option>
              <option value="1/32">1/32</option>
            </select>
            <IconButton label="Promote staged take" disabled={!snapshot.capture.staged} onClick={() => send({ type: "promote-staged" })}><Plus /></IconButton>
            <IconButton label={snapshot.capture.stagedAudible ? "Mute staged take" : "Unmute staged take"} active={snapshot.capture.stagedAudible} pressed={snapshot.capture.stagedAudible} onClick={() => send({ type: "set-staged-audible", audible: !snapshot.capture.stagedAudible })}>{snapshot.capture.stagedAudible ? <Volume2 /> : <VolumeX />}</IconButton>
          </div>
        </section>
        <section className="previous-staged-capture">
          <div className="staging-lane">
            <span className="lane-label">Previous staged // expires at rollover</span>
            <Waveform samples={snapshot.capture.previousStaged?.waveform ?? []} beatCount={beatCount} beatsPerMeasure={snapshot.settings.beatsPerMeasure} emptyLabel="No displaced take" />
          </div>
          <div className="take-actions">
            <IconButton label="Promote previous staged take" disabled={!snapshot.capture.previousStaged} onClick={() => send({ type: "promote-previous-staged" })}><Plus /></IconButton>
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
