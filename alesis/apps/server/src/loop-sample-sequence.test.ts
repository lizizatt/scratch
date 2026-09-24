import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { publishLoopSample } from "./loop-sample-sequence.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "alesis-loop-sequence-test-"));
  roots.push(root);
  return root;
}

async function stagedSample(root: string): Promise<string> {
  const staged = join(root, "sample.part");
  await writeFile(staged, "sample bytes");
  return staged;
}

describe("loop sample filename allocation", () => {
  it("allocates padded increasing names, retaining numbers after deletion and a fresh allocator call", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);

    const first = await publishLoopSample(staged, root);
    const second = await publishLoopSample(staged, root);
    await rm(first.path);
    const afterDeletionAndRestart = await publishLoopSample(staged, root);

    expect([first.filename, second.filename, afterDeletionAndRestart.filename]).toEqual([
      "Loop 0001.mp3",
      "Loop 0002.mp3",
      "Loop 0003.mp3",
    ]);
  });

  it("starts after the highest existing generated sample and ignores unrelated files", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);
    await writeFile(join(root, "Loop 0042.mp3"), "existing");
    await writeFile(join(root, "Loop Notes.mp3"), "unrelated");

    await expect(publishLoopSample(staged, root)).resolves.toMatchObject({ filename: "Loop 0043.mp3" });
  });

  it("reserves unique numbers across concurrent publishers", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);

    const published = await Promise.all(Array.from({ length: 12 }, () => publishLoopSample(staged, root)));
    const filenames = published.map(({ filename }) => filename).sort();

    expect(new Set(filenames).size).toBe(12);
    expect(filenames).toEqual(Array.from({ length: 12 }, (_, index) => `Loop ${String(index + 1).padStart(4, "0")}.mp3`));
  });

  it("keeps allocation markers when published samples are removed", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);
    const published = await publishLoopSample(staged, root);
    await rm(published.path);

    const markers = await readdir(join(root, ".loop-sample-sequence"));
    await expect(publishLoopSample(staged, root)).resolves.toMatchObject({ filename: "Loop 0002.mp3" });
    expect(markers).toContain("1");
  });

  it("keeps explicit UUID-based names and does not create sequence state", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);

    const published = await publishLoopSample(staged, root, "Manual Loop");

    expect(published.filename).toMatch(/^Manual Loop-[0-9a-f-]{36}\.mp3$/);
    await expect(readdir(join(root, ".loop-sample-sequence"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects sequence values outside JavaScript's safe integer range", async () => {
    const root = await temporaryRoot();
    const staged = await stagedSample(root);
    const sequenceDirectory = join(root, ".loop-sample-sequence");
    await mkdir(sequenceDirectory);
    await writeFile(join(sequenceDirectory, "9007199254740992"), "");

    await expect(publishLoopSample(staged, root)).rejects.toThrow("safe integer range");
  });
});
