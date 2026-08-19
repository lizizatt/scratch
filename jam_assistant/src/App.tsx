import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeAudioFile,
  type FileAnalysisProgress,
  type FileAnalysisResult,
} from "./audio/file-analysis";
import { ROOT_NAMES, buildFretboard, type FretNote } from "./music/fretboard";
import { chordLabel, detectedChordMarkers } from "./music/timeline";
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

const STRING_NAMES = ["E", "A", "D", "G", "B", "E"];
const MARKER_SETTLE_SECONDS = 0.05;

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
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [scaleName, setScaleName] = useState<string>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileUrlRef = useRef<string | undefined>(undefined);
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
  const chordMarkers = useMemo(
    () => detectedChordMarkers(result?.estimates ?? []),
    [result],
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    const handleTimeUpdate = () => setSelectedTime(audio.currentTime);
    const handleEnded = () => setAudioPlaying(false);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      if (fileUrlRef.current !== undefined) {
        URL.revokeObjectURL(fileUrlRef.current);
      }
    };
  }, []);

  async function handleFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }
    const currentRequest = ++requestId.current;
    const audio = audioRef.current;
    audio?.pause();
    setAudioPlaying(false);
    if (fileUrlRef.current !== undefined) {
      URL.revokeObjectURL(fileUrlRef.current);
    }
    fileUrlRef.current = URL.createObjectURL(file);
    if (audio !== null) {
      audio.src = fileUrlRef.current;
      audio.load();
    }
    setFileName(file.name);
    setResult(undefined);
    setSelectedTime(0);
    setScaleName(undefined);
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
      setSelectedTime(detectedChordMarkers(nextResult.estimates)[0]?.timestampSeconds ?? 0);
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

  function seekTo(time: number) {
    setSelectedTime(time);
    if (audioRef.current !== null) {
      audioRef.current.currentTime = time;
    }
  }

  function handleAudioToggle(shouldPlay: boolean) {
    const audio = audioRef.current;
    setAudioPlaying(shouldPlay);
    if (audio === null) {
      return;
    }
    if (!shouldPlay) {
      audio.pause();
      return;
    }
    audio.currentTime = selectedTime;
    void audio.play().catch(() => setAudioPlaying(false));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <h1>Jam Assistant</h1>
        </div>
      </header>

      <section className="control-strip" aria-label="Audio source controls">
        <label className="file-drop">
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/wave,audio/x-wav"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <span className="upload-icon" aria-hidden="true">+</span>
          <span><strong>{fileName ?? "Load an audio file"}</strong><small>MP3/WAV</small></span>
        </label>
        {status.kind === "analyzing" && <div className="source-meta">
          <span className={`live-status status-${status.kind}`}>
            <span className="status-dot" />
            {status.progress.phase}...
          </span>
          <span>{Math.round(status.progress.fraction * 100)}%</span>
        </div>}
      </section>

      <audio ref={audioRef} className="audio-element" preload="metadata" aria-label="Loaded audio" />

      {status.kind === "error" && <div className="error-banner" role="alert">{status.message}</div>}

      {result !== undefined && <>
      <section className="analysis-grid" aria-live="polite">
        <div className="chord-panel panel">
          <div className="panel-heading"><span>Current chord</span><span className="timestamp">{formatTime(selectedTime)}</span></div>
          {currentEstimate?.state === "chord" ? (
            <>
              <div className="chord-symbol">{chordLabel(currentEstimate.rootPitchClass, currentEstimate.quality)}</div>
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
          <div className="panel-heading"><span>Analysis timeline</span><label className="audio-toggle"><input type="checkbox" aria-label="Play audio" checked={audioPlaying} onChange={(event) => handleAudioToggle(event.target.checked)} /><span>Play audio</span></label></div>
          <div className="timeline-rail" aria-label="Detected chords">
            <span className="timeline-progress" style={{ width: `${(selectedTime / result.durationSeconds) * 100}%` }} />
            {chordMarkers.map((marker) => <button className="chord-marker" type="button" key={`${marker.timestampSeconds}-${marker.label}`} style={{ left: `${(marker.timestampSeconds / result.durationSeconds) * 100}%` }} onClick={() => seekTo(Math.min(result.durationSeconds, marker.timestampSeconds + MARKER_SETTLE_SECONDS))} aria-label={`Seek to ${marker.label}`}><span>{marker.label}</span></button>)}
          </div>
          <input className="scrubber" type="range" min="0" max={result.durationSeconds} step="0.01" value={selectedTime} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Analysis timeline" />
          <div className="timeline-controls"><span>{formatTime(selectedTime)}</span><span className="timeline-duration">{formatTime(result.durationSeconds)}</span></div>
        </div>
      </section>

      <section className="fretboard-panel panel" aria-labelledby="fretboard-title">
        <div className="fretboard-header">
          <h2 id="fretboard-title">Fretboard · standard tuning · 12 frets</h2>
          <div className="scale-picker"><label htmlFor="scale">Scale</label><select id="scale" value={scaleName ?? ""} onChange={(event) => setScaleName(event.target.value || undefined)} disabled={currentEstimate?.state !== "chord"}><option value="">Chord tones only</option><option value="major">Major</option><option value="minor">Minor</option><option value="major pentatonic">Major pentatonic</option><option value="minor pentatonic">Minor pentatonic</option></select></div>
        </div>
        <div className="legend"><span><i className="legend-root" /> Root</span><span><i className="legend-chord" /> Chord tone</span><span><i className="legend-scale" /> Scale tone</span></div>
        <div className="fretboard-scroll"><Fretboard notes={fretboard} /></div>
      </section>
      </>}
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
