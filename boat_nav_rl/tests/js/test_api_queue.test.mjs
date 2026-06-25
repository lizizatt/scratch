import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadUmdModule } from "./load_umd.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ApiQueue = loadUmdModule(join(root, "viz/api_queue.js"));

test("createApiQueue runs tasks sequentially", async () => {
  const { enqueue } = ApiQueue.createApiQueue();
  const order = [];

  const first = enqueue(async () => {
    await new Promise((r) => setTimeout(r, 20));
    order.push("first");
  });
  const second = enqueue(async () => {
    order.push("second");
  });

  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});

test("createApiQueue continues after rejected task", async () => {
  const { enqueue } = ApiQueue.createApiQueue();
  const order = [];

  enqueue(async () => {
    order.push("ok");
  }).catch(() => {});

  await enqueue(async () => {
    throw new Error("boom");
  }).catch(() => {});

  await enqueue(async () => {
    order.push("after");
  });

  assert.deepEqual(order, ["ok", "after"]);
});
