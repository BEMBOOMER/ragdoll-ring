// Visuele bokser: per rigid body een mesh, geïnterpoleerd tussen physics-stappen.
import * as THREE from 'three';
import { BODY } from '../game/constants.js';

export const TEAM = [
  { name: 'Blauw', primary: 0x2f7bff, trim: 0xffffff, glove: 0x1f5fe0, skin: 0xd9a27c, hair: 0x2b1d14 },
  { name: 'Rood', primary: 0xe8323c, trim: 0xffd666, glove: 0xd42330, skin: 0x8d5a3b, hair: 0x0f0b09 },
];

function std(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.6, metalness: opts.metalness ?? 0, ...opts });
}

export class FighterView {
  constructor(scene, fighter, team) {
    this.scene = scene;
    this.fighter = fighter;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.meshes = [];
    this.flash = 0;
    const skin = std(team.skin, { roughness: 0.55 });
    const trunks = std(team.primary, { roughness: 0.45 });
    const trim = std(team.trim, { roughness: 0.4 });
    const glove = std(team.glove, { roughness: 0.25, metalness: 0.05, emissive: team.glove, emissiveIntensity: 0.05 });
    const shoe = std(0x15151a, { roughness: 0.5 });
    const sock = std(0xf4f4f4, { roughness: 0.8 });
    const hair = std(team.hair, { roughness: 0.9 });
    const dark = std(0x111111, { roughness: 0.4 });
    this.materials = { skin, trunks, glove };
    this.allMaterials = [skin, trunks, trim, glove, shoe, sock, hair, dark];
    this.skinBase = new THREE.Color(team.skin);

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
      this.meshes.push({ part, g });
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
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), skin);
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
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), skin);
      m.scale.set(0.92, 1.05, 1);
      g.add(m);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
      cap.rotation.x = -0.35;
      cap.position.set(0, 0.012, -0.012);
      g.add(cap);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), dark);
        eye.position.set(s * 0.038, 0.02, r * 0.93);
        g.add(eye);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), skin);
        ear.scale.set(0.5, 1, 0.8);
        ear.position.set(s * r * 0.92, 0, 0);
        g.add(ear);
      }
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), hair);
      brow.position.set(0, 0.048, r * 0.92);
      g.add(brow);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 8), skin);
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
        const gl = new THREE.Mesh(new THREE.SphereGeometry(B.glove.radius * 1.08, 24, 18), glove);
        gl.scale.set(1, 1.12, 1.05);
        gl.position.y = shape.offset;
        g.add(gl);
        const thumb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), glove);
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
  }

  hitFlash(amount = 1) {
    this.flash = Math.max(this.flash, amount);
  }

  update(alpha, dt) {
    for (const { part, g } of this.meshes) {
      if (!part.curP) continue;
      g.position.lerpVectors(part.prevP, part.curP, alpha);
      g.quaternion.slerpQuaternions(part.prevQ, part.curQ, alpha);
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      this.materials.skin.emissive.setRGB(this.flash * 0.6, this.flash * 0.15, this.flash * 0.1);
    } else this.materials.skin.emissive.setRGB(0, 0, 0);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    for (const m of this.allMaterials) m.dispose();
  }
}
