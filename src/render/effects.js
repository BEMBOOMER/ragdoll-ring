// Treffereffecten: zweet- en vonkdeeltjes, een korte schokgolf, en bloeddruppels
// die vlekken op het canvas achterlaten (uit te zetten in de instellingen).
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
      blending: THREE.AdditiveBlending,
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
      fragmentShader: `
        varying float vA;
        varying vec3 vC;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vA;
          gl_FragColor = vec4(vC, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.6, 1, 40);
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

  impact(pos, dir, strength, kind) {
    const n = Math.round(8 + strength * 26);
    const col = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(2.2);
      const v = dir.clone().multiplyScalar(1.5 + Math.random() * 3 * strength).add(spread);
      if (kind === 'block') col.setRGB(0.6, 0.7, 0.9);
      else if (kind === 'head') col.setHSL(0.12 + Math.random() * 0.05, 0.9, 0.6 + Math.random() * 0.3);
      else col.setHSL(0.55, 0.4, 0.7 + Math.random() * 0.2);
      this.spawn(pos, v, 0.25 + Math.random() * 0.35, 0.025 + Math.random() * 0.04 * (1 + strength), col);
    }
    // schokgolf
    const ringMat = new THREE.MeshBasicMaterial({
      color: kind === 'block' ? 0x9fb8ff : 0xfff1c4,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(pos.clone().sub(dir));
    ring.scale.setScalar(0.02);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0, max: 0.16 + strength * 0.12, grow: 0.25 + strength * 0.45 });
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
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const r = this.rings[k];
      r.t += dt;
      const u = r.t / r.max;
      r.mesh.scale.setScalar(0.02 + u * r.grow);
      r.mesh.material.opacity = 0.85 * (1 - u);
      if (u >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(k, 1);
      }
    }
  }
}
