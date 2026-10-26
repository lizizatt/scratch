import type { MidiEvent } from "@alesis/engine";

type Sustain = Extract<MidiEvent, { type: "control-change" }>;

/**
 * Joins the keytar's own sustain pedal with a second (foot switch) one: sustain is held while either is down.
 * Without the second pedal the keytar's events pass through untouched.
 */
export class SustainPedals {
  private primaryValue = 0;
  private channel = 0;
  private footDown = false;
  private sent = 0;

  /** The event to forward for a sustain message from the keytar, or null when nothing changes. */
  primary(event: Sustain): Sustain | null {
    this.primaryValue = event.value;
    this.channel = event.channel;
    if (!this.footDown) {
      this.sent = event.value;
      return event;
    }
    if (this.sent === 127) return null;
    this.sent = 127;
    return { ...event, value: 127 };
  }

  /** The event to forward when the second pedal changes, or null when sustain is already in that state. */
  secondary(down: boolean): Sustain | null {
    this.footDown = down;
    const value = down ? 127 : this.primaryValue;
    if (value === this.sent) return null;
    this.sent = value;
    return { type: "control-change", channel: this.channel, controller: 64, value };
  }

  /** After a host panic nothing downstream is sustained, whatever the pedals are doing. */
  reset(): void {
    this.sent = 0;
    this.primaryValue = 0;
  }
}
