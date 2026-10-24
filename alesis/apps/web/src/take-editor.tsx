import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Magnet, Move, Gauge, Trash2, Undo2 } from "lucide-react";
import type { EditableNote, EngineCommand, EngineSnapshot, QuantizationMode, ServerMessage, Take } from "@alesis/protocol";

type CommandResult = Extract<ServerMessage, { type: "command-result" }>;
type SendCommand = (command: EngineCommand, onResult?: (result: CommandResult | null) => void) => string | null;

const ROW_HEIGHT = 16;
const VELOCITY_PIXELS_PER_STEP = 1.2;
const MIN_DURATION = 0.002;
const subdivisionsPerBeat: Record<Exclude<QuantizationMode, "off">, number> = { "1/4": 1, "1/8": 2, "1/16": 4, "1/32": 8 };
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const blackKeys = new Set([1, 3, 6, 8, 10]);

const noteName = (note: number): string => `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`;
const rounded = (value: number): number => Number(value.toFixed(9));

function pitchRange(notes: readonly EditableNote[]): { lo: number; hi: number } {
  const keys = notes.map(({ note }) => note);
  const lowest = keys.length > 0 ? Math.min(...keys) : 60;
  const highest = keys.length > 0 ? Math.max(...keys) : 60;
  let lo = Math.max(0, lowest - 5);
  let hi = Math.min(127, highest + 5);
  while (hi - lo < 23) {
    if (lo > 0) lo -= 1;
    if (hi - lo < 23 && hi < 127) hi += 1;
  }
  return { lo, hi };
}

interface Drag {
  mode: "move" | "resize" | "velocity";
  pointerId: number;
  startX: number;
  startY: number;
  origin: EditableNote[];
  ids: Set<number>;
  anchor: number;
}

