import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { EngineResult } from "@alesis/engine";
import {
  arpeggiatorSchema,
  drumSettingsSchema,
  quantizationModeSchema,
  settingsSchema,
  padModeSchema,
  padNavigationTargetSchema,
  padAssignmentsSchema,
  type EngineCommand,
  type EngineSnapshot,
} from "@alesis/protocol";
import { z } from "zod";

const cachedSettingsSchema = settingsSchema.pick({
  bpm: true,
  beatsPerMeasure: true,
  loopMeasures: true,
  velocityCurve: true,
  minimumVelocity: true,
  metronomeEnabled: true,
  metronomeVolume: true,
  countInEnabled: true,
});

const cachedPadsSchema = z.object({
  mode: padModeSchema,
  navigationTarget: padNavigationTargetSchema,
  navigationIndex: z.number().int().nonnegative(),
  selectedDrumKitId: z.string().min(1).nullable(),
  samplePageIndex: z.number().int().nonnegative(),
  assignments: padAssignmentsSchema.default([]),
}).strict();

const settingsCacheSchema = z.object({
  version: z.literal(1),
  settings: cachedSettingsSchema,
  synth: z.object({
    selectedId: z.string().min(1),
    selectedSoundFontId: z.string().min(1).nullable(),
    selectedSoundFontPresetId: z.string().min(1).nullable(),
    parameterValues: z.record(z.number()),
  }),
  arpeggiator: arpeggiatorSchema,
  drums: drumSettingsSchema,
  quantization: quantizationModeSchema,
  pads: cachedPadsSchema.optional(),
}).strict();

export type SettingsCache = Omit<z.infer<typeof settingsCacheSchema>, "pads"> & { pads: z.infer<typeof cachedPadsSchema> };

const defaultCachedPads: SettingsCache["pads"] = {
  mode: "drums",
  navigationTarget: "voices",
  navigationIndex: 0,
  selectedDrumKitId: null,
  samplePageIndex: 0,
  assignments: [],
};

export function defaultSettingsCachePath(environment = process.env): string {
  return environment.ALESIS_SETTINGS_PATH
    ?? join(environment.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "alesis", "settings-v1.json");
}

export function settingsCacheFromSnapshot(snapshot: EngineSnapshot): SettingsCache {
  const { midiInputId: _midiInputId, audioOutputId: _audioOutputId, ...settings } = snapshot.settings;
  return {
    version: 1,
    settings,
    synth: {
      selectedId: snapshot.synth.selectedId,
      selectedSoundFontId: snapshot.synth.selectedSoundFontId,
      selectedSoundFontPresetId: snapshot.synth.selectedSoundFontPresetId,
      parameterValues: snapshot.synth.parameterValues,
    },
    arpeggiator: snapshot.arpeggiator,
    drums: snapshot.drums,
    quantization: snapshot.capture.quantization,
    pads: {
      mode: snapshot.pads.mode,
      navigationTarget: snapshot.pads.navigationTarget,
      navigationIndex: snapshot.pads.navigationIndex,
      selectedDrumKitId: snapshot.pads.selectedDrumKitId,
      samplePageIndex: snapshot.pads.samplePageIndex,
      assignments: snapshot.pads.assignments,
    },
  };
}

export async function loadSettingsCache(path: string): Promise<SettingsCache | null> {
  try {
    const stored = JSON.parse(await readFile(path, "utf8"));
    if (stored && typeof stored === "object") delete stored.chord;
    const parsed = settingsCacheSchema.safeParse(stored).data;
    return parsed ? { ...parsed, pads: parsed.pads ?? defaultCachedPads } : null;
  } catch {
    return null;
  }
}

export async function saveSettingsCache(path: string, cache: SettingsCache): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
    const temporaryFile = await open(temporaryPath, "r");
    await temporaryFile.sync();
    await temporaryFile.close();
    await rename(temporaryPath, path);
    const directoryHandle = await open(directory, "r");
    await directoryHandle.sync();
    await directoryHandle.close();
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function restoreSettingsCache(
  cache: SettingsCache,
  execute: (command: EngineCommand) => Promise<EngineResult>,
  snapshot?: () => EngineSnapshot,
): Promise<void> {
  const commands: EngineCommand[] = [
    { type: "configure", settings: cache.settings },
    { type: "select-synth", synthId: cache.synth.selectedId },
    ...(cache.synth.selectedSoundFontId ? [{ type: "select-soundfont" as const, soundFontId: cache.synth.selectedSoundFontId }] : []),
    ...(cache.synth.selectedSoundFontPresetId ? [{ type: "select-soundfont-preset" as const, presetId: cache.synth.selectedSoundFontPresetId }] : []),
    ...Object.entries(cache.synth.parameterValues).map(([parameterId, value]) => ({ type: "set-synth-parameter" as const, parameterId, value })),
    { type: "configure-arpeggiator", settings: cache.arpeggiator },
    { type: "configure-drums", settings: cache.drums },
    { type: "set-quantization", mode: cache.quantization },
    { type: "set-pad-mode", mode: cache.pads.mode },
  ];
  for (const command of commands) await execute(command);

  if (snapshot) {
    await execute({ type: "set-pad-navigation-target", target: "drum-kits" });
    const kits = snapshot().pads.drumKits
      .slice()
      .sort((left, right) => left.bank - right.bank || left.program - right.program || left.name.localeCompare(right.name));
    const selectedIndex = kits.findIndex(({ id }) => id === cache.pads.selectedDrumKitId);
    const fallbackIndex = cache.pads.navigationTarget === "drum-kits"
      ? Math.min(cache.pads.navigationIndex, kits.length - 1)
      : -1;
    const index = selectedIndex >= 0 ? selectedIndex : fallbackIndex;
    if (index >= 0) await execute({ type: "select-pad-program", program: index });

  }

  await execute({ type: "set-pad-navigation-target", target: "sample-pages" });
  const samplePageCount = snapshot?.().pads.navigationCount;
  if (samplePageCount === undefined || cache.pads.samplePageIndex < samplePageCount) {
    await execute({ type: "select-pad-program", program: cache.pads.samplePageIndex });
  }

  await execute({ type: "set-pad-navigation-target", target: cache.pads.navigationTarget });
}
