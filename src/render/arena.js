// De zaal: ring met canvas, touwen en hoekpalen, licht, publiek en flitsers.
import * as THREE from 'three';
import { RING_HALF } from '../game/constants.js';
import { ringCanvas, rope, floor as floorTex, leather } from './textures.js';

const POST = RING_HALF + 0.18;
const RING_COLORS = { blue: 0x2f7bff, red: 0xff3b3b, white: 0xf2f2f2 };

function apronTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#0e1a33');
  grd.addColorStop(1, '#070d1c');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#ffd666';
  g.fillRect(0, 0, 1024, 6);
  g.font = '900 60px "Anton", Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText('RAGDOLL  RING', 300, 70);
  g.fillStyle = 'rgba(255,214,102,0.85)';
  g.fillText('★  ★  ★', 760, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.excitement = 0.2;
    this.time = 0;
    this.buildLights();
    this.buildRing();
    this.buildCrowd();
    this.buildFlashes();
  }

  buildLights() {
    const s = this.scene;
    // Weinig omgevingslicht: de zaal is donker, de ring fel en neutraal wit verlicht.
    s.add(new THREE.HemisphereLight(0x9aa6bd, 0x0b0b0e, 0.06));
    const key = new THREE.SpotLight(0xfff4e6, 230, 30, 0.6, 0.5, 1.6);
    key.position.set(0, 9.5, 0.5);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 16;
    s.add(key, key.target);
    this.key = key;
    // Twee schuine spots vanaf het rek: modelleren het lichaam, zoals bij tv-verlichting.
    for (const [x, z] of [[-6, 5], [6, -5]]) {
      const side = new THREE.SpotLight(0xf2f5ff, 55, 26, 0.45, 0.7, 1.6);
      side.position.set(x, 7, z);
      side.target.position.set(0, 1.1, 0);
      s.add(side, side.target);
    }
    const fill = new THREE.DirectionalLight(0xdfe6f5, 0.1);
    fill.position.set(0, 4, 8);
    s.add(fill);

    // Lampenrek boven de ring.
    const rig = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.12, 5),
      new THREE.MeshStandardMaterial({ color: 0x15171d, metalness: 0.6, roughness: 0.4 })
    );
    rig.position.y = 9.8;
    this.group.add(rig);
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, 0]]) {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 16), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
      lamp.position.set(x, 9.6, z);
      this.group.add(lamp);
    }
  }

  buildRing() {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), new THREE.MeshStandardMaterial({ map: floorTex().map, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.62;
    floor.receiveShadow = true;
    g.add(floor);

    const size = POST * 2 + 0.6;
    const apron = apronTexture();
    apron.wrapS = THREE.RepeatWrapping;
    apron.repeat.set(2, 1);
    const sideMat = new THREE.MeshStandardMaterial({ map: apron, roughness: 0.7 });
    const mat = ringCanvas();
    const topMat = new THREE.MeshStandardMaterial({ map: mat.map, normalMap: mat.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: mat.roughnessMap, roughness: 1 });
    const platform = new THREE.Mesh(new THREE.BoxGeometry(size, 0.62, size), [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    platform.position.y = -0.31;
    platform.receiveShadow = true;
    g.add(platform);

    // Hoekpalen en kussens.
    const postMat = new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.85, roughness: 0.25 });
    const corners = [
      [-POST, -POST, RING_COLORS.blue],
      [POST, POST, RING_COLORS.red],
      [POST, -POST, RING_COLORS.white],
      [-POST, POST, RING_COLORS.white],
    ];
    for (const [x, z, col] of corners) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.55, 16), postMat);
      post.position.set(x, 0.775, z);
      post.castShadow = true;
      g.add(post);
      const lea = leather();
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 1.05, 0.2),
        new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.45, map: lea.map, normalMap: lea.normalMap, clearcoat: 0.4, clearcoatRoughness: 0.3 })
      );
      pad.position.set(x - Math.sign(x) * 0.08, 0.85, z - Math.sign(z) * 0.08);
      pad.rotation.y = Math.PI / 4;
      pad.castShadow = true;
      g.add(pad);
    }

    // Touwen.
    const ropeCols = [0xd93a3a, 0xf0f0f0, 0x2f6fe0];
    const heights = [1.28, 0.88, 0.48];
    heights.forEach((h, i) => {
      const braid = rope();
      const mat = new THREE.MeshPhysicalMaterial({ color: ropeCols[i], roughness: 0.48, map: braid.map, normalMap: braid.normalMap, clearcoat: 0.25, clearcoatRoughness: 0.35 });
      for (let s = 0; s < 4; s++) {
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, POST * 2, 12), mat);
        line.castShadow = true;
        line.rotation.z = Math.PI / 2;
        if (s < 2) line.position.set(0, h, s === 0 ? -POST : POST);
        else {
          line.rotation.set(Math.PI / 2, 0, 0);
          line.position.set(s === 2 ? -POST : POST, h, 0);
        }
        g.add(line);
      }
    });

    // Trapjes en reclameborden langs de ring.
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x0b1224, emissive: 0x1d3b7a, emissiveIntensity: 0.18, roughness: 0.6 }); // ledborden
    for (const [x, z, ry] of [[0, -6.2, 0], [0, 6.2, Math.PI], [-6.2, 0, Math.PI / 2], [6.2, 0, -Math.PI / 2]]) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(9, 0.9, 0.1), boardMat);
      board.position.set(x, -0.17, z);
      board.rotation.y = ry;
      g.add(board);
    }
  }

  buildCrowd() {
    const rows = [];
    for (let tier = 0; tier < 6; tier++) {
      const r = 7.2 + tier * 1.05;
      const y = -0.45 + tier * 0.55;
      const n = Math.floor(r * 2 * 4 * 1.25);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // langs een vierkant
        const side = Math.floor(t * 4);
        const u = (t * 4 - side) * 2 - 1;
        let x;
        let z;
        if (side === 0) [x, z] = [u * r, -r];
        else if (side === 1) [x, z] = [r, u * r];
        else if (side === 2) [x, z] = [-u * r, r];
        else [x, z] = [-r, -u * r];
        if (Math.abs(x) < 1.6 && z < 0 && tier < 3) continue; // gangpad
        rows.push({ x: x + (Math.random() - 0.5) * 0.25, z: z + (Math.random() - 0.5) * 0.25, y, phase: Math.random() * 10, speed: 2 + Math.random() * 3, scale: 0.85 + Math.random() * 0.3 });
      }
    }
    const geo = new THREE.CapsuleGeometry(0.2, 0.55, 4, 8);
    geo.translate(0, 0.48, 0);
    // Publiek zit in het donker: nauwelijks zaalreflectie.
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.15 });
    const mesh = new THREE.InstancedMesh(geo, mat, rows.length);
    const headGeo = new THREE.SphereGeometry(0.15, 10, 8);
    headGeo.translate(0, 1.12, 0);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, envMapIntensity: 0.15 }), rows.length);
    const palette = [0x2a2f3d, 0x3b2a2a, 0x1f2f3a, 0x3a3524, 0x2d2236, 0x40403f, 0x1e2a22, 0x5a2324, 0x23345a];
    const skins = [0x8a5a3c, 0xc79072, 0x5c3b28, 0xe0b090, 0xa06a48];
    const col = new THREE.Color();
    rows.forEach((r, i) => {
      col.setHex(palette[i % palette.length]).multiplyScalar(0.7 + Math.random() * 0.5);
      mesh.setColorAt(i, col);
      col.setHex(skins[i % skins.length]).multiplyScalar(0.6);
      heads.setColorAt(i, col);
    });
    this.crowd = { rows, mesh, heads, m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3() };
    this.group.add(mesh, heads);
    this.updateCrowd(0);
  }

  buildFlashes() {
    const n = 90;
    const pos = new Float32Array(n * 3);
    const life = new Float32Array(n);
    const { rows } = this.crowd;
    for (let i = 0; i < n; i++) {
      const r = rows[Math.floor(Math.random() * rows.length)];
      pos.set([r.x, r.y + 1.3, r.z], i * 3);
      life[i] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('life', new THREE.BufferAttribute(life, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 110 } },
      vertexShader: `
        attribute float life;
        varying float vLife;
        uniform float scale;
        void main() {
          vLife = life;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = scale * life / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vLife;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          // Een cameraflits ver weg: een klein, kort lichtpuntje, geen ster.
          float a = smoothstep(0.5, 0.15, d) * vLife * 0.8;
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.92), a);
        }`,
    });
    this.flashes = new THREE.Points(geo, mat);
    this.group.add(this.flashes);
  }

  burstFlashes(count) {
    const life = this.flashes.geometry.attributes.life;
    for (let k = 0; k < count; k++) life.array[Math.floor(Math.random() * life.count)] = 1;
    life.needsUpdate = true;
  }

  updateCrowd(dt) {
    const { rows, mesh, heads, m, q, s, p } = this.crowd;
    const amp = 0.03 + this.excitement * 0.22;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const bob = Math.max(0, Math.sin(this.time * r.speed * (0.6 + this.excitement) + r.phase)) * amp;
      p.set(r.x, r.y + bob, r.z);
      s.setScalar(r.scale);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(-r.x, -r.z));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    this.time += dt;
    this.excitement = Math.max(0.15, this.excitement - dt * 0.12);
    this.updateCrowd(dt);
    const life = this.flashes.geometry.attributes.life;
    let changed = false;
    for (let i = 0; i < life.count; i++) {
      if (life.array[i] > 0) {
        life.array[i] = Math.max(0, life.array[i] - dt * 7);
        changed = true;
      } else if (Math.random() < dt * 0.25 * this.excitement) {
        life.array[i] = 1;
        changed = true;
      }
    }
    if (changed) life.needsUpdate = true;
  }

  excite(amount) {
    this.excitement = Math.min(1, this.excitement + amount);
  }
}
