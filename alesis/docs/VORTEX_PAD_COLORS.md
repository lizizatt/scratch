# Vortex Wireless 2 pad colors

Research date: 2026-10-05. Scope: official preset configuration and evidence for
host-driven LED feedback. No device reads/writes, Pi access, MIDI messages,
installer execution, deployment, or live audio were performed.

## Decision and confirmed requirements

Use the official editor to make **backed-up, full-preset edits** for the MVP.
The editor documents pad colors and preset retrieval/sending, so this path does
not need an invented SysEx command. An automated color writer is not yet ready.

User-confirmed requirements for this investigation:

- The device is connected by **direct USB cable**, not the wireless dongle.
- Physical rainbow traversal is **4, 8, 3, 7, 2, 6, 1, 5** with idle colors
  **red, orange, yellow, green, cyan, blue, violet, magenta**, respectively.
  This order is user-observed, not inferred from a product photograph.
- Keep all pads as **Note**, including pads assigned to host toggle actions.
  Preserve wire channel **9** (editor's **Channel 10**) and notes **36–43**.
- Use a fixed rainbow identity with local velocity color accents. No per-page,
  per-assignment, or host-state LED updates in the MVP. **Do not switch to CC
  Toggle or CC Momentary.** A host toggle assignment is not a hardware pad type.

The host already maps this note/channel range to pad indices in
[../apps/server/src/sample-pads.ts](../apps/server/src/sample-pads.ts), and
[../apps/server/src/pad-performance.ts](../apps/server/src/pad-performance.ts)
implements host control actions separately from sample/drum actions. This keeps
timing and authoritative state on the host, as required by
[adr/0001-host-owned-realtime-engine.md](adr/0001-host-owned-realtime-engine.md)
and [adr/0002-capability-driven-instrument-host.md](adr/0002-capability-driven-instrument-host.md).

## Verified editor behavior

The [official editor guide, pp. 6–7][editor-guide] documents **14 menu choices**:
LED Off, Chartreuse, Green, Aquamarine, Cyan, Azure, Blue, Violet, Magenta, Rose,
Red, Orange, Yellow, White. This is 13 named colors plus off, not 14 colors plus
off. The guide does not specify RGB values, brightness levels, or wire encoding;
the menu order is **not** a verified numeric color-ID table.

For a pad with Type = Note:

| Editor field | Documented local behavior |
| --- | --- |
| Color 1 | Inactive pad |
| Color 2 | Trigger velocity 1–63 |
| Color 3 | Trigger velocity 64–95 |
| Color 4 | Trigger velocity 96–127 |

For CC Toggle, CC Momentary, Program Change, and Panic, only Color 1 and Color 2
are used, for off/released/inactive and on/pressed/active, respectively. That is
local controller behavior, not documented acknowledgement of host state.
[Editor guide, p. 7][editor-guide]

For Note pads, **Velocity = 0 enables strike-dependent MIDI velocity**, using the
selected Curve (1–8). Values 1–127 instead select fixed MIDI velocity. Note pads
send Note On when pressed and Note Off when released.
[Editor guide, p. 6][editor-guide]

## Exact MVP settings

The user confirmed both the idle rainbow and the velocity rule: Color 2,
Color 3, and Color 4 are the next three entries in the eight-color sequence
Red → Orange → Yellow → Green → Cyan → Blue → Violet → Magenta, wrapping to
Red. These are hue changes, not a brightness ramp. These settings have not
been sent to the controller; physical readability remains to be checked.

All rows: **Type = Note; MIDI Channel = 10 (wire 9); Velocity = 0**. Preserve each
existing velocity Curve unless the user separately chooses to change it.

| Physical traversal | Pad number | MIDI note | Color 1: inactive | Color 2: 1–63 | Color 3: 64–95 | Color 4: 96–127 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | 39 | Red | Orange | Yellow | Green |
| 2 | 8 | 43 | Orange | Yellow | Green | Cyan |
| 3 | 3 | 38 | Yellow | Green | Cyan | Blue |
| 4 | 7 | 42 | Green | Cyan | Blue | Violet |
| 5 | 2 | 37 | Cyan | Blue | Violet | Magenta |
| 6 | 6 | 41 | Blue | Violet | Magenta | Red |
| 7 | 1 | 36 | Violet | Magenta | Red | Orange |
| 8 | 5 | 40 | Magenta | Red | Orange | Yellow |

This same mapping applies when a pad runs transport, drums, metronome, or arp
toggle actions. Its LED indicates its local strike/velocity state, **not whether
the host action succeeded or the feature remains enabled**. Host UI state stays
authoritative. Do not present the static LEDs as latched runtime feedback.

## Official downloads and OS availability

The working [official product page][product], under Downloads, links directly to:

- [Windows preset editor 1.0.3][win-editor]. HTTP 200 verified; advertised size
  28,566,424 bytes. The [Windows 11 compatibility table][windows11] explicitly
  lists Vortex Wireless 2 Preset Editor v1.0.3. Alesis describes its Windows 11
  testing as Intel-based and excludes Insider/Preview builds.
- [Mac preset editor 1.0.5][mac-editor]. HTTP 200 verified; size 12,507,480 bytes.
  The [macOS 26 Tahoe software-editor table][tahoe] lists 1.0.5 for Intel and
  Apple Silicon. **The same page's hardware asterisk still says editors and
  utilities are unsupported**, so its statements conflict. Seek confirmation
  from Alesis for the intended OS rather than treating the page as unqualified
  compatibility assurance. The older [Sonoma table][sonoma] says the editor is
  not supported; do not generalize that older result to all Mac releases.
- [Hardware user guide v1.3][hardware-guide] and [editor user guide v1.0][editor-guide].

The [current setup guide][setup] also describes product registration through an
[inMusic Profile][profile] and included software through inMusic Software Center.
The [official FAQ][faq] lists the editor among the included software and points
to registered-account downloads. The public product links above were accessible
without registration during this investigation.

This workstation is Linux. No native Linux editor download or Linux editor
support statement was found in these sources. The user's access to a suitable
Windows/Mac computer is **unknown**. Wine/VM USB operation, current Windows ARM
support, and successful editor operation on this user's hardware are unverified.
Class-compliant MIDI support is not evidence that the preset editor runs on an
OS. No installer or application was launched to test compatibility.

## Manual backup, edit, send, and rollback

These are **future human-operated steps**, not actions performed in this research.
Menu names and transfer semantics come from [editor guide, pp. 3–7][editor-guide];
the checkpoints below add safeguards for preserving the existing configuration.

1. Arrange a suitable editor computer and a maintenance window. Preserve any
   host work before changing connections; avoid routing setup-time pad strikes
   into live audio or transport actions. Connect the controller's rear USB port
   directly by cable. The guide specifies a powered hub if a hub is necessary.
   Direct USB is already the user's confirmed connection, so wireless pairing
   and firmware updates are not part of this task.
2. **Back up before editing or sending.** In the editor choose **File > Retrieve
   Preset**, select the original **Preset Slot**, then **Get**. This loads a copy
   into the editor; editing that copy does not change the stored hardware preset.
3. Choose **File > Save Preset**, select a backup directory, enter a name recording
   the original slot and date, then **Save**. The editor saves a `.vw2` preset
   containing its current MIDI assignments. Keep an untouched original copy.
   Repeat Retrieve/Get and Save for every preset used by +/− navigation and
   every slot that might be overwritten; preferably back up all available slots.
   Record which backup belongs to which hardware slot. The guide documents
   per-preset operations, not a one-click whole-device backup.
4. Reload the relevant backup via **File > Load Preset**, select it, and **Open**.
   Do not start from **New Preset**: Send transmits all assignments, not just colors.
   Check all eight pads before proceeding: pad 1–8 must retain notes 36–43 and
   editor Channel 10, Type Note. Confirm Velocity 0; if it was fixed velocity,
   changing it to 0 is an intentional MVP change, not a color-only edit. Retain
   Curve, faders, ribbon, tilt, pitch wheel, sustain, keybed zones, preset name,
   and program-change-on-load settings. Stop and reconcile any unexpected mapping
   rather than silently replacing it with factory defaults.
5. In **Pads**, select **Colors** below each pad number. Use the side arrows to
   switch between pads 1–4 and 5–8. Enter the four named colors from the table.
   Save the edited preset to a **separate** `.vw2` file, leaving the backup intact.
6. Only after explicit approval for the device write, choose **File > Send
   Preset**, select the intended **Preset Slot**, then **Send**. **This overwrites
   that hardware slot with all editor assignments.** Cancel if the destination or
   backup is uncertain. A spare slot is useful only after backing up its contents;
   it must not silently replace a navigation preset.
7. Retrieve the destination slot again and inspect every changed color plus all
   preserved MIDI assignments. Save the retrieved result separately for comparison.
   During an approved silent hardware check, verify physical order, idle colors,
   release behavior, velocity response, and channel/note output for all eight pads,
   including host-toggle pads. Check every controller preset used for navigation;
   colors belong to those presets, not a documented global palette setting.
8. To roll back: **File > Load Preset**, open the untouched original backup, then
   **File > Send Preset** to its recorded original slot. Retrieve again to verify.
   Do not use a factory reset as rollback: the [FAQ][faq] says it erases all stored
   settings.

**Preset-count discrepancy:** editor guide v1.0, p. 5 says **25 stored presets**;
[SAMPLE_PADS.md](SAMPLE_PADS.md) currently says 128. This investigation did not
verify the connected device's slot count or establish a firmware-dependent change.
Use the actual editor slot selector and the user's recorded navigation slots;
do not assume a 0–127 hardware bank or overwrite slots based on that assumption.
The conflicting existing document was left unchanged to preserve task scope.

## Protocol evidence: verified versus unknown

| Question | Evidence and limit |
| --- | --- |
| Can software configure persistent pad colors? | Yes: official editor controls plus full-preset Send/Get are documented, pp. 5–7. |
| Does the editor contain SysEx-related implementation? | Yes: targeted static inspection of official Mac 1.0.5 found `LMidiManager::SendSysexDataToDevice`, `RequestFirmwareVersion`, and pad-color parameter symbols. This establishes implementation references, not a callable protocol contract. |
| Is there a published preset/SysEx implementation specification? | None located in the bounded official documentation and public-source searches below. This is a search result, not proof that none exists. |
| Can the app send host-state LED feedback using Note On/Off, CC, or SysEx? | Unknown. The guides describe locally triggered colors and preset transfer, not a host-to-LED runtime command or acknowledgement scheme. |
| Are preset messages and transient LED messages interchangeable? | Not established. Do not use repeated full-preset writes as runtime feedback; the documented operation overwrites internal preset memory. Latency, flash endurance, and interference with performance were not established. |
| Does USB MIDI output availability prove an LED feedback API? | No. The setup guide says the device appears as MIDI input/output, but gives no incoming LED message mapping. |
| Are `.vw2` file bytes directly sendable as MIDI/SysEx? | Unknown. No file format, packet framing, color offsets/IDs, checksum, destination addressing, or acknowledgements were verified. |

**Concrete color/protocol command bytes established: none.** No manufacturer ID,
model ID, opcode, color index, or packet was inferred from another Alesis product,
menu ordering, USB IDs, or a generic MIDI message. Do not send guessed messages.

### Bounded static and public-source investigation

- Read the official editor guide, hardware guide, product downloads, setup guide,
  FAQ, and the OS compatibility pages cited here. The available product downloads
  did not list a separate MIDI implementation/SysEx specification.
- Downloaded only the official Mac editor disk image to temporary storage; listed
  its archive and streamed app metadata plus targeted strings. No mounting,
  installation, execution, disassembly, or bulk proprietary-source extraction.
- Disk-image SHA-256:
  `e97cf8b07b61036f391f9d73d679cf34f998ee1f66e1f618f4357715d7c1e1d8`.
  Its metadata reports version 1.0.5, build 1.0.5.37868, minimum macOS 12.0.
  That deployment minimum is **not** a tested-compatibility promise.
  Targeted strings include `padColor1` through `padColor4`,
  `LPadColors::UpdateFromHardwareState`, and the SysEx method noted above.
  These do not establish what bytes a caller may safely send. Source: [official
  Mac editor archive][mac-editor]. No proprietary assets are added to the repo.
- Public GitHub keyword/repository searches used `"Vortex Wireless 2"`,
  `VortexWireless2`, and Alesis/Vortex/SysEx terms. Scoped searches also checked
  [mixxxdj/mixxx](https://github.com/mixxxdj/mixxx),
  [thepostman2/RibbonToNotes](https://github.com/thepostman2/RibbonToNotes), and
  [billiegoose/keychordion](https://github.com/billiegoose/keychordion).
  No relevant LED/preset protocol implementation was located. Results from this
  project's own repository, unrelated Vortex products, and copied manuals were
  not treated as independent protocol evidence. Search indexing limits apply.

## Next implementation blockers

1. **Manual MVP:** confirm an available editor OS/version, obtain slot-specific
   backups, apply the confirmed velocity sequence, and authorize the subsequent
   hardware send. Check physical legibility and unchanged note routing afterward.
2. **Automated preset writer:** obtain an Alesis protocol/file-format specification
   or separately authorize narrowly scoped observation of official-editor
   transfers after backups. Need transport/framing, full-preset preservation,
   slot addressing, color encodings, checksums if present, responses/timeouts,
   firmware compatibility, and a verified restore path before implementation.
   A one-color differential comparison of saved presets may help, but alone does
   not prove a safe MIDI packet or runtime LED command.
3. **Runtime host feedback:** independently establish whether a transient LED
   endpoint exists, its interaction with local velocity colors, and how host
   state is restored after preset changes/disconnection. If supported, implement
   a host-owned output adapter consistent with the ADRs; test with a fake sink
   before an explicitly approved hardware check. Do not infer feedback support
   from the presence of the editor's SysEx function.

Only this research document was added. Existing dirty pad-feature work was not
edited; no commit or deployment was made.

## Primary sources

- [Editor guide v1.0][editor-guide]: connection, preset operations, pad settings.
- [Hardware guide v1.3][hardware-guide]: physical controls and pad capabilities.
- [Product downloads][product]: [Windows 1.0.3][win-editor] and [Mac 1.0.5][mac-editor].
- [Setup guide][setup] and [FAQ][faq]: USB connection and software access.
- [Windows 11 support][windows11], [macOS Sonoma support][sonoma], and
   [macOS Tahoe support][tahoe]: editor-specific compatibility statements.

[editor-guide]: https://www.alesis.com/rscdn/1856/documents/Vortex%20Wireless%202%20Editor%20-%20User%20Guide%20-%20v1.0.pdf
[hardware-guide]: https://www.alesis.com/rscdn/1856/documents/Vortex%20Wireless%202%20-%20User%20Guide%20-%20v1.3.pdf
[product]: https://www.alesis.com/products/view2/vortex-wireless-2
[setup]: https://support.alesis.com/support/solutions/articles/69000865912-alesis-vortex-wireless-2-setup-guide
[faq]: https://support.alesis.com/support/solutions/articles/69000810005-alesis-vortex-wireless-2-frequently-asked-questions
[profile]: https://profile.inmusicbrands.com/customer/account/login/
[win-editor]: https://cdn.inmusicbrands.com/alesis/AlesisVortexWireless2PresetEditor1.0.3PC.exe
[mac-editor]: https://www.alesis.com/rscdn/1856/downloads/AlesisVortexWireless2PresetEditorOSX-1.0.5.dmg
[windows11]: https://support.alesis.com/support/solutions/articles/69000817348-alesis-windows-11-compatibility
[sonoma]: https://support.alesis.com/support/solutions/articles/69000845646-alesis-macos-14-sonoma-compatibility
[tahoe]: https://support.alesis.com/support/solutions/articles/69000872798-alesis-macos-26-tahoe-compatibility
