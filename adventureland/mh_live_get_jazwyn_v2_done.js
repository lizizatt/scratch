const { spawnSync } = require("child_process");

const r = spawnSync(
  "node",
  ["live_mcp.js", "call", "mainframe_get_logs", JSON.stringify({ character: "Jazwyn", limit: 800 })],
  { cwd: "c:/Users/liz/scratch/adventureland", encoding: "utf8" }
);

if (r.status) {
  console.error(r.stderr || r.stdout);
  process.exit(r.status);
}

const x = JSON.parse(r.stdout);
const lines = (x.logs || []).map((e) => (e.values && e.values[0]) || e.message || "");
const done = lines.filter((l) => /LIVE_MH_V2_DONE/i.test(l));
const last = done.length ? done[done.length - 1] : null;

console.log(JSON.stringify({ done_lines: done.length, last }, null, 2));

