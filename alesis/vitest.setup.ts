import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Hosts booted by tests must neither read nor write the real autosave in the user's home directory.
const directory = mkdtempSync(join(tmpdir(), "alesis-test-autosave-"));
process.env.ALESIS_AUTOSAVE_PATH = join(directory, "autosave.json");
afterAll(() => rmSync(directory, { recursive: true, force: true }));
