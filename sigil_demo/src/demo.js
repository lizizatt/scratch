import { defaultConfig, gamePreset, generateSigilTree, renderSigilToCanvas } from './sigil.js';
import { makeRng, randomSeed } from './rng.js';

const display = document.getElementById('display');
const ctx = display.getContext('2d');

const seedInput = document.getElementById('seed');
const depthInput = document.getElementById('depth');
const firstLayerInput = document.getElementById('firstLayer');
const stopInput = document.getElementById('stop');
const periodInput = document.getElementById('period');

const regenBtn = document.getElementById('regen');
const playBtn = document.getElementById('play');
const presetBtn = document.getElementById('preset');

let config = null;
let tree = null;
let elapsed = 0;
let playing = true;
let lastNow = performance.now();

function readConfig() {
  return {
    ...defaultConfig,
    ...gamePreset,
    size: display.width,
    seed: seedInput.value || 'materia',
    maxDepth: Number(depthInput.value),
    firstLayerCount: Number(firstLayerInput.value),
    stopChance: Number(stopInput.value),
    ringPeriod: Number(periodInput.value),
  };
}

function rebuild() {
  config = readConfig();
  tree = generateSigilTree(config, makeRng(config.seed));
}

function render() {
  const sigil = renderSigilToCanvas(tree, config, elapsed);
  ctx.clearRect(0, 0, display.width, display.height);
  ctx.drawImage(sigil, 0, 0, display.width, display.height);
}

function frame(now) {
  const dt = (now - lastNow) / 1000;
  lastNow = now;
  if (playing) {
    elapsed += dt;
    render();
  }
  requestAnimationFrame(frame);
}

function applyGamePreset() {
  depthInput.value = String(gamePreset.maxDepth);
  firstLayerInput.value = String(gamePreset.firstLayerCount);
  stopInput.value = String(gamePreset.stopChance);
  periodInput.value = String(gamePreset.ringPeriod);
}

regenBtn.addEventListener('click', () => {
  seedInput.value = randomSeed();
  rebuild();
  render();
});

playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
});

presetBtn.addEventListener('click', () => {
  applyGamePreset();
  rebuild();
  render();
});

for (const el of [seedInput, depthInput, firstLayerInput, stopInput, periodInput]) {
  el.addEventListener('input', () => {
    rebuild();
    render();
  });
}

applyGamePreset();
rebuild();
render();
requestAnimationFrame(frame);
