---
status: accepted
---

# Host owns the real-time engine

The host process owns MIDI input, synthesis, the transport clock, loop capture and playback, persistence, export, and physical audio output. Browser clients on the host or an iPad are control surfaces connected over WebSocket; they send coarse commands and receive state, meters, and waveform summaries, but MIDI events and audio samples do not traverse the network. This avoids iOS Web MIDI and output-routing limitations and keeps note-to-sound latency independent of browser-to-server latency.

## Consequences

- The Alesis receiver and audio device connect to the host machine.
- Losing the browser connection does not interrupt audio or transport.
- Browser commands such as mute and promote take effect at a server-defined audio boundary and acknowledge the applied engine revision.
- The PWA can be privately served over Tailscale HTTPS and installed on iOS, but requires connectivity to the host for operation.
- A software MIDI source and simulated audio engine must implement the same host interfaces as real hardware so development and CI do not require the Vortex.
