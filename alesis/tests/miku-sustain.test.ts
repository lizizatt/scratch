import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../scripts/miku-sustain.mjs", import.meta.url);
const scriptPath = fileURLToPath(scriptUrl);
const asset = process.env.ALESIS_MIKU_FNF_SOUNDFONT_PATH ?? join(homedir(), "Downloads", "Hatsune Miku FNF.sf2");
const pinnedHash = "96dad7c0f173e5c5a2cb465ce89e0c1b87555c557cce2c1f69ea10f7959404d9";
const options = { encoding: "utf8" as const, timeout: 120_000, maxBuffer: 1024 * 1024 };

function probe(code: string, args: string[] = []) {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";
    import { buildSustainFont, sf2Tables, chooseLoop, SOURCE_SHA256, sha256 } from ${JSON.stringify(scriptUrl.href)};
    ${code}
  `, ...args], options);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

describe("Miku sustain generator", () => {
  it("rejects premature cutoffs immediately before note-off", () => {
    probe(`
      const { assessAudio } = await import(${JSON.stringify(new URL("../scripts/check-miku-sustain.mjs", import.meta.url).href)});
      const signal = cutoff => ({ peak: .1, rms: (start, end) =>
        .1 * Math.sqrt(Math.max(0, Math.min(end, cutoff) - start) / (end - start)) });
      assert.equal(assessAudio(signal(6)).passed, true);
      assert.equal(assessAudio(signal(5.8)).passed, false);
      assert.equal(assessAudio(signal(5.95)).passed, false);
      assert.equal(assessAudio(signal(7)).passed, false);
      assert.equal(assessAudio(signal(1.9)).passed, false);
      assert.equal(assessAudio(signal(1.9), true).passed, true);
    `);
  });

  it("pins the source checksum and rejects unverified bytes and inaudible loops", () => {
    probe(`
      assert.equal(SOURCE_SHA256, ${JSON.stringify(pinnedHash)});
      assert.equal(sha256(Buffer.from("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
      const invalid = Buffer.from("not the verified font"), before = Buffer.from(invalid);
      assert.throws(() => buildSustainFont(invalid), /Source checksum/);
      assert.deepEqual(invalid, before);
      assert.throws(() => chooseLoop(new Int16Array(48000), 48000), /No audible sustain region/);
      const rate = 48000, samples = Int16Array.from({ length: rate }, (_, i) => Math.round(12000 * Math.sin(2 * Math.PI * i / 100)));
      const loop = chooseLoop(samples, rate);
      assert.equal(loop.width, 1920);
      assert.ok(loop.start >= .30 * rate && loop.start <= .55 * rate);
      assert.ok(loop.end > loop.start + loop.width && loop.end <= samples.length - loop.width);
      assert.ok(Number.isFinite(loop.cost) && loop.correlation > .99);
    `);
  });

  describe.skipIf(!existsSync(asset))(`external pinned font (skipped if absent: ${asset})`, () => {
    it("preserves metadata and every sample attack while rebuilding valid sustain zones and seams", () => {
      probe(`
        const source = readFileSync(process.argv[1]), snapshot = Buffer.from(source);
        assert.equal(sha256(source), SOURCE_SHA256);
        const { font, report } = buildSustainFont(source);
        assert.deepEqual(source, snapshot);
        assert.deepEqual(readFileSync(process.argv[1]), snapshot);
        assert.notEqual(sha256(font), SOURCE_SHA256);
        assert.equal(font.toString("ascii", 0, 4), "RIFF");
        assert.equal(font.toString("ascii", 8, 12), "sfbk");
        assert.equal(font.readUInt32LE(4), font.length - 8);
        const old = sf2Tables(source), next = sf2Tables(font), a = old.tables, b = next.tables;
        const modified = new Set(["smpl", "shdr", "igen", "ibag", "phdr", "inst", "INAM"]);
        const preserved = tree => tree.map(c => c.children
          ? { id: c.id, type: c.type, children: preserved(c.children) }
          : { id: c.id, data: modified.has(c.id) ? null : c.data });
        assert.deepEqual(preserved(next.tree), preserved(old.tree));
        const name = data => data.toString("ascii", 0, data.indexOf(0));
        for (const id of ["phdr", "inst"]) {
          assert.equal(name(b[id].data), "Miku Sustain");
          assert.deepEqual(b[id].data.subarray(20), a[id].data.subarray(20));
        }
        assert.equal(name(b.INAM.data), "Hatsune Miku FNF Sustain");
        assert.equal(b.INAM.data.length % 2, 0);
        assert.equal(b.INAM.data.at(-1), 0);
        assert.equal(report.length, 48);
        assert.equal(b.shdr.data.length, 49 * 46);
        assert.equal(b.smpl.data.length, a.smpl.data.length);
        const headers = Buffer.from(b.shdr.data), expectedPcm = Buffer.from(a.smpl.data);
        for (let index = 0; index < 48; index++) {
          const p = index * 46, h = b.shdr.data;
          const start = h.readUInt32LE(p + 20), end = h.readUInt32LE(p + 24), rate = h.readUInt32LE(p + 36);
          const ls = h.readUInt32LE(p + 28), le = h.readUInt32LE(p + 32), r = report[index];
          assert.equal(r.sample, index);
          assert.equal(r.root, h[p + 40]);
          assert.equal(r.startFrame, ls - start);
          assert.equal(r.endFrame, le - start);
          assert.equal(r.startSeconds, r.startFrame / rate);
          assert.equal(r.endSeconds, r.endFrame / rate);
          assert.equal(r.crossfadeFrames, Math.round(.04 * rate));
          assert.ok(r.correlation >= .8 && r.correlation <= 1.000001);
          assert.ok(ls >= start + Math.round(.30 * rate) && ls <= start + Math.round(.55 * rate));
          assert.ok(ls - r.crossfadeFrames >= start && le - r.crossfadeFrames > ls && le <= end - r.crossfadeFrames);
          const attackEnd = start + Math.ceil(.25 * rate);
          assert.ok(attackEnd <= end && attackEnd <= le - r.crossfadeFrames);
          assert.deepEqual(b.smpl.data.subarray(start * 2, attackEnd * 2), a.smpl.data.subarray(start * 2, attackEnd * 2));
          const pcm = (table, frame) => table.smpl.data.readInt16LE(frame * 2);
          assert.equal(pcm(b, le - 1), pcm(a, ls - 1), "crossfade ends at the pre-loop frame");
          assert.equal(pcm(b, ls) - pcm(b, le - 1), pcm(a, ls) - pcm(a, ls - 1), "wrap derivative matches source");
          b.smpl.data.copy(expectedPcm, (le - r.crossfadeFrames) * 2, (le - r.crossfadeFrames) * 2, le * 2);
          a.shdr.data.copy(headers, p + 28, p + 28, p + 36);
        }
        assert.deepEqual(headers, a.shdr.data); // Includes names, root/pitch, links and EOS.
        assert.deepEqual(b.smpl.data, expectedPcm); // Only crossfade windows may change.
        const bags = b.ibag.data, originalBags = a.ibag.data;
        assert.equal(bags.length, originalBags.length);
        assert.equal(bags.length % 4, 0);
        assert.equal(b.igen.data.length % 4, 0);
        assert.equal(b.inst.data.length % 22, 0);
        assert.equal(name(b.inst.data.subarray(-22)), "EOI");
        assert.equal(b.inst.data.readUInt16LE(b.inst.data.length - 2), bags.length / 4 - 1);
        const zone = (t, i) => {
          const first = t.ibag.data.readUInt16LE(i), last = t.ibag.data.readUInt16LE(i + 4), records = [];
          assert.ok(first <= last && last <= t.igen.data.length / 4 - 1);
          for (let j = first; j < last; j++) records.push([t.igen.data.readUInt16LE(j * 4), t.igen.data.readInt16LE(j * 4 + 2)]);
          return records;
        };
        assert.equal(bags.readUInt16LE(0), 0);
        assert.deepEqual(zone(a, 0), []);
        assert.deepEqual(zone(b, 0), []);
        for (let i = 0; i < bags.length; i += 4) {
          assert.equal(bags.readUInt16LE(i + 2), originalBags.readUInt16LE(i + 2));
          if (i === 0 || i === bags.length - 4) continue;
          const before = zone(a, i), after = zone(b, i);
          const unchanged = records => records.filter(([op]) => ![37, 38, 54].includes(op));
          assert.deepEqual(unchanged(after), unchanged(before)); // Key ranges, pan, sample IDs and pitch generators.
          assert.deepEqual(after.slice(-4), [[37, 0], [38, -3600], [54, 1], before.find(([op]) => op === 53)]);
          for (const op of [37, 38, 54, 53]) assert.equal(after.filter(([id]) => id === op).length, 1);
        }
        assert.equal(bags.readUInt16LE(bags.length - 4), b.igen.data.length / 4 - 1);
        assert.deepEqual(b.igen.data.subarray(-4), Buffer.alloc(4));
      `, [asset]);
    }, 120_000);

    it("writes a loadable font exclusively and never overwrites an existing destination or source", () => {
      const directory = mkdtempSync(join(tmpdir(), "alesis-miku-sustain-test-"));
      try {
        const source = join(directory, "source.sf2"), output = join(directory, "sustain.sf2"), original = readFileSync(asset);
        writeFileSync(source, original);
        const run = (destination: string) => spawnSync(process.execPath, [scriptPath, source, destination], options);
        const created = run(output);
        expect(created.error).toBeUndefined();
        expect(created.status, created.stderr).toBe(0);
        expect(JSON.parse(created.stdout)).toMatchObject({ sourceSha256: pinnedHash, output });
        probe(`const { font } = buildSustainFont(readFileSync(process.argv[1])); assert.deepEqual(readFileSync(process.argv[2]), font);`, [source, output]);
        const checker = fileURLToPath(new URL("../scripts/check-miku-sustain.mjs", import.meta.url));
        for (const [font, label, status] of [[source, "original", 1], [output, "sustained", 0]] as const) {
          const renders = join(directory, label);
          const checked = spawnSync(process.execPath, [checker, font, renders], options);
          expect(checked.error).toBeUndefined();
          expect(checked.status, checked.stderr || checked.stdout).toBe(status);
          const { rows } = JSON.parse(readFileSync(join(renders, "results.json"), "utf8"));
          expect(rows).toHaveLength(5);
          expect(rows.every((row: { passed: boolean }) => row.passed === (status === 0))).toBe(true);
        }
        writeFileSync(output, "existing destination sentinel");
        for (const [destination, message] of [[output, "EEXIST"], [source, "Never overwrite the source SoundFont"]]) {
          const rejected = run(destination);
          expect(rejected.error).toBeUndefined();
          expect(rejected.status).not.toBe(0);
          expect(rejected.stderr).toContain(message);
          expect(readFileSync(output, "utf8")).toBe("existing destination sentinel");
          expect(readFileSync(source).equals(original)).toBe(true);
        }
        expect(readFileSync(asset).equals(original)).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }, 120_000);
  });
});
