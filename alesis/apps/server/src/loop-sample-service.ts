import { basename } from "node:path";
import { exportNameSchema, type EngineSnapshot } from "@alesis/protocol";
import type { EngineResult } from "@alesis/engine";
import type { RecordedMidiEvent } from "./loop-playback.js";

export interface LoopSampleCapture {
  snapshot: EngineSnapshot;
  recordings: Map<string, RecordedMidiEvent[]>;
  soundFontPath?: string;
  percussionSoundFontPath?: string;
}

export interface LoopSampleRequest extends LoopSampleCapture {
  name?: string;
  sampleRoot: string;
}

export interface LoopSampleRenderer {
  (request: LoopSampleRequest): Promise<{ filename: string; path: string; durationSeconds: number; warning?: string }>;
}

export interface LoopSampleExportDependencies {
  capture(name?: string): LoopSampleCapture;
  render: LoopSampleRenderer;
  refreshSamples(): Promise<EngineResult>;
  sampleRoot: string;
  resultState(): Pick<EngineResult, "revision" | "appliedCycle">;
}

export interface LoopSampleExportService {
  execute(name?: string): Promise<EngineResult>;
  busy(): boolean;
}

export function createLoopSampleExportService(dependencies: LoopSampleExportDependencies): LoopSampleExportService {
  let exporting = false;
  return {
    busy: () => exporting,
    async execute(rawName) {
      const current = () => dependencies.resultState();
      if (exporting) return { accepted: false, ...current(), error: "A loop sample export is already in progress" };
      exporting = true;
      try {
        const name = rawName === undefined ? undefined : exportNameSchema.parse(rawName);
        const captured = dependencies.capture(name);
        const snapshot = structuredClone(captured.snapshot);
        const recordings = structuredClone(captured.recordings);
        const rendered = await dependencies.render({
          snapshot,
          recordings,
          sampleRoot: dependencies.sampleRoot,
          ...(name === undefined ? {} : { name }),
          ...(captured.soundFontPath === undefined ? {} : { soundFontPath: captured.soundFontPath }),
          ...(captured.percussionSoundFontPath === undefined ? {} : { percussionSoundFontPath: captured.percussionSoundFontPath }),
        });
        const filename = basename(rendered.filename);
        const warnings: string[] = rendered.warning ? [sanitizeMessage(rendered.warning)] : [];
        try {
          const refreshResult = await dependencies.refreshSamples();
          if (!refreshResult.accepted) {
            warnings.push(`the file exists, but the sample library could not be refreshed (${sanitizeMessage(refreshResult.error ?? "sample library refresh was rejected")})`);
          }
        } catch (error) {
          warnings.push(`the file exists, but the sample library could not be refreshed (${sanitizeMessage(errorMessage(error))})`);
        }
        const message = warnings.length > 0
          ? `Saved ${filename}. Warning: ${warnings.join("; ")}.`
          : `Saved ${filename} to the sample library.`;
        return { accepted: true, ...current(), message };
      } catch (error) {
        return { accepted: false, ...current(), error: `Unable to export loop sample: ${sanitizeMessage(errorMessage(error))}` };
      } finally {
        exporting = false;
      }
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeMessage(message: string): string {
  return message.replace(/(?:\/[\w.-]+){2,}(?:\/[^\s:]*)?/g, "[local path]");
}
