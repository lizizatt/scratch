# CM108 alignment investigation — 2026-09-26

Status: after installation and restart, the user confirmed no crackle and responsive physical pads 3+. Pads 1 and 2 (saved loops) still had delayed onset; leading-silence trimming in loop-to-pad exports is being addressed separately.

## Evidence

The Pi uses 48 kHz stereo S16, a 512-frame period and a 1024-frame dmix buffer. Extra silence-only clients intermittently reported xruns every 32 ms (three periods). The production SamplePlayer reproduced this, but so did aplay supplied with an entire two-second PCM buffer up front. Node timer starvation is therefore not necessary for this measured failure. Increasing sustained lookahead from 20 to 40 ms and lowering the per-client wakeup threshold did not eliminate it.

Two temporary dmix aliases shared the existing IPC key and hardware configuration, differing only in `hw_ptr_alignment`. Alternating trials gave:

| Probe | `no` | `rounddown` |
|---|---:|---:|
| Two-second prefilled silence | 2/8 runs with xruns | 0/8 |
| One-second prefilled silence | 5/12 runs with xruns | 0/12 |
| Four-second production SamplePlayer, silence | 0/4 runs with xruns | 0/4 |
| Repeatable script, one-second prefilled silence through route + dmix | 2/20 runs with xruns | 0/20 |

These aliases were additional clients, not instrumentation of the original live streams. Large negative raw dmix hardware delay counters are not measurements of audible latency. Xrun reports have not been correlated with the user's recording.

## Candidate and tradeoff

[deploy/asoundrc](../deploy/asoundrc) explicitly selects `rounddown`, preserving the existing period and buffer sizes. ALSA documents period-by-period wakeups for this alignment mode, with possible loss of up to one period minus one frame at stream startup (511 frames, about 10.6 ms here). This concerns opening/recovering the PCM stream, not each pad press in a persistent stream. It does not guarantee scheduler deadlines or solve all sources of crackle.

## Repeatable hardware check

Run `node scripts/alsa-alignment-diagnosis.mjs` from the deployed project as the same user as the host, with the CM108 present. It opens additional silent clients and uses temporary configuration files; it does not install system settings or restart the host. It alternates 20 trials per policy and reports `candidate-passed` only when baseline xruns reproduce and the candidate has none. This is an underrun comparison, not an audible-onset test. Stop if playback is disturbed.

[tests/pi-setup.test.ts](../tests/pi-setup.test.ts) pins the deployment configuration only; it is not a simulation of the ALSA fault.

Validation before installation: 271 tests passed, workspace typecheck passed, and the repeatable hardware script reported `candidate-passed`. Subsequent user listening feedback is recorded above; this is not a claim that all possible causes of audio artifacts are eliminated.

## Deployment and acceptance

Back up the active ALSA configuration, install the candidate as the system ALSA configuration, then restart the host once pending musical work is saved. File sync alone does not install it. Administrative access is required. Do not rerun the entire Pi provisioning script for this change.

After restarting, verify the selected font, gain and reverb were retained. Recheck Miku single notes and physical pad 3 (Synthetic Tone 01 has immediate file onset). Gain 0.72→0.36, reverb 0.45→0 and headphones on the same CM108 output previously left the crackle audible; original gain 0.72 and reverb 0.45 were restored. If either symptom persists, continue diagnosis rather than labeling this configuration change a complete fix. Rollback restores the backed-up ALSA configuration and restarts the host.
