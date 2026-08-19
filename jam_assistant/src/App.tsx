import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAudioFile,
  type FileAnalysisProgress,
  type FileAnalysisResult,
} from "./audio/file-analysis";
import { ROOT_NAMES, buildFretboard, type FretNote } from "./music/fretboard";
import type { ChordEstimate, ChordQuality } from "./analysis/types";

const QUALITY_LABELS: Readonly<Record<ChordQuality, string>> = {
  major: "Major",
  minor: "Minor",
  dominant7: "Dominant 7",
  major7: "Major 7",
  minor7: "Minor 7",
  diminished: "Diminished",
  suspended4: "Suspended 4",
};

const QUALITY_SUFFIXES: Readonly<Record<ChordQuality, string>> = {
  major: "",
  minor: "m",
  dominant7: "7",
  major7: "maj7",
  minor7: "m7",
  diminished: "dim",
  suspended4: "sus4",
};

const STRING_NAMES = ["E", "A", "D", "G", "B", "E"];
const PREVIEW_SPEEDS = [0.5, 1, 2, 4];

type AppStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "analyzing"; readonly progress: FileAnalysisProgress }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

export function App() {
  const [status, setStatus] = useState<AppStatus>({ kind: "idle" });
  const [fileName, setFileName] = useState<string>();
  const [result, setResult] = useState<FileAnalysisResult>();
  const [selectedTime, setSelectedTime] = useState(0);
  const [previewSpeed, setPreviewSpeed] = useState(1);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [scaleName, setScaleName] = useState<string>();
  const requestId = useRef(0);

  const currentEstimate = useMemo(
    () => estimateAtTime(result?.estimates ?? [], selectedTime),
    [result, selectedTime],
  );
  const fretboard = useMemo(() => {
    if (currentEstimate?.state !== "chord") {
      return [];
    }
    return buildFretboard(
      currentEstimate.rootPitchClass,
      currentEstimate.quality,
      scaleName,
    );
  }, [currentEstimate, scaleName]);

  useEffect(() => {
    if (!previewPlaying || result === undefined) {
      return;
    }
    const timer = window.setInterval(() => {
      setSelectedTime((time) => {
        const nextTime = time + 0.05 * previewSpeed;
        if (nextTime >= result.durationSeconds) {
          setPreviewPlaying(false);
          return result.durationSeconds;
        }
        return nextTime;
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [previewPlaying, previewSpeed, result]);

  async function handleFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }
    const currentRequest = ++requestId.current;
    setFileName(file.name);
    setResult(undefined);
    setSelectedTime(0);
    setScaleName(undefined);
    setPreviewPlaying(false);
    setStatus({ kind: "analyzing", progress: { phase: "decoding", fraction: 0 } });
    try {
      const nextResult = await analyzeAudioFile(file, (progress) => {
        if (currentRequest === requestId.current) {
          setStatus({ kind: "analyzing", progress });
        }
      });
      if (currentRequest !== requestId.current) {
        return;
      }
      setResult(nextResult);
      setSelectedTime(nextResult.durationSeconds / 2);
      setStatus({ kind: "ready" });
    } catch (error) {
      if (currentRequest !== requestId.current) {
        return;
      }
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not analyze this file.",
      });
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">JA</span>
          <div>
            <p className="eyebrow">Harmonic field guide</p>
            <h1>Jam Assistant</h1>
          </div>
        </div>
        <div className="mode-pill"><span className="status-dot" /> File lab</div>
      </header>

      <section className="hero-band" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow accent">Listen. Find the shape. Play.</p>
          <h2 id="hero-title">See the harmony<br /><em>under your fingers.</em></h2>
          <p className="hero-copy">Drop in a recording to reveal its working chord and a practical map across standard tuning.</p>
        </div>
        <div className="hero-note" aria-hidden="true">
          <span>01</span><strong>CHROMA</strong>
          <span>02</span><strong>SHAPE</strong>
          <span>03</span><strong>JAM</strong>
        </div>
      </section>

      <section className="control-strip" aria-label="Audio source controls">
        <label className="file-drop">
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/wave,audio/x-wav"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <span className="upload-icon" aria-hidden="true">+</span>
          <span><strong>{fileName ?? "Load an audio file"}</strong><small>MP3 or WAV · processed locally</small></span>
        </label>
        <div className="source-meta">
          <span className={`live-status status-${status.kind}`}>
            <span className="status-dot" />
            {status.kind === "analyzing" ? `${status.progress.phase}...` : status.kind === "ready" ? "Analysis ready" : status.kind === "error" ? "Analysis failed" : "Waiting for source"}
          </span>
          {status.kind === "analyzing" && <span>{Math.round(status.progress.fraction * 100)}%</span>}
        </div>
      </section>

      {status.kind === "error" && <div className="error-banner" role="alert">{status.message}</div>}

      <section className="analysis-grid" aria-live="polite">
        <div className="chord-panel panel">
          <div className="panel-heading"><span>Current harmony</span><span className="timestamp">{formatTime(selectedTime)}</span></div>
          {currentEstimate?.state === "chord" ? (
            <>
              <div className="chord-symbol">{ROOT_NAMES[currentEstimate.rootPitchClass]}<sup>{QUALITY_SUFFIXES[currentEstimate.quality]}</sup></div>
              <div className="chord-details">
                <div><span className="label">ROOT</span><strong>{ROOT_NAMES[currentEstimate.rootPitchClass]}</strong></div>
                <div><span className="label">QUALITY</span><strong>{QUALITY_LABELS[currentEstimate.quality]}</strong></div>
                <div><span className="label">CONFIDENCE</span><strong>{Math.round(currentEstimate.confidence * 100)}%</strong></div>
              </div>
            </>
          ) : (
            <div className="empty-harmony">
              <span className="pulse-ring" aria-hidden="true" />
              <strong>{currentEstimate?.state === "uncertain" ? "Uncertain" : "No chord"}</strong>
              <span>{result === undefined ? "Load a recording to begin" : "Move along the timeline to inspect harmony"}</span>
            </div>
          )}
        </div>

        <div className="timeline-panel panel">
          <div className="panel-heading"><span>Analysis timeline</span><span>{result ? formatTime(result.durationSeconds) : "--:--"}</span></div>
          <div className="timeline-track"><span className="timeline-fill" style={{ width: `${result ? (selectedTime / result.durationSeconds) * 100 : 0}%` }} /></div>
          <input className="scrubber" type="range" min="0" max={result?.durationSeconds ?? 1} step="0.01" value={selectedTime} disabled={result === undefined} onChange={(event) => setSelectedTime(Number(event.target.value))} aria-label="Analysis timeline" />
          <div className="timeline-controls">
            <button className="play-button" type="button" disabled={result === undefined} onClick={() => setPreviewPlaying((playing) => !playing)} aria-label={previewPlaying ? "Pause estimate preview" : "Play estimate preview"}>{previewPlaying ? "||" : "▶"}</button>
            <label className="speed-control">Preview speed <select value={previewSpeed} onChange={(event) => setPreviewSpeed(Number(event.target.value))}>{PREVIEW_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}x</option>)}</select></label>
            <span className="timeline-hint">Estimate preview · no audio playback</span>
          </div>
        </div>
      </section>

      <section className="fretboard-panel panel" aria-labelledby="fretboard-title">
        <div className="fretboard-header">
          <div><p className="eyebrow accent">Standard tuning · 12 frets</p><h2 id="fretboard-title">Playable map</h2></div>
          <div className="scale-picker"><label htmlFor="scale">Scale layer</label><select id="scale" value={scaleName ?? ""} onChange={(event) => setScaleName(event.target.value || undefined)} disabled={currentEstimate?.state !== "chord"}><option value="">Chord tones only</option><option value="major">Major</option><option value="minor">Minor</option><option value="major pentatonic">Major pentatonic</option><option value="minor pentatonic">Minor pentatonic</option></select></div>
        </div>
        <div className="legend"><span><i className="legend-root" /> Root</span><span><i className="legend-chord" /> Chord tone</span><span><i className="legend-scale" /> Scale tone</span></div>
        <Fretboard notes={fretboard} />
      </section>
    </main>
  );
}

