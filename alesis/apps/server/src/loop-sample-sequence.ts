import { randomUUID } from "node:crypto";
import { link, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { exportNameSchema } from "@alesis/protocol";

const SEQUENCE_DIRECTORY = ".loop-sample-sequence";
const GENERATED_FILENAME = /^Loop ([0-9]+)\.mp3$/;

export interface PublishedLoopSample {
  filename: string;
  path: string;
}

export async function publishLoopSample(stagedPath: string, sampleRoot: string, rawName?: string): Promise<PublishedLoopSample> {
  const name = rawName === undefined ? undefined : exportNameSchema.parse(rawName);
  await mkdir(sampleRoot, { recursive: true });

  if (name !== undefined) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const filename = `${name}-${randomUUID()}.mp3`;
      const path = join(sampleRoot, filename);
      try {
        await link(stagedPath, path);
        return { filename, path };
      } catch (error) {
        if (!isAlreadyExists(error) || attempt === 7) throw error;
      }
    }
    throw new Error("Unable to allocate a unique sample filename");
  }

  const sequenceDirectory = join(sampleRoot, SEQUENCE_DIRECTORY);
  await mkdir(sequenceDirectory, { recursive: true });
  while (true) {
    const highWater = await readHighWaterMark(sampleRoot, sequenceDirectory);
    if (highWater >= Number.MAX_SAFE_INTEGER) throw new Error("Loop sample sequence exceeded the safe integer range");

    const sequence = highWater + 1;
    const markerPath = join(sequenceDirectory, String(sequence));
    try {
      const marker = await open(markerPath, "wx");
      await marker.close();
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      throw error;
    }

    const filename = `Loop ${String(sequence).padStart(4, "0")}.mp3`;
    const path = join(sampleRoot, filename);
    try {
      await link(stagedPath, path);
      return { filename, path };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
}

async function readHighWaterMark(sampleRoot: string, sequenceDirectory: string): Promise<number> {
  let highWater = 0;
  const markers = await readdir(sequenceDirectory, { withFileTypes: true });
  for (const marker of markers) {
    if (!marker.isFile() || !/^[1-9][0-9]*$/.test(marker.name)) continue;
    highWater = Math.max(highWater, parseSafeSequence(marker.name));
  }

  const entries = await readdir(sampleRoot, { withFileTypes: true });
  for (const entry of entries) {
    const match = GENERATED_FILENAME.exec(entry.name);
    if (match) highWater = Math.max(highWater, parseSafeSequence(match[1]!));
  }
  return highWater;
}

function parseSafeSequence(value: string): number {
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw new Error("Loop sample sequence exceeded the safe integer range");
  return sequence;
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
