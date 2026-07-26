# Shardblade

Browser roguelite: you are a lost shardblade found in a chasm. See [PLAN.md](./PLAN.md).

## Commands

```bash
npm install
npm run dev      # play (placeholder until later phases)
npm test         # headless sim tests
npm run build    # production bundle
```

## Layout

- `src/sim/` — pure game rules (agent-tested)
- `src/data/` — tuning and content
- `src/render/` — canvas adapter (later)
- `tests/` — vitest gates per plan phase
