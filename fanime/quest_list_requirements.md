# Quest List — Product Requirements

## Purpose

Three **static** Warcraft-style quest pages—**Uncommon**, **Rare**, **Epic**—each opened **only** by its own **QR card**. You wear an exclamation headband; people ask for a quest; you hand the **right card for their place in the chain**. Ordering is **ops + URL split** (not one multi-tier page, not app auth).

## Goals & non-goals

**Goals:** MMO quest-log UI per page; three URLs + three cards; proof + bag pickup stays simple; no world boss dependency for tiers.

**Non-goals:** World boss minigames, leaderboards/parses, accounts (default anonymous unless you add auth later).

## Roles

**Quest giver:** headband, cards, bags, proof checks. **Adventurer:** scan → read that tier’s quests → complete → return with proof.

## Entry & ordering

- **Uncommon / Rare / Epic card** → **only** that tier’s URL. Optional unguessable slugs; no required cross-links between pages. Leaked URL = ops policy (still award bags only in order).
- **First contact:** issue **Uncommon card only**. After proof + **Uncommon bag**, issue **Rare card**; repeat for **Epic**. Optional: tuck the next tier’s card inside the previous bag.
- **Social:** quests “on offer” only when the headband is visible—operational, not enforced in software.

## Quest model

| Tier | URL (example) | Reward |
|------|----------------|--------|
| Uncommon | `…/uncommon` | Uncommon bag |
| Rare | `…/rare` | Rare bag |
| Epic | `…/epic` | Epic bag |

Each page is a **standalone** quest list for that tier (title, description per quest; hints / time / consent notes optional). App does **not** auto-verify completion. **Proof** in person per quest definition. **Reward:** lock copy to “any one quest on this page” vs “all quests” for that tier (brainstorm: at least one per tier). Brief line on-page: return with proof for bag **and** next card.

## UX

WC-inspired panels/typography; **tier** obvious per page. Shared chrome OK. **Mobile-first**; contrast and tap targets; offline/PWA nice-to-have.

## Physical ops

Print **three** distinct quest-list QR cards (tier obvious on card). Stable deploy (three routes or files). Stock three bag types. **Epic bag** adds a **fourth** QR—**World Boss only**—not the Epic tier page URL; handoff to the other product (same repo/route optional).

## Success & boundaries

New player: Uncommon scan → understands quests + proof flow quickly. Staff: tier → correct card/bag, no DB. Looks like a quest log, not a form.

**Out of scope later:** auto-verification, paid rewards, shared identity with world boss.

**World boss:** Epic bag’s extra card → world boss URL only; no data back into quest list.
