import { useState, type FormEvent } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import type { EngineCommand, EngineSnapshot, SavedLoopsStatus } from "@alesis/protocol";

type Send = (command: EngineCommand) => string | null;

const formatBytes = (bytes: number): string => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
};

/** Loops kept on the host: save the current takes under a name, and reopen any of them to keep working. */
export function SavedLoopsPanel({ snapshot, status, send, recording }: { snapshot: EngineSnapshot; status: SavedLoopsStatus; send: Send; recording: boolean }) {
  const [name, setName] = useState("");
  const stopped = snapshot.transport.state === "stopped";
  const hasTakes = snapshot.capture.staged !== null || snapshot.capture.previousStaged !== null || snapshot.promoted.length > 0;
  const trimmed = name.trim();
  const validName = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,79}$/.test(trimmed);
  const locked = !stopped || recording;
  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (!validName || locked || !hasTakes) return;
    if (status.items.some(({ id }) => id === trimmed) && !window.confirm(`Replace the saved loop "${trimmed}"?`)) return;
    send({ type: "save-loop", name: trimmed });
  };
  const open = (id: string): void => {
    if (hasTakes && !window.confirm(`Open "${id}"? This replaces the takes you have now; save them first if you want to keep them.`)) return;
    send({ type: "load-saved-loop", id });
  };
  return (
    <details className="saved-loops">
      <summary>Saved loops ({status.items.length})</summary>
      <form className="saved-loops-save" onSubmit={save}>
        <input aria-label="Name for this loop" placeholder="Name this loop" maxLength={80} value={name} disabled={locked} onChange={(event) => setName(event.target.value)} />
        <button type="submit" disabled={locked || !hasTakes || !validName} title={!stopped ? "Stop first" : !hasTakes ? "Nothing to save yet" : !validName ? "Use letters, numbers, spaces, - or _" : "Save the current takes"}>Save loop</button>
      </form>
      {status.items.length === 0 && <p className="empty-list">SAVED LOOPS APPEAR HERE. EXPORTS ARE KEPT HERE TOO.</p>}
      <ul className="saved-loops-list" aria-label="Saved loops">
        {status.items.map((item) => (
          <li key={item.id}>
            <span className="saved-loop-title"><strong>{item.id}</strong><small>{item.takeCount} {item.takeCount === 1 ? "take" : "takes"} · {item.bpm} BPM · {item.loopMeasures * item.beatsPerMeasure} beats · {formatDate(item.savedAt)} · {formatBytes(item.bytes)}</small></span>
            <button type="button" aria-label={`Open saved loop ${item.id}`} title={locked ? "Stop first" : "Open this loop"} disabled={locked} onClick={() => open(item.id)}><FolderOpen aria-hidden="true" /> Open</button>
            <button type="button" className="icon-button danger" aria-label={`Delete saved loop ${item.id}`} title="Delete this saved loop" onClick={() => { if (window.confirm(`Delete the saved loop "${item.id}"?`)) send({ type: "delete-saved-loop", id: item.id }); }}><Trash2 /></button>
          </li>
        ))}
      </ul>
      {status.unreadable.length > 0 && <p className="free-warning" role="alert">Could not read: {status.unreadable.join(", ")}</p>}
    </details>
  );
}
