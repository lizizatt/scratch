# Shardblade

Browser roguelite: you are a lost shardblade found in a chasm. See [PLAN.md](./PLAN.md).

## Commands

```bash
npm install
npm run dev      # play in browser
npm test         # headless sim + hit-test gates
npm run build    # production bundle
```

## How to play

1. Choose **Greatsword** (and a skin). Unlock **Spear** with stormlight after runs.
2. Click through intro dialogue, then walk right into combat.
3. Styles: **Q** fast, **E** heavy, **S** defend — same-style parries; defend blocks everything.
4. Five fights teach the modes, then a baby chasmfiend that **opposes** your style.
5. Win or die — bank stormlight and unlock spear.

### Combat test arena

Open [`/combat-test`](http://localhost:5173/combat-test) (with `npm run dev`) for an infinite chasmfiend duel. You respawn on death; the fiend respawns when killed. No meta progression.

- **Q** = fast, **E** = heavy, **S** = defend (also click the style buttons)
- Defend blocks both fast and heavy; it deals no damage while held
- Bottom buttons pick enemy AI: Always Fast / Always Heavy / Alternate / Mirror / Oppose  
  AI choices apply at the **start of the enemy's next swing**.

## Layout

- `src/sim/` — pure game rules (agent-tested)
- `src/data/` — tuning and content
- `src/render/` — canvas adapter + hit tests
- `src/app/` — select/run UI controller
- `tests/` — vitest gates per plan phase
