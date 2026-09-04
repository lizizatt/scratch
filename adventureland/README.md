# Adventure Land — party grind (1–90)

| Character | Class | Role | File | CODE slot |
| --- | --- | --- | --- | ---: |
| Jazwyn | warrior | party lead / tank | `warrior.js` | 1 (`warrior`) |
| Sarene | mage | assist / formation | `mage.js` | 2 (`mage`) |
| Zarook | priest | heal / formation | `priest.js` | 3 (`priest`) |
| puppygirl | merchant | stand / sales | `merchant.js` | 4 (`merchant`) |
| *(shared)* | — | fighter runtime | `fighter_core.js` | `fighter_core` |

## Deploy (recommended)

Use the Adventure Land MCP token (Mainframe → **Connect an AI** → Reveal token). Save it as `adventureland/.al_mcp_token` (gitignored), then:

```
node adventureland/deploy_mcp.js
```

That uploads fighter + merchant CODE (including `fighter_core`, `merchant_plan`, `merchant_ops`). Saving does **not** restart running CODE — Stop/Run (or `load_code`) on each character after deploy.

Do **not** paste the MCP token into chat or character CODE; rotate it in Mainframe if it leaks.

Gearing (run separately at the upgrade NPC when you have gold): `warrior_upgrade.js`, `mage_upgrade.js`, `priest_upgrade.js`.

Keep the browser tab focused, or call `performance_trick()` once. Puppygirl already has a `stand0`.

## Party plan

**Jazwyn** (warrior) is party lead and tank: she invites the fighters, picks the ladder pack, pulls, taunts/charges/cleaves, and stands on the far side of the mob. **Sarene** and **Zarook** assist her target and hold **formation slots** relative to her facing (mage left-rear, priest right-rear). If the leader is missing/rip, they rally to the shared pack by walking (`smart_move`). No magiport.

Shared logic lives in `fighter_core.js` (loaded by each class). See `FIGHTER_PLAN.md`.

**puppygirl** (merchant) stays out of the combat party. On a ~5‑minute cycle she banks, parks the bag, combines compoundables (gold float reserved), clears the stand, then lists the most expensive unheld bank loot in town (`trade` 1–16). She mlucks passersby at level 40+. See `MERCHANT_PLAN.md`.

### Commands (party chat — works from any fighter, including the speaker)

| Command | Effect |
| --- | --- |
| `!hold` / `!resume` | Hold restock on Americas II / resume grind on Americas III |
| `!hunt <mtype>` / `!grind` | Override pack / clear override |
| `Let's kill X!` / `Back to the grind` | Same as hunt/grind (legacy) |

Status sync: leader-only `~s h=0|1 f=<mtype|->` every ~20s on change (rate-limited with other party chat). Social Ding/Gratz stay other-only.

Formation: mage/priest hold face-relative flank slots. Slot is **re-anchored only after the leader moves ≥70** from the last anchor (stops combat jitter).

Merchant console still has `hold()` / `resume()` / `hunt()` / `grind()` (CM/PM dual-path).

Hold survives reload via `localStorage`. On a potion run fighters bank non-pots first. Walking past puppygirl sends gold down to a 1k float.

Everyone farms the **lowest member's** ladder pack (HP gates the pull). After death, remembered levels/HP are kept so town goos don't steal the pull.

Other party chat: Ding / Gratz, potions (town rally), gear upgrade rally.

## Ladder (from [data.js](https://adventure.land/data.js) XP, attack-gated)

Commons only (no bosses / event nerfs). Early packs stay a bit early; spider+ delayed (scorpions were shredding ~45). HP gate uses `MAX_ATTACK_RATIO=0.24`.

| Lowest level | Monster | XP | Attack |
| ---: | --- | ---: | ---: |
| 1–3 | `goo` | 100 | 5 |
| 4–7 | `bee` | 400 | 16 |
| 8–11 | `crab` | 500 | 24 |
| 12–15 | `snake` | 960 | 24 |
| 16–19 | `armadillo` | 1720 | 20 |
| 20–23 | `arcticbee` | 1800 | 64 |
| 24–27 | `porcupine` | 3200 | 16 |
| 28–29 | `croc` | 3600 | 48 |
| 30–31 | `tortoise` | 5200 | 36 |
| 32–41 | `bat` | 8000 | 50 |
| 42–49 | `spider` | 12000 | 80 |
| 50–53 | `scorpion` | 20000 | 100 |
| 54–59 | `boar` | 10800 | 240 |
| 60–65 | `bigbird` | 30000 | 480 |
| 66–71 | `gscorpion` | 48000 | 120 |
| 72–77 | `wolf` | 48800 | 480 |
| 78–90 | `dryad` | 60000 | 400 |

## Tests

```
node adventureland/tests/run.js
```
