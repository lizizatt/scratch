# TerminalHero — TODO

_Updated: 2026-03-25_

---

## 🟢 Features — Core Gaps

- [x] **Difficulty selection UI**
  - `main.py` silently defaults to Expert Single; players can't choose
  - Options: add a second selection step after song select, or add cycle-with-Tab in `song_select.py`
  - `SongInfo.available_difficulties` is already populated — just needs a UI

- ~~**HOPO / tap auto-strum mechanics**~~ _(removed — keeping gameplay chill)_

- ~~**Star power activation**~~ _(removed — keeping gameplay chill)_

---

## 🔵 Features — Stretch Goals

- [ ] **Solo section bonus scoring**
  - Parse `[Events]` section for `solo`/`soloend` markers
  - Track notes inside a solo section; award bonus on clean completion

- [ ] **Section name overlay during play**
  - Parse `[Events]` for section name events (`E "section ..."`)
  - Display current section name in the header or as a brief overlay

- [ ] **`config.ini` for user tuning**
  - Expose `SCROLL_WINDOW_S`, `PERFECT_WINDOW_S`, `GOOD_WINDOW_S`, `KEY_RELEASE_S` as user-editable config
  - Load on startup; fall back to defaults if file absent

---

## 🧪 Test Hygiene

- [x] **Add test for `Note.sustain_end_s` field** (constructor arg + `__post_init__` default)
- [x] **Add test for restart loop** (ensure scorer resets and note list re-parses on restart)
