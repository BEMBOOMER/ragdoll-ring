// Computertegenstander. Kiest afstand, cirkelt, verdedigt op de aanloop van stoten
// en valt aan met combinaties. Moeilijkheid bepaalt reactie, tempo en kracht.
import { DIFFICULTY, PUNCHES, RING_HALF } from './constants.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (weights) => {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = Math.random() * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
};

const COMBOS = {
  jab: ['jab', 'cross', 'leftHook'],
  cross: ['leftHook', 'uppercut'],
  leftHook: ['cross', 'rightHook'],
  rightHook: ['leftHook'],
  uppercut: ['leftHook'],
};

export class AIController {
  constructor(difficulty = 'normal', rng = Math.random) {
    this.setDifficulty(difficulty);
    this.random = rng;
    this.reset();
  }

  setDifficulty(key) {
    this.key = DIFFICULTY[key] ? key : 'normal';
    this.cfg = DIFFICULTY[this.key];
  }

  reset() {
    this.cooldown = rand(0.8, 1.4);
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.strafeTimer = rand(1, 2.5);
    this.desired = 0.95;
    this.blockTimer = 0;
    this.duckTimer = 0;
    this.retreatTimer = 0;
    this.reactedTo = null;
    this.combo = [];
    this.comboTimer = 0;
  }

  poll(dt, game, me, opp) {
    const intent = { move: { x: 0, z: 0 }, block: false, duck: false, punch: null };
    if (!me.parts.pelvis || me.ko) return intent;
    me.powerScale = this.cfg.power;
    const p = me.pos();
    const o = opp.pos();
    let dx = o.x - p.x;
    let dz = o.z - p.z;
    const dist = Math.hypot(dx, dz) || 1e-3;
    dx /= dist;
    dz /= dist;

    this.cooldown -= dt;
    this.blockTimer -= dt;
    this.duckTimer -= dt;
    this.retreatTimer -= dt;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = Math.random() < 0.65 ? -this.strafe : this.strafe;
      this.strafeTimer = rand(0.8, 2.6);
    }

    if (opp.ko) {
      // Winnaarshouding: rustig afstand nemen.
      const away = Math.max(0, 1.6 - dist);
      intent.move = { x: -dx * away, z: -dz * away };
      return intent;
    }

    // Verdedigen op de aanloop van een stoot.
    const op = opp.punch;
    if (op && op !== this.reactedTo && op.phase === 'windup' && dist < 1.35) {
      this.reactedTo = op;
      if (Math.random() < this.cfg.react) {
        const r = Math.random();
        if (op.name !== 'uppercut' && r < 0.6) this.blockTimer = rand(0.3, 0.5);
        else if (op.name !== 'uppercut' && r < 0.8) this.duckTimer = rand(0.25, 0.4);
        else this.retreatTimer = rand(0.25, 0.45);
      }
    }

    // Afstand kiezen.
    const tired = me.stamina < 28;
    const hurt = me.health < 30 && opp.health > me.health + 15;
    let desired = 0.95;
    if (this.cooldown < 0.25) desired = 0.72;
    if (tired || hurt) desired = 1.45;
    if (this.retreatTimer > 0) desired = 1.6;
    this.desired += (desired - this.desired) * Math.min(1, dt * 4);
    const radial = Math.max(-1, Math.min(1, (dist - this.desired) * 2.4));
    let mx = dx * radial;
    let mz = dz * radial;
    // Cirkelen (loodrecht op de lijn naar de tegenstander).
    const s = this.strafe * (tired ? 0.65 : 0.4) * this.cfg.aggression;
    mx += -dz * s;
    mz += dx * s;
    // Weg van de touwen.
    const edge = RING_HALF - 0.9;
    if (Math.abs(p.x) > edge) mx -= Math.sign(p.x) * 0.8;
    if (Math.abs(p.z) > edge) mz -= Math.sign(p.z) * 0.8;
    intent.move = { x: mx, z: mz };

    intent.block = this.blockTimer > 0 || (tired && dist < 1.1 && Math.random() < 0.02);
    intent.duck = this.duckTimer > 0;

    // Aanvallen.
    if (this.combo.length) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && !intent.block) {
        intent.punch = this.combo.shift();
        this.comboTimer = rand(0.18, 0.3);
      }
    } else if (this.cooldown <= 0 && dist < 1.12 && !me.punch && !intent.block && !intent.duck) {
      const w = { jab: 34, cross: 24, leftHook: 16, rightHook: 14, uppercut: 10 };
      if (opp.blocking) w.uppercut += 30;
      if (opp.ducking) w.uppercut += 40;
      if (dist > 0.95) {
        w.jab += 25;
        w.cross += 10;
      }
      const first = pick(w);
      if (me.stamina >= PUNCHES[first].stamina) {
        intent.punch = first;
        if (Math.random() < this.cfg.combo && me.stamina > 35) {
          const next = COMBOS[first][Math.floor(Math.random() * COMBOS[first].length)];
          this.combo = [next];
          if (Math.random() < this.cfg.combo * 0.5) this.combo.push(COMBOS[next][0]);
          this.comboTimer = rand(0.22, 0.32);
        }
        this.cooldown = rand(this.cfg.cooldown[0], this.cfg.cooldown[1]);
      } else {
        this.cooldown = 0.4;
      }
    }
    return intent;
  }
}
