import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  analyzeAudioFile,
  type FileAnalysisProgress,
  type FileAnalysisResult,
} from "./audio/file-analysis";
import {
  MicrophoneAnalysisSession,
  type MicrophoneAnalysisSnapshot,
} from "./audio/microphone-analysis";
import {
  INSTRUMENT_DEFINITIONS,
  ROOT_NAMES,
  buildFretboard,
  clampFretStart,
  fretWidthRatios,
  stepFretStart,
  type FretNote,
  type InstrumentDefinition,
  type InstrumentMode,
} from "./music/fretboard";
import { chordLabel, detectedChordMarkers, retainLastChord } from "./music/timeline";
import type { ChordEstimate, ChordQuality } from "./analysis/types";
import { emptyHeatmap, logarithmicOpacity, updateHeatmap } from "./analysis/heatmap";

const QUALITY_LABELS: Readonly<Record<ChordQuality, string>> = {
  major: "Major",
  minor: "Minor",
  dominant7: "Dominant 7",
  major7: "Major 7",
  minor7: "Minor 7",
  diminished: "Diminished",
  suspended4: "Suspended 4",
};

const MARKER_SETTLE_SECONDS = 0.05;
const FFT_WINDOWS_MILLISECONDS = [21, 43, 85, 171] as const;
const INSTRUMENT_MODE_ORDER: readonly InstrumentMode[] = ["guitar", "piano", "bass", "ukulele", "cello"];
const PIANO_BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

type AppStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "analyzing"; readonly progress: FileAnalysisProgress }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

type InputMode = "file" | "microphone";

