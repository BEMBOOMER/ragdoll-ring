// Het gevecht: physics-wereld, twee boksers, treffers, scheidsrechter en jury.
// Bevat geen rendering of geluid, zodat het ook headless (Node) draait.
import * as THREE from 'three';
import { Fighter, GROUP } from './fighter.js';
import {
  PHYSICS_DT, RING_HALF, FIGHT_START_GAP, PUNCHES, ZONES, MATCH, SPOTS, IMPACT, KO, KNOCKDOWN,
  COMBO, DEFENSE, HEALTH, CORNER, JUDGES, JUDGING, PLAYER_PROFILE, BODY,
} from './constants.js';
import { collide, severityOf, resistanceOf, knockoutRoll, headSpot, bodySpot, classifyKnockdown } from './impact.js';
import { ReplayRecorder } from './replay.js';

const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export const IDLE_INTENT = Object.freeze({ move: { x: 0, z: 0 }, block: false, duck: false, punch: null, body: false, slip: 0 });
const CPU_PROFILE = { id: 'cpu', name: 'CPU', short: 'CPU', style: null, attrs: {} };
const blankRound = () => ({ clean: 0, aggression: 0, generalship: 0, defense: 0 });
const blankStats = () => ({ thrown: 0, landed: 0, damage: 0, blocked: 0, knockdowns: 0 });

