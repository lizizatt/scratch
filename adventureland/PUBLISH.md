# Publish pipeline

Readable, documented source lives under `src/`. What Mainframe runs is a **compressed** copy in `dist/` (≤176 lines per CODE slot), uploaded by name.

```text
src/**/*.js          author here (comments, modules, tests OK)
       │
       ▼  node publish.js --build
tools/compress_code.js
       │  strip comments + collapse whitespace
       │  join into ≤176-line slot files
       │  (no identifier mangling — load_code shares globals by name)
       ▼
dist/*.js            generated; gitignored
       │
       ▼  node publish.js --upload
MCP save_code        v2_lib / v2_fighter / v2_merchant / Jazwyn / Sarene / Zarook / Puppygirl
```

## Commands

| Command | What it does |
|---------|----------------|
| `node publish.js --list` | Show slot → sources → upload name |
| `node publish.js --build` | Compress only |
| `node publish.js --dry-run` | Build + print MCP targets (no `save_code`) |
| `node publish.js --upload` | Build + upload |
| `node publish.js` | Same as `--upload` |
| `node publish.js --test --upload` | Sim suite, then build + upload |
| `node deploy_mcp.js` | Thin wrapper → `publish.js --upload` (kept for older live scripts) |

Auth: `adventureland/.al_mcp_token` or env `AL_MCP_TOKEN`.

**Important:** `save_code` does **not** restart a running character. After upload, disconnect/relink (or use your observe harness) so workers load the new CODE.

## Slot map

Defined once in [`publish.manifest.js`](publish.manifest.js):

| dist file | Upload name | Role |
|-----------|-------------|------|
| `v2_lib.js` | `v2_lib` | Shared lib (constants, packs, gear, chat, party, motion) |
| `v2_fighter.js` | `v2_fighter` | Fighter stack (`al_api` + `fighter` + live hooks) |
| `v2_merchant.js` | `v2_merchant` | Merchant stack |
| `warrior.js` | `Jazwyn` | Character entry (`load_code` lib+fighter + combat) |
| `mage.js` | `Sarene` | Character entry |
| `priest.js` | `Zarook` | Character entry |
| `merchant.js` | `Puppygirl` | Character entry (`load_code` lib+merchant) |

Character entries are tiny and readable in [`src/slots/`](src/slots/). Library logic stays in multi-file `src/` modules.

## Authoring rules

1. **Edit `src/` only.** Never hand-edit `dist/`.
2. Keep comments and structure in source; the compressor strips them at publish.
3. Do not rely on Node `require` at runtime on Mainframe — bundles strip `require` / `module.exports` / `"use strict"` chrome. Character slots use `load_code("v2_lib")` etc.
4. **Do not mangle or rename** exports that other slots call (`bootFighter`, `GOLD_FLOAT_FIGHTER`, …).
5. After changing shared code, run `node tests/run.js` (includes dist smoke tests) before upload.
6. One-shot / temp scripts (e.g. `code/bank_clean.js`) are **not** in the permanent slot map — upload over a character slot temporarily, then `node publish.js --upload` to restore V2.

## Limits

- **≤176 non-empty lines** per slot (AL editor).
- Soft per-line char budget in the packer (~12k) so a single packed line stays manageable.
- Build **fails** if a slot cannot fit.

## Temporary uploads

Party scripts in git can be packed and `save_code`'d over a character slot without adding permanent slots. Restore with a normal publish:

```bash
node publish.js --upload
```
