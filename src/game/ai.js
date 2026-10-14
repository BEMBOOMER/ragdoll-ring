// Computertegenstander met een vechtstijl. Ziet alleen wat een bokser ook ziet: de aanloop
// van een stoot (na een reactietijd), afstand, dekking, vermoeidheid en missers. Onthoudt
// welke stoten de tegenstander graag gooit en reageert daar steeds beter op.
import { DIFFICULTY, PUNCHES, RING_HALF, STYLES } from './constants.js';

const COMBOS = {
  jab: ['jab', 'cross', 'leftHook'],
  cross: ['leftHook', 'uppercut'],
  leftHook: ['cross', 'rightHook'],
  rightHook: ['leftHook'],
  uppercut: ['leftHook'],
};

export class AIController {
  constructor(difficulty = 'normal', style = 'boxerPuncher', rng = Math.random) {
    this.random = rng;
    this.setDifficulty(difficulty);
    this.setStyle(style);
    this.reset();
  }

  setDifficulty(key) {
    this.key = DIFFICULTY[key] ? key : 'normal';
    this.cfg = DIFFICULTY[this.key];
  }

  setStyle(key) {
    this.styleKey = STYLES[key] ? key : 'boxerPuncher';
    this.style = STYLES[this.styleKey];
  }

  rand(a, b) {
    return a + this.random() * (b - a);
  }

