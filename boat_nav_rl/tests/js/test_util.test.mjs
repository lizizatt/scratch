import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadUmdModule } from "./load_umd.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const Util = loadUmdModule(join(root, "viz/util.js"));

test("escapeHtml neutralizes HTML metacharacters", () => {
  assert.equal(Util.escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(Util.escapeHtml('a & "b"'), "a &amp; &quot;b&quot;");
  assert.equal(Util.escapeHtml(null), "");
});

test("shortRunId trims long timestamp ids", () => {
  assert.equal(Util.shortRunId("20260625_021230_ab"), "021230_ab");
  assert.equal(Util.shortRunId("short"), "short");
  assert.equal(Util.shortRunId(""), "—");
});

test("liveMetricsFingerprint tracks last eval point", () => {
  assert.equal(Util.liveMetricsFingerprint([]), "");
  const a = [{ timesteps: 100, t_sec: 10, score: 0.5 }];
  const b = [...a, { timesteps: 200, t_sec: 20, score: 0.7 }];
  assert.equal(Util.liveMetricsFingerprint(a), "1:100:10:0.5");
  assert.equal(Util.liveMetricsFingerprint(b), "2:200:20:0.7");
});

test("breakdownDisplayY negates penalty components", () => {
  assert.equal(Util.breakdownDisplayY(3.5, { penalty: true }), -3.5);
  assert.equal(Util.breakdownDisplayY(2, { penalty: false }), 2);
  assert.equal(Util.breakdownDisplayY(null, { penalty: true }), null);
});
