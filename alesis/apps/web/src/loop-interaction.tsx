export function Waveform({ samples, beatCount, beatsPerMeasure, loopStart, live = false, progress, emptyLabel }: { samples: number[]; beatCount: number; beatsPerMeasure: number; loopStart: number; live?: boolean; progress?: number; emptyLabel?: string }) {
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
      <i className="loop-start-marker" aria-hidden="true" style={{ left: `${loopStart * 100}%` }} />
      {progress !== undefined && <i className="playhead" style={{ left: `${progress * 100}%` }} />}
    </div>
  );
}

export function LoopInteraction({ waveform, beatCount, beatsPerMeasure, startBeat, legacyStart, onStartBeatChange, disabled }: {
  waveform: number[]; beatCount: number; beatsPerMeasure: number; startBeat: number | null;
  legacyStart: number; onStartBeatChange(beat: number | null): void; disabled: boolean;
}) {
  return <div className="loop-interaction">
    <Waveform samples={waveform} beatCount={beatCount} beatsPerMeasure={beatsPerMeasure} loopStart={startBeat === null ? legacyStart : startBeat / beatCount} emptyLabel="Drum pattern / loop arrangement" />
    <label className="overdub-toggle"><input type="checkbox" checked={startBeat !== null} disabled={disabled} onChange={(event) => onStartBeatChange(event.target.checked ? 0 : null)} /> Choose start beat</label>
    {startBeat !== null && <label className="start-beat-slider">Start position: Beat {startBeat + 1} of {beatCount}
      <input aria-label="Export start beat" aria-valuetext={`Beat ${startBeat + 1} of ${beatCount}`} type="range" min={0} max={beatCount - 1} step={1} value={startBeat} disabled={disabled} onChange={(event) => onStartBeatChange(Number(event.target.value))} />
    </label>}
    <p>{startBeat === null ? `Default export policy · saved origin ${(legacyStart * beatCount + 1).toFixed(2)}` : "Whole cycle, rotated to this beat. Left/right moves one beat; length does not change."}</p>
  </div>;
}
