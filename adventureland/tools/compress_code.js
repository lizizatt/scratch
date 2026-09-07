"use strict";

/**
 * Line-oriented publish compressor.
 * Joins source modules into ≤176-line slots (no mangling — cross-slot duck-typing).
 */
const fs = require("fs");
const path = require("path");

const MAX_LINES = 176;

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function compressSource(src) {
  const stripped = stripComments(src);
  // Keep requires for node tests; in-game slots use load_code — caller inlines.
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
  return lines.join("\n");
}

function assertLineBudget(text, label) {
  const n = text.replace(/\s+$/, "").split(/\r?\n/).length;
  if (n > MAX_LINES) {
    throw new Error(label + " has " + n + " lines (max " + MAX_LINES + ")");
  }
  return n;
}

function buildSlot(files, outPath) {
  const parts = files.map((f) => fs.readFileSync(f, "utf8"));
  // Strip require()/module.exports for in-game bundle — keep bodies
  let body = parts
    .map((src) =>
      src
        .replace(/^.*"use strict".*;?\s*/m, "")
        .replace(/^const .* = require\(.*\);?\s*/gm, "")
        .replace(/^module\.exports\s*=\s*[^;]+;?\s*/gm, "")
    )
    .join("\n");
  const out = compressSource(body);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out + "\n");
  return assertLineBudget(out, outPath);
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const dist = path.join(root, "dist");
  // MVP: one shared fighter bundle + merchant (line counts reported)
  const fighterFiles = [
    path.join(root, "src/constants.js"),
    path.join(root, "src/chat_queue.js"),
    path.join(root, "src/party_state.js"),
    path.join(root, "src/motion.js"),
    path.join(root, "src/fighter.js"),
  ];
  try {
    // For CI we only assert the compressor runs; full in-game slots need load_code wiring.
    const n = buildSlot(fighterFiles, path.join(dist, "fighter_bundle.js"));
    console.log("fighter_bundle.js lines=" + n);
    console.log("(Slot split comes later; src is multi-file until publish map exists.)");
    process.exit(0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { compressSource, assertLineBudget, buildSlot, MAX_LINES };
