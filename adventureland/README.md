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

That uploads fighter + merchant CODE (including `fighter_core`, `gear_ops`, `merchant_ops`). Saving does **not** restart running CODE — Stop/Run (or `load_code`) on each character after deploy.

Do **not** paste the MCP token into chat or character CODE; rotate it in Mainframe if it leaks.

Gearing (run separately at the upgrade NPC when you have gold): `warrior_upgrade.js`, `mage_upgrade.js`, `priest_upgrade.js`.

Keep the browser tab focused, or call `performance_trick()` once. Puppygirl already has a `stand0`.

## Party plan

**Jazwyn** (warrior) is party lead and tank: she invites the fighters, picks the ladder pack, pulls, taunts/charges/cleaves, and stands on the far side of the mob. **Sarene** and **Zarook** assist her target and hold **formation slots** relative to her facing (mage left-rear, priest right-rear). If the leader is missing/rip, they rally to the shared pack by walking (`smart_move`). No magiport.

Shared logic lives in `fighter_core.js` (loaded by each class). See `FIGHTER_PLAN.md`.

**puppygirl** (merchant) stays out of the combat party. Delivery jobs preempt econ: fighters CM `dlv_req` for pots in the field; she hops/walks, `send_item`, handshake (`FIELD_DELIVERY_PLAN.md`). When the queue is empty she runs a ~5‑minute bank/combine/stand cycle. She mlucks passersby at level 40+. See `MERCHANT_PLAN.md`.

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

Other party chat: Ding / Gratz; potion mentions get a social Ok (field CM restock, not town); gear upgrade rally still towns.

## Ladder (from [data.js](https://adventure.land/data.js) XP, attack-gated)

Commons only (no bosses / event nerfs). **Blacklisted:** `spider`, `scorpion`, `bigbird` (east-island / tunnel packs). HP gate uses `MAX_ATTACK_RATIO=0.24`.

| Lowest level | Monster | Map notes |
| ---: | --- | --- |
| 1–3 | `goo` | main |
| 4–7 | `bee` | main |
| 8–11 | `crab` | main |
| 12–15 | `snake` | main |
| 16–19 | `armadillo` | main |
| 20–23 | `arcticbee` | winterland |
| 24–27 | `porcupine` | desertland |
| 28–29 | `croc` | main south |
| 30–31 | `tortoise` | main south |
| 32–41 | `bat` | cave |
| 42–49 | `boar` | winterland |
| 50–57 | `gscorpion` | desertland |
| 58–65 | `wolfie` | winterland |
| 66–90 | `wolf` | winterland |

## Tests

```
node adventureland/tests/run.js
```
