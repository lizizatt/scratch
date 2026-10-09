import { z } from "zod";

export const PROTOCOL_VERSION = 6 as const;

export const LOOP_SESSION_MAX_BYTES = 4 * 1024 * 1024;
export const LOOP_SESSION_MAX_EVENTS_PER_TAKE = 32_768;
export const LOOP_SESSION_MAX_EVENTS = 100_000;
export const MAX_PROMOTED_TAKES = 12;

const midiByte = z.number().int().min(0).max(127);
const midiChannel = z.number().int().min(0).max(15);
export const midiEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("note-on"), channel: midiChannel, note: midiByte, velocity: midiByte }).strict(),
  z.object({ type: z.literal("note-off"), channel: midiChannel, note: midiByte }).strict(),
  z.object({ type: z.literal("pitch-bend"), channel: midiChannel, value: z.number().min(-1).max(1) }).strict(),
  z.object({ type: z.literal("control-change"), channel: midiChannel, controller: midiByte, value: midiByte }).strict(),
  z.object({ type: z.literal("channel-pressure"), channel: midiChannel, value: midiByte }).strict(),
]);
export type MidiEvent = z.infer<typeof midiEventSchema>;

const waveformSchema = z.array(z.number().min(-1).max(1)).max(256);
const takeIdSchema = z.string().min(1).max(128);
export const exportNameSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/);
export const quantizationModeSchema = z.enum(["off", "1/4", "1/8", "1/16", "1/32"]);
export const velocityCurveSchema = z.enum(["linear", "responsive", "strong", "fixed"]);

export const dependencyReadinessSchema = z.object({
  ready: z.boolean(),
  reason: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
});

export const readinessSchema = z.object({
  soundFont: dependencyReadinessSchema,
  synth: dependencyReadinessSchema,
  audio: dependencyReadinessSchema,
  midi: dependencyReadinessSchema,
});

