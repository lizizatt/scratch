const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { before, test } = require('node:test');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
let THREE;
before(async () => { THREE = await import('three'); });

// Exercise the actual scene update with real Three.js transforms; only GPU/DOM I/O is replaced.
function harness() {
  let captured;
  class Renderer {
    setPixelRatio() {}
    setClearColor() {}
    getPixelRatio() { return 1; }
    render(scene, camera) { captured = { scene, camera }; }
  }
  class Controls {
    constructor() { this.target = new THREE.Vector3(); }
    update() {}
  }
  const source = readFileSync('src/hms_jazzy/web/scene.js', 'utf8');
  const context = { module: { exports: {} }, devicePixelRatio: 1,
    require: (name) => name === 'three'
      ? { ...THREE, WebGLRenderer: Renderer } : { OrbitControls: Controls } };
  vm.runInNewContext(transformSync(source, { format: 'cjs' }).code, context);
  const view = context.module.exports.createScene({
    width: 640, height: 400, clientWidth: 640, clientHeight: 400,
  });
  return {
    update(state) {
      view.update(state);
      view.render();
      const water = captured.scene.children.find((item) =>
        item.geometry?.type === 'PlaneGeometry' && !item.material.wireframe);
      const grid = captured.scene.children.find((item) =>
        item.name === 'ground-reference-grid' || item.material?.wireframe);
      return { ...captured, water, grid };
    },
  };
}

function snapshot(east = 0, north = 0) {
  return {
    time_s: 3, mode: 'manual',
    config: { length_m: 3.2, width_m: .85, thickness_m: .18, com_height_m: .2,
      thruster_x_m: -.6, thruster_arm_m: .5, max_thrust_n: 44.48 },
    truth: { east_m: east, north_m: north, up_m: .24, quaternion_wxyz: [1, 0, 0, 0] },
    thrust_n: { port: 0, starboard: 0 },
    water: { components: [{ amplitude_m: .15, wave_number_rad_m: .7,
      east: .8, north: .6, omega_rad_s: 2.6, phase_rad: .2 }] },
  };
}

for (const [east, north] of [[.1, 0], [0, .1], [-.1, -.1]]) {
  test(`grid stays fixed while camera follows boat (${east}, ${north})`, () => {
    const view = harness();
    const initial = view.update(snapshot());
    const origin = initial.grid.position.clone();
    const camera = initial.camera.position.clone();
    const after = view.update(snapshot(east, north));
    assert.ok(after.grid.position.distanceTo(origin) < 1e-10, 'grid translated with the boat');
    assert.ok(after.camera.position.clone().sub(camera)
      .distanceTo(new THREE.Vector3(east, north, 0)) < 1e-10);
    assert.ok(after.water.position.distanceTo(after.grid.position) < 1e-10);
  });
}

test('patch rebasing preserves overlapping world grid vertices and wave phase', () => {
  const view = harness();
  function vertices(rendered) {
    const positions = rendered.grid.geometry.attributes.position;
    const result = new Map();
    for (let i = 0; i < positions.count; i++) {
      const east = positions.getX(i) + rendered.grid.position.x;
      const north = positions.getY(i) + rendered.grid.position.y;
      result.set(`${east.toFixed(4)},${north.toFixed(4)}`, positions.getZ(i));
    }
    return result;
  }
  const before = vertices(view.update(snapshot()));
  const after = vertices(view.update(snapshot(4.9, -3.3)));
  let shared = 0;
  for (const [key, height] of before) {
    if (after.has(key)) {
      shared++;
      assert.ok(Math.abs(height - after.get(key)) < 1e-5, 'wave phase jumped after recentering');
    }
  }
  assert.ok(shared > before.size * .7, `only ${shared} grid vertices stayed world-anchored`);
});

test('rendering the same paused snapshot leaves the grid unchanged', () => {
  const view = harness();
  const first = view.update(snapshot(50, -30));
  const origin = first.grid.position.clone();
  const positions = first.grid.geometry.attributes.position.array.slice();
  const second = view.update(snapshot(50, -30));
  assert.deepEqual(second.grid.geometry.attributes.position.array, positions);
  assert.ok(second.grid.position.distanceTo(origin) < 1e-10);
});

test('ground reference has distinctive markings beyond a repeating single cell', () => {
  const view = harness();
  const { grid } = view.update(snapshot());
  assert.ok(grid.isLineSegments, 'triangular wireframe obscures the square ground reference');
  const colors = grid.geometry.attributes.color;
  assert.ok(colors, 'uniform cells cannot distinguish travel by one grid spacing');
  const styles = new Set();
  for (let i = 0; i < colors.count; i++) {
    styles.add(`${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`);
  }
  assert.ok(styles.size >= 3, 'need minor lines, major lines, and distinctive landmarks');
});

test('major lines and landmarks retain their styling at shared world positions', () => {
  const view = harness();
  function markings(rendered) {
    const { position, color } = rendered.grid.geometry.attributes;
    assert.ok(color, 'ground reference has no world-anchored markings');
    const result = new Set();
    for (let i = 0; i < position.count; i++) {
      result.add(`${(position.getX(i) + rendered.grid.position.x).toFixed(4)},`
        + `${(position.getY(i) + rendered.grid.position.y).toFixed(4)},`
        + `${color.getX(i)},${color.getY(i)},${color.getZ(i)}`);
    }
    return result;
  }
  const before = markings(view.update(snapshot()));
  const after = markings(view.update(snapshot(4.9, -3.3)));
  const shared = [...before].filter((key) => after.has(key));
  assert.ok(shared.length > before.size * .7, 'markings moved or changed when patch recentered');
});
