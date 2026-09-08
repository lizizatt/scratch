# Raspberry Pi V1 Bill of Materials

Reviewed 2026-09-04. Inventory status reflects the bring-up handoff and must be
confirmed physically before purchasing duplicates. Search terms are preferred
over transient reseller links.

## Already owned

| Item | Exact requirement | Verify before bring-up |
| --- | --- | --- |
| Host | Raspberry Pi 4 Model B, 2 GB | Owned; assembled and reaches soft boot |
| Battery | PiSugar S Plus, 5000 mAh | Owned; mounted beneath Pi and reaches soft boot |
| Display | Waveshare `4inch HDMI LCD`, resistive touch | Owned; connected and reaches soft boot |
| Pointer | External USB or wireless trackpad | Ordered; primary UI input, with keyboard secondary |
| MIDI | Vortex Wireless 2 receiver | Owned and verified as USB ID `13b2:005e`, ALSA card `V2` |
| Amplifier | Existing mono amp with 1/4-inch input | Confirm line-level input and working speaker connection |
| SoundFont | Existing `STH.sf2` | Verified locally; provenance remains open |
| Cooling candidate | Easycargo 30 x 30 x 7 mm fan | Owned and intentionally unplugged; deferred until thermal need is proven |

`STH.sf2` is stored externally at `/home/liz.izatt/Downloads/STH.sf2` and is not
committed to this repository. It is a 145,330,818-byte RIFF SoundFont bank with
SHA-256 `d56e5e9e5020c17f6d512dc59005456cec3647946640a75c23038cf6be983d2f`.
Its original source or license is not documented locally; resolve that before
redistribution. Do not substitute another bank.

## Required purchases or inventory confirmation

| Priority | Item | Search terms / specification | Compatibility constraint |
| --- | --- | --- | --- |
| P0 | microSD | `64GB high endurance microSD U3 A2` from a reputable flash vendor | Exactly 64 GB class target; endurance-rated, not a generic promotional card |
| P0 | USB audio | CM108 USB audio adapter | Owned and verified as `0d8c:013c`; S16_LE stereo at 48/44.1 kHz |
| P0 | Mono breakout | `3.5mm TRS stereo male to dual 1/4 TS male breakout` | Two independently labelled plugs; use left only; not an insert cable with 1/4-inch TRS |
| P0 | Passive cooling | `Raspberry Pi 4 copper aluminum heatsink set low profile` | Must clear the directly stacked display and avoid GPIO/pogo contacts |
| P0 | Charger | `5V 3A USB-C charger regulated Raspberry Pi` plus cable matching the PiSugar input | PiSugar input is 5 V/3 A max; do not use an unregulated supply |
| P0 | Ethernet cable | `Cat5e Ethernet patch cable` in suitable bench length | Must reach the first-boot router/switch |
| P0 | Display adapter, if absent | `Raspberry Pi 4 micro HDMI male to full HDMI adapter short` | Must fit the Waveshare full-size HDMI bridge geometry without levering the stack |

Before ordering the HDMI item, inspect the Waveshare box: its Pi 4 connection
may already be supplied. Before ordering the charger, inspect whether the owned
PiSugar uses its USB-C or alternate micro-USB charging input and choose one
short, low-resistance cable accordingly.

## Optional or deferred

| Item | Decision |
| --- | --- |
| 30 x 30 x 7 mm fan | Use only if clearance is safe and the bench test throttles or remains above 75 C |
| Enclosure | Defer until the four-hour acceptance gate passes |
| Overlay/read-only root | Defer until the writable bench image survives acceptance |
| Wi-Fi | May be preseeded; Ethernet is the required first-boot path |
| Hardware Panic mapping | Persistent on-screen Panic remains required; dedicated hardware mapping is later |
| WS2812B LEDs | Removed from v1 |
| Powered USB hub | Buy only if measured USB power or enumeration proves unstable |

## Compatibility notes

- Raspberry Pi specifies 5 V/3 A for Pi 4B. PiSugar rates S Plus output at
  5 V/2.5 A, so the assembled load requires measured validation.
- Waveshare specifies a native 480 by 800 panel; Bookworm rotates display and
  touch together for the required 800 by 480 landscape viewport.
- The display consumes SPI touch pins 19/21/23/26 and IRQ pin 22. PiSugar uses
  GPIO3/SCL. Keep PiSugar auto-start off so SCL is not continuously held low.
- Power the display from the GPIO stack only. Do not attach its USB power input
  at the same time.
- Render dual-mono in software. Connect only the left TS breakout plug to the
  mono amp; never short channels together.
- PiSugar S Plus provides no battery telemetry and hard-cuts below 3 V. Storage
  hardening and orderly manual shutdown are therefore v1 requirements.

## Primary sources

- [Raspberry Pi 4 specifications](https://www.raspberrypi.com/products/raspberry-pi-4-model-b/specifications/)
- [Raspberry Pi setup and accessory guidance](https://www.raspberrypi.com/documentation/computers/getting-started.html)
- [Waveshare 4inch HDMI LCD wiki](https://www.waveshare.com/wiki/4inch_HDMI_LCD)
- [PiSugar S series documentation](https://docs.pisugar.com/docs/product-wiki/battery/pisugar-s-series)
