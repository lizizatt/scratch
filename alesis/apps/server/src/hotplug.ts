export type DeviceKind = "audio" | "midi";

export interface DeviceAvailability {
  audio: boolean;
  midi: boolean;
}

export interface HotplugActions {
  panic(): void;
  stopTransport(): Promise<void>;
  disconnectAudio(): Promise<void>;
  reconnectAudio(): Promise<boolean>;
  disconnectMidi(): Promise<void>;
  reconnectMidi(): Promise<boolean>;
  setReady(device: DeviceKind, ready: boolean): void | Promise<void>;
}

export class DeviceHotplugCoordinator {
  private connected: DeviceAvailability;

  constructor(initial: DeviceAvailability, private readonly actions: HotplugActions) {
    this.connected = { ...initial };
  }

  async reconcile(detected: DeviceAvailability): Promise<void> {
    const audioLost = this.connected.audio && !detected.audio;
    const midiLost = this.connected.midi && !detected.midi;
    if (audioLost || midiLost) this.actions.panic();

    if (audioLost) {
      await this.actions.stopTransport();
      await this.actions.disconnectAudio();
      this.connected.audio = false;
      await this.actions.setReady("audio", false);
    }
    if (midiLost) {
      await this.actions.disconnectMidi();
      this.connected.midi = false;
      await this.actions.setReady("midi", false);
    }

    let reconnected = false;
    if (!this.connected.audio && detected.audio && await this.actions.reconnectAudio()) {
      this.connected.audio = true;
      await this.actions.setReady("audio", true);
      reconnected = true;
    }
    if (!this.connected.midi && detected.midi && await this.actions.reconnectMidi()) {
      this.connected.midi = true;
      await this.actions.setReady("midi", true);
      reconnected = true;
    }
    if (reconnected) this.actions.panic();
  }
}
