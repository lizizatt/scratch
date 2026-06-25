import { readFileSync } from "node:fs";
import vm from "node:vm";

/** Load a browser UMD viz module in Node for unit tests. */
export function loadUmdModule(filePath) {
  const sandbox = {
    module: { exports: {} },
    exports: {},
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  const code = readFileSync(filePath, "utf8");
  vm.runInNewContext(code, sandbox, { filename: filePath });
  return sandbox.module.exports;
}
