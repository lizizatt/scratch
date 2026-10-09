import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_SHA256 = "96dad7c0f173e5c5a2cb465ce89e0c1b87555c557cce2c1f69ea10f7959404d9";
export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

// This transformer is deliberately restricted to the verified external FNF asset.
// It is not a general SF2 editor (stereo links, modulators and offsets need other handling).
export function readChunks(buffer, start = 12, end = buffer.length) {
  const result = [];
  for (let p = start; p < end;) {
    if (p + 8 > end) throw new Error("Truncated RIFF header");
    const id = buffer.toString("ascii", p, p + 4);
    const size = buffer.readUInt32LE(p + 4);
    const next = p + 8 + size + size % 2;
    if (next > end) throw new Error("Truncated RIFF chunk");
    result.push(id === "LIST"
      ? { id, type: buffer.toString("ascii", p + 8, p + 12), children: readChunks(buffer, p + 12, p + 8 + size) }
      : { id, data: Buffer.from(buffer.subarray(p + 8, p + 8 + size)) });
    p = next;
  }
  return result;
}

function encodeChunk(chunk) {
  const data = chunk.children ? Buffer.concat([Buffer.from(chunk.type), ...chunk.children.map(encodeChunk)]) : chunk.data;
  const header = Buffer.alloc(8);
  header.write(chunk.id); header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

export function sf2Tables(buffer) {
  const tree = readChunks(buffer);
  const tables = Object.fromEntries(tree.flatMap((list) => list.children ?? []).map((chunk) => [chunk.id, chunk]));
  return { tree, tables };
}

function name(buffer, offset, value) {
  buffer.fill(0, offset, offset + 20);
  buffer.write(value, offset, 19, "ascii");
}

function match(samples, start, end, width, stride) {
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < width; i += stride) {
    const a = samples[start - width + i], b = samples[end - width + i];
    aa += a * a; bb += b * b; ab += a * b;
  }
  if (Math.min(aa, bb) < 1) return { cost: Infinity, correlation: 0 };
  const correlation = ab / Math.sqrt(aa * bb);
  return { cost: 1 - correlation + 0.15 * Math.abs(Math.log(bb / aa)), correlation };
}

export function chooseLoop(samples, rate) {
  const width = Math.round(0.04 * rate);
  const candidates = [];
  // Stay after the attack and before the recording's fade-out. A long loop retains
  // more vocal movement than repeating one pitch period.
  for (let start = Math.round(0.30 * rate); start <= Math.round(0.55 * rate); start += Math.round(0.025 * rate)) {
    for (let end = start + Math.round(0.35 * rate); end <= Math.min(start + Math.round(0.65 * rate), samples.length - width); end += 16) {
      const candidate = { ...match(samples, start, end, width, 4), start, end };
      if (Number.isFinite(candidate.cost) && (candidates.length < 8 || candidate.cost < candidates.at(-1).cost)) {
        candidates.push(candidate);
        candidates.sort((a, b) => a.cost - b.cost);
        if (candidates.length > 8) candidates.pop();
      }
    }
  }
  if (!candidates.length) throw new Error("No audible sustain region");
  let best = { cost: Infinity };
  // Refine several candidates at full bandwidth; coarse decimation can alias
  // high vocal harmonics and rank a poor match first.
  for (const coarse of candidates) {
    for (let end = coarse.end - 16; end <= Math.min(coarse.end + 16, samples.length - width); end++) {
      const candidate = match(samples, coarse.start, end, width, 1);
      if (candidate.cost < best.cost) best = { ...candidate, start: coarse.start, end };
    }
  }
  if (best.correlation < 0.8) throw new Error(`Poor loop match: ${best.correlation}`);
  return { ...best, width };
}

