import { mkdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { EssentiaChromaExtractor } from "../src/analysis/adapters/essentia";
import { MeydaChromaExtractor } from "../src/analysis/adapters/meyda";
import { evaluateExtractor } from "../src/evaluation/evaluate";

const reports = [];
for (const extractor of [
  new EssentiaChromaExtractor(),
  new MeydaChromaExtractor(),
]) {
  reports.push(await evaluateExtractor(extractor));
}

const candidateBrowserAssetBytes = {
  essentia: await totalBytes([
    "../node_modules/essentia.js/dist/essentia-wasm.web.wasm",
    "../node_modules/essentia.js/dist/essentia.js-core.es.js",
    "../node_modules/essentia.js/dist/essentia.js-extractor.es.js",
  ]),
  meyda: await totalBytes(["../node_modules/meyda/dist/web/meyda.min.js"]),
};
const output = {
  generatedAt: new Date().toISOString(),
  reports,
  candidateBrowserAssetBytes,
};
const artifactsDirectory = fileURLToPath(
  new URL("../artifacts", import.meta.url),
);
await mkdir(artifactsDirectory, { recursive: true });
await writeFile(
  new URL("../artifacts/milestone-0-evaluation.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`,
);
console.log(JSON.stringify(output, null, 2));

async function totalBytes(relativePaths: readonly string[]): Promise<number> {
  let total = 0;
  for (const relativePath of relativePaths) {
    const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
    total += (await stat(filePath)).size;
  }
  return total;
}
