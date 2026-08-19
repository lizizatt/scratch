import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHORD_QUALITIES,
  type ChordQuality,
  type PitchClass,
} from "../src/analysis/types";
import {
  FIXTURE_DURATION_SECONDS,
  FIXTURE_SAMPLE_RATE,
  synthesizeChord,
  synthesizeTransition,
} from "../src/fixtures/synthesis";
import { encodeMonoWav } from "../src/fixtures/wav";

export type FixtureManifestEntry = {
  readonly file: string;
  readonly durationSeconds: number;
  readonly segments: readonly {
    readonly startSeconds: number;
    readonly endSeconds: number;
    readonly rootPitchClass?: PitchClass;
    readonly quality?: ChordQuality;
    readonly state: "chord" | "silence";
  }[];
};

const outputDirectory = fileURLToPath(
  new URL("../tests/fixtures/generated", import.meta.url),
);
await mkdir(outputDirectory, { recursive: true });

const manifest: FixtureManifestEntry[] = [];
for (let root = 0; root < 12; root += 1) {
  for (const quality of CHORD_QUALITIES) {
    const label = { rootPitchClass: root as PitchClass, quality };
    const file = `root-${root}-${quality}.wav`;
    await writeFile(
      join(outputDirectory, file),
      encodeMonoWav(synthesizeChord(label), FIXTURE_SAMPLE_RATE),
    );
    manifest.push({
      file,
      durationSeconds: FIXTURE_DURATION_SECONDS,
      segments: [
        {
          state: "chord",
          startSeconds: 0,
          endSeconds: FIXTURE_DURATION_SECONDS,
          ...label,
        },
      ],
    });
  }
}

const silenceFile = "silence.wav";
await writeFile(
  join(outputDirectory, silenceFile),
  encodeMonoWav(
    new Float32Array(FIXTURE_SAMPLE_RATE * FIXTURE_DURATION_SECONDS),
    FIXTURE_SAMPLE_RATE,
  ),
);
manifest.push({
  file: silenceFile,
  durationSeconds: FIXTURE_DURATION_SECONDS,
  segments: [
    {
      state: "silence",
      startSeconds: 0,
      endSeconds: FIXTURE_DURATION_SECONDS,
    },
  ],
});

const transitionFile = "transition-c-major-d-minor.wav";
await writeFile(
  join(outputDirectory, transitionFile),
  encodeMonoWav(
    synthesizeTransition(
      { rootPitchClass: 0, quality: "major" },
      { rootPitchClass: 2, quality: "minor" },
    ),
    FIXTURE_SAMPLE_RATE,
  ),
);
manifest.push({
  file: transitionFile,
  durationSeconds: FIXTURE_DURATION_SECONDS * 2,
  segments: [
    {
      state: "chord",
      startSeconds: 0,
      endSeconds: FIXTURE_DURATION_SECONDS,
      rootPitchClass: 0,
      quality: "major",
    },
    {
      state: "chord",
      startSeconds: FIXTURE_DURATION_SECONDS,
      endSeconds: FIXTURE_DURATION_SECONDS * 2,
      rootPitchClass: 2,
      quality: "minor",
    },
  ],
});

await writeFile(
  join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`Generated ${manifest.length} fixtures in ${outputDirectory}`);
