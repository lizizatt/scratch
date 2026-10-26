import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const defaultFootSwitchDevice = "/dev/input/by-id/usb-PCsensor_FootSwitch-event-kbd";

export interface FootSwitchOptions {
  devicePath: string;
  onChange(down: boolean): void;
  log(message: string): void;
  retryMs?: number;
  /** Replaces the evdev reader; receives the device path. */
  command?: (devicePath: string) => [string, string[]];
}

/** A USB foot button as a held switch. The reader is restarted after unplugging or an error. */
export class FootSwitch {
  private child: ChildProcess | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private down = false;
  private reportedFailure = false;

  constructor(private readonly options: FootSwitchOptions) {}

  start(): void {
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.child?.kill();
    this.set(false);
  }

  private connect(): void {
    if (this.closed) return;
    if (!existsSync(this.options.devicePath)) {
      this.retry();
      return;
    }
    const [command, args] = this.options.command?.(this.options.devicePath)
      ?? ["python3", [fileURLToPath(new URL("./foot-switch-grab.py", import.meta.url)), this.options.devicePath]];
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;
    let buffered = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim() === "down") this.set(true);
        else if (line.trim() === "up") this.set(false);
      }
    });
    let failure = "";
    child.stderr.on("data", (chunk: Buffer) => { failure += chunk.toString(); });
    let finished = false;
    const finish = (reason: string): void => {
      if (finished) return;
      finished = true;
      this.child = undefined;
      // A pedal cannot stay held if its reader is gone.
      this.set(false);
      if (!this.closed && (failure.trim() || !this.reportedFailure)) {
        this.options.log(`Foot switch ${this.options.devicePath} stopped (${failure.trim().split("\n").pop() || reason}); retrying`);
        this.reportedFailure = true;
      }
      this.retry();
    };
    child.on("error", (error) => finish(error.message));
    child.on("exit", (code) => finish(`exit ${code}`));
    if (this.reportedFailure) this.options.log(`Foot switch ${this.options.devicePath} connected`);
    this.reportedFailure = false;
  }

  private retry(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => this.connect(), this.options.retryMs ?? 2_000);
    this.timer.unref();
  }

  private set(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    this.options.onChange(down);
  }
}
