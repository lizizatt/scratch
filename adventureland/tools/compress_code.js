"use strict";

/**
 * Publish compressor: readable src → ≤176-line dist slots (join only, no mangle).
 */
const fs = require("fs");
const path = require("path");

const MAX_LINES = 176;
const MAX_CHARS = 12000;

function stripComments(src) {
  // Remove block comments, then whole-line //, then inline // (not inside strings)
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
        // skip to end of line
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

  // Evenly bucket whole statements into maxLines (never cut a statement)
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

function buildSlot(files, outPath) {
  const stmts = [];
  for (const f of files) {
    const raw = fs.readFileSync(f, "utf8");
    stmts.push.apply(stmts, flattenLines(stripModuleChrome(raw)));
  }
  const out = packToBudget(stmts, MAX_LINES, outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out + "\n");
  return assertLineBudget(out, path.basename(outPath));
}

function copySlot(srcPath, outPath) {
  const raw = fs.readFileSync(srcPath, "utf8");
  const stmts = flattenLines(raw);
  const out = packToBudget(stmts, MAX_LINES, outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out + "\n");
  return assertLineBudget(out, path.basename(outPath));
}

function buildAll(root) {
  const dist = path.join(root, "dist");
  const src = path.join(root, "src");
  const report = {};

  report.v2_lib = buildSlot(
    [
      path.join(src, "constants.js"),
      path.join(src, "packs.js"),
      path.join(src, "gear.js"),
      path.join(src, "chat_queue.js"),
      path.join(src, "party_state.js"),
      path.join(src, "motion.js"),
    ],
    path.join(dist, "v2_lib.js")
  );

  report.v2_fighter = buildSlot(
    [path.join(src, "al_api.js"), path.join(src, "fighter.js"), path.join(src, "live_fighter_runtime.js")],
    path.join(dist, "v2_fighter.js")
  );

  report.v2_merchant = buildSlot(
    [path.join(src, "al_api.js"), path.join(src, "merchant.js"), path.join(src, "live_merchant_runtime.js")],
    path.join(dist, "v2_merchant.js")
  );

  for (const name of ["warrior", "mage", "priest", "merchant"]) {
    report[name] = copySlot(path.join(src, "slots", name + ".js"), path.join(dist, name + ".js"));
  }

  return report;
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
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
  assertLineBudget,
  buildSlot,
  buildAll,
  packToBudget,
  MAX_LINES,
};
