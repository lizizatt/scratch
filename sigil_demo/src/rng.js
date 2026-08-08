// Seedable RNG utilities — deterministic so any seed reproduces the same sigil.

/**
 * Hash an arbitrary string into a 32-bit unsigned integer seed.
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32 deterministic PRNG.
 * @param {number|string} seed
 * @returns {() => number}
 */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a fresh random seed string.
 * @returns {string}
 */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff).toString(36);
}
