import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, Gauge, Magnet, Move, StretchHorizontal, Trash2, Undo2, ZoomIn, ZoomOut } from "lucide-react";
import type { EditableNote, EngineCommand, EngineSnapshot, QuantizationMode, ServerMessage, Take } from "@alesis/protocol";

type CommandResult = Extract<ServerMessage, { type: "command-result" }>;
type SendCommand = (command: EngineCommand, onResult?: (result: CommandResult | null) => void) => string | null;

const DEFAULT_ROW_HEIGHT = 16;
const ROW_HEIGHT_RANGE = { min: 10, max: 48 };
const ZOOM_RANGE = { min: 1, max: 12 };
const KEY_COLUMN = 38;
const DRAG_THRESHOLD = 3;
const AUDITION_MS = 350;
const AUDITION_INTERVAL_MS = 70;
const VELOCITY_PIXELS_PER_STEP = 1.2;
const MIN_DURATION = 0.002;
const subdivisionsPerBeat: Record<Exclude<QuantizationMode, "off">, number> = { "1/4": 1, "1/8": 2, "1/16": 4, "1/32": 8 };
const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const blackKeys = new Set([1, 3, 6, 8, 10]);

const noteName = (note: number): string => `${noteNames[note % 12]}${Math.floor(note / 12) - 1}`;
const rounded = (value: number): number => Number(value.toFixed(9));
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