export function App() {
  const [status, setStatus] = useState<AppStatus>({ kind: "idle" });
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [microphoneSnapshot, setMicrophoneSnapshot] = useState<MicrophoneAnalysisSnapshot>({ status: "stopped" });
  const [microphoneEstimate, setMicrophoneEstimate] = useState<ChordEstimate>();
  const [fileName, setFileName] = useState<string>();
  const [result, setResult] = useState<FileAnalysisResult>();
  const [selectedTime, setSelectedTime] = useState(0);
  const [audioMuted, setAudioMuted] = useState(true);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [latchedEstimate, setLatchedEstimate] = useState<ChordEstimate>();
  const [fftWindowIndex, setFftWindowIndex] = useState(2);
  const [accumulationSeconds, setAccumulationSeconds] = useState(0.2);
  const [fadeSeconds, setFadeSeconds] = useState(0.2);
  const [logResponse, setLogResponse] = useState(0.1);
  const [heatmapStrengths, setHeatmapStrengths] = useState(emptyHeatmap);
  const [lowestNote, setLowestNote] = useState<string>();
  const [fretStart, setFretStart] = useState(1);
  const [instrumentMode, setInstrumentMode] = useState<InstrumentMode>("guitar");
  const [zoomIndex, setZoomIndex] = useState(
    INSTRUMENT_DEFINITIONS.guitar.visibleFretCounts.length - 1,
  );
  const [compactLandscape, setCompactLandscape] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const fileUrlRef = useRef<string | undefined>(undefined);
  const microphoneRef = useRef<MicrophoneAnalysisSession | undefined>(undefined);
  const requestId = useRef(0);
  const heatmapTimestampRef = useRef<number | undefined>(undefined);
  const accumulationSecondsRef = useRef(accumulationSeconds);
  const fadeSecondsRef = useRef(fadeSeconds);
  accumulationSecondsRef.current = accumulationSeconds;
  fadeSecondsRef.current = fadeSeconds;

  const fileEstimate = useMemo(
    () => estimateAtTime(result?.estimates ?? [], selectedTime),
    [result, selectedTime],
  );
  const currentEstimate = inputMode === "microphone"
    ? microphoneEstimate
    : fileEstimate;
  const fretboardEstimate = latchedEstimate ?? currentEstimate;
  const instrument = INSTRUMENT_DEFINITIONS[instrumentMode];
  const visibleFretCounts = instrument.visibleFretCounts;
  const maxFretCount = instrument.maxFretCount;
  const minPosition = instrument.minPosition;
  const visibleFretCount = visibleFretCounts[zoomIndex] ?? visibleFretCounts[visibleFretCounts.length - 1] ?? 12;
  const fretEnd = fretStart + visibleFretCount - 1;
  const displayedFretStart = compactLandscape ? minPosition : fretStart;
  const displayedFretCount = compactLandscape ? maxFretCount - minPosition + 1 : visibleFretCount;
  const fretboard = useMemo(() => {
    const rootPitchClass = fretboardEstimate?.state === "chord"
      ? fretboardEstimate.rootPitchClass
      : 0;
    const quality = fretboardEstimate?.state === "chord"
      ? fretboardEstimate.quality
      : "major";
    return buildFretboard(rootPitchClass, quality, undefined, maxFretCount, instrument.tuningMidi);
  }, [fretboardEstimate, instrument, maxFretCount]);
  const displayedStrengths = inputMode === "microphone"
    ? heatmapStrengths
    : currentEstimate?.chroma ?? emptyHeatmap();
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
    const handlePlay = () => setAudioPlaying(true);
    const handlePause = () => setAudioPlaying(false);
    const handleEnded = () => setAudioPlaying(false);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.pause();
      if (fileUrlRef.current !== undefined) {
        URL.revokeObjectURL(fileUrlRef.current);
      }
    };
  }, []);

  useEffect(() => () => {
    void microphoneRef.current?.stop();
  }, []);

  useEffect(() => {
    const media = window.matchMedia(
      "(orientation: landscape) and (max-width: 950px) and (max-height: 500px)",
    );
    const update = () => setCompactLandscape(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  async function handleFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }
    const currentRequest = ++requestId.current;
    const audio = audioRef.current;
    audio?.pause();
    if (audio !== null) {
      audio.muted = audioMuted;
    }
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
    setLatchedEstimate(undefined);
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

  async function enterMode(nextMode: InputMode) {
    if (nextMode === inputMode) {
      return;
    }
    await microphoneRef.current?.stop();
    microphoneRef.current = undefined;
    setInputMode(nextMode);
    setMicrophoneEstimate(undefined);
    setLatchedEstimate(undefined);
    setHeatmapStrengths(emptyHeatmap());
    setLowestNote(undefined);
    heatmapTimestampRef.current = undefined;
    if (nextMode === "file") {
      setMicrophoneSnapshot({ status: "stopped" });
      return;
    }
    setResult(undefined);
    setFileName(undefined);
    setStatus({ kind: "idle" });
    const session = new MicrophoneAnalysisSession((snapshot) => {
      setMicrophoneSnapshot(snapshot);
      if (snapshot.status === "starting") {
        setHeatmapStrengths(emptyHeatmap());
        setLowestNote(undefined);
        heatmapTimestampRef.current = undefined;
      }
      if (
        snapshot.status === "muted" ||
        snapshot.status === "ended" ||
        snapshot.status === "stopped" ||
        snapshot.status === "error"
      ) {
        setLowestNote(undefined);
      }
      if (snapshot.heatmapFrame !== undefined) {
        const frame = snapshot.heatmapFrame;
        setLowestNote(frame.lowestNote);
        const previousTimestamp = heatmapTimestampRef.current;
        const elapsedSeconds = previousTimestamp === undefined
          ? frame.intervalSeconds
          : Math.max(frame.intervalSeconds, frame.timestampSeconds - previousTimestamp);
        heatmapTimestampRef.current = frame.timestampSeconds;
        setHeatmapStrengths((current) => updateHeatmap(
          current,
          frame.chroma,
          elapsedSeconds,
          accumulationSecondsRef.current,
          fadeSecondsRef.current,
        ));
      }
      if (snapshot.estimate !== undefined) {
        setMicrophoneEstimate((current) => retainLastChord(current, snapshot.estimate));
        setSelectedTime(snapshot.estimate.timestampSeconds);
      }
    });
    session.setFftWindowMilliseconds(
      FFT_WINDOWS_MILLISECONDS[fftWindowIndex] ?? FFT_WINDOWS_MILLISECONDS[2],
    );
    microphoneRef.current = session;
    try {
      await session.start();
    } catch {
      // The session publishes a user-facing error snapshot.
    }
  }

  function handleFftWindowChange(index: number) {
    setFftWindowIndex(index);
    microphoneRef.current?.setFftWindowMilliseconds(
      FFT_WINDOWS_MILLISECONDS[index] ?? FFT_WINDOWS_MILLISECONDS[2],
    );
  }

  function handleFretStep(direction: -1 | 1) {
    setFretStart((current) => stepFretStart(
      current,
      visibleFretCount,
      direction,
      maxFretCount,
      minPosition,
    ));
  }

  function handleZoom(direction: -1 | 1) {
    const nextZoomIndex = Math.max(
      0,
      Math.min(visibleFretCounts.length - 1, zoomIndex + direction),
    );
    const nextVisibleFretCount = visibleFretCounts[nextZoomIndex] ?? visibleFretCount;
    setZoomIndex(nextZoomIndex);
    setFretStart((current) => clampFretStart(current, nextVisibleFretCount, maxFretCount, minPosition));
  }

  function seekTo(time: number) {
    setSelectedTime(time);
    if (audioRef.current !== null) {
      audioRef.current.currentTime = time;
    }
  }

  function handleAudioMuteToggle(shouldPlay: boolean) {
    const audio = audioRef.current;
    setAudioMuted(!shouldPlay);
    if (audio === null) {
      return;
    }
    audio.muted = !shouldPlay;
  }

  function handlePlaybackToggle() {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (audio.paused) {
      audio.currentTime = selectedTime;
      void audio.play().catch(() => setAudioPlaying(false));
    } else {
      audio.pause();
    }
  }

  useEffect(() => {
    setZoomIndex(Math.max(0, INSTRUMENT_DEFINITIONS[instrumentMode].visibleFretCounts.length - 1));
    setFretStart(INSTRUMENT_DEFINITIONS[instrumentMode].minPosition);
  }, [instrumentMode]);

  return (
    <main className={compactLandscape ? "app-shell landscape-view" : "app-shell"}>
      <section className="control-strip" aria-label="Audio source controls">
        <div className="input-mode" role="group" aria-label="Audio input mode">
          <button type="button" className={inputMode === "file" ? "mode-active" : ""} onClick={() => void enterMode("file")}>File</button>
          <button type="button" className={inputMode === "microphone" ? "mode-active" : ""} onClick={() => void enterMode("microphone")}>Microphone</button>
        </div>
        {inputMode === "file" && <label className="file-drop">
          <input
            type="file"
            accept="audio/mpeg,audio/wav,audio/wave,audio/x-wav"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <span className="upload-icon" aria-hidden="true">+</span>
          <span><strong>{fileName ?? "Load an audio file"}</strong><small>MP3/WAV</small></span>
        </label>}
        {inputMode === "file" && status.kind === "analyzing" && <div className="source-meta">
          <span className={`live-status status-${status.kind}`}>
            <span className="status-dot" />
            {status.progress.phase}...
          </span>
          <span>{Math.round(status.progress.fraction * 100)}%</span>
        </div>}
        {inputMode === "microphone" && <div className={`source-meta microphone-status microphone-${microphoneSnapshot.status}`}>
          <span className="status-dot" />
          <span>{microphoneSnapshot.status === "running" ? "Listening" : microphoneSnapshot.status === "starting" ? "Starting microphone" : microphoneSnapshot.status === "muted" ? "Microphone muted" : microphoneSnapshot.status === "ended" ? "Microphone ended" : microphoneSnapshot.status === "error" ? microphoneSnapshot.message : "Microphone stopped"}</span>
          {(microphoneSnapshot.status === "running" || microphoneSnapshot.status === "starting") && <button type="button" onClick={() => void microphoneRef.current?.stop()}>Stop</button>}
          {(microphoneSnapshot.status === "stopped" || microphoneSnapshot.status === "ended" || microphoneSnapshot.status === "error") && <button type="button" onClick={() => void microphoneRef.current?.start()}>Start</button>}
        </div>}
      </section>

      <audio ref={audioRef} className="audio-element" preload="metadata" aria-label="Loaded audio" />

      {status.kind === "error" && <div className="error-banner" role="alert">{status.message}</div>}

      {(result !== undefined || inputMode === "microphone") && <>
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
              <span>{inputMode === "microphone" ? "Play a chord near the microphone" : result === undefined ? "Load a recording to begin" : "Move along the timeline to inspect harmony"}</span>
            </div>
          )}
        </div>

        {inputMode === "file" && result !== undefined && <div className="timeline-panel panel">
          <div className="panel-heading"><span>Analysis timeline</span><div className="playback-controls"><button className="playback-button" type="button" onClick={handlePlaybackToggle} aria-label={audioPlaying ? "Pause timeline" : "Play timeline"}>{audioPlaying ? "||" : "▶"}</button><label className="audio-toggle"><input type="checkbox" aria-label="Play audio" checked={!audioMuted} onChange={(event) => handleAudioMuteToggle(event.target.checked)} /><span>Play audio</span></label></div></div>
          <div className="timeline-rail" aria-label="Detected chords">
            <span className="timeline-progress" style={{ width: `${(selectedTime / result.durationSeconds) * 100}%` }} />
            {chordMarkers.map((marker) => <button className="chord-marker" type="button" key={`${marker.timestampSeconds}-${marker.label}`} style={{ left: `${(marker.timestampSeconds / result.durationSeconds) * 100}%` }} onClick={() => seekTo(Math.min(result.durationSeconds, marker.timestampSeconds + MARKER_SETTLE_SECONDS))} aria-label={`Seek to ${marker.label}`}><span>{marker.label}</span></button>)}
          </div>
          <input className="scrubber" type="range" min="0" max={result.durationSeconds} step="0.01" value={selectedTime} onChange={(event) => seekTo(Number(event.target.value))} aria-label="Analysis timeline" />
          <div className="timeline-controls"><span>{formatTime(selectedTime)}</span><span className="timeline-duration">{formatTime(result.durationSeconds)}</span></div>
        </div>}
      </section>

      <section className="fretboard-panel panel" aria-labelledby="fretboard-title">
        <div className="landscape-status" aria-label="Current harmony">
          <strong>{currentEstimate?.state === "chord" ? chordLabel(currentEstimate.rootPitchClass, currentEstimate.quality) : "--"} / {lowestNote ?? "--"}</strong>
        </div>
        <div className="fretboard-header">
          <h2 id="fretboard-title">{instrument.label} · {instrument.mode === "piano" ? "keys" : "frets"} {fretStart}–{fretEnd}</h2>
          <div className="fretboard-controls">
            <label className="instrument-picker"><span>Display</span><select aria-label="Instrument display mode" value={instrumentMode} onChange={(event) => setInstrumentMode(event.target.value as InstrumentMode)}>{INSTRUMENT_MODE_ORDER.map((mode) => <option key={mode} value={mode}>{INSTRUMENT_DEFINITIONS[mode].label}</option>)}</select></label>
            <button
              type="button"
              className={latchedEstimate === undefined ? "latch-button" : "latch-button latch-active"}
              aria-pressed={latchedEstimate !== undefined}
              disabled={latchedEstimate === undefined && currentEstimate?.state !== "chord"}
              onClick={() => setLatchedEstimate((latched) => latched === undefined && currentEstimate?.state === "chord" ? currentEstimate : undefined)}
            >{latchedEstimate === undefined ? "Latch" : "Latched"}</button>
            <details className="options-menu">
              <summary>Options</summary>
              <div className="heatmap-controls">
                <label><span>FFT <output>{FFT_WINDOWS_MILLISECONDS[fftWindowIndex]} ms</output></span><input aria-label="FFT window" type="range" min="0" max="3" step="1" value={fftWindowIndex} onChange={(event) => handleFftWindowChange(Number(event.target.value))} /></label>
                <label><span>Accumulation <output>{accumulationSeconds.toFixed(1)} s</output></span><input aria-label="Accumulation time" type="range" min="0.1" max="5" step="0.1" value={accumulationSeconds} onChange={(event) => setAccumulationSeconds(Number(event.target.value))} /></label>
                <label><span>Fade <output>{fadeSeconds.toFixed(1)} s</output></span><input aria-label="Fade time" type="range" min="0.1" max="10" step="0.1" value={fadeSeconds} onChange={(event) => setFadeSeconds(Number(event.target.value))} /></label>
                <label><span>Log response <output>{logResponse.toFixed(1)}</output></span><input aria-label="Log response" type="range" min="0.1" max="1" step="0.1" value={logResponse} onChange={(event) => setLogResponse(Number(event.target.value))} /></label>
              </div>
            </details>
          </div>
        </div>
        <div className="fretboard-subbar">
          <div className="legend"><span><i className="legend-heat" /> FFT energy</span><span><i className="legend-root" /> Root outline</span><span><i className="legend-chord" /> Chord outline</span></div>
          <div className="fretboard-navigation">
            <div role="group" aria-label="Fretboard segment controls">
              <button type="button" aria-label="Previous fret" disabled={fretStart === minPosition} onClick={() => handleFretStep(-1)}>←</button>
              <output>{fretStart}–{fretEnd} / {maxFretCount}</output>
              <button type="button" aria-label="Next fret" disabled={fretEnd === maxFretCount} onClick={() => handleFretStep(1)}>→</button>
            </div>
            <div role="group" aria-label="Fretboard zoom controls">
              <button type="button" aria-label="Zoom out" disabled={zoomIndex === visibleFretCounts.length - 1} onClick={() => handleZoom(1)}>−</button>
              <button type="button" aria-label="Zoom in" disabled={zoomIndex === 0} onClick={() => handleZoom(-1)}>+</button>
            </div>
          </div>
        </div>
        <div className="fretboard-scroll"><Fretboard instrument={instrument} notes={fretboard} hasChord={fretboardEstimate?.state === "chord"} heatmapStrengths={displayedStrengths} logResponse={logResponse} startFret={displayedFretStart} visibleFretCount={displayedFretCount} /></div>
      </section>
      </>}
    </main>
  );
}

