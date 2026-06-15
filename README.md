# scratch

Personal experiments — terminal games, RL sims, 3D-print tooling, and small utilities. Most subprojects are self-contained; see linked READMEs for setup and usage.

## Projects

| Folder | Description |
|--------|-------------|
| [boat_nav_rl](boat_nav_rl/README.md) | Marine navigation RL — waypoint missions, traffic avoidance, COLREGS scoring, browser viz |
| [gcode_music](gcode_music/README.md) | Nudge print GCODE segments to match target melodies without breaking the model |
| [map_llm](map_llm/README.md) | Chat with a local LLM; log prompts and explore responses as a similarity graph |
| `terminalhero` | Terminal rhythm game for Clone Hero `.chart` files |
| `invisalign` | Dental mesh fetch and CTM→OBJ export from Invisalign share links |

## Terminal toys

Single-file scripts at the repo root. Regenerate screenshots: `python scripts/capture_readme_screenshots.py`

### blep

Black Mage dodge game (2021) — WASD movement, minimal motion to avoid AoE patterns. Stand still to build a sigil score multiplier.

```bash
python blep
```

![blep gameplay](docs/screenshots/blep.png)

Requirements: Python 3, curses (`windows-curses` on Windows).

### type

Live centered text in the terminal — type and backspace; newlines split across centered lines.

```bash
python type
```

![type](docs/screenshots/type.png)

Requirements: Python 3, curses.

### epiano

Terminal MIDI keyboard via FluidSynth — number keys `1`–`8` play C to high C; `+`/`-` change preset.

```bash
python epiano
```

![epiano](docs/screenshots/epiano.png)

Requirements: Python 3, FluidSynth, `pynput`, `soundfont_sm64.sf2` in repo root.
