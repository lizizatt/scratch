const SAMPLE_RATE = 48_000;
const BYTES_PER_FRAME = 4;
const SILENCE_LIMIT = 3; // About -80 dBFS in S16 PCM; ignores quantization noise.
const PRE_ROLL_FRAMES = SAMPLE_RATE * 0.005;
const MIN_LEADING_SILENCE_FRAMES = SAMPLE_RATE * 0.01;

/** Frame offset in interleaved 48 kHz stereo S16_LE PCM, before MP3 encoding. */
export function sampleOnsetTrimFrame(pcm: Buffer, firstAttackFrame = 0): number {
  if (pcm.length % BYTES_PER_FRAME !== 0) throw new Error("Incomplete sample PCM frame");
  for (let offset = 0; offset < pcm.length; offset += BYTES_PER_FRAME) {
    if (Math.abs(pcm.readInt16LE(offset)) <= SILENCE_LIMIT
      && Math.abs(pcm.readInt16LE(offset + 2)) <= SILENCE_LIMIT) continue;
    const onset = offset / BYTES_PER_FRAME;
    // Audio before this cycle's first attack belongs to a preceding cycle.
    // Even a delayed effect reflection is intentional opening audio, not preroll.
    if (onset < firstAttackFrame) return 0;
    return onset < MIN_LEADING_SILENCE_FRAMES ? 0 : onset - PRE_ROLL_FRAMES;
  }
  throw new Error("No audible sample material after rendering");
}
