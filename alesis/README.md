# Alesis

Host-rendered synthesizer and live looper built around the Alesis Vortex Wireless 2, controlled from a landscape browser or installed iPad PWA.

## Documents

- [Project scope](SCOPE.md)
- [Research and architecture recommendation](RESEARCH.md)
- [Selected UI design](UI_DESIGN.md)
- [Host-engine architecture decision](docs/adr/0001-host-owned-realtime-engine.md)
- [Interactive layout studies](mockups/index.html)
- [Landscape UI comparison prototype](mockups/ui-prototype.html) (`?variant=A`, `B`, or `C`)

## View the mockups

Open `mockups/index.html` directly in a browser. The layout selector switches among performance, loop-first, and controller-mapping concepts; controls are visual interaction prototypes and do not produce audio yet.

## Current recommendation

Run MIDI, synthesis, transport, loop capture/playback, persistence, MP3 export, and physical audio output on the host. Serve the landscape PWA over Tailscale HTTPS and connect it to the host engine through WebSocket commands and state updates. Network traffic never carries performance MIDI or audio, so browser latency cannot affect note-to-sound timing. Develop against software MIDI and audio-engine mocks until the physical Vortex is available.
