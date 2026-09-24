import { existsSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";

export default async function globalTeardown(): Promise<void> {
  const directory = process.env.ALESIS_E2E_SAMPLE_LIBRARY_DIR;
  if (!directory) return;
  const resolved = resolve(directory);
  if (resolve(tmpdir()) !== resolve(resolved, "..") || !basename(resolved).startsWith("alesis-playwright-samples-")) return;
  if (!existsSync(resolve(resolved, ".alesis-playwright-owned"))) return;
  try {
    if (!lstatSync(resolved).isDirectory()) return;
  } catch {
    return;
  }
  rmSync(resolved, { recursive: true, force: true });
}
