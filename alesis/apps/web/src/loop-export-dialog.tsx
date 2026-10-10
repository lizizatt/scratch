import { useEffect, useRef, useState } from "react";
import type { EngineCommand, EngineSnapshot, LoopExportStatus, ServerMessage } from "@alesis/protocol";
import { LoopInteraction } from "./loop-interaction";

type Result = Extract<ServerMessage, { type: "command-result" }>;
type Send = (command: EngineCommand, onResult?: (result: Result | null) => void) => string | null;

export function LoopExportDialog({ target, snapshot, status, send, onClose, onSaved }: {
  target: "sample" | "promoted"; snapshot: EngineSnapshot; status: LoopExportStatus; send: Send;
  onClose(): void; onSaved(message: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const artifact = useRef<string | null>(null);
  const preparation = useRef<{ id: string; settled: Promise<Result | null> } | null>(null);
  const operation = useRef(0);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [pending, setPending] = useState(false);
  const [startBeat, setStartBeat] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The display and beat domain are frozen at opening just like the host preparation recipe.
  const [display] = useState(snapshot);
  const beats = display.settings.beatsPerMeasure * display.settings.loopMeasures;
  const layers = target === "sample"
    ? [...(display.capture.stagedAudible && !display.monitorOnly && display.capture.staged ? [display.capture.staged] : []), ...display.promoted.filter((take) => !display.monitorOnly && !take.muted)]
    : display.promoted;
  const waveform = Array.from({ length: Math.max(0, ...layers.map((take) => take.waveform.length)) }, (_, i) => Math.min(1, layers.reduce((sum, take) => sum + (take.waveform[i] ?? 0) * take.level, 0)));
  const previewing = status.artifactId === artifact.current && status.state === "previewing";
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      operation.current += 1;
      const id = artifact.current ?? preparation.current?.id;
      if (id) sendRef.current({ type: "release-loop-export", artifactId: id });
    };
  }, []);
  const request = (command: EngineCommand, done: (result: Result) => void, callbacks?: {
    settled?(result: Result | null): void;
    rejected?(): void;
  }): void => {
    const generation = operation.current;
    setPending(true);
    setError(null);
    const sent = send(command, (result) => {
      callbacks?.settled?.(result);
      if (generation !== operation.current) return;
      setPending(false);
      if (!result?.accepted) {
        setError(result?.error ?? "Connection lost before confirmation. Check the host/library before retrying.");
        callbacks?.rejected?.();
        return;
      }
      done(result);
    });
    if (!sent) { callbacks?.settled?.(null); setPending(false); setError("Host is not connected."); callbacks?.rejected?.(); }
  };
  const invalidate = (done: () => void): void => {
    const generation = ++operation.current;
    const preparing = preparation.current;
    const id = artifact.current ?? preparing?.id;
    if (!id) { done(); return; }
    request({ type: "release-loop-export", artifactId: id }, () => {
      artifact.current = null;
      if (preparation.current === preparing) preparation.current = null;
      done();
    }, { rejected: () => {
      // Release can race the prepare reply. A rejected prepare never acquired ownership.
      void preparing?.settled.then((result) => {
        if (generation === operation.current && result && !result.accepted) done();
      });
    } });
  };
  const close = (): void => invalidate(onClose);
  const action = (kind: "preview" | "save"): void => {
    const apply = (id: string) => request(kind === "preview"
      ? { type: "preview-loop-export", artifactId: id, enabled: true }
      : { type: "publish-loop-export", artifactId: id, ...(name.trim() ? { name: name.trim() } : {}) }, (result) => {
        if (kind === "save") { artifact.current = null; onSaved(result.message ?? "Export saved."); onClose(); }
      });
    if (artifact.current && status.artifactId === artifact.current && status.state !== "error" && status.state !== "idle") { apply(artifact.current); return; }
    const id = crypto.randomUUID();
    let settle!: (result: Result | null) => void;
    const preparing = { id, settled: new Promise<Result | null>((resolve) => { settle = resolve; }) };
    preparation.current = preparing;
    artifact.current = null;
    request({ type: "prepare-loop-export", artifactId: id, target, ...(startBeat === null ? {} : { startBeat }) }, () => apply(id), {
      settled: (result) => {
        if (preparation.current === preparing && result) {
          preparation.current = null;
          if (result.accepted) artifact.current = id;
        }
        settle(result);
      },
    });
  };
  return <dialog ref={dialog} className="save-dialog loop-export-dialog" aria-labelledby="loop-export-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <form onSubmit={(event) => { event.preventDefault(); action("save"); }}>
      <h2 id="loop-export-title">{target === "sample" ? "Export loop to sample library" : "Save MP3 audio"}</h2>
      <label>{target === "sample" ? "Sample name (optional)" : "Folder name"}<input autoFocus required={target === "promoted"} maxLength={80} pattern="[A-Za-z0-9][-A-Za-z0-9 _]*" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} /></label>
      <LoopInteraction waveform={waveform} beatCount={beats} beatsPerMeasure={display.settings.beatsPerMeasure} startBeat={startBeat} legacyStart={display.capture.loopStart} disabled={pending} onStartBeatChange={(beat) => invalidate(() => setStartBeat(beat))} />
      <p>Preview takes over the host audio output, not this browser. Stop transport first. It never resumes automatically.</p>
      <p>{target === "sample" ? "Audible staged/promoted takes + drums. Default zero origin trims leading silence." : "All promoted tracks, including muted tracks, plus their normalized mix. Default retains renderer tails."} Choosing a beat exports one exact cycle.</p>
      <div role="status" className="export-status">{status.artifactId === (artifact.current ?? preparation.current?.id) ? status.state : "Choose Save or Preview"}{pending ? " · Working…" : ""}</div>
      {snapshot.transport.state !== "stopped" && <p>Stop transport before preview.</p>}
      {(error || status.error) && <p role="alert">{error ?? status.error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={close}>Cancel</button>
        <button type="button" disabled={pending || (!previewing && snapshot.transport.state !== "stopped")} onClick={() => previewing && artifact.current
          ? request({ type: "preview-loop-export", artifactId: artifact.current, enabled: false }, () => {}) : action("preview")}>{previewing ? "Stop preview" : "Preview on host output"}</button>
        <button type="submit" disabled={pending || (target === "promoted" && !name.trim())}>Save</button>
      </div>
    </form>
  </dialog>;
}
