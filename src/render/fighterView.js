// Visuele bokser: per rigid body een mesh, geïnterpoleerd tussen physics-stappen.
// Huid, leer en satijn komen uit textures.js; treffers worden op de huid geschilderd
// (roodheid, blauwe plekken, zwelling, cuts) en de huid gaat glanzen van het zweet.
import * as THREE from 'three';
import { BODY } from '../game/constants.js';
import { skinDetail, leather, satin, DamageSkin, GloveSkin } from './textures.js';

export const TEAM = [
  { name: 'Blauw', primary: 0x2f7bff, trim: 0xffffff, glove: 0x1f5fe0, skin: 0xd9a27c, hair: 0x2b1d14 },
  { name: 'Rood', primary: 0xe8323c, trim: 0xffd666, glove: 0xd42330, skin: 0x8d5a3b, hair: 0x0f0b09 },
];

// Ogen in de lokale ruimte van het hoofd (voor zwelling).
const EYES = { L: new THREE.Vector3(0.33, 0.17, 0.93).normalize(), R: new THREE.Vector3(-0.33, 0.17, 0.93).normalize() };

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0, ...opts });
}

// Schade die een heel gevecht blijft staan, per hoek en over de rondes heen.
export class Marks {
  constructor() {
    this.face = new DamageSkin(512, 256);
    this.body = new DamageSkin(512, 256);
    this.gloves = { L: new GloveSkin(), R: new GloveSkin() };
    this.swell = { L: 0, R: 0 };
  }
  reset() {
    this.face.reset();
    this.body.reset();
    this.gloves.L.reset();
    this.gloves.R.reset();
    this.swell = { L: 0, R: 0 };
  }
  get bleeding() {
    return this.face.bleed > 0.3 || this.face.cuts > 0;
  }
}

