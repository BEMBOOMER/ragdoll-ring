// De wedstrijd: physics-wereld, twee boksers, treffers en het rondeverloop.
// Bevat geen rendering of geluid, zodat het ook headless (Node) draait.
import * as THREE from 'three';
import { Fighter, GROUP } from './fighter.js';
import { PHYSICS_DT, RING_HALF, FIGHT_START_GAP, PUNCHES, ZONES, MATCH } from './constants.js';

const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const IDLE_INTENT = Object.freeze({ move: { x: 0, z: 0 }, block: false, duck: false, punch: null });

export class Game {
  constructor(R, opts = {}) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.world.numSolverIterations = 8;
    this.eventQueue = new R.EventQueue(true);
    this.names = opts.names || ['JIJ', 'CPU'];
    this.startGap = opts.startGap;
    this.controllers = [null, null];
    this.pending = [this.blankIntent(), this.blankIntent()];
    this.events = [];
    this.fighters = [];
    this.state = 'idle';
    this.mode = 'idle'; // 'idle' | 'demo' | 'match'
    this.paused = false;
    this.accumulator = 0;
    this.alpha = 0;
    this.time = 0;
    this.slowmo = 1;
    this.hitStop = 0;
    this.round = 1;
    this.roundsWon = [0, 0];
    this.roundClock = MATCH.roundTime;
    this.timer = 0;
    this.winner = null;
    this.matchWinner = null;
    this.roundDamage = [0, 0];
    this.matchStats = null;
    this.roundHistory = [];
    this.buildArena();
    this.spawnFighters();
  }

  blankIntent() {
    return { move: { x: 0, z: 0 }, block: false, duck: false, punch: null };
  }

  buildArena() {
    const R = this.R;
    const world = this.world;
    const all = 0xffff;
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    world.createCollider(R.ColliderDesc.cuboid(12, 0.1, 12).setFriction(0.9).setCollisionGroups(groups(GROUP.ground, all)), ground);
    const walls = world.createRigidBody(R.RigidBodyDesc.fixed());
    const h = RING_HALF + 0.12;
    const wallGroups = groups(GROUP.walls, all);
    const mk = (x, z, hx, hz) =>
      world.createCollider(
        R.ColliderDesc.cuboid(hx, 0.8, hz).setTranslation(x, 0.8, z).setRestitution(0.35).setFriction(0.4).setCollisionGroups(wallGroups),
        walls
      );
    mk(h, 0, 0.1, h);
    mk(-h, 0, 0.1, h);
    mk(0, h, h, 0.1);
    mk(0, -h, h, 0.1);
  }

  spawnFighters() {
    for (const f of this.fighters) f.destroy();
    const half = (this.startGap ?? FIGHT_START_GAP) / 2;
    this.fighters = [
      new Fighter(this, { side: 0, name: this.names[0], x: -half, z: 0, yaw: Math.PI / 2 }),
      new Fighter(this, { side: 1, name: this.names[1], x: half, z: 0, yaw: -Math.PI / 2 }),
    ];
    this.snapshot();
    this.snapshot();
    this.events.push({ type: 'spawn' });
  }

  colliderInfo(handle) {
    for (const f of this.fighters) {
      const info = f.colliderParts.get(handle);
      if (info) return info;
    }
    return null;
  }

  // ---------- wedstrijdverloop ----------
  startDemo() {
    this.mode = 'demo';
    this.paused = false;
    this.slowmo = 1;
    this.spawnFighters();
    this.state = 'fight';
    this.timer = 0;
  }

  startMatch() {
    this.mode = 'match';
    this.paused = false;
    this.round = 1;
    this.roundsWon = [0, 0];
    this.matchWinner = null;
    this.roundHistory = [];
    this.matchStats = [
      { thrown: 0, landed: 0, damage: 0, blocked: 0, knockdowns: 0 },
      { thrown: 0, landed: 0, damage: 0, blocked: 0, knockdowns: 0 },
    ];
    this.startRound();
  }

  startRound() {
    this.slowmo = 1;
    this.hitStop = 0;
    this.spawnFighters();
    this.state = 'intro';
    this.timer = MATCH.introTime;
    this.roundClock = MATCH.roundTime;
    this.winner = null;
    this.roundDamage = [0, 0];
    this.countdownShown = 4;
    this.events.push({ type: 'roundStart', round: this.round });
  }

  endRound(winner, reason) {
    if (this.state === 'roundEnd' || this.state === 'matchEnd') return;
    this.winner = winner;
    if (winner !== null) this.roundsWon[winner]++;
    this.roundHistory.push({ round: this.round, winner, reason });
    this.foldStats();
    const decided = winner !== null && this.roundsWon[winner] >= MATCH.roundsToWin;
    if (decided || this.round >= MATCH.maxRounds) {
      this.state = 'matchEnd';
      if (decided) this.matchWinner = winner;
      else if (this.roundsWon[0] !== this.roundsWon[1]) this.matchWinner = this.roundsWon[0] > this.roundsWon[1] ? 0 : 1;
      else this.matchWinner = this.matchStats[0].damage >= this.matchStats[1].damage ? 0 : 1;
      this.timer = 0;
      this.events.push({ type: 'matchEnd', winner: this.matchWinner, reason });
    } else {
      this.state = 'roundEnd';
      this.timer = MATCH.roundEndHold;
      this.events.push({ type: 'roundEnd', winner, reason, round: this.round });
    }
  }

  foldStats() {
    if (!this.matchStats) return;
    this.fighters.forEach((f, i) => {
      const s = this.matchStats[i];
      s.thrown += f.stats.thrown;
      s.landed += f.stats.landed;
      s.damage += f.stats.damage;
      s.blocked += f.stats.blocked;
      f.stats = { thrown: 0, landed: 0, damage: 0, blocked: 0 };
    });
  }

  updateFlow(dt) {
    if (this.mode === 'demo') {
      const down = this.fighters.findIndex((f) => f.ko);
      if (down >= 0) {
        this.timer += dt;
        if (this.timer > 3.2) {
          this.timer = 0;
          this.spawnFighters();
        }
      }
      return;
    }
    if (this.mode !== 'match') return;
    switch (this.state) {
      case 'intro': {
        this.timer -= dt;
        const n = Math.ceil(this.timer);
        if (n < this.countdownShown && n >= 1 && n <= 3) {
          this.countdownShown = n;
          this.events.push({ type: 'countdown', n });
        }
        if (this.timer <= 0) {
          this.state = 'fight';
          this.events.push({ type: 'fight', round: this.round });
        }
        break;
      }
      case 'fight': {
        this.roundClock = Math.max(0, this.roundClock - dt);
        const down = this.fighters.findIndex((f) => f.ko);
        if (down >= 0) {
          this.state = 'ko';
          this.timer = 0;
          this.winner = 1 - down;
          if (this.matchStats) this.matchStats[1 - down].knockdowns++;
          this.events.push({ type: 'ko', loser: down, winner: 1 - down });
        } else if (this.roundClock <= 0) {
          const [a, b] = this.fighters;
          let w = null;
          if (Math.abs(a.health - b.health) > 0.5) w = a.health > b.health ? 0 : 1;
          else if (this.roundDamage[0] !== this.roundDamage[1]) w = this.roundDamage[0] > this.roundDamage[1] ? 0 : 1;
          this.events.push({ type: 'timeUp', winner: w });
          this.endRound(w, 'time');
        }
        break;
      }
      case 'ko': {
        this.timer += dt / Math.max(this.slowmo, 0.05);
        this.slowmo = this.timer < MATCH.koSlowmo ? 0.3 : Math.min(1, this.slowmo + dt * 2);
        if (this.timer >= MATCH.koSlowmo + MATCH.koHold) {
          this.slowmo = 1;
          this.endRound(this.winner, 'ko');
        }
        break;
      }
      case 'roundEnd': {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.round++;
          this.startRound();
        }
        break;
      }
      default:
        break;
    }
  }

  inputsEnabled() {
    if (this.mode === 'demo') return true;
    return this.mode === 'match' && (this.state === 'fight' || this.state === 'matchEnd' || this.state === 'roundEnd' || this.state === 'ko');
  }

  // ---------- treffers ----------
  processContacts() {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.colliderInfo(h1);
      const b = this.colliderInfo(h2);
      if (!a || !b || a.fighter === b.fighter) return;
      if (a.kind === 'glove') this.tryHit(a, b);
      if (b.kind === 'glove') this.tryHit(b, a);
    });
  }

  // Nabijheidstest: telt een stoot die tot op een paar centimeter bij het doel komt,
  // ook als de botsing net niet in deze stap viel. Dekking die dichterbij zit, gaat voor.
  proximityHits() {
    for (const attacker of this.fighters) {
      const p = attacker.punch;
      if (!p || p.hit || p.phase !== 'active' || attacker.ko) continue;
      const defender = this.fighters.find((f) => f !== attacker);
      if (defender.ko) continue;
      const side = p.def.hand;
      const glove = attacker.gloveWorld(side);
      const vel = attacker.gloveVelocity(side);
      const reach = 0.085 + 0.06;
      let best = null;
      const consider = (part, kind, dist, center) => {
        if (dist > reach) return;
        const toward = center.clone().sub(glove);
        if (toward.lengthSq() > 1e-8 && vel.dot(toward.normalize()) < 0.4) return;
        if (!best || dist < best.dist) best = { part, kind, dist };
      };
      const head = defender.pos('head');
      consider('head', 'head', head.distanceTo(glove) - 0.12, head);
      for (const name of ['chest', 'pelvis']) {
        const part = defender.parts[name];
        const size = part.shapes[0].size;
        const c = defender.pos(name);
        const local = glove.clone().sub(c).applyQuaternion(defender.rot(name).invert());
        const q = new THREE.Vector3(clamp(local.x, -size[0], size[0]), clamp(local.y, -size[1], size[1]), clamp(local.z, -size[2], size[2]));
        consider(name, name, q.distanceTo(local), c);
      }
      if (defender.blocking) {
        for (const s of ['L', 'R']) {
          const g = defender.gloveWorld(s);
          consider('foreArm' + s, 'glove', g.distanceTo(glove) - 0.085 + 0.02, g);
        }
      }
      if (best) this.tryHit({ fighter: attacker, part: 'foreArm' + side, kind: 'glove' }, { fighter: defender, part: best.part, kind: best.kind });
    }
  }

  tryHit(gloveInfo, targetInfo) {
    const attacker = gloveInfo.fighter;
    const defender = targetInfo.fighter;
    const p = attacker.punch;
    const side = gloveInfo.part.endsWith('L') ? 'L' : 'R';
    if (!p || p.hit || p.def.hand !== side || attacker.ko || defender.ko) return;
    if (p.phase !== 'active' && !(p.phase === 'windup' && p.t > p.def.windup * 0.7)) return;
    if (targetInfo.kind === 'leg') return;
    if (this.mode === 'match' && this.state !== 'fight') return;

    const gloveVel = attacker.gloveVelocity(side);
    const targetVel = defender.vel(targetInfo.part);
    const relSpeed = gloveVel.clone().sub(targetVel).length();
    if (relSpeed < 0.6) return;

    let zone;
    if (targetInfo.kind === 'head') zone = 'head';
    else if (targetInfo.kind === 'chest') zone = 'chest';
    else if (targetInfo.kind === 'pelvis') zone = 'pelvis';
    else if (defender.blocking) zone = 'block';
    else return; // langs een arm geschampt: de stoot gaat door
    // Een hoge dekking vangt rechte stoten en hoeken op; de uppercut gaat er tussendoor.
    if (defender.blocking && (zone === 'head' || zone === 'chest') && p.name !== 'uppercut') zone = 'block';
    const blocked = zone === 'block';

    const def = PUNCHES[p.name];
    const speedFactor = clamp(relSpeed / def.refSpeed, 0.75, 1.25);
    let mult = ZONES[zone] * speedFactor * p.power * (attacker.powerScale || 1);
    let counter = false;
    if (!blocked && defender.punch && defender.punch.phase !== 'recover') {
      mult *= 1.25;
      counter = true;
    }
    if (!blocked && p.name === 'uppercut' && defender.ducking) mult *= 1.3;
    const raw = def.damage * speedFactor * p.power;
    const damage = Math.round(def.damage * mult * 10) / 10;
    p.hit = true;

    const dir = gloveVel.lengthSq() > 1e-6 ? gloveVel.clone().normalize() : defender.pos().sub(attacker.pos()).normalize();
    const impulse = def.impulse * Math.min(speedFactor, 1.2) * (blocked ? 0.35 : 1);
    defender.applyHitImpulse(targetInfo.part === 'foreArmL' || targetInfo.part === 'foreArmR' ? targetInfo.part : targetInfo.part, dir, impulse);
    if (!blocked && zone === 'head') defender.applyHitImpulse('chest', dir, impulse * 0.3);

    attacker.stats.damage += damage;
    if (blocked) defender.stats.blocked++;
    else attacker.stats.landed++;
    this.roundDamage[attacker.side] += damage;

    const wasAlive = !defender.ko;
    defender.receiveHit({ damage, raw, zone, blocked, stagger: def.stagger * speedFactor, dir });
    const ko = wasAlive && defender.ko;

    const pos = attacker.gloveWorld(side);
    this.events.push({
      type: 'hit',
      part: targetInfo.part,
      attacker: attacker.side,
      defender: defender.side,
      punch: p.name,
      zone,
      blocked,
      counter,
      damage,
      ko,
      pos,
      dir,
      speed: relSpeed,
    });
    if (ko) this.hitStop = 0.16;
    else if (!blocked) this.hitStop = Math.max(this.hitStop, clamp(damage / 160, 0.025, 0.09));
  }

  // ---------- simulatie ----------
  snapshot() {
    for (const f of this.fighters) {
      for (const part of Object.values(f.parts)) {
        const t = part.body.translation();
        const r = part.body.rotation();
        if (!part.curP) {
          part.curP = new THREE.Vector3(t.x, t.y, t.z);
          part.curQ = new THREE.Quaternion(r.x, r.y, r.z, r.w);
          part.prevP = part.curP.clone();
          part.prevQ = part.curQ.clone();
        } else {
          part.prevP.copy(part.curP);
          part.prevQ.copy(part.curQ);
          part.curP.set(t.x, t.y, t.z);
          part.curQ.set(r.x, r.y, r.z, r.w);
        }
      }
    }
  }

  setController(i, c) {
    this.controllers[i] = c;
  }

  pollControllers(dt) {
    for (let i = 0; i < 2; i++) {
      const c = this.controllers[i];
      const f = this.fighters[i];
      if (!c || !f) continue;
      const intent = c.poll(dt, this, f, this.fighters[1 - i]) || IDLE_INTENT;
      const p = this.pending[i];
      p.move = intent.move || { x: 0, z: 0 };
      p.block = !!intent.block;
      p.duck = !!intent.duck;
      if (intent.punch) p.punch = intent.punch;
    }
  }

  fixedStep(dt) {
    const enabled = this.inputsEnabled();
    const [a, b] = this.fighters;
    const ia = enabled ? this.pending[0] : IDLE_INTENT;
    const ib = enabled ? this.pending[1] : IDLE_INTENT;
    a.update(dt, ia, b);
    b.update(dt, ib, a);
    this.pending[0].punch = null;
    this.pending[1].punch = null;
    this.world.step(this.eventQueue);
    this.processContacts();
    this.proximityHits();
    this.snapshot();
    for (const f of this.fighters) {
      if (f.events.length) {
        this.events.push(...f.events);
        f.events.length = 0;
      }
    }
    this.updateFlow(dt);
    this.time += dt;
  }

  // Wordt elke frame aangeroepen met de echte frametijd.
  step(realDt) {
    realDt = Math.min(realDt, 0.1);
    this.pollControllers(realDt);
    if (this.paused) return;
    let scale = this.slowmo;
    if (this.hitStop > 0) {
      this.hitStop -= realDt;
      scale *= 0.07;
    }
    this.accumulator += realDt * scale;
    let n = 0;
    while (this.accumulator >= PHYSICS_DT && n < 12) {
      this.fixedStep(PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      n++;
    }
    if (n >= 12) this.accumulator = 0;
    this.alpha = this.accumulator / PHYSICS_DT;
  }

  // Voor tests: simuleer een aantal seconden met vaste stappen.
  advance(seconds) {
    const steps = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) {
      this.pollControllers(PHYSICS_DT);
      this.fixedStep(PHYSICS_DT);
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