export function buildSustainFont(source) {
  if (sha256(source) !== SOURCE_SHA256) throw new Error("Source checksum does not match verified Hatsune Miku FNF.sf2");
  const { tree, tables: t } = sf2Tables(source);
  const report = [];
  const smpl = t.smpl.data, shdr = t.shdr.data;
  for (let p = 0; p < shdr.length - 46; p += 46) {
    const start = shdr.readUInt32LE(p + 20), end = shdr.readUInt32LE(p + 24);
    const rate = shdr.readUInt32LE(p + 36);
    if (shdr.readUInt16LE(p + 44) !== 1) throw new Error("Expected mono samples");
    const samples = new Int16Array(end - start);
    for (let i = 0; i < samples.length; i++) samples[i] = smpl.readInt16LE((start + i) * 2);
    const loop = chooseLoop(samples, rate);
    // Blend toward the audio immediately BEFORE loopStart. The wrap then continues
    // at loopStart naturally, without replaying the attack or duplicating a frame.
    for (let i = 0; i < loop.width; i++) {
      const blend = 0.5 - 0.5 * Math.cos(Math.PI * i / (loop.width - 1));
      const frame = loop.end - loop.width + i;
      const value = Math.round(samples[frame] * (1 - blend) + samples[loop.start - loop.width + i] * blend);
      smpl.writeInt16LE(value, (start + frame) * 2);
    }
    shdr.writeUInt32LE(start + loop.start, p + 28);
    shdr.writeUInt32LE(start + loop.end, p + 32);
    report.push({ sample: p / 46, root: shdr[p + 40], startFrame: loop.start, endFrame: loop.end,
      crossfadeFrames: loop.width, startSeconds: loop.start / rate, endSeconds: loop.end / rate,
      correlation: loop.correlation });
  }
  const original = t.igen.data, bags = t.ibag.data, generators = [];
  const gen = (op, value) => { const b = Buffer.alloc(4); b.writeUInt16LE(op); b.writeInt16LE(value, 2); return b; };
  // Rebuild generator indices including terminal EOI. Modulator indices stay intact.
  for (let p = 0; p < bags.length - 4; p += 4) {
    const first = bags.readUInt16LE(p), last = bags.readUInt16LE(p + 4);
    bags.writeUInt16LE(generators.length, p);
    if (p === 0 && first === last) continue; // Preserve this asset's empty global zone.
    let sampleID;
    for (let i = first; i < last; i++) {
      const record = original.subarray(i * 4, i * 4 + 4), op = record.readUInt16LE(0);
      if (op === 53) sampleID = record;
      else if (![37, 38, 54].includes(op)) generators.push(record);
    }
    if (!sampleID) throw new Error("Expected sample in every instrument zone");
    // Continuous looping also during the short release avoids jumping into the old
    // recording tail on note-off. Sustain is 0 centibels attenuation; release ~125ms.
    generators.push(gen(37, 0), gen(38, -3600), gen(54, 1), sampleID);
  }
  bags.writeUInt16LE(generators.length, bags.length - 4);
  generators.push(Buffer.alloc(4));
  t.igen.data = Buffer.concat(generators);
  name(t.phdr.data, 0, "Miku Sustain");
  name(t.inst.data, 0, "Miku Sustain");
  // SF2 INFO strings include even-byte NUL padding in their declared chunk size.
  t.INAM.data = Buffer.from("Hatsune Miku FNF Sustain\0\0", "ascii");
  const body = Buffer.concat([Buffer.from("sfbk"), ...tree.map(encodeChunk)]);
  const header = Buffer.alloc(8); header.write("RIFF"); header.writeUInt32LE(body.length, 4);
  return { font: Buffer.concat([header, body]), report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) throw new Error("Usage: node scripts/miku-sustain.mjs source.sf2 destination.sf2");
  if (resolve(input) === resolve(output)) throw new Error("Never overwrite the source SoundFont");
  const source = await readFile(input);
  const { font, report } = buildSustainFont(source);
  await writeFile(output, font, { flag: "wx" });
  console.log(JSON.stringify({ sourceSha256: sha256(source), outputSha256: sha256(font), output, samples: report }, null, 2));
}
