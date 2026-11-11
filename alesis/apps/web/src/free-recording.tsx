import { Circle, Download, RotateCcw, Square, Trash2 } from "lucide-react";
import type { CaptureMode, EngineCommand, EngineSnapshot, FreeRecordingItem, FreeRecordingStatus } from "@alesis/protocol";
import { Waveform } from "./loop-interaction";

type Send = (command: EngineCommand) => string | null;

const modes: Array<{ mode: CaptureMode; text: string; label: string; hint: string }> = [
  { mode: "replace", text: "Replace", label: "Replace staged loop", hint: "Each pass replaces the staged take" },
  { mode: "overdub", text: "Overdub", label: "Overdub staged loop", hint: "Each pass layers onto the staged take" },
  { mode: "record", text: "Record", label: "Record open-ended take", hint: "Record with no loop and no length limit to a .mid and .mp3" },
];

/** Replace / Overdub / Record as one three-position switch. */
export function CaptureModeSwitch({ snapshot, send, recording }: { snapshot: EngineSnapshot; send: Send; recording: boolean }) {
  const current: CaptureMode = snapshot.capture.freeRecord ? "record" : snapshot.capture.overdub ? "overdub" : "replace";
  const stopped = snapshot.transport.state === "stopped";
  return (
    <div className="mode-rocker" role="radiogroup" aria-label="Capture mode" data-mode={current} style={{ ["--position" as string]: modes.findIndex(({ mode }) => mode === current) }}>
      <i className="rocker-thumb" aria-hidden="true" />
      {modes.map(({ mode, text, label, hint }) => {
        // Replace and Overdub swap while playing; entering or leaving Record needs the transport stopped.
        const crossesRecord = (mode === "record") !== (current === "record");
        return (
          <button
            key={mode} type="button" role="radio" aria-checked={current === mode} aria-label={label}
            title={crossesRecord && !stopped ? "Stop the transport first" : hint}
            disabled={recording || crossesRecord && !stopped}
            onClick={() => {
              if (mode === current) return;
              send(crossesRecord ? { type: "set-capture-mode", mode } : { type: "set-overdub", enabled: mode === "overdub" });
            }}
          >{text}</button>
        );
      })}
    </div>
  );
}

export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const two = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}` : `${Math.floor(seconds / 60)}:${two(seconds % 60)}`;
};

const formatBytes = (bytes: number): string => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
/** About 85 MB of MP3 per hour (192 kbit/s). */
const MP3_BYTES_PER_HOUR = 85 * 1024 ** 2;

export function FreeRecordingPanel({ status, send }: { status: FreeRecordingStatus; send: Send }) {
  const { active } = status;
  const hoursOfRoom = status.diskFreeBytes === null ? null : Math.floor(status.diskFreeBytes / MP3_BYTES_PER_HOUR);
  return (
    <div className="free-panel">
      <section className="free-lane" aria-label="Recording">
        <span className="lane-label">{active ? `Recording // ${formatDuration(active.elapsedMs)}` : "Ready // press Record, then play"}</span>
        <Waveform samples={active?.waveform ?? []} span={active?.buckets ?? 240} beatCount={0} beatsPerMeasure={4} loopStart={0} live={active !== null} emptyLabel={active ? "Waiting for the first note" : "Nothing recording"} />
        <div className="free-axis" aria-hidden="true">
          <span>0:00</span>
          <span>{active ? `${formatDuration(active.bucketMs * active.buckets)} shown · compresses as it grows` : ""}</span>
        </div>
        <div className="free-stats" role="status">
          {active ? `${active.noteCount} ${active.noteCount === 1 ? "note" : "notes"} · ${active.eventCount} events · saved as you play.` : "Records the notes you play, with their sound, as a .mid and an .mp3 when you press Stop."}
          {status.diskFreeBytes !== null && ` Disk: ${formatBytes(status.diskFreeBytes)} free${hoursOfRoom !== null ? ` (room for about ${hoursOfRoom} h of MP3)` : ""}.`}
        </div>
        {active?.warning && <p className="free-warning" role="alert">{active.warning}</p>}
        {status.error && <p className="free-notice" role="status">{status.error}</p>}
      </section>
      <section className="free-list" aria-label="Free recordings">
        {status.items.length === 0 && <div className="empty-list">RECORDINGS APPEAR HERE</div>}
        {status.items.map((item) => <FreeRecordingRow key={item.id} item={item} send={send} />)}
      </section>
    </div>
  );
}

function FreeRecordingRow({ item, send }: { item: FreeRecordingItem; send: Send }) {
  const { mp3 } = item;
  return (
    <article className="free-item" aria-label={item.name}>
      <div className="free-item-title">
        <strong>{item.name}</strong>
        <span>{formatDuration(item.durationMs)} · {item.noteCount} {item.noteCount === 1 ? "note" : "notes"}{item.recovered ? " · recovered after a power cut" : ""}</span>
      </div>
      <div className="free-files">
        <a className="free-download" href={`/recordings/${item.id}.mid`} download aria-label={`Download MIDI of ${item.name}`}><Download aria-hidden="true" /> MIDI {formatBytes(item.midiBytes)}</a>
        {mp3.state === "ready" && <a className="free-download" href={`/recordings/${item.id}.mp3`} download aria-label={`Download MP3 of ${item.name}`}><Download aria-hidden="true" /> MP3 {formatBytes(mp3.bytes ?? 0)}</a>}
        {(mp3.state === "queued" || mp3.state === "rendering") && <span className="free-render" role="status">{mp3.state === "queued" ? "MP3 queued…" : `Rendering MP3 ${Math.round((mp3.progress ?? 0) * 100)}%`}</span>}
        {mp3.state === "failed" && <span className="free-warning" role="alert">MP3 failed: {mp3.error ?? "unknown error"}</span>}
        {(mp3.state === "failed" || mp3.state === "none") && <button type="button" className="free-render-button" aria-label={`${mp3.state === "failed" ? "Retry" : "Render"} MP3 of ${item.name}`} onClick={() => send({ type: "render-free-recording", id: item.id })}><RotateCcw aria-hidden="true" /> {mp3.state === "failed" ? "Retry MP3" : "Render MP3"}</button>}
      </div>
      <button type="button" className="icon-button danger" aria-label={`Delete ${item.name}`} title="Delete this recording" onClick={() => { if (window.confirm(`Delete ${item.name} and its files?`)) send({ type: "delete-free-recording", id: item.id }); }}><Trash2 /></button>
    </article>
  );
}

export function RecordControls({ recording, send }: { recording: boolean; send: Send }) {
  return <>
    <button className="icon-button" type="button" aria-label="Stop recording" title="Stop recording" disabled={!recording} onClick={() => send({ type: "stop-free-recording" })}><Square /></button>
    <button className={`icon-button record-button ${recording ? "active" : ""}`} type="button" aria-label="Record" title={recording ? "Recording" : "Record"} aria-pressed={recording} disabled={recording} onClick={() => send({ type: "start-free-recording" })}><Circle /></button>
  </>;
}