interface Touch { x: number; y: number }
interface Pinch { ids: [number, number]; startX: number; startY: number; zoom: number; rows: number }
interface Anchor { fx: number; fy: number; ox: number; oy: number }

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
  moved: boolean;
  pitch: number;
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
  const [tool, setTool] = useState<"move" | "velocity" | "stretch">("move");
  const [zoomX, setZoomX] = useState(1);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; velocity: number } | null>(null);
  const version = useRef(0);
  const drag = useRef<Drag | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const view = useRef({ zoomX: 1, rowHeight: DEFAULT_ROW_HEIGHT, rowCount: 0 });
  const pendingFocus = useRef<Anchor | null>(null);
  const touches = useRef(new Map<number, Touch>());
  const pinch = useRef<Pinch | null>(null);
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const audition = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, timer: null });

  const beatCount = snapshot.settings.beatsPerMeasure * snapshot.settings.loopMeasures;
  const step = snap === "off" ? 0 : 1 / (beatCount * subdivisionsPerBeat[snap]);
  const busy = !loaded || pending || !take;
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
    scroller.current.scrollTop = Math.max(0, (range.hi - middle) * rowHeight - scroller.current.clientHeight / 2);
  }, [loaded]);
  useEffect(() => () => { if (audition.current.timer) clearTimeout(audition.current.timer); }, []);

  view.current.zoomX = zoomX;
  view.current.rowHeight = rowHeight;
  view.current.rowCount = range.hi - range.lo + 1;
  /** Scroll so the content fraction under the focal point stays under the same screen offset at the current zoom. */
  const placeAnchor = (): void => {
    const target = pendingFocus.current;
    const box = scroller.current;
    if (!target || !box) return;
    const gridWidth = (box.clientWidth - KEY_COLUMN) * view.current.zoomX;
    box.scrollLeft = target.fx * gridWidth + KEY_COLUMN - target.ox;
    box.scrollTop = target.fy * view.current.rowCount * view.current.rowHeight - target.oy;
  };
  useLayoutEffect(() => { placeAnchor(); pendingFocus.current = null; }, [zoomX, rowHeight]);
  /** Zoom around a screen point, or the middle of the roll. */
  const zoomTo = (nextZoom: number, nextRows: number, focus?: { x: number; y: number }): void => {
    const box = scroller.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const ox = focus ? focus.x - rect.left : rect.width / 2;
    const oy = focus ? focus.y - rect.top : rect.height / 2;
    const gridWidth = (box.clientWidth - KEY_COLUMN) * view.current.zoomX;
    const fx = clamp((box.scrollLeft + ox - KEY_COLUMN) / gridWidth, 0, 1);
    const fy = clamp((box.scrollTop + oy) / (view.current.rowCount * view.current.rowHeight), 0, 1);
    const zoom = clamp(nextZoom, ZOOM_RANGE.min, ZOOM_RANGE.max);
    const rows = clamp(nextRows, ROW_HEIGHT_RANGE.min, ROW_HEIGHT_RANGE.max);
    pendingFocus.current = { fx, fy, ox, oy };
    if (zoom === view.current.zoomX && rows === view.current.rowHeight) { placeAnchor(); pendingFocus.current = null; return; }
    view.current.zoomX = zoom;
    view.current.rowHeight = rows;
    setZoomX(zoom);
    setRowHeight(rows);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const wheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.01);
      const focus = { x: event.clientX, y: event.clientY };
      if (event.shiftKey) zoomRef.current(view.current.zoomX, view.current.rowHeight * factor, focus);
      else zoomRef.current(view.current.zoomX * factor, view.current.rowHeight, focus);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    return () => box.removeEventListener("wheel", wheel);
  }, [loaded, take === undefined]);

  const sound = (pitch: number, channel: number, velocity: number, now = false): void => {
    const state = audition.current;
    const play = (): void => {
      state.timer = null;
      state.at = performance.now();
      sendRef.current({ type: "audition-note", takeId, channel, note: pitch, velocity, durationMs: AUDITION_MS });
    };
    if (state.timer) clearTimeout(state.timer);
    const wait = now ? 0 : state.at + AUDITION_INTERVAL_MS - performance.now();
    if (wait <= 0) play();
    else state.timer = setTimeout(play, wait);
  };

  const touchDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "touch") return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2 && !pinch.current) {
      const [first, second] = [...touches.current.entries()];
      const startX = Math.max(Math.abs(first![1].x - second![1].x), 24);
      const startY = Math.max(Math.abs(first![1].y - second![1].y), 24);
      pinch.current = { ids: [first![0], second![0]], startX, startY, zoom: view.current.zoomX, rows: view.current.rowHeight };
      pan.current = null;
      setTooltip(null);
      if (drag.current) { setNotes(drag.current.origin); drag.current = null; }
    }
    if (pinch.current) { event.stopPropagation(); return; }
    if (touches.current.size === 1 && !(event.target as HTMLElement).closest(".roll-note") && scroller.current) {
      pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.current.scrollLeft, top: scroller.current.scrollTop };
    }
  };
  const touchMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "touch" || !touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const gesture = pinch.current;
    if (gesture) {
      event.stopPropagation();
      const a = touches.current.get(gesture.ids[0]);
      const b = touches.current.get(gesture.ids[1]);
      if (!a || !b) return;
      const spreadX = Math.max(Math.abs(a.x - b.x), 24) / gesture.startX;
      const spreadY = Math.max(Math.abs(a.y - b.y), 24) / gesture.startY;
      const spread = Math.hypot(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / Math.hypot(gesture.startX, gesture.startY);
      const horizontal = gesture.startY < gesture.startX * 0.5;
      const vertical = gesture.startX < gesture.startY * 0.5;
      zoomTo(
        horizontal ? gesture.zoom * spreadX : vertical ? gesture.zoom : gesture.zoom * spread,
        vertical ? gesture.rows * spreadY : horizontal ? gesture.rows : gesture.rows * spread,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      );
      return;
    }
    const current = pan.current;
    if (current?.id === event.pointerId && scroller.current) {
      scroller.current.scrollLeft = current.left - (event.clientX - current.x);
      scroller.current.scrollTop = current.top - (event.clientY - current.y);
    }
  };
  const touchUp = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType !== "touch") return;
    touches.current.delete(event.pointerId);
    if (pan.current?.id === event.pointerId) pan.current = null;
    if (pinch.current) {
      event.stopPropagation();
      if (touches.current.size === 0) pinch.current = null;
    }
  };

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
    if (busy || pinch.current || (event.button !== 0 && event.button !== 2)) return;
    event.stopPropagation();
    const additive = event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey);
    let ids = new Set(selected);
    if (additive) { if (ids.has(entry.id)) ids.delete(entry.id); else ids.add(entry.id); }
    else if (!ids.has(entry.id)) ids = new Set([entry.id]);
    setSelected(ids);
    if (!ids.has(entry.id)) return;
    const mode = event.button === 2 || tool === "velocity" ? "velocity" : tool === "stretch" || (event.target as HTMLElement).dataset.handle ? "resize" : "move";
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { mode, moved: false, pitch: entry.note, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: notes, ids, anchor: entry.id };
    if (mode === "velocity") setTooltip(tooltipFor(event, entry.velocity));
    else if (mode === "move") sound(entry.note, entry.channel, entry.velocity, true);
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
    if (!current.moved && Math.hypot(event.clientX - current.startX, dy) < DRAG_THRESHOLD) return;
    current.moved = true;
    if (current.mode === "velocity") {
      const delta = Math.round(-dy / VELOCITY_PIXELS_PER_STEP);
      const next = current.origin.map((entry) => current.ids.has(entry.id) ? { ...entry, velocity: Math.max(1, Math.min(127, entry.velocity + delta)) } : entry);
      setNotes(next);
      const velocity = next.find(({ id }) => id === current.anchor)!.velocity;
      setTooltip((shown) => shown && { ...shown, velocity });
    } else if (current.mode === "resize") {
      const wanted = anchor.start + anchor.duration + dx;
      const end = step === 0 ? wanted : Math.round(wanted / step) * step;
      const change = end - (anchor.start + anchor.duration);
      setNotes(current.origin.map((entry) => {
        if (!current.ids.has(entry.id)) return entry;
        const longest = Math.max(1 - entry.start, entry.duration);
        return { ...entry, duration: rounded(clamp(entry.duration + change, Math.min(step || MIN_DURATION, longest), longest)) };
      }));
    } else {
      const earliest = Math.min(...chosen.map(({ start }) => start));
      const latest = Math.max(...chosen.map(({ start }) => start));
      const lastStart = step === 0 ? 1 - 1e-3 : 1 - step;
      const snapped = step === 0 ? anchor.start + dx : Math.round((anchor.start + dx) / step) * step;
      const delta = Math.max(-earliest, Math.min(snapped - anchor.start, lastStart - latest));
      const rows = Math.max(range.lo - Math.min(...chosen.map(({ note }) => note)), Math.min(-Math.round(dy / view.current.rowHeight), range.hi - Math.max(...chosen.map(({ note }) => note))));
      setNotes(current.origin.map((entry) => current.ids.has(entry.id) ? { ...entry, start: rounded(entry.start + delta), note: entry.note + rows } : entry));
      if (anchor.note + rows !== current.pitch) {
        current.pitch = anchor.note + rows;
        sound(current.pitch, anchor.channel, anchor.velocity);
      }
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
        style={{ left: `${segment.left * 100}%`, width: `${segment.width * 100}%`, top: (range.hi - entry.note) * rowHeight, height: rowHeight - 1, opacity: 0.4 + 0.6 * entry.velocity / 127 }}
        onPointerDown={(event) => begin(event, entry)}
        onPointerMove={drive}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
      >{segment.first && end <= 1 + 1e-9 && <i className="note-handle" data-handle="true" />}</div>
    ));
  }), [notes, selected, range, step, busy, tool, rowHeight]);

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
          <button type="button" aria-label="Move" title="Move notes" aria-pressed={tool === "move"} className={tool === "move" ? "active" : ""} onClick={() => setTool("move")}><Move aria-hidden="true" /></button>
          <button type="button" aria-label="Velocity" title="Change velocity" aria-pressed={tool === "velocity"} className={tool === "velocity" ? "active" : ""} onClick={() => setTool("velocity")}><Gauge aria-hidden="true" /></button>
          <button type="button" aria-label="Stretch" title="Stretch note length" aria-pressed={tool === "stretch"} className={tool === "stretch" ? "active" : ""} onClick={() => setTool("stretch")}><StretchHorizontal aria-hidden="true" /></button>
        </div>
        <button type="button" disabled={busy || step === 0 || notes.length === 0} onClick={quantize}>Quantize {selected.size > 0 ? "selected" : "all"}</button>
        <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoomX <= ZOOM_RANGE.min && rowHeight <= ROW_HEIGHT_RANGE.min} onClick={() => zoomTo(zoomX / 1.5, rowHeight / 1.25)}><ZoomOut /></button>
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoomX >= ZOOM_RANGE.max && rowHeight >= ROW_HEIGHT_RANGE.max} onClick={() => zoomTo(zoomX * 1.5, rowHeight * 1.25)}><ZoomIn /></button>
        <button type="button" aria-label="Undo edit" title="Undo edit" disabled={busy || history.length === 0} onClick={undo}><Undo2 /></button>
        <button type="button" aria-label="Delete selected notes" title="Delete selected notes" disabled={busy || selected.size === 0} onClick={deleteSelected}><Trash2 /></button>
      </div>}
    </header>
  );
  if (!take) return <section className="pane take-editor" aria-label="Take editor">{header}<p role="status">This take is no longer available.</p></section>;

  return (
    <section className="pane take-editor" aria-label="Take editor">
      {header}
      {error && <p className="take-editor-note error" role="alert">{error}</p>}
      {loaded && notes.length === 0 && <p className="take-editor-note" role="status">This take has no notes.</p>}
      <div
        className="roll-scroll"
        ref={scroller}
        data-tool={tool}
        data-zoom-x={zoomX.toFixed(3)}
        data-row-height={rowHeight.toFixed(2)}
        onPointerDownCapture={touchDown}
        onPointerMoveCapture={touchMove}
        onPointerUpCapture={touchUp}
        onPointerCancelCapture={touchUp}
      >
        <div className="roll-body" style={{ height: keyRows.length * rowHeight, width: `calc(${KEY_COLUMN}px + (100% - ${KEY_COLUMN}px) * ${zoomX})` }}>
          <div className="roll-keys" aria-hidden="true">
            {keyRows.map((note) => <span key={note} className={blackKeys.has(note % 12) ? "black" : ""} style={{ height: rowHeight, lineHeight: `${rowHeight - 1}px` }}>{note % 12 === 0 ? noteName(note) : ""}</span>)}
          </div>
          <div
            className="roll-grid"
            ref={grid}
            aria-label="Note grid"
            style={{ ["--row" as string]: `${rowHeight}px`, ...step > 0 ? { ["--snap-width" as string]: `${step * 100}%` } : {} }}
            onPointerDown={() => { if (!busy) setSelected(new Set()); }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="roll-rows" aria-hidden="true">{keyRows.map((note) => <i key={note} className={blackKeys.has(note % 12) ? "black" : ""} style={{ height: rowHeight }} />)}</div>
            {step > 0 && <i className="snap-lines" aria-hidden="true" />}
            <div className="beat-grid" aria-hidden="true">
              {Array.from({ length: Math.max(0, beatCount - 1) }, (_, index) => <i key={index} className={(index + 1) % snapshot.settings.beatsPerMeasure === 0 ? "measure" : ""} style={{ left: `${(index + 1) / beatCount * 100}%` }} />)}
            </div>
            {noteLayer}
            <i className="playhead" style={{ left: `${progress * 100}%` }} />
            {tooltip && <div className="velocity-tooltip" role="status" style={{ left: tooltip.x, top: tooltip.y }}>Velocity {tooltip.velocity}</div>}
          </div>
        </div>
        <div className="roll-clearance" aria-hidden="true" />
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
