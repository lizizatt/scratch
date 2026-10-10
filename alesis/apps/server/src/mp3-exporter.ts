import { copyFile, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { exportNameSchema } from "@alesis/protocol";
import { renderLoopArtifact, type LoopArtifact, type LoopRecipe } from "./loop-render.js";

export { renderTakeWav, renderNeonWav, recordingToMidi, recordingToSoundFontMidi, encodeMp3, encodeSamplePcmMp3, mixWavsToCyclePcm } from "./midi-render.js";
export type { TakeWavRenderRequest } from "./midi-render.js";
export interface ExportRequest extends LoopRecipe { name: string; outputRoot?: string }
export interface ExportResult { directory: string; tracks: string[]; mix: string }

export async function publishMp3Artifact(artifact: LoopArtifact, rawName: string, outputRoot: string, signal?: AbortSignal): Promise<ExportResult> {
  const name = exportNameSchema.parse(rawName);
  const directory = join(outputRoot, name);
  await mkdir(outputRoot, { recursive: true });
  signal?.throwIfAborted();
  await mkdir(directory);
  try {
    const tracks: string[] = [];
    for (const file of [...artifact.tracks, artifact.mix]) {
      signal?.throwIfAborted();
      const destination = join(directory, basename(file));
      await copyFile(file, destination, constants.COPYFILE_EXCL);
      if (file !== artifact.mix) tracks.push(destination);
    }
    signal?.throwIfAborted();
    return { directory, tracks, mix: join(directory, basename(artifact.mix)) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export async function exportMp3Session(request: ExportRequest): Promise<ExportResult> {
  const name = exportNameSchema.parse(request.name);
  const artifact = await renderLoopArtifact(request, { target: "promoted" }, new AbortController().signal);
  try { return await publishMp3Artifact(artifact, name, request.outputRoot ?? join(homedir(), "alesis_recordings")); }
  finally { await artifact.release(); }
}
