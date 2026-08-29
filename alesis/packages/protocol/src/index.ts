import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const waveformSchema = z.array(z.number().min(-1).max(1)).max(256);
const takeIdSchema = z.string().min(1).max(128);

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

export const synthParameterSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  minimum: z.number(),
  maximum: z.number(),
  unit: z.string(),
});

export const engineSnapshotSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  revision: z.number().int().nonnegative(),
  engine: z.object({
    mode: z.enum(["simulated", "native"]),
    midiConnected: z.boolean(),
    audioConnected: z.boolean(),
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
    available: z.array(z.object({ id: z.string(), name: z.string() })),
    parameters: z.array(synthParameterSchema),
  }),
  capture: z.object({
    currentWaveform: waveformSchema,
    staged: takeSchema.nullable(),
    stagedAudible: z.boolean(),
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
  z.object({ type: z.literal("set-synth-parameter"), parameterId: z.string().min(1), value: z.number() }),
  z.object({ type: z.literal("set-staged-audible"), audible: z.boolean() }),
  z.object({ type: z.literal("promote-staged") }),
  z.object({ type: z.literal("set-take-level"), takeId: takeIdSchema, level: z.number().min(0).max(1) }),
  z.object({ type: z.literal("set-take-muted"), takeId: takeIdSchema, muted: z.boolean() }),
  z.object({ type: z.literal("delete-take"), takeId: takeIdSchema }),
  z.object({ type: z.literal("undo-delete") }),
  z.object({ type: z.literal("export-mp3") }),
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
  }),
]);

export type Settings = z.infer<typeof settingsSchema>;
export type Take = z.infer<typeof takeSchema>;
export type SynthParameter = z.infer<typeof synthParameterSchema>;
export type EngineSnapshot = z.infer<typeof engineSnapshotSchema>;
export type EngineCommand = z.infer<typeof commandSchema>;
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
