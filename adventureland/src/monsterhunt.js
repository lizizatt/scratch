"use strict";

/**
 * Monster Hunt (Daisy) helpers — mirrors AL guide "monster-hunts".
 * Condition shape: character.s.monsterhunt = { id, c, sn, ms }
 * Accept/turn-in: interact("monsterhunt") near Daisy; merchants cannot accept.
 */

const DAISY = { map: "main", x: 126, y: -413, id: "monsterhunter" };
/** Interact range (px) — near NPC; calibrated loosely to send/vision scales. */
const DAISY_RANGE = 120;
const HUNT_DURATION_MS = 1800000; // G.conditions.monsterhunt.duration
const DEFAULT_HUNT_COUNT = 3;

function formatHuntSn(region, ident) {
  if (!region || !ident) return null;
  return region + " " + ident;
}

function getHunt(character) {
  return character && character.s && character.s.monsterhunt ? character.s.monsterhunt : null;
}

function huntRemaining(hunt) {
  return hunt && hunt.c != null ? hunt.c : 0;
}

function huntComplete(hunt) {
  return !!(hunt && hunt.c === 0);
}

function canAcceptHunts(ctype) {
  return ctype !== "merchant";
}

/** Docs: only visit Daisy when no hunt or c===0. Never spam while c>0. */
function shouldInteractDaisy(character) {
  if (!canAcceptHunts(character && character.ctype)) return false;
  const h = getHunt(character);
  return !h || h.c === 0;
}

function countTokens(items) {
  let n = 0;
  for (const it of items || []) {
    if (it && it.name === "monstertoken") n += it.q == null ? 1 : it.q;
  }
  return n;
}

module.exports = {
  DAISY,
  DAISY_RANGE,
  HUNT_DURATION_MS,
  DEFAULT_HUNT_COUNT,
  formatHuntSn,
  getHunt,
  huntRemaining,
  huntComplete,
  canAcceptHunts,
  shouldInteractDaisy,
  countTokens,
};