  pick(weights) {
    let total = 0;
    for (const k in weights) total += weights[k];
    let r = this.random() * total;
    for (const k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return Object.keys(weights)[0];
  }

  reset() {
    this.cooldown = this.rand(0.8, 1.4);
    this.strafe = this.random() < 0.5 ? -1 : 1;
    this.strafeTimer = this.rand(1, 2.5);
    this.desired = this.style.range;
    this.blockTimer = 0;
    this.duckTimer = 0;
    this.retreatTimer = 0;
    this.counterTimer = 0;
    this.shell = false;
    this.shellTimer = 0;
    this.headTimer = 0;
    this.reactedTo = null;
    this.combo = [];
    this.comboTimer = 0;
    this.memory = { jab: 0, cross: 0, leftHook: 0, rightHook: 0, uppercut: 0 };
  }

  // Kies een verdediging tegen een stoot die we zien aankomen.
  defend(op, intent) {
    const st = this.style;
    const straight = op.name === 'jab' || op.name === 'cross';
    const r = this.random();
    if (op.body || op.name === 'uppercut') {
      // Dekking helpt niet tegen een uppercut of lijfstoot: wegdraaien of afstand nemen.
      if (r < st.slip) intent.slip = this.random() < 0.5 ? 1 : -1;
      else this.retreatTimer = this.rand(0.25, 0.45);
    } else if (straight && r < st.slip) {
      intent.slip = op.def.hand === 'L' ? 1 : -1; // weg van de slaande hand, buiten de lijn
    } else if (!straight && r < st.slip * 0.8) {
      this.duckTimer = this.rand(0.25, 0.4); // onder de hoek door
    } else if (r < st.slip + st.block) {
      this.blockTimer = this.rand(0.3, 0.5);
    } else {
      this.retreatTimer = this.rand(0.25, 0.45);
    }
    // Wie ontwijkt, heeft een kans om terug te slaan.
    if (intent.slip || this.duckTimer > 0) this.counterTimer = 0.6;
  }

  poll(dt, game, me, opp) {
    const intent = { move: { x: 0, z: 0 }, block: false, duck: false, punch: null, body: false, slip: 0 };
    if (!me.parts.pelvis || me.state !== 'up') return intent;
    me.powerScale = this.cfg.power;
    const st = this.style;
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
    this.counterTimer -= dt;
    this.strafeTimer -= dt;
    this.shellTimer -= dt;
    this.headTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = this.random() < 0.65 ? -this.strafe : this.strafe;
      this.strafeTimer = this.rand(0.8, 2.6);
    }

    if (opp.state !== 'up') {
      // Tegenstander ligt: rustig afstand nemen.
      const away = Math.max(0, 1.6 - dist);
      intent.move = { x: -dx * away, z: -dz * away };
      return intent;
    }

    // Waarnemen: een stoot is pas na de reactietijd te zien.
    const op = opp.punch;
    if (op && op !== this.reactedTo && op.phase !== 'recover') {
      const seen = op.phase === 'windup' ? op.t : op.windup + op.t;
      if (seen >= this.cfg.delay) {
        this.reactedTo = op;
        this.memory[op.name]++;
        const total = Object.values(this.memory).reduce((a, b) => a + b, 0);
        const habit = total > 4 ? this.memory[op.name] / total : 0.2;
        const chance = Math.min(0.95, this.cfg.react * (0.8 + habit * 1.2));
        if (dist < 1.35 && this.random() < chance) this.defend(op, intent);
      }
    }

    // Conditie bepaalt het tempo.
    const cap = me.staminaCap();
    const tired = me.stamina < cap * 0.28;
    const hurt = me.daze > 0.45 || me.health < 30;
    const oppHurt = opp.daze > 0.4 || opp.balance < 0.5;

    // Afstand kiezen.
    let desired = st.range;
    if (this.cooldown < 0.25) desired = st.close;
    if (oppHurt && !st.retreatHurt) desired = st.close; // ruikt bloed
    if (hurt && st.retreatHurt) desired = 1.5;
    if (tired) desired = Math.max(desired, 1.3);
    if (this.retreatTimer > 0) desired = 1.6;
    this.desired += (desired - this.desired) * Math.min(1, dt * 4);
    const radial = Math.max(-1, Math.min(1, (dist - this.desired) * 2.4));
    let mx = dx * radial;
    let mz = dz * radial;
    // Cirkelen (loodrecht op de lijn naar de tegenstander).
    const s = this.strafe * (tired ? 0.65 : 0.25 + st.strafe * 0.5) * this.cfg.aggression;
    mx += -dz * s;
    mz += dx * s;
    // Weg van de touwen.
    const edge = RING_HALF - 0.9;
    if (Math.abs(p.x) > edge) mx -= Math.sign(p.x) * 0.8;
    if (Math.abs(p.z) > edge) mz -= Math.sign(p.z) * 0.8;
    intent.move = { x: mx, z: mz };

    // Tussen de aanvallen door af en toe de dekking omhoog (vaker als hij moe of geraakt is).
    if (this.shellTimer <= 0) {
      this.shellTimer = this.rand(0.5, 1.1);
      const want = st.block * (hurt || tired ? 1.3 : 0.6) * (0.6 + this.cfg.react);
      this.shell = dist < 1.15 && this.random() < want;
    }
    intent.block = this.blockTimer > 0 || (this.shell && this.cooldown > 0.3 && !this.combo.length);
    intent.duck = this.duckTimer > 0;

    // Hoofdbeweging op de gok: wegdraaien van de hand die de tegenstander het meest gebruikt.
    if (this.headTimer <= 0) {
      this.headTimer = this.rand(0.5, 1.2);
      if (dist < 1.25 && !me.punch && !intent.slip && this.random() < st.slip * 0.5) {
        const m = this.memory;
        const lead = m.jab + m.leftHook;
        const rear = m.cross + m.rightHook + m.uppercut;
        intent.slip = lead === rear ? (this.random() < 0.5 ? 1 : -1) : lead > rear ? 1 : -1;
      }
    }

    const ready = !me.punch && !intent.block && !intent.duck && !intent.slip;
    // Counteren: na een ontwijking, of als de tegenstander mist en open staat.
    const opening = (this.counterTimer > 0 && opp.punch?.phase === 'recover') || opp.exposed > 0;
    if (ready && dist < 1.15 && opening && (this.counterFor !== opp || this.counterChecked !== opp.stats.thrown)) {
      // Eén beslissing per opening.
      this.counterFor = opp;
      this.counterChecked = opp.stats.thrown;
      if (this.random() < st.counter * (0.35 + this.cfg.react)) {
        intent.punch = this.random() < 0.5 ? 'cross' : 'leftHook';
        this.counterTimer = 0;
        this.cooldown = this.rand(this.cfg.cooldown[0], this.cfg.cooldown[1]) / st.pace;
        return intent;
      }
    }

    // Aanvallen.
    if (this.combo.length) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && !intent.block) {
        const next = this.combo.shift();
        intent.punch = next.name;
        intent.body = next.body;
        this.comboTimer = this.rand(0.16, 0.28);
      }
    } else if (this.cooldown <= 0 && dist < 1.12 && ready) {
      const w = { ...st.weights };
      if (opp.blocking) w.uppercut += 30;
      if (opp.ducking) w.uppercut += 40;
      if (dist > 0.95) {
        w.jab += 25;
        w.cross += 10;
      }
      const first = this.pick(w);
      if (me.stamina >= PUNCHES[first].stamina) {
        const bodyChance = st.body + (opp.blocking ? 0.25 : 0) + (opp.bodyDamage > 0.4 ? 0.15 : 0);
        intent.punch = first;
        intent.body = first !== 'uppercut' && this.random() < bodyChance;
        const comboChance = (this.cfg.combo + st.combo) / 2;
        if (this.random() < comboChance && me.stamina > cap * 0.35) {
          const next = COMBOS[first][Math.floor(this.random() * COMBOS[first].length)];
          this.combo = [{ name: next, body: this.random() < bodyChance * 0.6 }];
          if (this.random() < comboChance * 0.6) this.combo.push({ name: COMBOS[next][0], body: false });
          this.comboTimer = this.rand(0.2, 0.3);
        }
        // Vermoeidheid remt het tempo.
        const slow = 1 + (1 - me.cardio) * 0.8 + (tired ? 0.5 : 0);
        this.cooldown = (this.rand(this.cfg.cooldown[0], this.cfg.cooldown[1]) * slow) / st.pace;
      } else {
        this.cooldown = 0.4;
      }
    }
    return intent;
  }
}