export const settingsSchema = z.object({
  bpm: z.number().int().min(30).max(300),
  beatsPerMeasure: z.number().int().min(1).max(16),
  loopMeasures: z.number().int().min(1).max(128),
  midiInputId: z.string(),
  audioOutputId: z.string(),
  velocityCurve: velocityCurveSchema,
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

export const padModeSchema = z.enum(["drums", "samples"]);
export const padNavigationTargetSchema = z.enum(["voices", "drum-kits", "sample-pages"]);
export const drumKitSchema = z.object({
  id: z.string().min(1).max(128),
  bank: z.number().int().min(0).max(16_383),
  program: z.number().int().min(0).max(127),
  name: z.string().min(1).max(256),
});
export const samplePadSchema = z.object({
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  pad: z.number().int().min(0).max(7),
}).nullable();
export const padsSchema = z.object({
  mode: padModeSchema,
  navigationTarget: padNavigationTargetSchema,
  navigationIndex: z.number().int().nonnegative(),
  navigationCount: z.number().int().nonnegative(),
  selectedDrumKitId: z.string().min(1).nullable(),
  samplePageIndex: z.number().int().nonnegative(),
  samplePageCount: z.number().int().nonnegative(),
  samplePage: z.array(samplePadSchema).length(8),
  sampleLibraryStatus: z.enum(["ready", "loading", "error"]),
  sampleLibraryError: z.string().optional(),
  drumKits: z.array(drumKitSchema),
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
  pads: padsSchema,
  arpeggiator: arpeggiatorSchema,
  drums: drumSettingsSchema,
  capture: z.object({
    currentWaveform: waveformSchema,
    hasCurrentEvents: z.boolean(),
    staged: takeSchema.nullable(),
    previousStaged: takeSchema.nullable(),
    stagedAudible: z.boolean(),
    quantization: quantizationModeSchema,
  }),
  promoted: z.array(takeSchema),
  canUndoDelete: z.boolean(),
});

export const snapshotUpdateSchema = engineSnapshotSchema.pick({
  revision: true,
  engine: true,
  transport: true,
  capture: true,
  synth: true,
  pads: true,
});

const recordingSchema = z.array(z.object({
  position: z.number().min(0).max(1),
  event: midiEventSchema,
}).strict()).max(LOOP_SESSION_MAX_EVENTS_PER_TAKE).refine(
  (events) => events.every((event, index) => index === 0 || event.position >= events[index - 1]!.position),
  "Recording events must be ordered by position",
);
const sessionTakeSchema = z.object({
  take: takeSchema.extend({ cycle: z.number().int().nonnegative().safe() }).strict(),
  recording: recordingSchema,
}).strict();
export const loopSessionSchema = z.object({
  format: z.literal("alesis-loop-session"),
  version: z.literal(1),
  settings: settingsSchema.omit({ midiInputId: true, audioOutputId: true }).strict(),
  synth: z.object({
    selectedId: z.string().min(1).max(128),
    parameterValues: z.record(z.string().min(1).max(128), z.number().finite()).refine((values) => Object.keys(values).length <= 64, "Too many synth parameters"),
    soundFont: soundFontSchema.extend({ preset: soundFontPresetSchema.strict() }).strict().nullable(),
  }).strict(),
  drums: drumSettingsSchema.strict(),
  percussion: z.object({ soundFontId: z.string().min(1).max(128), kit: drumKitSchema.strict() }).strict().nullable(),
  arpeggiator: arpeggiatorSchema.strict(),
  monitorOnly: z.boolean(),
  stagedAudible: z.boolean(),
  quantization: quantizationModeSchema,
  staged: sessionTakeSchema.extend({ rawRecording: recordingSchema }).strict().nullable(),
  previousStaged: sessionTakeSchema.nullable(),
  promoted: z.array(sessionTakeSchema).max(MAX_PROMOTED_TAKES),
}).strict().superRefine((session, context) => {
  const takes = [session.staged, session.previousStaged, ...session.promoted].filter((take) => take !== null);
  if (new Set(takes.map(({ take }) => take.id)).size !== takes.length) context.addIssue({ code: "custom", message: "Duplicate take IDs" });
  const count = takes.reduce((sum, take) => sum + take.recording.length, session.staged?.rawRecording.length ?? 0);
  if (count > LOOP_SESSION_MAX_EVENTS) context.addIssue({ code: "custom", message: "Session has too many MIDI events" });
  if (session.synth.selectedId === "soundfont" && !session.synth.soundFont) context.addIssue({ code: "custom", message: "SoundFont selection is required" });
});
export type LoopSession = z.infer<typeof loopSessionSchema>;
export type SessionTake = z.infer<typeof sessionTakeSchema>;

export function parseLoopSession(json: string): LoopSession {
  if (new TextEncoder().encode(json).byteLength > LOOP_SESSION_MAX_BYTES) throw new Error("Loop session exceeds the 4 MiB file limit");
  const parsed = loopSessionSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new Error(`Invalid loop session: ${parsed.error.issues.slice(0, 4).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("play") }),
  z.object({ type: z.literal("stop") }),
  z.object({ type: z.literal("set-monitor-only"), enabled: z.boolean() }),
  z.object({ type: z.literal("configure"), settings: settingsSchema.partial(), clearAudio: z.boolean().optional() }),
  z.object({ type: z.literal("select-synth"), synthId: z.string().min(1) }),
  z.object({ type: z.literal("select-soundfont"), soundFontId: z.string().min(1).max(128) }),
  z.object({ type: z.literal("select-soundfont-preset"), presetId: z.string().min(1).max(128) }),
  z.object({ type: z.literal("refresh-soundfonts") }),
  z.object({ type: z.literal("set-pad-mode"), mode: padModeSchema }),
  z.object({ type: z.literal("set-pad-navigation-target"), target: padNavigationTargetSchema }),
  z.object({ type: z.literal("select-pad-program"), program: z.number().int().nonnegative().safe() }),
  z.object({ type: z.literal("step-pad-navigation"), direction: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ type: z.literal("refresh-samples") }),
  z.object({ type: z.literal("trigger-sample-pad"), pad: z.number().int().min(0).max(7), velocity: z.number().int().min(1).max(127) }),
  z.object({ type: z.literal("release-sample-pad"), pad: z.number().int().min(0).max(7) }),
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
  z.object({ type: z.literal("export-loop-sample"), name: exportNameSchema.optional() }),
  z.object({ type: z.literal("export-loop-session") }),
  // File validation belongs in the executor so invalid uploads are recoverable command errors.
  z.object({ type: z.literal("import-loop-session"), sessionJson: z.string() }),
]);

export const commandEnvelopeSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  commandId: z.string().uuid(),
  command: commandSchema,
});

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: engineSnapshotSchema, readiness: readinessSchema }),
  z.object({ type: z.literal("snapshot-update"), update: snapshotUpdateSchema, readiness: readinessSchema }),
  z.object({
    type: z.literal("command-result"),
    commandId: z.string().uuid(),
    accepted: z.boolean(),
    revision: z.number().int().nonnegative(),
    appliedCycle: z.number().int().nonnegative(),
    error: z.string().optional(),
    message: z.string().optional(),
    sessionJson: z.string().max(LOOP_SESSION_MAX_BYTES).optional(),
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
export type PadMode = z.infer<typeof padModeSchema>;
export type PadNavigationTarget = z.infer<typeof padNavigationTargetSchema>;
export type DrumKit = z.infer<typeof drumKitSchema>;
export type SamplePad = z.infer<typeof samplePadSchema>;
export type Pads = z.infer<typeof padsSchema>;
export type QuantizationMode = z.infer<typeof quantizationModeSchema>;
export type VelocityCurve = z.infer<typeof velocityCurveSchema>;
export type DependencyReadiness = z.infer<typeof dependencyReadinessSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export type EngineSnapshot = z.infer<typeof engineSnapshotSchema>;
export type SnapshotUpdate = z.infer<typeof snapshotUpdateSchema>;
export type EngineCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
