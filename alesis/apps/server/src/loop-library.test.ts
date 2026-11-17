import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SilentAudioOutput } from "@alesis/audio";
import { SimulatedHostEngine, type MidiEvent } from "@alesis/engine";
import { MidiLoopScheduler } from "./loop-playback.js";
import { exportLoopSession, type LoopSessionHost } from "./loop-session.js";
import { LoopLibrary } from "./loop-library.js";

const preset = { id: "0:6", bank: 0, program: 6, name: "Test voice" };

/** A real session with one promoted take. */
async function sessionJson(bpm = 120): Promise<string> {
  const output = new SilentAudioOutput();
  const engine = new SimulatedHostEngine({ soundFonts: [{ id: "test-sf2", name: "Test" }], soundFontPresets: [preset], drumKits: [] });
  const loops = new MidiLoopScheduler(output);
  const host: LoopSessionHost = { engine, loops, percussionSoundFontId: null, inspectPresets: () => [preset], prepareAudio: async () => ({ commit: vi.fn(), dispose: async () => {} }) };
  await engine.execute({ type: "configure", settings: { bpm, beatsPerMeasure: 4, loopMeasures: 1, countInEnabled: false } });
  await engine.execute({ type: "play" });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    engine.advance(0.1);
    for (const event of [{ type: "note-on", channel: 0, note: 60, velocity: 90 }, { type: "note-off", channel: 0, note: 60 }] as MidiEvent[]) {
      loops.record(event, engine.snapshot());
      engine.dispatchMidi(event);
      engine.advance(0.2);
    }
    engine.advance(60 / bpm * 4);
    loops.update(engine.snapshot());
    if (cycle === 0) await engine.execute({ type: "promote-staged" });
  }
  await engine.execute({ type: "stop" });
  return exportLoopSession(host, { checkCapabilities: false }).sessionJson!;
}

let directory: string;
let library: LoopLibrary;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "alesis-loops-"));
  library = new LoopLibrary({ directory: join(directory, "loops"), log: () => {} });
  await library.init();
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("loop library", () => {
  it("keeps a loop under its name and describes it", async () => {
    const json = await sessionJson(96);
    const heard: number[] = [];
    library.subscribe((status) => heard.push(status.items.length));
    const saved = await library.save("My loop", json);
    expect(saved).toMatchObject({ id: "My loop", bpm: 96, loopMeasures: 1, beatsPerMeasure: 4, takeCount: 2 });
    expect(saved.bytes).toBe(Buffer.byteLength(json));
    expect(library.status().items).toEqual([saved]);
    expect(await library.read("My loop")).toBe(json);
    expect(await readdir(join(directory, "loops"))).toEqual(["My loop.json"]);
    expect(heard).toEqual([1]);
  });

  it("replaces a loop saved under the same name", async () => {
    await library.save("Take", await sessionJson(100));
    await library.save("Take", await sessionJson(140));
    expect(library.status().items).toHaveLength(1);
    expect(library.status().items[0]!.bpm).toBe(140);
  });

  it("refuses anything that is not a loop session or a safe name, creating nothing", async () => {
    await expect(library.save("Bad", "not json")).rejects.toThrow();
    await expect(library.save("Bad", JSON.stringify({ format: "other" }))).rejects.toThrow(/Invalid loop session/);
    for (const name of ["../escape", "a/b", "", ".hidden", "x".repeat(81), "semi;colon"]) {
      await expect(library.save(name, await sessionJson())).rejects.toThrow();
    }
    await expect(library.read("../etc/passwd")).rejects.toThrow();
    expect(await readdir(join(directory, "loops"))).toEqual([]);
    expect(await readdir(directory)).toEqual(["loops"]);
  });

  it("deletes a loop, and says so for one that is not there", async () => {
    await library.save("Gone", await sessionJson());
    await library.delete("Gone");
    expect(library.status().items).toEqual([]);
    expect(await readdir(join(directory, "loops"))).toEqual([]);
    await expect(library.delete("Gone")).rejects.toThrow(/No saved loop/);
    await expect(library.read("Gone")).rejects.toThrow(/No saved loop/);
  });

  it("notices files copied in or removed by hand, and reports damaged ones without losing the rest", async () => {
    const folder = join(directory, "loops");
    await library.save("Kept", await sessionJson());
    await writeFile(join(folder, "Copied.json"), await sessionJson(80));
    await writeFile(join(folder, "Damaged.json"), "{ nope");
    await writeFile(join(folder, "notes.txt"), "ignored");
    await writeFile(join(folder, "bad name!.json"), await sessionJson());
    await library.refresh();
    expect(library.status().items.map(({ id }) => id).sort()).toEqual(["Copied", "Kept"]);
    expect(library.status().unreadable).toEqual(["Damaged.json"]);
    await rm(join(folder, "Copied.json"));
    await library.refresh();
    expect(library.status().items.map(({ id }) => id)).toEqual(["Kept"]);
  });

  it("lists the most recently saved loop first and rereads a file that changed on disk", async () => {
    const folder = join(directory, "loops");
    await library.save("Older", await sessionJson());
    await library.save("Newer", await sessionJson());
    await utimes(join(folder, "Older.json"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    await library.refresh();
    expect(library.status().items.map(({ id }) => id)).toEqual(["Newer", "Older"]);
    await writeFile(join(folder, "Newer.json"), await sessionJson(61));
    await library.refresh();
    expect(library.status().items.find(({ id }) => id === "Newer")!.bpm).toBe(61);
    await mkdir(join(folder, "folder.json"));
    await library.refresh();
    expect(library.status().items).toHaveLength(2);
  });

  it("survives a missing folder", async () => {
    const lonely = new LoopLibrary({ directory: join(directory, "never-created"), log: () => {} });
    await lonely.refresh();
    expect(lonely.status()).toEqual({ items: [], unreadable: [] });
    expect((await lonely.save("First", await sessionJson())).id).toBe("First");
    expect(JSON.parse(await readFile(join(directory, "never-created", "First.json"), "utf8")).format).toBe("alesis-loop-session");
  });
});
