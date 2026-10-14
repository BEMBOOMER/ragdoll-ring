// De scheidsrechter: een kinematische figuur (geen physics). Hij houdt afstand van de
// boksers, loopt bij een knockdown naar de gevloerde bokser, telt met zijn arm en
// zwaait het gevecht af bij een knock-out.
import * as THREE from 'three';
import { RING_HALF } from '../game/constants.js';

const mat = (color, roughness = 0.6) => new THREE.MeshStandardMaterial({ color, roughness });

export class Referee {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    const shirt = mat(0xd9e3f0, 0.7);
    const pants = mat(0x15161b, 0.8);
    const skin = mat(0xc99673, 0.6);
    const black = mat(0x0b0b0e, 0.4);
    const capsule = (r, h, m) => new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 4, 10), m);
    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.1, 0.92, 0);
      const leg = capsule(0.065, 0.74, pants);
      leg.position.y = -0.44;
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), black);
      shoe.position.set(0, -0.86, 0.05);
      hip.add(leg, shoe);
      this.group.add(hip);
      this.legs.push(hip);
    }
    const torso = capsule(0.15, 0.34, shirt);
    torso.position.y = 1.22;
    torso.scale.set(0.95, 1, 0.68);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 16), black);
    belt.position.y = 0.97;
    belt.scale.set(1, 1, 0.75);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), skin);
    head.position.y = 1.62;
    head.scale.set(0.95, 1.08, 1);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.03), black);
    tie.position.set(0, 1.47, 0.12);
    this.group.add(torso, belt, head, tie);
    this.arms = [];
    for (const s of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.21, 1.42, 0);
      const upper = capsule(0.05, 0.24, shirt);
      upper.position.y = -0.16;
      const elbow = new THREE.Group();
      elbow.position.y = -0.31;
      const fore = capsule(0.042, 0.22, skin);
      fore.position.y = -0.14;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
      hand.position.y = -0.3;
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      this.group.add(shoulder);
      this.arms.push({ shoulder, elbow, side: s });
    }
    this.group.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    this.pos = new THREE.Vector3(0, 0, -2);
    this.yaw = 0;
    this.phase = 0;
    this.lastCount = 0;
    this.chop = 1;
    this.wave = 0;
  }

  // side = richting van het midden naar de camera; de scheidsrechter blijft aan de overkant.
  update(dt, game, side) {
    const f = game.fighters;
    if (f.length < 2 || !f[0].parts.pelvis) return;
    const a = f[0].pos().setY(0);
    const b = f[1].pos().setY(0);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    let target;
    let look = mid;
    let gesture = null;
    const counting = game.mode === 'match' && game.state === 'count' && game.count;
    const stopped = game.mode === 'match' && (game.state === 'ko' || (game.state === 'matchEnd' && game.method !== 'decision'));
    if (counting || stopped) {
      const who = counting ? game.count.who : game.loser ?? 0;
      const down = f[who].pos('chest').setY(0);
      const away = this.pos.clone().sub(down).setY(0);
      if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
      target = down.clone().addScaledVector(away.normalize(), 1.0);
      look = down;
      gesture = counting ? 'count' : 'wave';
      if (counting && game.count.n !== this.lastCount) {
        this.lastCount = game.count.n;
        this.chop = 0;
      }
    } else {
      this.lastCount = 0;
      target = mid.clone().addScaledVector(side, -1.9);
    }
    // Afstand houden van beide boksers en binnen de touwen blijven.
    for (const p of [a, b]) {
      const d = target.clone().sub(p);
      const len = d.length();
      const min = gesture ? 0.8 : 1.2;
      if (len < min) target.copy(p).addScaledVector(len > 1e-3 ? d.divideScalar(len) : new THREE.Vector3(0, 0, 1), min);
    }
    const lim = RING_HALF - 0.3;
    target.x = Math.max(-lim, Math.min(lim, target.x));
    target.z = Math.max(-lim, Math.min(lim, target.z));

    const step = target.clone().sub(this.pos);
    const dist = step.length();
    const speed = Math.min(dist * 3, 2.4);
    if (dist > 0.02) this.pos.addScaledVector(step.normalize(), Math.min(dist, speed * dt));
    const to = look.clone().sub(this.pos);
    if (to.lengthSq() > 1e-4) {
      const want = Math.atan2(to.x, to.z);
      let dy = want - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 6);
    }

    // Lopen: benen en armen zwaaien met de snelheid.
    const walk = Math.min(1, speed / 2);
    this.phase += dt * (4 + speed * 3);
    const swing = Math.sin(this.phase) * 0.5 * walk;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.chop = Math.min(1, this.chop + dt / 0.5);
    this.wave += dt * 9;
    for (const arm of this.arms) {
      let rx = -swing * arm.side * 0.6;
      let rz = arm.side * 0.12;
      let bend = -0.25;
      if (gesture === 'count' && arm.side > 0) {
        // Arm omhoog, dan bij elke tel naar beneden hakken.
        const u = this.chop;
        rx = -2.4 + u * 1.5;
        rz = 0.15;
        bend = -0.3;
      } else if (gesture === 'wave') {
        // Armen boven het hoofd heen en weer: afgelopen.
        rx = -2.6;
        rz = arm.side * (0.4 + Math.sin(this.wave) * 0.45);
        bend = -0.15;
      }
      arm.shoulder.rotation.set(rx, 0, rz);
      arm.elbow.rotation.x = bend;
    }
    this.group.position.set(this.pos.x, 0, this.pos.z);
    this.group.rotation.y = this.yaw;
  }
}
