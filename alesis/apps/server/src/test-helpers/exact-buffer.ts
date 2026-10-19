export function expectExactBuffer(actual: Buffer, expected: Buffer, label = "Buffer"): void {
	if (actual.length !== expected.length) {
		throw new Error(`${label}: byte length mismatch (actual ${actual.length}, expected ${expected.length})`);
	}
	if (actual.equals(expected)) return;

	// Scan only on failure; never hand large buffers to a structural diff formatter.
	let offset = 0;
	while (offset < actual.length && actual[offset] === expected[offset]) offset++;
	const actualByte = actual[offset]!.toString(16).padStart(2, "0");
	const expectedByte = expected[offset]!.toString(16).padStart(2, "0");
	throw new Error(`${label}: first byte difference at offset ${offset} (actual 0x${actualByte}, expected 0x${expectedByte}; length ${actual.length})`);
}