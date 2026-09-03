# Adventure Land — party grind (1–90)

| Character | Class | Role | File | CODE slot |
| --- | --- | --- | --- | ---: |
| Jazwyn | warrior | party lead / tank | `warrior.js` | 1 (`warrior`) |
| Sarene | mage | assist / magiport | `mage.js` | 2 (`mage`) |
| Zarook | priest | heal / assist | `priest.js` | 3 (`priest`) |
| puppygirl | merchant | stand / sales | `merchant.js` | 4 (`merchant`) |

## Deploy (recommended)

Use the Adventure Land MCP token (Mainframe → **Connect an AI** → Reveal token). Save it as `adventureland/.al_mcp_token` (gitignored), then:

```
node adventureland/deploy_mcp.js
```

That uploads `warrior.js` / `mage.js` / `priest.js` / `merchant.js` into the account’s **Jazwyn / Sarene / Zarook / Puppygirl** CODE slots. Saving does **not** restart running CODE — Stop/Run (or `load_code`) on each character after deploy.

Do **not** paste the MCP token into chat or character CODE; rotate it in Mainframe if it leaks.

Gearing (run separately at the upgrade NPC when you have gold): `warrior_upgrade.js`, `mage_upgrade.js`, `priest_upgrade.js`.

Keep the browser tab focused, or call `performance_trick()` once. Puppygirl already has a `stand0`; on boot she pulls bank loot (5 free slots reserved), then stands in town and lists it.

## Party plan

**Jazwyn** (warrior) is party lead and tank: she invites the fighters, picks the ladder pack, pulls, taunts/charges/cleaves, and stands on the far side of the mob. **Sarene** (mage) and **Zarook** (priest) assist her target and stay off the warrior. Sarene also magiports the party when she's at the pack.

**puppygirl** (merchant) is **passive** and stays out of the combat party (she cannot join it). On CODE start she visits the **bank** once, `bank_retrieve`s packs into inventory while leaving **5 free slots**, then stands in town and lists non-potion loot for sale (`trade` slots 1–16). She also mlucks anyone who walks by once she's **level 40+**.

Run `hold()` on puppygirl's CODE console to whisper each fighter `hold:1` (and also `send_cm` `{hold:1}`). They hop to **Americas II** (`US`/`II`, home with puppygirl), party-say each step (`Hold: restocking` → `banking` → `buying pots` → `ready`), and stay put until you run `resume()` (`hold:0` → hop to **Americas III** / `US`/`III` → `Resuming`). Hold survives the server reload via `localStorage`. You should see the whisper in each fighter's PM chat. Puppygirl stays on Americas II. Fighters still restock potions on their own when low (on the farm server). On a potion run they visit the bank first and `bank_store` everything that is not an hp/mp potion. If they walk past puppygirl they send her gold down to a 1k float.

`performance_trick()` plays a silent sound so browsers don't throttle the CODE tab in the background (Steam/desktop clients don't need it).

Everyone farms the **lowest member's** ladder pack (their HP gates the pull). After a death, remembered levels/HP are kept so town goos don't steal the pull.

Travel: warrior and priest party-say `I need a summon!` when walking to the pack. Sarene only magiports if she's **already at the pack** with **900 MP** free (mage skill). Early on she usually can't — she'll party-say why (`need 900 MP` / `not at pack`). When the whole party leaves town together, walk; summons help later for catch-up after death/vendor.

Other party chat (not global): Ding / Gratz, potions (town rally), gear upgrade rally.

## Ladder (from [data.js](https://adventure.land/data.js) XP, attack-gated)

Commons only (no bosses / event nerfs). Thresholds are intentionally a bit overleveled; HP still gates hot packs.

| Lowest level | Monster | XP | Attack |
| ---: | --- | ---: | ---: |
| 1–7 | `goo` | 100 | 5 |
| 8–11 | `bee` | 400 | 16 |
| 12–15 | `crab` | 500 | 24 |
| 16–19 | `snake` | 960 | 24 |
| 20–23 | `armadillo` | 1720 | 20 |
| 24–27 | `arcticbee` | 1800 | 64 |
| 28–31 | `porcupine` | 3200 | 16 |
| 32–33 | `croc` | 3600 | 48 |
| 34–35 | `tortoise` | 5200 | 36 |
| 36–41 | `bat` | 8000 | 50 |
| 42–47 | `spider` | 12000 | 80 |
| 48–53 | `scorpion` | 20000 | 100 |
| 54–59 | `boar` | 10800 | 240 |
| 60–65 | `bigbird` | 30000 | 480 |
| 66–71 | `gscorpion` | 48000 | 120 |
| 72–77 | `wolf` | 48800 | 480 |
| 78–90 | `dryad` | 60000 | 400 |

## Tests

```
node adventureland/tests/run.js
```
