import { constants } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { exportNameSchema } from "@alesis/protocol";
import { renderLoopArtifact, type LoopArtifact, type LoopRecipe } from "./loop-render.js";
import { publishLoopSample } from "./loop-sample-sequence.js";

export { makeDrumRecording } from "./loop-layers.js";
export interface ExportLoopSampleRequest extends LoopRecipe { name?: string; sampleRoot: string }
export interface ExportLoopSampleResult { filename: string; path: string; durationSeconds: number; warning?: string }

export async function publishSampleArtifact(artifact: LoopArtifact, sampleRoot: string, rawName?: string, signal?: AbortSignal): Promise<ExportLoopSampleResult> {
  const name = rawName === undefined ? undefined : exportNameSchema.parse(rawName);
  await mkdir(sampleRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(join(sampleRoot, ".alesis-loop-sample-"));
  let result: ExportLoopSampleResult | undefined;
  try {
    const part = join(temporaryDirectory, "sample.part");
    await copyFile(artifact.mix, part, constants.COPYFILE_EXCL);
    signal?.throwIfAborted();
    const published = await publishLoopSample(part, sampleRoot, name);
    if (signal?.aborted) { await rm(published.path, { force: true }); signal.throwIfAborted(); }
    result = { ...published, durationSeconds: artifact.durationSeconds };
    return result;
  } finally {
    try { await rm(temporaryDirectory, { recursive: true, force: true }); }
    catch {
      try { console.warn("Unable to clean up temporary loop sample export directory"); } catch { /* Retain the publication result. */ }
      if (result) result.warning = "Temporary loop sample cleanup failed";
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function exportLoopSample(request: ExportLoopSampleRequest): Promise<ExportLoopSampleResult> {
  const name = request.name === undefined ? undefined : exportNameSchema.parse(request.name);
  const artifact = await renderLoopArtifact(request, { target: "sample" }, new AbortController().signal);
  let result: ExportLoopSampleResult | undefined;
  try { result = await publishSampleArtifact(artifact, request.sampleRoot, name); return result; }
  finally {
    try { await artifact.release(); }
    catch { if (result) result.warning = "Temporary loop sample cleanup failed"; }
  }
}