function Fretboard({
  instrument,
  notes,
  hasChord,
  heatmapStrengths,
  logResponse,
  startFret,
  visibleFretCount,
}: {
  instrument: InstrumentDefinition;
  notes: readonly FretNote[];
  hasChord: boolean;
  heatmapStrengths: readonly number[];
  logResponse: number;
  startFret: number;
  visibleFretCount: number;
}) {
  if (instrument.mode === "piano") {
    return (
      <PianoKeyboard
        instrument={instrument}
        notes={notes}
        hasChord={hasChord}
        heatmapStrengths={heatmapStrengths}
        logResponse={logResponse}
        startFret={startFret}
        visibleFretCount={visibleFretCount}
      />
    );
  }

  const stringIndexes = Array.from({ length: instrument.stringNames.length }, (_, index) => instrument.stringNames.length - 1 - index);
  const endFret = startFret + visibleFretCount - 1;
  const fretColumns = fretWidthRatios(startFret, visibleFretCount)
    .map((width) => `${width}fr`)
    .join(" ");
  const boardStyle = {
    "--visible-frets": visibleFretCount,
    "--fret-columns": fretColumns,
  } as CSSProperties;
  const ariaLabel = `${instrument.label} fretboard visualization`;

  return <div className="fretboard" style={boardStyle} aria-label={ariaLabel}>
    <div className="fret-labels"><span className="string-label">STRING</span>{Array.from({ length: visibleFretCount }, (_, index) => <span key={startFret + index}>{startFret + index}</span>)}</div>
    {stringIndexes.map((stringIndex) => <div className="fret-row" data-string-index={stringIndex} key={stringIndex}>
      <span className="string-label">{instrument.stringNames[stringIndex]}</span>
      {notes.filter((note) => note.stringIndex === stringIndex && note.fret >= startFret && note.fret <= endFret).map((note) => {
        const strength = heatmapStrengths[note.pitchClass] ?? 0;
        const opacity = logarithmicOpacity(strength, logResponse);
        const style = { "--heat-strength": opacity } as CSSProperties;
        const role = hasChord ? note.role : "none";
        return <span className={`fret-cell role-${role}`} data-strength={strength.toFixed(3)} data-opacity={opacity.toFixed(3)} key={`${note.stringIndex}-${note.fret}`} title={`${note.noteName} · ${role}`}><span style={style}>{note.noteName.replace(/[0-9]/g, "")}</span></span>;
      })}
    </div>)}
  </div>;
}

