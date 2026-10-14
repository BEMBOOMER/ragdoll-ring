// Treffereffecten: zweet- en vonkdeeltjes en een korte schokgolf.
import * as THREE from 'three';

const MAX = 600;

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
