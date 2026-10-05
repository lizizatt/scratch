import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// All transforms use the simulator's ENU world and X-forward, Y-port, Z-up body.
export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x0b2029);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b2029, 20, 42);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 150);
  camera.up.set(0, 0, 1);
  camera.position.set(5, -7, 4.5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 24;
  controls.maxPolarAngle = Math.PI * .47;
  scene.add(new THREE.HemisphereLight(0xc3e8ed, 0x173b41, 2.4));
  const sun = new THREE.DirectionalLight(0xfff2d9, 3);
  sun.position.set(-3, -4, 10);
  scene.add(sun);

  const waterSize = 64;
  const waterSegments = 100;
  const gridSpacing = waterSize / waterSegments;
  const waterGeometry = new THREE.PlaneGeometry(waterSize, waterSize, waterSegments, waterSegments);
  const water = new THREE.Mesh(waterGeometry, new THREE.MeshStandardMaterial({
    color: 0x20647a, roughness: .45, metalness: .15, transparent: true,
    opacity: .73, side: THREE.DoubleSide, depthWrite: false,
  }));
  // Shade the major squares in world space, independent of patch recentering.
  water.material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 groundPosition;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\ngroundPosition = (modelMatrix * vec4(transformed, 1.0)).xy;'
    );
    shader.fragmentShader = 'varying vec2 groundPosition;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
       vec2 groundCell = floor(groundPosition / ${(gridSpacing * 5).toFixed(1)});
       float alternate = mod(groundCell.x + groundCell.y, 2.0);
       diffuseColor.rgb *= mix(0.78, 1.08, alternate);`
    );
  };
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: .8, depthWrite: false,
  }));
  grid.name = 'ground-reference-grid';
  grid.renderOrder = 1;
  scene.add(water, grid);
  const board = new THREE.Group();
  scene.add(board);
  const target = new THREE.Mesh(new THREE.RingGeometry(.88, 1, 64),
    new THREE.MeshBasicMaterial({ color: 0xeddbb6, side: THREE.DoubleSide }));
  target.visible = false;
  scene.add(target);
  let configuration = "";
  let state = null;
  let center = new THREE.Vector3();
  let plumes = [];

  function mesh(geometry, color, x, y, z) {
    const result = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .6 }));
    result.position.set(x, y, z);
    board.add(result);
    return result;
  }

  function rebuild(c) {
    for (const child of [...board.children]) {
      child.geometry.dispose();
      child.material.dispose();
      board.remove(child);
    }
    const hull = mesh(new THREE.SphereGeometry(1, 40, 20), 0xe6e3cc, 0, 0, -c.com_height_m);
    hull.scale.set(c.length_m / 2, c.width_m / 2, c.thickness_m / 2);
    const deckZ = -c.com_height_m + c.thickness_m / 2;
    mesh(new THREE.BoxGeometry(c.length_m * .5, c.width_m * .6, .04), 0x164f50, -.12, 0, deckZ);
    mesh(new THREE.SphereGeometry(.08, 16, 12), 0xff9048, c.length_m * .4, 0, deckZ);
    const motorZ = -c.com_height_m - c.thickness_m / 2 - .06;
    mesh(new THREE.BoxGeometry(.04, c.thruster_arm_m * 2, .04), 0x6f9295,
      c.thruster_x_m, 0, motorZ + .09);
    plumes = [];
    for (const [side, color] of [[1, 0xf26c65], [-1, 0x57d7af]]) {
      const y = side * c.thruster_arm_m;
      const motor = mesh(new THREE.CapsuleGeometry(.085, .36, 4, 12), color,
        c.thruster_x_m, y, motorZ);
      motor.rotation.z = Math.PI / 2;
      mesh(new THREE.BoxGeometry(.035, .035, .13), 0x6f9295, c.thruster_x_m, y, motorZ + .06);
      const plume = mesh(new THREE.ConeGeometry(.085, 1, 12), color, c.thruster_x_m, y, motorZ);
      plume.material.transparent = true;
      plume.material.opacity = .35;
      plume.material.depthWrite = false;
      plumes.push(plume);
    }
  }

  function heightAt(east, north, snapshot) {
    return snapshot.water.components.reduce((height, wave) => height + wave.amplitude_m * Math.cos(
      wave.wave_number_rad_m * (east * wave.east + north * wave.north)
      - wave.omega_rad_s * snapshot.time_s + wave.phase_rad
    ), 0);
  }

  function rebuildGrid(east, north) {
    const positions = [], colors = [];
    const minor = new THREE.Color(0x397583);
    const major = new THREE.Color(0x98d6dc);
    const landmark = new THREE.Color(0xf5deb0);
    const firstEast = Math.round(east / gridSpacing) - waterSegments / 2;
    const firstNorth = Math.round(north / gridSpacing) - waterSegments / 2;
    function line(x1, y1, x2, y2, color) {
      positions.push(x1, y1, 0, x2, y2, 0);
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }
    for (let i = 0; i <= waterSegments; i++) {
      const fixed = (i - waterSegments / 2) * gridSpacing;
      for (let j = 0; j < waterSegments; j++) {
        const start = (j - waterSegments / 2) * gridSpacing;
        line(fixed, start, fixed, start + gridSpacing, (firstEast + i) % 5 === 0 ? major : minor);
        line(start, fixed, start + gridSpacing, fixed, (firstNorth + i) % 5 === 0 ? major : minor);
      }
    }
    for (let i = 0; i < waterSegments; i++) {
      if ((firstEast + i) % 5 !== 0) continue;
      for (let j = 0; j < waterSegments; j++) {
        if ((firstNorth + j) % 5 !== 0) continue;
        // World-cell hashing prevents identical marks from repeating with the patch.
        const hash = (Math.imul(firstEast + i, 73856093)
          ^ Math.imul(firstNorth + j, 19349663)) >>> 0;
        const x = (i - waterSegments / 2) * gridSpacing + .8 + (hash % 7) * .16;
        const y = (j - waterSegments / 2) * gridSpacing + .8 + ((hash >>> 4) % 7) * .16;
        const arm = .12 + (hash % 3) * .05;
        line(x - arm, y, x + arm, y, landmark);
        line(x, y - arm, x, y + arm, landmark);
      }
    }
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry();
    grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    grid.geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }

  function update(snapshot) {
    state = snapshot;
    const c = state.config;
    const key = JSON.stringify([c.length_m, c.width_m, c.thickness_m, c.com_height_m,
      c.thruster_x_m, c.thruster_arm_m]);
    if (key !== configuration) { rebuild(c); configuration = key; }
    const next = new THREE.Vector3(state.truth.east_m, state.truth.north_m, 0);
    camera.position.add(next.clone().sub(center));
    controls.target.add(next.clone().sub(center));
    center = next;
    board.position.set(center.x, center.y, state.truth.up_m);
    const [w, x, y, z] = state.truth.quaternion_wxyz;
    board.quaternion.set(x, y, z, w);
    // Recenter only by whole cells: overlapping grid lines stay fixed in ENU,
    // while the finite patch continues covering the camera on long journeys.
    const waterEast = Math.round(center.x / gridSpacing) * gridSpacing;
    const waterNorth = Math.round(center.y / gridSpacing) * gridSpacing;
    if (!grid.geometry.attributes.position || grid.position.x !== waterEast || grid.position.y !== waterNorth) {
      rebuildGrid(waterEast, waterNorth);
    }
    const positions = waterGeometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setZ(i, heightAt(positions.getX(i) + waterEast, positions.getY(i) + waterNorth, state));
    }
    positions.needsUpdate = true;
    waterGeometry.computeVertexNormals();
    water.position.set(waterEast, waterNorth, 0);
    grid.position.copy(water.position);
    const gridPositions = grid.geometry.attributes.position;
    for (let i = 0; i < gridPositions.count; i++) {
      gridPositions.setZ(i, heightAt(gridPositions.getX(i) + waterEast,
        gridPositions.getY(i) + waterNorth, state) + .015);
    }
    gridPositions.needsUpdate = true;
    grid.geometry.computeBoundingSphere();
    target.visible = state.mode === "waypoint";
    if (target.visible) {
      const wp = state.waypoint;
      target.position.set(wp.east_m, wp.north_m, heightAt(wp.east_m, wp.north_m, state) + .04);
      target.scale.setScalar(wp.arrival_radius_m);
    }
    for (const [i, side] of ["port", "starboard"].entries()) {
      const force = state.thrust_n[side] / c.max_thrust_n;
      const plume = plumes[i];
      plume.visible = Math.abs(force) > .02;
      plume.scale.y = Math.abs(force) * .9;
      plume.rotation.z = -Math.sign(force) * Math.PI / 2;
      plume.position.x = c.thruster_x_m - Math.sign(force) * (.22 + Math.abs(force) * .45);
    }
  }

  function render() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const ratio = renderer.getPixelRatio();
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    }
    controls.update();
    if (state) renderer.render(scene, camera);
  }

  return { update, render };
}
