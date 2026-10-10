import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";

// One render context follows every encoder and cooperative Neon chunk, including legacy exports.
export const renderCancellation = new AsyncLocalStorage<AbortSignal>();
export function checkRenderCancellation(): void { renderCancellation.getStore()?.throwIfAborted(); }

export function runRenderProcess(command: string, args: string[]): Promise<void> {
  checkRenderCancellation();
  const signal = renderCancellation.getStore();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let childError: Error | null = null;
    let timedOut = false;
    const abort = () => { child.kill("SIGKILL"); };
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 120_000);
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_192); });
    child.once("error", (error) => { childError = error; });
    child.once("close", (code, exitSignal) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Export canceled"));
      if (timedOut) return reject(new Error(`${command} timed out after 120000 ms`));
      if (childError) return reject(childError);
      if (code !== 0) return reject(new Error(`${command} exited ${exitSignal ?? code}: ${stderr.trim()}`));
      resolve();
    });
  });
}