function Fretboard({ notes }: { notes: readonly FretNote[] }) {
  return <div className="fretboard" aria-label="Guitar fretboard visualization">
    <div className="fret-labels"><span className="string-label">STRING</span>{Array.from({ length: 13 }, (_, fret) => <span key={fret}>{fret === 0 ? "OPEN" : fret}</span>)}</div>
    {Array.from({ length: 6 }, (_, stringIndex) => <div className="fret-row" key={stringIndex}>
      <span className="string-label">{STRING_NAMES[stringIndex]}</span>
      {notes.filter((note) => note.stringIndex === stringIndex).map((note) => <span className={`fret-cell role-${note.role}`} key={`${note.stringIndex}-${note.fret}`} title={`${note.noteName} · ${note.role}`}><span>{note.role === "none" ? "" : note.noteName.replace(/[0-9]/g, "")}</span></span>)}
    </div>)}
  </div>;
}

function estimateAtTime(estimates: readonly ChordEstimate[], time: number): ChordEstimate | undefined {
  let selected: ChordEstimate | undefined;
  for (const estimate of estimates) {
    if (estimate.timestampSeconds > time) break;
    if (estimate.state === "chord" || estimate.state === "no-chord") {
      selected = estimate;
    }
    if (selected === undefined && estimate.state === "uncertain") {
      selected = estimate;
    }
  }
  return selected;
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}