export class Game {
  constructor(R, opts = {}) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.world.numSolverIterations = 8;
    this.eventQueue = new R.EventQueue(true);
    this.rng = opts.rng || Math.random;
    this.rules = { rounds: MATCH.rounds, roundTime: MATCH.roundTime, sensitivity: 1, ...(opts.rules || {}) };
    this.profiles = opts.profiles || [PLAYER_PROFILE, CPU_PROFILE];
    this.names = opts.names || this.profiles.map((p) => p.short);
    this.startGap = opts.startGap;
    this.controllers = [null, null];
    this.pending = [this.blankIntent(), this.blankIntent()];
    this.events = [];
    this.fighters = [];
    this.replay = new ReplayRecorder();
    this.state = 'idle';
    this.mode = 'idle'; // 'idle' | 'demo' | 'match'
    this.paused = false;
    this.accumulator = 0;
    this.alpha = 0;
    this.time = 0;
    this.slowmo = 1;
    this.slowFor = 0;
    this.hitStop = 0;
    this.round = 1;
    this.roundClock = this.rules.roundTime;
    this.timer = 0;
    this.winner = null;
    this.matchWinner = null;
    this.method = null;
    this.count = null;
    this.carryOver = [null, null];
    this.roundStats = [blankRound(), blankRound()];
    this.matchStats = null;
    this.roundHistory = [];
    this.cards = JUDGES.map(() => []);
    this.lastKnockdown = null;
    this.buildArena();
    this.spawnFighters();
  }

  blankIntent() {
    return { move: { x: 0, z: 0 }, block: false, duck: false, punch: null, body: false, slip: 0 };
  }

  // Regels en boksers voor het volgende gevecht.
  configure({ rules, profiles } = {}) {
    if (rules) Object.assign(this.rules, rules);
    if (profiles) {
      this.profiles = profiles;
      this.names = profiles.map((p) => p.short);
    }
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

  spawnFighters(carry = [null, null]) {
    for (const f of this.fighters) f.destroy();
    const half = (this.startGap ?? FIGHT_START_GAP) / 2;
    this.fighters = [0, 1].map(
      (i) =>
        new Fighter(this, {
          side: i,
          name: this.names[i],
          profile: this.profiles[i],
          carry: carry[i],
          x: i ? half : -half,
          z: 0,
          yaw: i ? -Math.PI / 2 : Math.PI / 2,
        })
    );
    this.snapshot();
    this.snapshot();
    this.replay.reset(this.fighters);
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
    this.slowFor = 0;
    this.spawnFighters();
    this.state = 'fight';
    this.timer = 0;
  }

  startMatch() {
    this.mode = 'match';
    this.paused = false;
    this.round = 1;
    this.matchWinner = null;
    this.method = null;
    this.decision = null;
    this.koKind = null;
    this.roundHistory = [];
    this.cards = JUDGES.map(() => []);
    this.carryOver = [null, null];
    this.lastKnockdown = null;
    this.replayClip = null;
    this.matchStats = [blankStats(), blankStats()];
    this.events.push({ type: 'matchStart' });
    this.startRound();
  }

  startRound() {
    this.slowmo = 1;
    this.slowFor = 0;
    this.hitStop = 0;
    this.spawnFighters(this.carryOver);
    this.state = 'intro';
    this.timer = MATCH.introTime;
    this.roundClock = this.rules.roundTime;
    this.winner = null;
    this.count = null;
    this.roundStats = [blankRound(), blankRound()];
    this.countdownShown = 4;
    this.events.push({ type: 'roundStart', round: this.round, rounds: this.rules.rounds });
  }

  // Hoekwerk tussen de rondes: een deel van de conditie komt terug, niet alles.
  cornerCarry(f) {
    const c = f.carry();
    c.health = Math.min(c.maxHealth, c.health + HEALTH * CORNER.health);
    c.headDamage *= 1 - CORNER.head;
    c.bodyDamage *= 1 - CORNER.body;
    c.cardio = Math.min(1, c.cardio + CORNER.cardio);
    c.armFatigue = { L: c.armFatigue.L * (1 - CORNER.arm), R: c.armFatigue.R * (1 - CORNER.arm) };
    c.sweat *= 0.6;
    return c;
  }

  // 10-point must: elk jurylid geeft de winnaar van de ronde 10 en de verliezer 9 of minder.
  // Een knockdown kost de gevloerde bokser een punt.
  scoreRound() {
    const st = this.roundStats;
    const kd = this.fighters.map((f) => f.roundKnockdowns);
    return JUDGES.map((j) => {
      const s = st.map(
        (x) =>
          j.clean * x.clean + j.aggression * x.aggression * 3 + j.generalship * x.generalship * 1.5 + j.defense * x.defense * 2.5 + (this.rng() * 2 - 1) * JUDGING.noise
      );
      const diff = s[0] - s[1];
      const w = diff > JUDGING.even ? 0 : diff < -JUDGING.even ? 1 : null;
      const net = kd[1] - kd[0];
      let card;
      if (net > 0) card = [10, 10 - net - (w === 1 ? 0 : 1)];
      else if (net < 0) card = [10 + net - (w === 0 ? 0 : 1), 10];
      else card = w === 0 ? [10, 9] : w === 1 ? [9, 10] : [10, 10];
      return card.map((v) => Math.max(7, v));
    });
  }

  totals() {
    return this.cards.map((c) => c.reduce((t, [a, b]) => [t[0] + a, t[1] + b], [0, 0]));
  }

  // Na de bel: de jury scoort de ronde.
  endRound() {
    if (this.state === 'roundEnd' || this.state === 'matchEnd') return;
    const cards = this.scoreRound();
    cards.forEach((c, j) => this.cards[j].push(c));
    this.roundHistory.push({ round: this.round, cards, knockdowns: this.fighters.map((f) => f.roundKnockdowns) });
    this.foldStats();
    if (this.round >= this.rules.rounds) {
      this.decide();
      return;
    }
    this.carryOver = this.fighters.map((f) => this.cornerCarry(f));
    this.state = 'roundEnd';
    this.timer = MATCH.roundEndHold;
    this.events.push({ type: 'roundEnd', round: this.round, cards });
  }

  // Jurybeslissing na de laatste ronde.
  decide() {
    const totals = this.totals();
    const votes = totals.map(([a, b]) => (a > b ? 0 : b > a ? 1 : null));
    const n = [votes.filter((v) => v === 0).length, votes.filter((v) => v === 1).length];
    const draws = votes.filter((v) => v === null).length;
    let winner = null;
    let decision = 'draw';
    const lead = n[0] > n[1] ? 0 : n[1] > n[0] ? 1 : null;
    if (lead !== null && n[lead] === 3) decision = 'unanimous';
    else if (lead !== null && n[lead] === 2 && n[1 - lead] === 1) decision = 'split';
    else if (lead !== null && n[lead] === 2 && draws === 1) decision = 'majority';
    if (decision !== 'draw') winner = lead;
    this.events.push({ type: 'timeUp', winner, final: true });
    this.finish(winner, 'decision', { decision });
  }

  finish(winner, method, extra = {}) {
    this.state = 'matchEnd';
    this.matchWinner = winner;
    this.method = method;
    this.decision = extra.decision || null;
    this.timer = 0;
    this.endAt = { round: this.round, clock: this.rules.roundTime - this.roundClock };
    this.events.push({ type: 'matchEnd', winner, method, decision: this.decision, kind: this.koKind, totals: this.totals(), replay: this.replayClip });
  }

  // De scheidsrechter beëindigt het gevecht (KO of TKO).
  stopFight(loser, method, kind) {
    if (this.state === 'ko' || this.state === 'matchEnd') return;
    this.foldStats();
    this.state = 'ko';
    this.timer = 0;
    this.loser = loser;
    this.winner = 1 - loser;
    this.method = method;
    this.koKind = kind;
    this.count = null;
    if (method === 'ko') this.fighters[loser].setOut();
    const kd = this.lastKnockdown;
    const at = kd && kd.defender === loser ? kd.time : this.time;
    this.replayClip = this.replay.clip(at - 1.8, at + 2.6);
    if (this.replayClip) {
      this.replayClip.at = at;
      this.replayClip.impact = kd && kd.defender === loser ? kd.hit : null;
    }
    this.events.push({ type: 'ko', loser, winner: 1 - loser, method, kind });
  }

  beginCount(i) {
    const f = this.fighters[i];
    if (this.matchStats) this.matchStats[1 - i].knockdowns++;
    this.events.push({ type: 'down', fighter: i, kind: this.lastKnockdown?.kind, count: f.roundKnockdowns });
    if (this.lastKnockdown?.waveOff && f.ko) {
      this.stopFight(i, 'ko', this.lastKnockdown.kind);
      return;
    }
    if (f.roundKnockdowns >= KNOCKDOWN.tko) {
      this.stopFight(i, 'tko', 'tko');
      return;
    }
    this.state = 'count';
    this.count = { who: i, t: 0, n: 0 };
  }

  updateFlow(dt) {
    if (this.mode === 'demo') {
      // Menu-achtergrond: wie neergaat mag opstaan; blijft het te lang liggen, dan opnieuw.
      if (this.fighters.some((f) => f.grounded)) {
        this.timer += dt;
        if (this.timer > 3.2) {
          this.timer = 0;
          this.spawnFighters();
        }
      } else this.timer = 0;
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
        this.trackRound(dt);
        const down = this.fighters.findIndex((f) => f.grounded);
        if (down >= 0) {
          this.beginCount(down);
          break;
        }
        // Staande TKO: wie niets meer terugdoet en wankelend klappen blijft vangen.
        const S = KNOCKDOWN.stoppage;
        for (const f of this.fighters) {
          f.recentHits = f.recentHits.filter((t) => f.clock - t < S.window);
          if (f.headDamage > S.impair && f.daze > S.daze && f.recentHits.length >= S.hits) {
            this.stopFight(f.side, 'tko', 'stoppage');
            break;
          }
        }
        if (this.state === 'fight' && this.roundClock <= 0) {
          if (this.round < this.rules.rounds) this.events.push({ type: 'timeUp', winner: null });
          this.endRound();
        }
        break;
      }
      case 'count': {
        // Tienstelling. Wie op tijd staat, krijgt de verplichte telling tot acht.
        const c = this.count;
        const f = this.fighters[c.who];
        c.t += dt;
        const n = Math.min(10, Math.floor((c.t - KNOCKDOWN.countStart) / KNOCKDOWN.countStep) + 1);
        if (n > c.n && n >= 1) {
          c.n = n;
          this.events.push({ type: 'count', n, fighter: c.who });
          if (n >= 10 && f.state !== 'up') {
            this.stopFight(c.who, 'ko', this.lastKnockdown?.kind || 'flash');
            break;
          }
        }
        if (f.state === 'up' && c.n >= KNOCKDOWN.mandatory) {
          this.state = 'fight';
          this.count = null;
          this.events.push({ type: 'resume', fighter: c.who });
        }
        break;
      }
      case 'ko': {
        this.timer += dt / Math.max(this.slowmo, 0.05);
        if (this.timer >= MATCH.koHold) this.finish(this.winner, this.method);
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

  // Wat de jury ziet: wie zet druk, wie heeft het midden van de ring.
  trackRound(dt) {
    const [a, b] = this.fighters;
    const pa = a.pos();
    const pb = b.pos();
    [[a, pa, pb], [b, pb, pa]].forEach(([f, me, them], i) => {
      if (f.state !== 'up') return;
      const to = them.clone().sub(me).setY(0);
      const d = to.length();
      if (d > 1e-3 && f.vel().dot(to) / d > 0.3) this.roundStats[i].aggression += dt;
      if (Math.hypot(me.x, me.z) + 0.4 < Math.hypot(them.x, them.z)) this.roundStats[i].generalship += dt;
    });
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

  inputsEnabled() {
    if (this.mode !== 'match') return true; // demo en sandbox: altijd
    return (this.state === 'fight' || this.state === 'matchEnd' || this.state === 'roundEnd' || this.state === 'ko');
  }

  // Tijdens de telling loopt de staande bokser naar een neutrale hoek.
  cornerIntent(f, downed) {
    const c = RING_HALF - 0.75;
    const corners = [new THREE.Vector3(c, 0, -c), new THREE.Vector3(-c, 0, c)];
    const dp = downed.pos();
    const corner = corners[0].distanceTo(dp) > corners[1].distanceTo(dp) ? corners[0] : corners[1];
    const to = corner.sub(f.pos()).setY(0);
    const m = to.length() > 0.15 ? to.multiplyScalar(Math.min(1, to.length() * 1.5) / to.length()) : to.set(0, 0, 0);
    return { ...IDLE_INTENT, move: { x: m.x, z: m.z } };
  }

  intentFor(i) {
    const enabled = this.inputsEnabled();
    if (this.mode === 'match' && this.state === 'count') {
      // Op de grond telt alleen tikken (sneller opstaan).
      if (i === this.count.who) return { ...IDLE_INTENT, punch: this.pending[i].punch };
      return this.cornerIntent(this.fighters[i], this.fighters[this.count.who]);
    }
    if (this.mode === 'match' && this.state === 'ko' && i === this.loser) return IDLE_INTENT;
    return enabled ? this.pending[i] : IDLE_INTENT;
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
      if (!p || p.hit || p.phase !== 'active' || attacker.state !== 'up') continue;
      const defender = this.fighters.find((f) => f !== attacker);
      if (defender.state !== 'up') continue;
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

  // Waar raakt de vuist: zone, trefplek, normaal en contactpunt.
  contactOf(defender, targetInfo, glove) {
    if (targetInfo.kind === 'head') {
      const center = defender.pos('head');
      const normal = glove.clone().sub(center).normalize();
      const local = normal.clone().applyQuaternion(defender.rot('head').invert());
      return { zone: 'head', spot: headSpot(local), normal, center, contact: center.clone().addScaledVector(normal, BODY.head.radius) };
    }
    if (targetInfo.kind === 'chest' || targetInfo.kind === 'pelvis') {
      const part = targetInfo.kind;
      const center = defender.pos(part);
      const q = defender.rot(part);
      const size = defender.parts[part].shapes[0].size;
      const local = glove.clone().sub(center).applyQuaternion(q.clone().invert());
      const onBox = new THREE.Vector3(clamp(local.x, -size[0], size[0]), clamp(local.y, -size[1], size[1]), clamp(local.z, -size[2], size[2]));
      const normal = glove.clone().sub(center).normalize();
      return { zone: part, spot: bodySpot(part, local), normal, center, contact: onBox.applyQuaternion(q).add(center) };
    }
    const center = defender.pos(targetInfo.part);
    return { zone: 'block', spot: 'guard', normal: glove.clone().sub(center).normalize(), center, contact: glove.clone() };
  }

  // Zet de verdediger zich schrap? Wie de stoot ziet aankomen, spant de nek aan.
  braceOf(defender, attacker, head) {
    const toAtt = attacker.pos('chest').sub(defender.pos('chest')).setY(0).normalize();
    const look = new THREE.Vector3(0, 0, 1).applyQuaternion(defender.rot('chest')).setY(0).normalize();
    const facing = clamp((look.dot(toAtt) - 0.3) / 0.6, 0, 1);
    const busy = defender.punch && defender.punch.phase !== 'recover' ? 0.6 : 0;
    const aware = 1 - busy - 0.5 * defender.daze - (defender.exposed > 0 ? 0.35 : 0) - (defender.slip ? 0.2 : 0);
    return clamp(facing * aware, 0, 1) * (head ? defender.attrs.neck : defender.attrs.core);
  }

  // Herstelvermogen na een knockdown: seconden tot de poging om op te staan.
  getUpTime(f, x) {
    const r =
      1 -
      0.45 * clamp(f.headDamage, 0, 1) -
      0.15 * (1 - f.health / HEALTH) -
      0.15 * f.knockdowns +
      0.12 * (f.stamina / f.staminaCap()) +
      0.15 * (f.attrs.chin - 1) -
      0.3 * clamp(x - 1, 0, 1);
    if (r < 0.15) return Infinity;
    return 2.2 + (1 - r) * 7 + this.rng() * 1.2;
  }

  tryHit(gloveInfo, targetInfo) {
    const attacker = gloveInfo.fighter;
    const defender = targetInfo.fighter;
    const p = attacker.punch;
    const side = gloveInfo.part.endsWith('L') ? 'L' : 'R';
    if (!p || p.hit || p.def.hand !== side || attacker.state !== 'up' || defender.state !== 'up') return;
    if (p.phase !== 'active' && !(p.phase === 'windup' && p.t > p.windup * 0.7)) return;
    if (targetInfo.kind === 'leg') return;
    if (targetInfo.kind !== 'head' && targetInfo.kind !== 'chest' && targetInfo.kind !== 'pelvis' && !defender.blocking) return; // langs een arm geschampt
    if (this.mode === 'match' && this.state !== 'fight') return;

    const gloveVel = attacker.gloveVelocity(side);
    const targetVel = defender.vel(targetInfo.part);
    const vRel = gloveVel.clone().sub(targetVel);
    const relSpeed = vRel.length();
    if (relSpeed < 0.6) return;

    const glovePos = attacker.gloveWorld(side);
    const c = this.contactOf(defender, targetInfo, glovePos);
    // Een hoge dekking vangt rechte stoten en hoeken op hoofd en borst; de uppercut gaat
    // ertussendoor en lijfstoten eronderdoor.
    if (defender.blocking && p.name !== 'uppercut' && (c.zone === 'head' || c.spot === 'chest')) {
      c.zone = 'block';
      c.spot = 'guard';
    }
    const zone = c.zone;
    const blocked = zone === 'block';
    const parried = blocked && (p.name === 'jab' || p.name === 'cross') && defender.blockTime < DEFENSE.parryWindow;
    const counter = !blocked && !!defender.punch && defender.punch.phase !== 'recover';
    const head = zone === 'head';

    // Effectieve slagmassa: lichaam achter de stoot, balans, en een romp die al meedraait.
    const def = PUNCHES[p.name];
    const spin = attacker.parts.chest.body.angvel().y * Math.sign(def.twist);
    const momentum = 1 + COMBO.momentum * clamp((spin - def.spin) / 2.5, 0, 1);
    const mass = def.mass * attacker.attrs.power * p.power * (0.6 + 0.4 * attacker.balance) * momentum * (attacker.powerScale || 1);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(defender.rot('head'));
    const brace = this.braceOf(defender, attacker, head);
    const impact = collide({ zone: head ? 'head' : 'body', vRel, normal: c.normal, contact: c.contact, center: c.center, up, mass, brace });
    const severity = blocked ? 0 : severityOf(head ? 'head' : 'body', c.spot, impact);

    // Schade op de energiebalk: snelheid, trefplek, schampen en massa achter de stoot.
    const speedFactor = clamp(relSpeed / def.refSpeed, 0.75, 1.25);
    const glance = impact.clean < IMPACT.glance ? 0.6 + (0.4 * impact.clean) / IMPACT.glance : 1;
    const massFactor = mass / def.mass;
    let mult = ZONES[zone] * speedFactor * (SPOTS[c.spot]?.dmg ?? 1) * glance * massFactor;
    if (blocked && !parried && p.name !== 'jab') {
      // Moeie armen houden een harde stoot niet meer tegen.
      const af = (defender.armFatigue.L + defender.armFatigue.R) / 2;
      if (af > DEFENSE.guardLeak) mult += 0.35 * ((af - DEFENSE.guardLeak) / (1 - DEFENSE.guardLeak));
    }
    if (parried) mult = 0;
    const raw = def.damage * speedFactor * p.power;
    const damage = Math.round(def.damage * mult * 10) / 10;
    p.hit = true;

    const dir = gloveVel.lengthSq() > 1e-6 ? gloveVel.clone().normalize() : defender.pos().sub(attacker.pos()).normalize();
    // De berekende impuls duwt echt tegen het lichaam; een hoek draait het hoofd weg.
    const applied = impact.J.clone().multiplyScalar(IMPACT.applyScale * (blocked ? 0.35 : 1));
    if (head) {
      defender.parts.head.body.applyImpulseAtPoint(applied, c.center.clone().lerp(c.contact, IMPACT.spin), true);
      defender.applyHitImpulse('chest', applied.clone().normalize(), applied.length() * 0.3);
    } else defender.parts[targetInfo.part].body.applyImpulseAtPoint(applied, c.contact, true);

    if (parried) {
      // Pareren: de stoot wordt weggetikt en de aanvaller verliest zijn balans.
      const side3 = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(side === 'L' ? -3 : 3);
      attacker.parts['foreArm' + side].body.applyImpulse(side3, true);
      attacker.balance = Math.max(0.3, attacker.balance - DEFENSE.parryBalance);
      p.recover *= 1.4;
      attacker.exposed = DEFENSE.exposed;
    }

    let outcome = null;
    if (!blocked) {
      outcome = knockoutRoll({
        zone: head ? 'head' : 'body',
        spot: c.spot,
        severity,
        resistance: resistanceOf(defender, head ? 'head' : 'body'),
        sensitivity: this.rules.sensitivity,
        rng: this.rng,
      });
    }

    attacker.stats.damage += damage;
    if (blocked) defender.stats.blocked++;
    else attacker.stats.landed++;
    if (this.mode === 'match') {
      if (!blocked) this.roundStats[attacker.side].clean += damage * (head ? 1 : 0.9);
      else this.roundStats[defender.side].defense += parried ? 1.5 : 1;
    }

    defender.receiveHit({ damage, raw, zone, spot: c.spot, blocked, parried, stagger: def.stagger * speedFactor, dir, severity, outcome });

    // Knockdown: uit de botsing zelf, of omdat er geen energie meer over is.
    let kd = null;
    if (outcome && (outcome.result === 'out' || outcome.result === 'waveOff' || outcome.result === 'down')) kd = outcome.result;
    else if (!blocked && defender.health <= 0) kd = 'down';
    let kind = null;
    if (kd) {
      kind = classifyKnockdown({ zone, counter, defender, single: defender.headDamage < 0.35 });
      const out = kd !== 'down';
      defender.knockDown({ kind, out, dir, getUp: out ? Infinity : this.getUpTime(defender, outcome?.x ?? 1) });
    } else if (outcome?.result === 'bodyDown') {
      kind = 'body';
      defender.pendingDown = { t: KO.bodyDelay, opts: { kind, dir, getUp: this.getUpTime(defender, outcome.x) } };
    }

    const hit = {
      type: 'hit',
      part: targetInfo.part,
      attacker: attacker.side,
      defender: defender.side,
      punch: p.name,
      zone,
      spot: c.spot,
      blocked,
      parried,
      counter,
      body: !!p.body,
      timing: p.timing,
      damage,
      severity,
      ratio: outcome?.x ?? 0,
      impulse: impact.impulse,
      headSpeed: head ? impact.dvLin : 0,
      spin: head ? impact.dOmega : 0,
      outcome: outcome?.result ?? null,
      knockdown: kind,
      ko: kd === 'out' || kd === 'waveOff',
      pos: glovePos,
      dir,
      speed: relSpeed,
    };
    this.events.push(hit);
    if (kind) {
      this.lastKnockdown = { time: this.time, hit, kind, waveOff: kd === 'waveOff', defender: defender.side };
      this.hitStop = 0.16;
      this.slowFor = 1.0;
    } else if (!blocked) this.hitStop = Math.max(this.hitStop, clamp(damage / 160, 0.025, 0.09));
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
      if (intent.punch) {
        p.punch = intent.punch;
        p.body = !!intent.body;
      }
      if (intent.slip) p.slip = intent.slip;
    }
  }

  fixedStep(dt) {
    const [a, b] = this.fighters;
    const ia = this.intentFor(0);
    const ib = this.intentFor(1);
    a.update(dt, ia, b);
    b.update(dt, ib, a);
    for (const p of this.pending) {
      p.punch = null;
      p.body = false;
      p.slip = 0;
    }
    this.world.step(this.eventQueue);
    this.processContacts();
    this.proximityHits();
    this.snapshot();
    if (this.state !== 'ko' && this.state !== 'matchEnd') this.replay.capture(this.time, this.fighters);
    for (const f of this.fighters) {
      if (!f.events.length) continue;
      for (const e of f.events) {
        // Een misser van de een is verdediging van de ander.
        if (e.type === 'miss' && this.mode === 'match' && this.state === 'fight') this.roundStats[1 - e.fighter.side].defense += 1;
      }
      this.events.push(...f.events);
      f.events.length = 0;
    }
    this.updateFlow(dt);
    this.time += dt;
  }

  // Wordt elke frame aangeroepen met de echte frametijd.
  step(realDt) {
    realDt = Math.min(realDt, 0.1);
    this.pollControllers(realDt);
    if (this.paused) return;
    // Slowmotion rond een knockdown.
    if (this.slowFor > 0) {
      this.slowFor -= realDt;
      this.slowmo = 0.3;
    } else this.slowmo = Math.min(1, this.slowmo + realDt * 2);
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