export class FighterView {
  constructor(scene, fighter, team, marks = new Marks()) {
    this.scene = scene;
    this.fighter = fighter;
    this.marks = marks;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.meshes = [];
    this.byPart = {};
    this.flash = 0;
    const look = { ...team, ...(fighter.profile?.look || {}) };
    const detail = skinDetail();
    const skinOpts = {
      color: look.skin,
      roughness: 0.55,
      normalMap: detail.normalMap,
      normalScale: new THREE.Vector2(0.07, 0.07),
      clearcoat: 0,
      clearcoatRoughness: 0.4,
      sheen: 0.25,
      sheenColor: new THREE.Color(0xffd9c2),
    };
    const skin = new THREE.MeshPhysicalMaterial({ ...skinOpts, map: detail.map });
    const face = new THREE.MeshPhysicalMaterial({ ...skinOpts, map: marks.face.texture });
    const torso = new THREE.MeshPhysicalMaterial({ ...skinOpts, map: marks.body.texture });
    const trunks = std(look.primary, { roughness: 0.36, map: satin(fighter.side === 0 ? '' : fighter.profile?.short || '').map });
    const trim = std(look.trim, { roughness: 0.4 });
    const lea = leather();
    const gloves = {};
    for (const s of ['L', 'R']) {
      gloves[s] = std(look.glove, {
        roughness: 0.3,
        metalness: 0.05,
        map: marks.gloves[s].texture,
        normalMap: lea.normalMap,
        normalScale: new THREE.Vector2(0.6, 0.6),
        emissive: look.glove,
        emissiveIntensity: 0.04,
      });
    }
    const shoe = std(0x15151a, { roughness: 0.45, normalMap: lea.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
    const sock = std(0xf4f4f4, { roughness: 0.85 });
    const hair = std(look.hair, { roughness: 0.9 });
    const dark = std(0x111111, { roughness: 0.3 });
    // Zwelling: dezelfde huid, iets paarser en glanzender.
    const swollen = new THREE.MeshPhysicalMaterial({ ...skinOpts, color: new THREE.Color(look.skin).multiply(new THREE.Color(0xc79aa8)), roughness: 0.4 });
    this.skins = [skin, face, torso, swollen];
    this.allMaterials = [skin, face, torso, swollen, trunks, trim, gloves.L, gloves.R, shoe, sock, hair, dark];

    const B = BODY;
    const add = (partName, build) => {
      const part = fighter.parts[partName];
      const g = new THREE.Group();
      build(g);
      g.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.root.add(g);
      this.meshes.push({ part, g, name: partName });
      this.byPart[partName] = g;
    };
    const capsule = (r, half, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, half * 2, 6, 14), mat);

    add('pelvis', (g) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), trunks);
      m.scale.set(0.2, 0.15, 0.14);
      g.add(m);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 32), trim);
      band.rotation.x = Math.PI / 2;
      band.scale.set(1.05, 0.78, 1);
      band.position.y = 0.08;
      g.add(band);
    });
    add('chest', (g) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), torso);
      m.scale.set(0.21, 0.24, 0.135);
      g.add(m);
      const pecs = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skin);
      pecs.scale.set(0.19, 0.1, 0.1);
      pecs.position.set(0, 0.08, 0.05);
      g.add(pecs);
      const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.34, 6, 12), skin);
      shoulders.rotation.z = Math.PI / 2;
      shoulders.position.y = B.shoulderY;
      g.add(shoulders);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12), skin);
      neck.position.y = 0.24;
      g.add(neck);
    });
    add('head', (g) => {
      const r = B.head.radius;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 22), face);
      m.scale.set(0.92, 1.05, 1);
      g.add(m);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
      cap.rotation.x = -0.35;
      cap.position.set(0, 0.012, -0.012);
      g.add(cap);
      this.swellMeshes = {};
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), dark);
        eye.position.set(s * 0.038, 0.02, r * 0.93);
        g.add(eye);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin);
        ear.scale.set(0.5, 1, 0.8);
        ear.position.set(s * r * 0.92, 0, 0);
        g.add(ear);
        // Zwelling boven en naast het oog, groeit met treffers.
        const swell = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), swollen);
        swell.position.set(s * 0.05, 0.034, r * 0.88);
        swell.visible = false;
        g.add(swell);
        this.swellMeshes[s > 0 ? 'L' : 'R'] = swell;
      }
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), hair);
      brow.position.set(0, 0.048, r * 0.92);
      g.add(brow);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 12), face);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, -0.005, r * 1.02);
      g.add(nose);
      const mouthguard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), trim);
      mouthguard.position.set(0, -0.05, r * 0.94);
      g.add(mouthguard);
    });
    for (const side of ['L', 'R']) {
      add('upperArm' + side, (g) => g.add(capsule(B.upperArm.radius, B.upperArm.half, skin)));
      add('foreArm' + side, (g) => {
        g.add(capsule(B.foreArm.radius, B.foreArm.half, skin));
        const shape = fighter.parts['foreArm' + side].shapes.find((s) => s.type === 'glove');
        const gl = new THREE.Mesh(new THREE.SphereGeometry(B.glove.radius * 1.08, 28, 20), gloves[side]);
        gl.scale.set(1, 1.12, 1.05);
        gl.position.y = shape.offset;
        g.add(gl);
        const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), gloves[side]);
        thumb.position.set(side === 'L' ? -0.06 : 0.06, shape.offset + 0.02, 0.04);
        g.add(thumb);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.07, 16), trim);
        cuff.position.y = shape.offset + 0.1;
        g.add(cuff);
      });
      add('thigh' + side, (g) => {
        g.add(capsule(B.thigh.radius, B.thigh.half, skin));
        const shorts = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.095, 0.24, 16), trunks);
        shorts.position.y = 0.09;
        g.add(shorts);
        const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.097, 0.097, 0.025, 16), trim);
        stripe.position.y = -0.02;
        g.add(stripe);
      });
      add('shin' + side, (g) => {
        g.add(capsule(B.shin.radius, B.shin.half, skin));
        const shape = fighter.parts['shin' + side].shapes.find((s) => s.type === 'shoe');
        const boot = new THREE.Mesh(new THREE.BoxGeometry(shape.size[0] * 2.1, shape.size[1] * 2.4, shape.size[2] * 2), shoe);
        boot.position.set(...shape.offset);
        g.add(boot);
        const high = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.062, 0.14, 14), shoe);
        high.position.y = shape.offset[1] + 0.08;
        g.add(high);
        const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.03, 14), sock);
        s2.position.y = shape.offset[1] + 0.16;
        g.add(s2);
      });
    }
    this.applySwelling();
  }

  hitFlash(amount = 1) {
    this.flash = Math.max(this.flash, amount);
  }

  // Een treffer laat sporen na op de plek waar hij landde.
  mark(e, blood) {
    const f = this.fighter;
    const strength = Math.min(1, e.damage / 18) * (0.6 + Math.min(1, e.severity) * 0.4);
    if (e.zone === 'head') {
      const d = e.pos.clone().sub(f.pos('head')).applyQuaternion(f.rot('head').invert()).normalize();
      this.marks.face.hit(d, strength, { blood, spot: e.spot });
      for (const s of ['L', 'R']) {
        if (d.dot(EYES[s]) > 0.8) this.marks.swell[s] = Math.min(1, this.marks.swell[s] + strength * 0.22);
      }
      this.applySwelling();
    } else if (e.zone === 'chest' || e.zone === 'pelvis') {
      const d = e.pos.clone().sub(f.pos('chest')).applyQuaternion(f.rot('chest').invert()).normalize();
      this.marks.body.hit(d, strength * 0.8, { blood: false });
    }
  }

  applySwelling() {
    if (!this.swellMeshes) return;
    for (const s of ['L', 'R']) {
      const k = this.marks.swell[s];
      const m = this.swellMeshes[s];
      m.visible = k > 0.08;
      m.scale.set(0.01 + k * 0.009, 0.007 + k * 0.007, 0.007 + k * 0.008);
    }
  }

  // Herhaling: zet één lichaamsdeel direct op een opgenomen stand.
  setPart(name, p, q) {
    const g = this.byPart[name];
    if (!g) return;
    g.position.set(p[0], p[1], p[2]);
    g.quaternion.set(q[0], q[1], q[2], q[3]);
  }

  update(alpha, dt, live = true) {
    if (live) {
      for (const { part, g } of this.meshes) {
        if (!part.curP) continue;
        g.position.lerpVectors(part.prevP, part.curP, alpha);
        g.quaternion.slerpQuaternions(part.prevQ, part.curQ, alpha);
      }
    }
    // Zweet: de huid wordt glanzender naarmate het gevecht vordert.
    const sweat = this.fighter.sweat || 0;
    for (const m of this.skins) {
      m.roughness = 0.55 - sweat * 0.22;
      m.clearcoat = sweat * 0.7;
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of this.skins) m.emissive.setRGB(this.flash * 0.6, this.flash * 0.15, this.flash * 0.1);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const m of this.allMaterials) m.dispose();
  }
}
