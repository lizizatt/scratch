import { makeRng } from './rng.js';

const SHAPES = ['circle', 'triangle', 'square'];
const PLACEMENTS = ['inscribed', 'edge', 'midpoint'];

export const defaultConfig = {
  size: 512,
  outerRadius: 0.9,
  maxDepth: 5,
  strokeWidth: 2,
  color: '#ffffff',
  background: null,
  firstLayerCount: 3,
  stopChance: 0.35,
  branchiness: 0.7,
  ringPeriod: 8,
  seed: 'materia',
};

export const gamePreset = {
  maxDepth: 5,
  firstLayerCount: 6,
  outerRadius: 0.9,
  stopChance: 0.5,
  ringPeriod: 8.0,
};

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

function randRange(a, b, rng) {
  return a + (b - a) * rng();
}

export function generateSigilTree(config, rng) {
  const rootRadius = (config.size / 2) * config.outerRadius;
  const rootSpin = config.ringPeriod ? (2 * Math.PI) / config.ringPeriod : 0;
  const root = {
    shape: 'circle',
    radius: rootRadius,
    transform: { x: 0, y: 0, rotation: 0 },
    spin: rootSpin,
    children: [],
  };
  growChildren(root, 1, config, rng);
  return root;
}

function growChildren(parent, depth, config, rng) {
  if (depth >= config.maxDepth) return;

  let count;
  if (depth === 1) {
    count = Math.max(0, Math.round(config.firstLayerCount));
  } else {
    if (rng() < config.stopChance) return;
    const decay = Math.pow(config.branchiness, depth);
    count = 0;
    for (let i = 0; i < 4; i++) if (rng() < decay) count++;
    if (count === 0) return;
  }

  for (let i = 0; i < count; i++) {
    const shape = pick(SHAPES, rng);
    const placement = pick(PLACEMENTS, rng);
    const child = makeChild(parent, shape, placement, rng);
    if (!child) continue;
    parent.children.push(child);
    growChildren(child, depth + 1, config, rng);
  }
}

function makeChild(parent, shape, placement, rng) {
  const r = parent.radius;
  let radius;
  let dist;

  switch (placement) {
    case 'inscribed':
      radius = r * randRange(0.45, 0.82, rng);
      dist = 0;
      break;
    case 'edge':
      radius = r * randRange(0.15, 0.35, rng);
      dist = r * randRange(0.72, 1.0, rng);
      break;
    case 'midpoint':
    default:
      radius = r * randRange(0.22, 0.45, rng);
      dist = r * randRange(0.4, 0.58, rng);
      break;
  }

  if (radius < 1.5) return null;

  const angle = rng() * Math.PI * 2;
  const spin = -parent.spin * (rng() * 2.0);
  return {
    shape,
    radius,
    transform: {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      rotation: rng() * Math.PI * 2,
    },
    spin,
    children: [],
  };
}

function strokeShape(ctx, shape, radius) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
  } else {
    const sides = shape === 'triangle' ? 3 : 4;
    const offset = shape === 'triangle' ? -Math.PI / 2 : -Math.PI / 4;
    for (let i = 0; i < sides; i++) {
      const a = offset + (i / sides) * Math.PI * 2;
      const px = Math.cos(a) * radius;
      const py = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.stroke();
}

function renderNode(ctx, node, time) {
  ctx.save();
  ctx.translate(node.transform.x, node.transform.y);
  ctx.rotate(node.transform.rotation + node.spin * time);
  strokeShape(ctx, node.shape, node.radius);
  for (const child of node.children) renderNode(ctx, child, time);
  ctx.restore();
}

export function renderSigilToCanvas(tree, config, time = 0, target = null) {
  const canvas = target || document.createElement('canvas');
  canvas.width = config.size;
  canvas.height = config.size;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (config.background) {
    ctx.fillStyle = config.background;
    ctx.fillRect(0, 0, config.size, config.size);
  } else {
    ctx.clearRect(0, 0, config.size, config.size);
  }

  ctx.translate(config.size / 2, config.size / 2);
  ctx.strokeStyle = config.color;
  ctx.lineWidth = config.strokeWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  renderNode(ctx, tree, time);
  return canvas;
}

export function createSigilCanvas(overrides = {}, time = 0) {
  const config = { ...defaultConfig, ...overrides };
  const rng = makeRng(config.seed);
  const tree = generateSigilTree(config, rng);
  return renderSigilToCanvas(tree, config, time);
}
