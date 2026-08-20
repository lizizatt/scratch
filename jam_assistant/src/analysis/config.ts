export const ANALYSIS_FRAME_SIZE = 4096;
export const ANALYSIS_HOP_SIZE = 512;

export function fftFrameSizeForMilliseconds(
	milliseconds: number,
	sampleRate: number,
): number {
	const targetSamples = milliseconds * sampleRate / 1000;
	const exponent = Math.round(Math.log2(targetSamples));
	return 2 ** Math.max(10, Math.min(13, exponent));
}
