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
3. Click **fast** / **heavy** over your head to switch styles (same-style parries).
4. Clear three foes and the baby chasmfiend — or die and bank stormlight.

## Layout

- `src/sim/` — pure game rules (agent-tested)
- `src/data/` — tuning and content
- `src/render/` — canvas adapter + hit tests
- `src/app/` — select/run UI controller
- `tests/` — vitest gates per plan phase
