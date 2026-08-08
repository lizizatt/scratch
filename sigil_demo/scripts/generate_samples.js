import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { defaultConfig, gamePreset, generateSigilTree } from '../src/sigil.js';
import { makeRng } from '../src/rng.js';

const outDir = path.resolve('samples');

const cases = [
  { name: 'sample-materia.svg', seed: 'materia' },
  { name: 'sample-leviathan.svg', seed: 'leviathan' },
  { name: 'sample-ramuh.svg', seed: 'ramuh' },
];

function shapePath(shape, radius) {
  if (shape === 'circle') {
    return `M ${radius} 0 A ${radius} ${radius} 0 1 0 ${-radius} 0 A ${radius} ${radius} 0 1 0 ${radius} 0`;
  }
  const sides = shape === 'triangle' ? 3 : 4;
  const offset = shape === 'triangle' ? -Math.PI / 2 : -Math.PI / 4;
  let d = '';
  for (let i = 0; i < sides; i++) {
    const a = offset + (i / sides) * Math.PI * 2;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    d += `${i === 0 ? 'M' : 'L'} ${x} ${y} `;
  }
  return `${d}Z`;
}

function renderNodeSvg(node, parentMatrix, parts) {
  const a = node.transform.rotation;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const local = [c, s, -s, c, node.transform.x, node.transform.y];
  const m = multiply(parentMatrix, local);

  const pathD = shapePath(node.shape, node.radius);
  parts.push(`<path d="${pathD}" transform="matrix(${m.join(' ')})" />`);

  for (const child of node.children) {
    renderNodeSvg(child, m, parts);
  }
}

function multiply(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function renderSvg(tree, config) {
  const parts = [];
  const rootMatrix = [1, 0, 0, 1, config.size / 2, config.size / 2];
  renderNodeSvg(tree, rootMatrix, parts);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${config.size}" height="${config.size}" viewBox="0 0 ${config.size} ${config.size}">
  <rect width="100%" height="100%" fill="#181b24" />
  <g fill="none" stroke="${config.color}" stroke-width="${config.strokeWidth}" stroke-linejoin="round" stroke-linecap="round">
    ${parts.join('\n    ')}
  </g>
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });

for (const c of cases) {
  const cfg = {
    ...defaultConfig,
    ...gamePreset,
    size: 512,
    color: '#ffffff',
    strokeWidth: 2,
    seed: c.seed,
  };
  const tree = generateSigilTree(cfg, makeRng(cfg.seed));
  const svg = renderSvg(tree, cfg);
  const svgPath = path.join(outDir, c.name);
  const pngName = c.name.replace(/\.svg$/i, '.png');
  const pngPath = path.join(outDir, pngName);

  fs.writeFileSync(svgPath, svg);
  await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: true })
    .toFile(pngPath);

  console.log(`wrote ${c.name}`);
  console.log(`wrote ${pngName}`);
}
