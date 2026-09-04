# Shardblade

Browser story game: you are a lost shardblade found in a chasm. See [PLAN.md](./PLAN.md) (MVP engineering) and [STORY_PLAN.md](./STORY_PLAN.md) (narrative arc + design ideas).

## Commands

```bash
npm install
npm run dev      # play in browser
npm test         # headless sim + hit-test gates
npm run build    # production bundle
```

## How to play

1. **Scene 0 (forge):** choose Greatsword or Spear (+ skin), then Enter the chasm.
2. Click through intro dialogue, then walk right into combat.
3. Styles: **Q** fast, **E** heavy, **S** defend — same-style parries; defend blocks everything.
4. Five fights teach the modes, then a baby chasmfiend that **opposes** your style.
5. Stormlight starts at 0 each scene, gathers from kills (heals while walking), and does not carry over.
6. After the chasm, scene 2 (castle chase) begins automatically.

Happy path is `/`. Jump-ins: `/god-mode/scene-1`, `/god-mode/scene-2` (base greatsword).

### Combat test arena

Open [`/combat-test`](http://localhost:5173/combat-test) (with `npm run dev`) for an infinite chasmfiend duel. You respawn on death; the fiend respawns when killed. No meta progression.

- **Q** = fast, **E** = heavy, **S** = defend (also click the style buttons)
- Defend blocks both fast and heavy; it deals no damage while held
- Bottom buttons pick enemy AI: Always Fast / Always Heavy / Alternate / Mirror / Oppose  
  AI choices apply at the **start of the enemy's next swing**.

### God mode

- [`/god-mode`](http://localhost:5173/god-mode) or [`/god-mode/scene-1`](http://localhost:5173/god-mode/scene-1) — chasm with cheats (invincible + one-shot)
- [`/god-mode/scene-2`](http://localhost:5173/god-mode/scene-2) — jump straight into the castle chase (same cheats if you return to chasm)

### Castle (scene 2)

Open [`/castle`](http://localhost:5173/castle) to jump into the hallway chase without god-mode cheats. Mouse over glowing hotspots for Tension prompts (`Tighten?` / `Release?` / `Panic!`), then click.

## Layout

- `src/sim/` — pure game rules (agent-tested)
- `src/data/` — tuning and content
- `src/render/` — canvas adapter + hit tests
- `src/app/` — select/run UI controller
- `tests/` — vitest gates per plan phase
