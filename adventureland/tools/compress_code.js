"use strict";

/**
 * Publish compressor: readable src → ≤176-line dist slots.
 * Strips comments + collapses whitespace; joins statements into line budget.
 * Does NOT mangle names (cross-slot load_code shares globals by identifier).
 *
 * Slot map: publish.manifest.js
 */
const fs = require("fs");
const path = require("path");
const { MAX_LINES, MAX_CHARS, SLOTS, resolveSources } = require("../publish.manifest");

function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  out = out.replace(/^\s*\/\/.*$/gm, "");
  let res = "";
  let mode = "code";
  let esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const n = out[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") {
        while (i < out.length && out[i] !== "\n") i++;
        if (i < out.length) res += "\n";
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        mode = c;
        res += c;
        continue;
      }
      res += c;
    } else {
      res += c;
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === mode) mode = "code";
    }
  }
  return res;
}

function stripModuleChrome(src) {
  return src
    .replace(/^.*"use strict".*;?\s*/m, "")
    .replace(/^const\s+\{[^}]*\}\s*=\s*require\([^)]*\);?\s*/gm, "")
    .replace(/^const\s+\w+\s*=\s*require\([^)]*\);?\s*/gm, "")
    .replace(/^module\.exports\s*=\s*[^;]+;?\s*/gm, "");
}

/** One logical line per non-empty source line, whitespace collapsed. */
function flattenLines(src) {
  return stripComments(src)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** Pack statements into ≤maxLines long lines (never split mid-statement). */
function packToBudget(stmts, maxLines, label) {
  if (!stmts.length) return "";
  const out = [];
  let cur = "";
  for (const s of stmts) {
    const next = cur ? cur + " " + s : s;
    if (next.length > MAX_CHARS && cur) {
      out.push(cur);
      cur = s;
    } else {
      cur = next;
    }
  }
  if (cur) out.push(cur);

  if (out.length <= maxLines) return out.join("\n");

  const per = Math.ceil(stmts.length / maxLines);
  const forced = [];
  for (let i = 0; i < stmts.length; i += per) {
    forced.push(stmts.slice(i, i + per).join(" "));
  }
  if (forced.length > maxLines) {
    throw new Error(label + " cannot pack " + stmts.length + " stmts into " + maxLines + " lines");
  }
  return forced.join("\n");
}

function assertLineBudget(text, label) {
  const n = text.replace(/\s+$/, "").split(/\r?\n/).filter(Boolean).length;
  if (n > MAX_LINES) throw new Error(label + " has " + n + " lines (max " + MAX_LINES + ")");
  return n;
}

function buildSlot(files, outPath, opts) {
  opts = opts || {};
  const stmts = [];
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error("missing source " + f);
    const raw = fs.readFileSync(f, "utf8");
    const body = opts.stripChrome ? stripModuleChrome(raw) : raw;
    stmts.push.apply(stmts, flattenLines(body));
  }
  const out = packToBudget(stmts, MAX_LINES, outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out + "\n");
  return assertLineBudget(out, path.basename(outPath));
}

function copySlot(srcPath, outPath) {
  return buildSlot([srcPath], outPath, { stripChrome: false });
}

function buildAll(root) {
  const dist = path.join(root, "dist");
  const report = {};

  for (const slot of SLOTS) {
    const files = resolveSources(root, slot);
    const outPath = path.join(dist, slot.out);
    if (slot.kind === "bundle") {
      report[slot.id] = buildSlot(files, outPath, { stripChrome: true });
    } else if (slot.kind === "entry") {
      if (files.length !== 1) throw new Error(slot.id + " entry must have exactly one source");
      report[slot.id] = copySlot(files[0], outPath);
    } else {
      throw new Error("unknown slot kind " + slot.kind + " for " + slot.id);
    }
  }

  return report;
}

function printManifest(root) {
  console.log("Publish manifest (%s slots, max %s lines):\n", SLOTS.length, MAX_LINES);
  for (const s of SLOTS) {
    console.log("  %s → dist/%s  upload as %s", s.id, s.out, s.upload.name);
    console.log("    %s", s.role || "");
    for (const src of s.sources) console.log("      · %s", src);
  }
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const args = process.argv.slice(2);
  if (args.includes("--list") || args.includes("-l")) {
    printManifest(root);
    process.exit(0);
  }
  try {
    const report = buildAll(root);
    for (const k of Object.keys(report)) console.log(k + ".js lines=" + report[k]);
    console.log("OK all slots ≤" + MAX_LINES);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}

module.exports = {
  compressSource: (s) => flattenLines(s).join("\n"),
  stripComments,
  stripModuleChrome,
  flattenLines,
  assertLineBudget,
  buildSlot,
  copySlot,
  buildAll,
  packToBudget,
  printManifest,
  MAX_LINES,
  MAX_CHARS,
};