function PianoKeyboard({
  instrument,
  notes,
  hasChord,
  heatmapStrengths,
  logResponse,
  startFret,
  visibleFretCount,
}: {
  instrument: InstrumentDefinition;
  notes: readonly FretNote[];
  hasChord: boolean;
  heatmapStrengths: readonly number[];
  logResponse: number;
  startFret: number;
  visibleFretCount: number;
}) {
  const endFret = startFret + visibleFretCount - 1;
  const fretColumns = Array.from({ length: visibleFretCount }, () => "1fr").join(" ");
  const boardStyle = {
    "--visible-frets": visibleFretCount,
    "--fret-columns": fretColumns,
  } as CSSProperties;
  const visibleNotes = notes.filter((note) => note.stringIndex === 0 && note.fret >= startFret && note.fret <= endFret);

  return <div className="fretboard piano-board" style={boardStyle} aria-label={`${instrument.label} keyboard visualization`}>
    <div className="fret-labels"><span className="string-label">KEY</span>{visibleNotes.map((note) => <span key={note.fret}>{note.noteName}</span>)}</div>
    <div className="fret-row piano-row" data-string-index="0">
      <span className="string-label">{instrument.stringNames[0]}</span>
      {visibleNotes.map((note) => {
        const strength = heatmapStrengths[note.pitchClass] ?? 0;
        const opacity = logarithmicOpacity(strength, logResponse);
        const style = { "--heat-strength": opacity } as CSSProperties;
        const role = hasChord ? note.role : "none";
        const keyClass = PIANO_BLACK_KEYS.has(note.pitchClass)
          ? "piano-black"
          : "piano-white";
        return <span className={`fret-cell piano-key ${keyClass} role-${role}`} data-strength={strength.toFixed(3)} data-opacity={opacity.toFixed(3)} key={`${note.stringIndex}-${note.fret}`} title={`${note.noteName} · ${role}`}><span style={style}>{note.noteName}</span></span>;
      })}
    </div>
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
