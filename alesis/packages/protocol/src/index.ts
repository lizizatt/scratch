import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const waveformSchema = z.array(z.number().min(-1).max(1)).max(256);
const takeIdSchema = z.string().min(1).max(128);
export const exportNameSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/);
export const quantizationModeSchema = z.enum(["off", "1/4", "1/8", "1/16", "1/32"]);

export const settingsSchema = z.object({
  bpm: z.number().int().min(30).max(300),
  beatsPerMeasure: z.number().int().min(1).max(16),
  loopMeasures: z.number().int().min(1).max(128),
  midiInputId: z.string(),
  audioOutputId: z.string(),
  metronomeEnabled: z.boolean(),
  metronomeVolume: z.number().min(0).max(1),
  countInEnabled: z.boolean(),
});

export const takeSchema = z.object({
  id: takeIdSchema,
  cycle: z.number().int().nonnegative(),
  level: z.number().min(0).max(1),
  muted: z.boolean(),
  waveform: waveformSchema,
});

export const instrumentControlSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.literal("range"),
  group: z.enum(["tone", "envelope", "modulation", "output", "effects"]),
  advanced: z.boolean(),
  defaultValue: z.number(),
  minimum: z.number(),
  maximum: z.number(),
  step: z.number().positive(),
  unit: z.string(),
});

export const instrumentDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  engine: z.enum(["neon", "fluidsynth"]),
  controls: z.array(instrumentControlSchema),
});

export const soundFontSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
});

export const soundFontPresetSchema = z.object({
  id: z.string().min(1).max(128),
  bank: z.number().int().min(0).max(16_383),
  program: z.number().int().min(0).max(127),
  name: z.string().min(1).max(256),
});

export const arpeggiatorSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["up", "down", "up-down", "up-to-root-then-down", "played", "random"]),
  rate: z.enum(["1/4", "1/8", "1/16", "1/8T", "1/16T"]),
  octaves: z.number().int().min(1).max(4),
  gate: z.number().min(0.1).max(1),
  latch: z.boolean(),
  swing: z.number().min(0).max(0.5),
});

export const drumSettingsSchema = z.object({
  enabled: z.boolean(),
  pattern: z.enum(["four-on-floor", "backbeat", "breakbeat"]),
  volume: z.number().min(0).max(1),
});

export const engineSnapshotSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  engine: z.object({
    mode: z.enum(["simulated", "native"]),
    midiConnected: z.boolean(),
    audioConnected: z.boolean(),
    midiEventsReceived: z.number().int().nonnegative(),
    lastMidiEvent: z.enum(["note-on", "note-off", "pitch-bend", "control-change", "channel-pressure"]).nullable(),
  }),
  settings: settingsSchema,
  transport: z.object({
    state: z.enum(["stopped", "counting-in", "playing"]),
    cycle: z.number().int().nonnegative(),
    progress: z.number().min(0).max(1),
  }),
  monitorOnly: z.boolean(),
  synth: z.object({
    selectedId: z.string(),
    instruments: z.array(instrumentDescriptorSchema),
    soundFonts: z.array(soundFontSchema),
    selectedSoundFontId: z.string().nullable(),
    soundFontPresets: z.array(soundFontPresetSchema),
    selectedSoundFontPresetId: z.string().nullable(),
    parameterValues: z.record(z.number()),
  }),
  arpeggiator: arpeggiatorSchema,
  drums: drumSettingsSchema,
  capture: z.object({
    currentWaveform: waveformSchema,
    staged: takeSchema.nullable(),
    previousStaged: takeSchema.nullable(),
    stagedAudible: z.boolean(),
    quantization: quantizationModeSchema,
  }),
  promoted: z.array(takeSchema),
  canUndoDelete: z.boolean(),
});

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("set-monitor-only"), enabled: z.boolean() }),
  z.object({ type: z.literal("configure"), settings: settingsSchema.partial(), clearAudio: z.boolean().optional() }),
  z.object({ type: z.literal("select-synth"), synthId: z.string().min(1) }),
  z.object({ type: z.literal("select-soundfont"), soundFontId: z.string().min(1).max(128) }),
  z.object({ type: z.literal("select-soundfont-preset"), presetId: z.string().min(1).max(128) }),
  z.object({ type: z.literal("refresh-soundfonts") }),
  z.object({ type: z.literal("set-synth-parameter"), parameterId: z.string().min(1), value: z.number() }),
  z.object({ type: z.literal("configure-arpeggiator"), settings: arpeggiatorSchema.partial() }),
  z.object({ type: z.literal("configure-drums"), settings: drumSettingsSchema.partial() }),
  z.object({ type: z.literal("set-staged-audible"), audible: z.boolean() }),
  z.object({ type: z.literal("set-quantization"), mode: quantizationModeSchema }),
  z.object({ type: z.literal("promote-staged") }),
  z.object({ type: z.literal("promote-previous-staged") }),
  z.object({ type: z.literal("set-take-level"), takeId: takeIdSchema, level: z.number().min(0).max(1) }),
  z.object({ type: z.literal("set-take-muted"), takeId: takeIdSchema, muted: z.boolean() }),
  z.object({ type: z.literal("delete-take"), takeId: takeIdSchema }),
  z.object({ type: z.literal("undo-delete") }),
  z.object({ type: z.literal("export-mp3"), name: exportNameSchema }),
]);

export const commandEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  command: commandSchema,
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: engineSnapshotSchema }),
  z.object({
    type: z.literal("command-result"),
    commandId: z.string().uuid(),
    accepted: z.boolean(),
    revision: z.number().int().nonnegative(),
    appliedCycle: z.number().int().nonnegative(),
    error: z.string().optional(),
    message: z.string().optional(),
  }),
]);

export type Settings = z.infer<typeof settingsSchema>;
export type Take = z.infer<typeof takeSchema>;
export type InstrumentControl = z.infer<typeof instrumentControlSchema>;
export type InstrumentDescriptor = z.infer<typeof instrumentDescriptorSchema>;
export type SoundFont = z.infer<typeof soundFontSchema>;
export type SoundFontPreset = z.infer<typeof soundFontPresetSchema>;
export type ArpeggiatorSettings = z.infer<typeof arpeggiatorSchema>;
export type DrumSettings = z.infer<typeof drumSettingsSchema>;
export type QuantizationMode = z.infer<typeof quantizationModeSchema>;
export type EngineSnapshot = z.infer<typeof engineSnapshotSchema>;
export type EngineCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