export function TakeEditor({ snapshot, send, takeId, onBack }: { snapshot: EngineSnapshot; send: SendCommand; takeId: string; onBack(): void }) {
  const take = findTake(snapshot, takeId);
  const sendRef = useRef(send);
  sendRef.current = send;
  const [notes, setNotes] = useState<EditableNote[]>([]);
  const [range, setRange] = useState({ lo: 48, hi: 72 });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [history, setHistory] = useState<EditableNote[][]>([]);
  const [snap, setSnap] = useState<QuantizationMode>(snapshot.capture.quantization === "off" ? "1/16" : snapshot.capture.quantization);
  const [tool, setTool] = useState<"move" | "velocity">("move");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; velocity: number } | null>(null);
  const version = useRef(0);
  const drag = useRef<Drag | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const beatCount = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const step = snap === "off" ? 0 : 1 / (beatCount * subdivisionsPerBeat[snap]);
  const locked = snapshot.capture.overdub && snapshot.capture.staged?.id === takeId && snapshot.transport.state !== "stopped";
  const busy = !loaded || pending || locked || !take;
  const isPlaying = snapshot.transport.state !== "stopped";
  const progress = isPlaying ? (snapshot.transport.origin + snapshot.transport.progress) % 1 : snapshot.capture.loopStart;

  const adopt = (result: NonNullable<CommandResult["takeNotes"]>, initial: boolean): void => {
    version.current = result.version;
    setNotes(result.notes);
    if (initial) {
      setRange(pitchRange(result.notes));
      setHistory([]);
      setSelected(new Set());
    } else setSelected((current) => new Set([...current].filter((id) => result.notes.some((entry) => entry.id === id))));
    setLoaded(true);
  };
  const load = (): void => {
    setError(null);
    sendRef.current({ type: "get-take-notes", takeId }, (result) => {
      if (result?.accepted && result.takeNotes) adopt(result.takeNotes, true);
      else setError(result?.error ?? "Connection lost while opening the take");
    });
  };
  useEffect(load, [takeId]);
  useEffect(() => {
    if (!loaded || !scroller.current) return;
    const keys = notes.map(({ note }) => note);
    const middle = keys.length > 0 ? (Math.min(...keys) + Math.max(...keys)) / 2 : 60;
    scroller.current.scrollTop = Math.max(0, (range.hi - middle) * ROW_HEIGHT - scroller.current.clientHeight / 2);
  }, [loaded]);

  const commit = (next: EditableNote[], before: EditableNote[], remember = true): void => {
    setPending(true);
    setError(null);
    const id = sendRef.current({ type: "set-take-notes", takeId, version: version.current, notes: next }, (result) => {
      setPending(false);
      if (result?.accepted && result.takeNotes) {
        adopt(result.takeNotes, false);
        if (remember) setHistory((current) => [...current.slice(-49), before]);
        return;
      }
      setError(result?.error ?? "Connection lost; the edit may not have been applied");
      load();
    });
    if (!id) { setPending(false); setError("Host is not connected."); setNotes(before); }
  };

  const snapStart = (start: number): number => step === 0 ? start : rounded(Math.min(Math.round(start / step) * step, 1 - step));
  const deleteSelected = (): void => {
    if (busy || selected.size === 0) return;
    commit(notes.filter(({ id }) => !selected.has(id)), notes);
    setSelected(new Set());
  };
  const undo = (): void => {
    const previous = history.at(-1);
    if (busy || !previous) return;
    setHistory((current) => current.slice(0, -1));
    commit(previous, notes, false);
  };
  const quantize = (): void => {
    if (busy || step === 0) return;
    const next = notes.map((entry) => selected.size === 0 || selected.has(entry.id) ? { ...entry, start: snapStart(entry.start) } : entry);
    if (JSON.stringify(next) !== JSON.stringify(notes)) commit(next, notes);
  };

  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => {});
  keyHandler.current = (event) => {
    if ((event.target as HTMLElement | null)?.closest("input, select, textarea")) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelected(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const begin = (event: ReactPointerEvent<HTMLElement>, entry: EditableNote): void => {
    if (busy || (event.button !== 0 && event.button !== 2)) return;
    event.stopPropagation();
    const additive = event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey);
    let ids = new Set(selected);
    if (additive) { if (ids.has(entry.id)) ids.delete(entry.id); else ids.add(entry.id); }
    else if (!ids.has(entry.id)) ids = new Set([entry.id]);
    setSelected(ids);
    if (!ids.has(entry.id)) return;
    const mode = event.button === 2 || tool === "velocity" ? "velocity" : (event.target as HTMLElement).dataset.handle ? "resize" : "move";
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: notes, ids, anchor: entry.id };
    if (mode === "velocity") setTooltip(tooltipFor(event, entry.velocity));
  };
  const tooltipFor = (event: ReactPointerEvent<HTMLElement>, velocity: number) => {
    const box = grid.current!.getBoundingClientRect();
    return { x: event.clientX - box.left + 14, y: event.clientY - box.top - 34, velocity };
  };
  const drive = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const width = grid.current!.getBoundingClientRect().width;
    const dx = (event.clientX - current.startX) / width;
    const dy = event.clientY - current.startY;
    const anchor = current.origin.find(({ id }) => id === current.anchor)!;
    const chosen = current.origin.filter(({ id }) => current.ids.has(id));
    if (current.mode === "velocity") {
      const delta = Math.round(-dy / VELOCITY_PIXELS_PER_STEP);
      const next = current.origin.map((entry) => current.ids.has(entry.id) ? { ...entry, velocity: Math.max(1, Math.min(127, entry.velocity + delta)) } : entry);
      setNotes(next);
      setTooltip(tooltipFor(event, next.find(({ id }) => id === current.anchor)!.velocity));
    } else if (current.mode === "resize") {
      const wanted = anchor.start + anchor.duration + dx;
      const end = step === 0 ? wanted : Math.round(wanted / step) * step;
      const duration = Math.max(step || MIN_DURATION, Math.min(1 - anchor.start, end - anchor.start));
      setNotes(current.origin.map((entry) => entry.id === anchor.id ? { ...entry, duration: rounded(duration) } : entry));
    } else {
      const earliest = Math.min(...chosen.map(({ start }) => start));
      const latest = Math.max(...chosen.map(({ start }) => start));
      const lastStart = step === 0 ? 1 - 1e-3 : 1 - step;
      const snapped = step === 0 ? anchor.start + dx : Math.round((anchor.start + dx) / step) * step;
      const delta = Math.max(-earliest, Math.min(snapped - anchor.start, lastStart - latest));
      const rows = Math.max(range.lo - Math.min(...chosen.map(({ note }) => note)), Math.min(-Math.round(dy / ROW_HEIGHT), range.hi - Math.max(...chosen.map(({ note }) => note))));
      setNotes(current.origin.map((entry) => current.ids.has(entry.id) ? { ...entry, start: rounded(entry.start + delta), note: entry.note + rows } : entry));
    }
  };
  const finish = (event: ReactPointerEvent<HTMLElement>, cancelled: boolean): void => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setTooltip(null);
    if (cancelled || JSON.stringify(notes) === JSON.stringify(current.origin)) {
      setNotes(current.origin);
      return;
    }
    commit(notes, current.origin);
  };

  const keyRows = Array.from({ length: range.hi - range.lo + 1 }, (_, index) => range.hi - index);
  const noteLayer = useMemo(() => notes.filter(({ note }) => note >= range.lo && note <= range.hi).map((entry) => {
    const end = entry.start + entry.duration;
    const segments = [{ left: entry.start, width: Math.min(entry.duration, 1 - entry.start), first: true }];
    if (end > 1 + 1e-9) segments.push({ left: 0, width: end - 1, first: false });
    return segments.map((segment) => (
      <div
        key={`${entry.id}-${segment.first ? "a" : "b"}`}
        role="button"
        aria-label={`${noteName(entry.note)} velocity ${entry.velocity}`}
        title={`${noteName(entry.note)} · velocity ${entry.velocity}`}
        className={`roll-note ${selected.has(entry.id) ? "selected" : ""} ${entry.channel === 9 ? "drum" : ""}`}
        data-note={entry.note}
        data-velocity={entry.velocity}
        style={{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%`, top: (range.hi - entry.note) * ROW_HEIGHT, height: ROW_HEIGHT - 1, opacity: 0.4 + 0.6 * entry.velocity / 127 }}
        onPointerDown={(event) => begin(event, entry)}
        onPointerMove={drive}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
      >{segment.first && end <= 1 + 1e-9 && <i className="note-handle" data-handle="true" />}</div>
    ));
  }), [notes, selected, range, step, busy, tool]);

  const header = (
    <header className="take-editor-header">
      <button type="button" className="back-button" aria-label="Back" onClick={onBack}><ArrowLeft /> Back</button>
      <h1>{take ? takeTitle(snapshot, take) : "Take unavailable"}</h1>
      {take && <div className="take-editor-tools">
        <label className="snap-control"><Magnet aria-hidden="true" />
          <select aria-label="Snap to grid" value={snap} onChange={(event) => setSnap(event.target.value as QuantizationMode)}>
            <option value="off">Snap off</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option>
          </select>
        </label>
        <div className="tool-toggle" role="group" aria-label="Drag tool">
          <button type="button" aria-pressed={tool === "move"} className={tool === "move" ? "active" : ""} onClick={() => setTool("move")}><Move aria-hidden="true" /> Move</button>
          <button type="button" aria-pressed={tool === "velocity"} className={tool === "velocity" ? "active" : ""} onClick={() => setTool("velocity")}><Gauge aria-hidden="true" /> Velocity</button>
        </div>
        <button type="button" disabled={busy || step === 0 || notes.length === 0} onClick={quantize}>Quantize {selected.size > 0 ? "selected" : "all"}</button>
        <button type="button" aria-label="Undo edit" title="Undo edit" disabled={busy || history.length === 0} onClick={undo}><Undo2 /></button>
        <button type="button" aria-label="Delete selected notes" title="Delete selected notes" disabled={busy || selected.size === 0} onClick={deleteSelected}><Trash2 /></button>
      </div>}
    </header>
  );
  if (!take) return <section className="pane take-editor" aria-label="Take editor">{header}<p role="status">This take is no longer available.</p></section>;

  return (
    <section className="pane take-editor" aria-label="Take editor">
      {header}
      {locked && <p className="take-editor-note" role="status">Stop playback to edit the take being overdubbed.</p>}
      {error && <p className="take-editor-note error" role="alert">{error}</p>}
      {loaded && notes.length === 0 && <p className="take-editor-note" role="status">This take has no notes.</p>}
      <div className="roll-scroll" ref={scroller}>
        <div className="roll-body" style={{ height: keyRows.length * ROW_HEIGHT }}>
          <div className="roll-keys" aria-hidden="true">
            {keyRows.map((note) => <span key={note} className={blackKeys.has(note % 12) ? "black" : ""} style={{ height: ROW_HEIGHT }}>{note % 12 === 0 ? noteName(note) : ""}</span>)}
          </div>
          <div
            className="roll-grid"
            ref={grid}
            aria-label="Note grid"
            style={{ ["--row" as string]: `${ROW_HEIGHT}px`, ...step > 0 ? { ["--snap-width" as string]: `${step * 100}%` } : {} }}
            onPointerDown={() => { if (!busy) setSelected(new Set()); }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="roll-rows" aria-hidden="true">{keyRows.map((note) => <i key={note} className={blackKeys.has(note % 12) ? "black" : ""} style={{ height: ROW_HEIGHT }} />)}</div>
            {step > 0 && <i className="snap-lines" aria-hidden="true" />}
            <div className="beat-grid" aria-hidden="true">
              {Array.from({ length: Math.max(0, beatCount - 1) }, (_, index) => <i key={index} className={(index + 1) % snapshot.settings.beatsPerMeasure === 0 ? "measure" : ""} style={{ left: `${(index + 1) / beatCount * 100}%` }} />)}
            </div>
            {noteLayer}
            <i className="playhead" style={{ left: `${progress * 100}%` }} />
            {tooltip && <div className="velocity-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>Velocity {tooltip.velocity}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}

function findTake(snapshot: EngineSnapshot, takeId: string): Take | undefined {
  return [snapshot.capture.staged, snapshot.capture.previousStaged, ...snapshot.promoted].find((take) => take?.id === takeId) ?? undefined;
}

function takeTitle(snapshot: EngineSnapshot, take: Take): string {
  if (snapshot.capture.staged?.id === take.id) return "Staged take";
  if (snapshot.capture.previousStaged?.id === take.id) return "Previous staged take";
  return `Take ${snapshot.promoted.findIndex(({ id }) => id === take.id) + 1}`;
}
