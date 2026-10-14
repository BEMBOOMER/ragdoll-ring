// Treffereffecten: zweet dat van de huid spat bij een klap, en bloeddruppels die vlekken
// op het canvas achterlaten (uit te zetten in de instellingen). Geen gloed of
// lichtgevende deeltjes: alles wordt gewoon gemengd, zoals echte druppels.
import * as THREE from 'three';
import { bloodStain } from './textures.js';

const MAX = 600;
const DROPS = 160;
const STAINS = 90;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.size = new Float32Array(MAX);
    this.color = new Float32Array(MAX * 3);
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAX), 1));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      uniforms: { scale: { value: 420 } },
      vertexShader: `
        attribute float alpha;
        attribute float size;
        varying float vA;
        varying vec3 vC;
        uniform float scale;
        void main() {
          vA = alpha;
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      // Een druppel: doorzichtig met een donkere rand en een klein lichtpuntje.
      fragmentShader: `
        varying float vA;
        varying vec3 vC;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float rim = smoothstep(0.25, 0.5, d);
          float glint = smoothstep(0.12, 0.0, length(p - vec2(-0.14, -0.14)));
          vec3 c = mix(vC, vC * 0.55, rim) + glint * 0.35;
          gl_FragColor = vec4(c, (0.35 + 0.3 * rim) * vA);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.buildBlood(scene);
  }

  buildBlood(scene) {
    this.drop = { pos: new Float32Array(DROPS * 3), vel: new Float32Array(DROPS * 3), life: new Float32Array(DROPS), cursor: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.drop.pos, 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(DROPS), 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 26 } },
      vertexShader: `
        attribute float alpha;
        varying float vA;
        uniform float scale;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = scale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5 || vA <= 0.0) discard;
          gl_FragColor = vec4(0.42, 0.02, 0.02, 0.9);
        }`,
    });
    this.drops = new THREE.Points(geo, mat);
    this.drops.frustumCulled = false;
    scene.add(this.drops);
    const stainMat = new THREE.MeshBasicMaterial({ map: bloodStain(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.stains = new THREE.InstancedMesh(plane, stainMat, STAINS);
    this.stains.count = 0;
    this.stains.frustumCulled = false;
    this.stainCursor = 0;
    scene.add(this.stains);
  }

  // Druppels uit een cut of neus, in de richting van de klap.
  bleed(pos, dir, amount) {
    const d = this.drop;
    const n = Math.round(3 + amount * 10);
    for (let k = 0; k < n; k++) {
      const i = d.cursor;
      d.cursor = (d.cursor + 1) % DROPS;
      d.pos.set([pos.x, pos.y, pos.z], i * 3);
      d.vel.set([dir.x * 1.6 + (Math.random() - 0.5) * 1.4, 0.4 + Math.random() * 1.2, dir.z * 1.6 + (Math.random() - 0.5) * 1.4], i * 3);
      d.life[i] = 2;
    }
  }

  stain(x, z) {
    const m = new THREE.Matrix4();
    const s = 0.05 + Math.random() * 0.09;
    m.compose(new THREE.Vector3(x, 0.006, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28), new THREE.Vector3(s, 1, s));
    this.stains.setMatrixAt(this.stainCursor, m);
    this.stainCursor = (this.stainCursor + 1) % STAINS;
    this.stains.count = Math.min(STAINS, this.stains.count + 1);
    this.stains.instanceMatrix.needsUpdate = true;
  }

  clearBlood() {
    this.drop.life.fill(0);
    this.stains.count = 0;
    this.stainCursor = 0;
  }

  updateBlood(dt) {
    const d = this.drop;
    const alpha = this.drops.geometry.attributes.alpha;
    for (let i = 0; i < DROPS; i++) {
      if (d.life[i] <= 0) {
        alpha.array[i] = 0;
        continue;
      }
      d.life[i] -= dt;
      const j = i * 3;
      d.vel[j + 1] -= 9.8 * dt;
      d.pos[j] += d.vel[j] * dt;
      d.pos[j + 1] += d.vel[j + 1] * dt;
      d.pos[j + 2] += d.vel[j + 2] * dt;
      if (d.pos[j + 1] < 0.01) {
        // Vlek op het canvas (alleen binnen de ring).
        if (Math.abs(d.pos[j]) < 3.6 && Math.abs(d.pos[j + 2]) < 3.6 && Math.random() < 0.5) this.stain(d.pos[j], d.pos[j + 2]);
        d.life[i] = 0;
      }
      alpha.array[i] = d.life[i] > 0 ? 1 : 0;
    }
    alpha.needsUpdate = true;
    this.drops.geometry.attributes.position.needsUpdate = true;
  }

  spawn(p, v, life, size, col) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.color.set([col.r, col.g, col.b], i * 3);
    this.dirty = true;
  }

  // Zweet spat van de huid in de richting van de klap (bij een geblokte stoot minder).
  impact(pos, dir, strength, kind) {
    const blocked = kind === 'block';
    const n = Math.round((blocked ? 3 : 6) + strength * (blocked ? 5 : 16));
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(1.6);
      const v = dir.clone().multiplyScalar(1.2 + Math.random() * 2.4 * strength).add(spread);
      col.setRGB(0.74 + Math.random() * 0.08, 0.76 + Math.random() * 0.08, 0.8 + Math.random() * 0.06);
      this.spawn(pos, v, 0.35 + Math.random() * 0.35, 0.008 + Math.random() * 0.012 * (1 + strength), col);
    }
  }

  update(dt) {
    this.updateBlood(dt);
    const alpha = this.points.geometry.attributes.alpha;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        alpha.array[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= 9.8 * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0.01) {
        this.pos[j + 1] = 0.01;
        this.vel[j + 1] *= -0.2;
        this.vel[j] *= 0.5;
        this.vel[j + 2] *= 0.5;
      }
      alpha.array[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    alpha.needsUpdate = true;
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    if (this.dirty) {
      attrs.size.needsUpdate = true;
      attrs.color.needsUpdate = true;
      this.dirty = false;
    }
  }
}
