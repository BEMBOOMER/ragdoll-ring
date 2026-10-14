// Actieve ragdoll-bokser: rigid bodies verbonden met gewrichten, aangedreven door
// spieren (PD-koppels) en een balanssysteem dat het bekken overeind houdt.
// Bij een knockdown vallen balans en spierspanning weg en neemt de physics het over;
// opstaan gebeurt weer met diezelfde spieren.
import * as THREE from 'three';
import {
  BODY, MUSCLE, MOVE, PUNCHES, STAMINA, HEALTH, GRAVITY, RING_HALF,
  FATIGUE, COMBO, DEFENSE, KNOCKDOWN, DEFAULT_ATTRS, PLAYER_PROFILE, RECOVERY,
} from './constants.js';

export const GROUP = { ground: 0x0001, walls: 0x0002, A: 0x0004, B: 0x0008 };
const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);

const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const HEAVY = ['cross', 'leftHook', 'rightHook', 'uppercut'];

// Gewrichtslengtes (gewricht tot gewricht).
const LU = 0.32; // schouder → elleboog
const LF = 0.29; // elleboog → pols
const GLOVE_OFFSET = LF / 2 + 0.05; // vanaf het midden van de onderarm
const LF_REACH = LF / 2 + GLOVE_OFFSET; // elleboog → midden handschoen
const LT = 0.42; // heup → knie
const LS = 0.44; // knie → enkel
const ANKLE_H = 0.085;

// Vuistposities in de lokale ruimte van de borst (+Z vooruit, +X links).
const GUARD = { L: new THREE.Vector3(0.23, 0.02, 0.27), R: new THREE.Vector3(-0.22, 0.0, 0.21) };
const BLOCK = { L: new THREE.Vector3(0.075, 0.36, 0.27), R: new THREE.Vector3(-0.075, 0.36, 0.27) };
const PUSH = { L: new THREE.Vector3(0.24, -0.42, 0.3), R: new THREE.Vector3(-0.24, -0.42, 0.3) }; // handen op het canvas
const POLE_GUARD = { L: new THREE.Vector3(0.35, -1, -0.1), R: new THREE.Vector3(-0.35, -1, -0.1) };

const tmpV = () => new THREE.Vector3();
const v3 = (o) => new THREE.Vector3(o.x, o.y, o.z);
const q4 = (o) => new THREE.Quaternion(o.x, o.y, o.z, o.w);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const easeOut = (u) => 1 - Math.pow(1 - clamp(u, 0, 1), 3);
const easeInOut = (u) => {
  u = clamp(u, 0, 1);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};

// Tweebeens-IK. Geeft de wereldrotatie van het bovenste segment (lokaal -Y langs het bot,
// lokaal X = scharnieras) en de buighoek voor het scharnier.
export function solveTwoBone(root, target, a, b, pole) {
  const toT = target.clone().sub(root);
  let L = toT.length();
  const u = L > 1e-6 ? toT.divideScalar(L) : new THREE.Vector3(0, 0, 1);
  L = clamp(L, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const v = pole.clone().addScaledVector(u, -pole.dot(u));
  if (v.lengthSq() < 1e-8) v.set(0, -1, 0).addScaledVector(u, u.y);
  if (v.lengthSq() < 1e-8) v.set(1, 0, 0);
  v.normalize();
  const cosA = clamp((a * a + L * L - b * b) / (2 * a * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const d = u.clone().multiplyScalar(cosA).addScaledVector(v, sinA).normalize();
  const X = new THREE.Vector3().crossVectors(v, u).normalize();
  const Y = d.clone().negate();
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  X.crossVectors(Y, Z).normalize();
  const m = new THREE.Matrix4().makeBasis(X, Y, Z);
  const quat = new THREE.Quaternion().setFromRotationMatrix(m);
  const cosB = clamp((a * a + b * b - L * L) / (2 * a * b), -1, 1);
  const bend = Math.PI - Math.acos(cosB);
  const mid = root.clone().addScaledVector(d, a);
  return { quat, bend, mid };
}

function quatError(qDesired, qCurrent) {
  const e = qDesired.clone().multiply(qCurrent.clone().invert());
  if (e.w < 0) {
    e.x = -e.x;
    e.y = -e.y;
    e.z = -e.z;
    e.w = -e.w;
  }
  const s = Math.sqrt(Math.max(1 - e.w * e.w, 0));
  const angle = 2 * Math.acos(clamp(e.w, -1, 1));
  if (s < 1e-6) return new THREE.Vector3(2 * e.x, 2 * e.y, 2 * e.z);
  return new THREE.Vector3(e.x / s, e.y / s, e.z / s).multiplyScalar(angle);
}

function bodyInertia(body) {
  const p = body.principalInertia();
  return (p.x + p.y + p.z) / 3;
}

export class Fighter {
  constructor(game, opts) {
    this.game = game;
    this.R = game.R;
    this.world = game.world;
    this.side = opts.side; // 0 = blauw (speler), 1 = rood
    this.name = opts.name;
    this.member = this.side === 0 ? GROUP.A : GROUP.B;
    this.enemyGroup = this.side === 0 ? GROUP.B : GROUP.A;
    this.profile = opts.profile || PLAYER_PROFILE;
    this.attrs = { ...DEFAULT_ATTRS, ...this.profile.attrs };
    // Conditie die over rondes heen meegaat (carry).
    const c = opts.carry || {};
    this.maxHealth = c.maxHealth ?? HEALTH; // zakt blijvend met elke treffer
    this.health = Math.min(c.health ?? HEALTH, this.maxHealth);
    this.displayHealth = this.health;
    this.sinceHit = 10;
    this.headDamage = c.headDamage ?? 0; // opgebouwde hoofdschade, 0..1
    this.bodyDamage = c.bodyDamage ?? 0; // opgebouwde lijfschade, 0..1
    this.cardio = c.cardio ?? 1; // uithouding op lange termijn, 0..1
    this.armFatigue = { L: c.armFatigue?.L ?? 0, R: c.armFatigue?.R ?? 0 };
    this.knockdowns = c.knockdowns ?? 0; // keer gevloerd in dit gevecht
    this.sweat = c.sweat ?? 0;
    this.roundKnockdowns = 0;
    this.stamina = this.staminaCap();
    this.staminaDelay = 0;
    this.balance = 1;
    this.daze = 0;
    // 'up' staat, 'down' ligt (kan opstaan), 'rising' staat op, 'out' is knock-out.
    this.state = 'up';
    this.downTime = 0;
    this.getUpAt = Infinity;
    this.riseT = 0;
    this.pendingDown = null;
    this.punch = null;
    this.queuedPunch = null;
    this.lastPunch = null; // { hand, ended } voor combo-timing
    this.clock = 0;
    this.blocking = false;
    this.blockTime = 0;
    this.ducking = false;
    this.slip = null;
    this.slipCool = 0;
    this.exposed = 0;
    this.wobble = new THREE.Vector3();
    this.recentHits = [];
    this.stats = { thrown: 0, landed: 0, damage: 0, blocked: 0 };
    this.parts = {};
    this.joints = [];
    this.hinges = {};
    this.colliderParts = new Map();
    this.aim = { L: new THREE.Vector3(0, 0.36, 0.8), R: new THREE.Vector3(0, 0.36, 0.8) };
    this.yaw = opts.yaw;
    this.lastPunchName = null;
    this.events = [];
    this.build(opts.x, opts.z, opts.yaw);
    const P = this.parts;
    const sub = { shoulderL: ['upperArmL', 'foreArmL'], shoulderR: ['upperArmR', 'foreArmR'], hipL: ['thighL', 'shinL'], hipR: ['thighR', 'shinR'], neck: ['head'] };
    // Benen raken de grond niet zolang de bokser staat (het bekken zweeft op de balans);
    // hun spieren duwen daarom niet terug op het bekken.
    const reaction = { hipL: 0, hipR: 0, shoulderL: 0.6, shoulderR: 0.6 };
    for (const j of this.joints) {
      j.subtree = (sub[j.name] || []).map((n) => P[n]);
      j.reaction = reaction[j.name] ?? 1;
    }
    this.totalMass = Object.values(this.parts).reduce((m, p) => m + p.body.mass(), 0);
    this.initFeet();
  }

  // ---------- opbouw ----------
  build(x, z, yaw) {
    const R = this.R;
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const origin = new THREE.Vector3(x, 0, z);
    const toWorld = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(qYaw).add(origin);
    const solid = groups(this.member, GROUP.ground | GROUP.walls | this.enemyGroup);
    this.legGroupsStanding = groups(this.member, 0);
    this.legGroupsLimp = groups(this.member, GROUP.ground | GROUP.walls);

    const makeBody = (name, pos, opts = {}) => {
      const desc = R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: qYaw.x, y: qYaw.y, z: qYaw.z, w: qYaw.w })
        .setLinearDamping(opts.linDamp ?? 0.05)
        .setAngularDamping(opts.angDamp ?? 1.2)
        .setCanSleep(false);
      if (opts.ccd) desc.setCcdEnabled(true);
      const body = this.world.createRigidBody(desc);
      const part = { name, body, colliders: [], shapes: [] };
      this.parts[name] = part;
      return part;
    };
    const addCollider = (part, desc, shape, kind, group = solid) => {
      desc.setCollisionGroups(group).setFriction(0.7).setRestitution(0.05);
      const col = this.world.createCollider(desc, part.body);
      part.colliders.push(col);
      part.shapes.push(shape);
      this.colliderParts.set(col.handle, { fighter: this, part: part.name, kind });
      return col;
    };

    const B = BODY;
    const pY = B.pelvis.height;
    const s = B.pelvis.size;
    const pelvis = makeBody('pelvis', toWorld(0, pY, 0), { angDamp: 2 });
    addCollider(pelvis, R.ColliderDesc.cuboid(s[0], s[1], s[2]).setMass(B.pelvis.mass), { type: 'box', size: s }, 'pelvis');

    const c = B.chest.size;
    const chestY = pY + B.chest.offset;
    const chest = makeBody('chest', toWorld(0, chestY, 0), { angDamp: 2 });
    addCollider(chest, R.ColliderDesc.cuboid(c[0], c[1], c[2]).setMass(B.chest.mass), { type: 'box', size: c }, 'chest');

    const headY = chestY + B.head.offset;
    const head = makeBody('head', toWorld(0, headY, 0), { angDamp: 2.5 });
    addCollider(head, R.ColliderDesc.ball(B.head.radius).setMass(B.head.mass), { type: 'head', radius: B.head.radius }, 'head');

    this.joint('waist', pelvis, chest, [0, 0.1, 0], [0, -0.22, 0], MUSCLE.waist);
    this.joint('neck', chest, head, [0, 0.23, 0], [0, -0.14, 0], MUSCLE.neck);

    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? B.shoulderX : -B.shoulderX;
      const shoulder = [sx, B.shoulderY, 0];
      const uaY = chestY + B.shoulderY - LU / 2;
      const upper = makeBody('upperArm' + side, toWorld(sx, uaY, 0));
      addCollider(
        upper,
        R.ColliderDesc.capsule(B.upperArm.half, B.upperArm.radius).setMass(B.upperArm.mass),
        { type: 'capsule', half: B.upperArm.half, radius: B.upperArm.radius },
        'arm'
      );
      const faY = uaY - LU / 2 - LF / 2;
      const fore = makeBody('foreArm' + side, toWorld(sx, faY, 0), { ccd: true });
      addCollider(
        fore,
        R.ColliderDesc.capsule(B.foreArm.half, B.foreArm.radius).setMass(B.foreArm.mass),
        { type: 'capsule', half: B.foreArm.half, radius: B.foreArm.radius },
        'arm'
      );
      const glove = addCollider(
        fore,
        R.ColliderDesc.ball(B.glove.radius)
          .setTranslation(0, -GLOVE_OFFSET, 0)
          .setMass(B.glove.mass)
          .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS),
        { type: 'glove', radius: B.glove.radius, offset: -GLOVE_OFFSET },
        'glove'
      );
      fore.glove = glove;
      this.joint('shoulder' + side, chest, upper, shoulder, [0, LU / 2, 0], MUSCLE.shoulder);
      this.hinge('elbow' + side, upper, fore, [0, -LU / 2, 0], [0, LF / 2, 0], [0, 2.55], MUSCLE.elbow);

      const hx = side === 'L' ? B.hipX : -B.hipX;
      const thY = pY + B.hipY - LT / 2;
      const thigh = makeBody('thigh' + side, toWorld(hx, thY, 0), { angDamp: 1.6 });
      addCollider(
        thigh,
        R.ColliderDesc.capsule(B.thigh.half, B.thigh.radius).setMass(B.thigh.mass),
        { type: 'capsule', half: B.thigh.half, radius: B.thigh.radius, trunks: true },
        'leg',
        this.legGroupsStanding
      );
      const shY = thY - LT / 2 - LS / 2;
      const shin = makeBody('shin' + side, toWorld(hx, shY, 0), { angDamp: 1.6 });
      addCollider(
        shin,
        R.ColliderDesc.capsule(B.shin.half, B.shin.radius).setMass(B.shin.mass),
        { type: 'capsule', half: B.shin.half, radius: B.shin.radius },
        'leg',
        this.legGroupsStanding
      );
      addCollider(
        shin,
        R.ColliderDesc.cuboid(0.05, 0.035, 0.11)
          .setTranslation(0, -LS / 2 - 0.03, 0.05)
          .setMass(0.6),
        { type: 'shoe', size: [0.05, 0.035, 0.11], offset: [0, -LS / 2 - 0.03, 0.05] },
        'leg',
        this.legGroupsStanding
      );
      this.joint('hip' + side, pelvis, thigh, [hx, B.hipY, 0], [0, LT / 2, 0], MUSCLE.hip);
      this.hinge('knee' + side, thigh, shin, [0, -LT / 2, 0], [0, LS / 2, 0], [0.02, 2.4], MUSCLE.knee);
    }
  }

  joint(name, parent, child, a1, a2, muscle) {
    const R = this.R;
    const data = R.JointData.spherical({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] });
    const joint = this.world.createImpulseJoint(data, parent.body, child.body, true);
    joint.setContactsEnabled(false);
    const j = { name, parent, child, joint, muscle, target: new THREE.Quaternion(), gain: 1, anchor: new THREE.Vector3(...a2), subtree: [child] };
    this.joints.push(j);
    return j;
  }

  hinge(name, parent, child, a1, a2, limits, muscle) {
    const R = this.R;
    const data = R.JointData.revolute({ x: a1[0], y: a1[1], z: a1[2] }, { x: a2[0], y: a2[1], z: a2[2] }, { x: 1, y: 0, z: 0 });
    data.limitsEnabled = true;
    data.limits = limits;
    const joint = this.world.createImpulseJoint(data, parent.body, child.body, true);
    joint.setContactsEnabled(false);
    joint.configureMotorPosition(limits[0] + 0.3, muscle.stiffness, muscle.damping);
    this.hinges[name] = { joint, muscle, limits, target: 0.3 };
  }

  initFeet() {
    this.feet = {};
    for (const side of ['L', 'R']) {
      const p = this.footHome(side, new THREE.Vector3());
      this.feet[side] = { pos: p.clone(), from: p.clone(), to: p.clone(), t: 0, stepping: false };
    }
  }

  // ---------- toestand ----------
  get ko() {
    return this.state === 'out';
  }
  get grounded() {
    return this.state !== 'up';
  }
  staminaCap() {
    return STAMINA.max * (STAMINA.minCap + (1 - STAMINA.minCap) * this.cardio);
  }
  // Wat er na de bel mee naar de volgende ronde gaat.
  carry() {
    return {
      health: this.health,
      maxHealth: this.maxHealth,
      headDamage: this.headDamage,
      bodyDamage: this.bodyDamage,
      cardio: this.cardio,
      armFatigue: { ...this.armFatigue },
      knockdowns: this.knockdowns,
      sweat: this.sweat,
    };
  }
  pos(name = 'pelvis') {
    return v3(this.parts[name].body.translation());
  }
  rot(name) {
    return q4(this.parts[name].body.rotation());
  }
  vel(name = 'pelvis') {
    return v3(this.parts[name].body.linvel());
  }
  headPos() {
    return this.pos('head');
  }
  gloveWorld(side) {
    const p = this.parts['foreArm' + side];
    return new THREE.Vector3(0, -GLOVE_OFFSET, 0).applyQuaternion(this.rot('foreArm' + side)).add(this.pos('foreArm' + side));
  }
  gloveVelocity(side) {
    const body = this.parts['foreArm' + side].body;
    const w = v3(body.angvel());
    const r = this.gloveWorld(side).sub(this.pos('foreArm' + side));
    return v3(body.linvel()).add(new THREE.Vector3().crossVectors(w, r));
  }
  isPunching() {
    return !!this.punch;
  }
  punchPhase() {
    return this.punch ? this.punch.phase : null;
  }

  // ---------- besturing ----------
  // queued = de stoot stond al klaar (te vroeg ingedrukt): nooit 'perfect'.
  startPunch(name, body = false, queued = false) {
    if (this.state !== 'up') return false;
    const def = PUNCHES[name];
    if (!def) return false;
    let timing = 'normal';
    if (this.punch) {
      // Combo: een volgende stoot mag pas in de herstelfase, met de andere hand of na de helft.
      const p = this.punch;
      const otherHand = PUNCHES[p.name].hand !== def.hand;
      const late = p.phase === 'recover' && (p.t > def.windup * 0.3 || otherHand);
      if (!late) {
        this.queuedPunch = { name, body };
        return false;
      }
      // Timing: de andere hand die midden in het terugtrekken vertrekt, sluit perfect aan;
      // dezelfde hand die te snel terugkomt, staat er slecht voor.
      const u = p.t / p.recover;
      if (otherHand && u >= COMBO.perfect[0] && u <= COMBO.perfect[1]) timing = 'perfect';
      else if (!otherHand && u < 0.5) timing = 'poor';
    } else if (!queued && this.lastPunch && this.lastPunch.hand !== def.hand && this.clock - this.lastPunch.ended < COMBO.late) {
      timing = 'perfect';
    }
    if (queued && timing === 'perfect') timing = 'normal';
    if (this.balance < 0.45) timing = 'poor';

    const af = this.armFatigue[def.hand];
    const costMul = timing === 'perfect' ? COMBO.perfectCost : timing === 'poor' ? COMBO.poorCost : 1;
    const cost = def.stamina * costMul * (1 + 0.35 * af);
    const tired = this.stamina < cost;
    this.stamina = Math.max(0, this.stamina - cost);
    this.staminaDelay = STAMINA.regenDelay;
    this.cardio = Math.max(0, this.cardio - (cost * FATIGUE.cardioPerStamina) / this.attrs.cardio);
    this.armFatigue[def.hand] = Math.min(1, af + (cost * FATIGUE.armPerStamina) / this.attrs.cardio);
    this.sweat = Math.min(1, this.sweat + cost * 0.0006);
    if (timing === 'poor') this.balance = Math.max(0.3, this.balance - COMBO.poorBalance);
    // Snelheid komt uit de spieren: vermoeide armen en slechte timing maken de stoot trager.
    const tgain = timing === 'perfect' ? COMBO.perfectGain : timing === 'poor' ? COMBO.poorGain : 1;
    this.punch = {
      name,
      def,
      body,
      timing,
      gain: tgain * this.attrs.speed * (1 - FATIGUE.armSlow * af),
      t: 0,
      phase: 'windup',
      hit: false,
      whoosh: false,
      power: tired ? STAMINA.tiredFactor : 1,
      windup: def.windup * (timing === 'perfect' ? COMBO.perfectWindup : 1),
      active: def.active,
      recover: def.recover,
    };
    this.aimAt(def.hand, body);
    this.queuedPunch = null;
    this.stats.thrown++;
    this.lastPunchName = name;
    this.events.push({ type: 'punchStart', name, fighter: this, timing, body });
    return true;
  }

  // Richt op het hoofd (of het lijf) van de tegenstander, vastgezet bij het begin van de stoot:
  // wie op tijd bukt, wegdraait of wegstapt, laat de stoot missen.
  aimAt(side, body = false) {
    const opp = this.game.fighters.find((f) => f !== this);
    if (!opp || !opp.parts.head) return;
    const inv = this.rot('chest').invert();
    if (body) {
      // Onderkant van de ribben; een hoek gaat naar de flank (linkse hoek → lever).
      const name = this.punch?.name;
      const shift = name === 'leftHook' ? 0.08 : name === 'rightHook' ? -0.08 : 0;
      const local = opp.pos('chest').addScaledVector(UP, -0.17).sub(this.pos('chest')).applyQuaternion(inv);
      local.x = clamp(local.x + shift, -0.3, 0.3);
      local.y = clamp(local.y, -0.55, 0.1);
      local.z = clamp(local.z, 0.3, 0.95);
      this.aim[side].copy(local);
      return;
    }
    const local = opp.headPos().sub(this.pos('chest')).applyQuaternion(inv);
    local.x = clamp(local.x, -0.3, 0.3);
    local.y = clamp(local.y, -0.05, 0.6);
    local.z = clamp(local.z, 0.3, 0.95);
    this.aim[side].copy(local);
  }

  // Ontwijken: hoofd en romp opzij (dir = 1 links, -1 rechts).
  startSlip(dir) {
    if (this.state !== 'up' || this.slip || this.slipCool > 0) return false;
    if (this.punch && this.punch.phase !== 'recover') return false;
    this.slip = { dir: Math.sign(dir), t: 0 };
    this.stamina = Math.max(0, this.stamina - DEFENSE.slipStamina);
    this.events.push({ type: 'slip', fighter: this, dir: Math.sign(dir) });
    return true;
  }

  receiveHit(hit) {
    if (this.state === 'out' || hit.parried) return;
    this.health = Math.max(0, this.health - hit.damage);
    this.maxHealth = Math.max(HEALTH * RECOVERY.minMax, this.maxHealth - hit.damage * RECOVERY.permanent);
    this.sinceHit = 0;
    if (hit.blocked) {
      // De dekking vangt de klap, maar armen en adem betalen ervoor.
      this.stamina = Math.max(0, this.stamina - hit.raw * STAMINA.blockDrain);
      this.staminaDelay = STAMINA.regenDelay;
      this.balance = Math.max(0.55, this.balance - hit.stagger * 0.3);
      const arm = hit.raw * FATIGUE.armBlock;
      this.armFatigue.L = Math.min(1, this.armFatigue.L + arm);
      this.armFatigue.R = Math.min(1, this.armFatigue.R + arm);
      return;
    }
    const head = hit.zone === 'head';
    this.balance = Math.max(0.2, this.balance - hit.stagger * (head ? 1.3 : 0.7) * (1 + this.daze * 0.6));
    if (head) {
      this.daze = Math.min(1, this.daze + hit.damage / 60 + hit.severity * 0.1);
      this.headDamage = Math.min(1.2, this.headDamage + hit.severity * 0.04 + (hit.damage / HEALTH) * 0.15);
      this.recentHits.push(this.clock);
    } else {
      // Lijfstoten: adem weg, uithouding omlaag.
      this.bodyDamage = Math.min(1, this.bodyDamage + hit.severity * 0.025 + (hit.damage / HEALTH) * 0.15);
      this.stamina = Math.max(0, this.stamina - hit.damage * 0.9);
      this.staminaDelay = STAMINA.regenDelay * 2;
      this.cardio = Math.max(0, this.cardio - (hit.damage * FATIGUE.cardioBody) / this.attrs.core);
    }
    const out = hit.outcome;
    if (out?.result === 'rocked') {
      // Wankelen: de spieren sturen tijdelijk minder goed bij, geen vaste animatie.
      this.daze = Math.max(this.daze, 0.35 + 0.6 * out.amount);
      this.balance = Math.min(this.balance, 0.45);
    } else if (out?.result === 'winded') {
      this.stamina *= 1 - 0.5 * out.amount;
      this.staminaDelay = 1 + out.amount;
    }
    // Een tik onderbreekt een stoot in de aanloop.
    if (this.punch && this.punch.phase === 'windup' && hit.damage > 6) this.punch = null;
  }

  // Neer: spierspanning en balans vallen weg en de physics neemt het over.
  // getUp = seconden tot een poging om op te staan (Infinity = blijft liggen).
  knockDown({ kind = 'flash', out = false, dir = null, getUp = Infinity } = {}) {
    if (this.state === 'out') return;
    const wasUp = this.state === 'up';
    this.state = out ? 'out' : 'down';
    this.downTime = 0;
    this.getUpAt = out ? Infinity : getUp;
    this.punch = null;
    this.queuedPunch = null;
    this.blocking = false;
    this.slip = null;
    this.pendingDown = null;
    this.thudDone = false;
    if (wasUp) {
      this.knockdowns++;
      this.roundKnockdowns++;
    }
    this.setLegsLimp(true);
    if (dir) {
      const imp = dir.clone().setY(Math.max(dir.y, 0.15)).normalize().multiplyScalar(4);
      this.parts.head.body.applyImpulse(imp, true);
      this.parts.chest.body.applyImpulse(imp.clone().multiplyScalar(1.4), true);
    }
    this.events.push({ type: 'knockdown', fighter: this, kind, out });
  }

  // Uitgeteld: blijft liggen (ook als hij net aan het opstaan was).
  setOut() {
    if (this.state === 'out') return;
    this.state = 'out';
    this.getUpAt = Infinity;
    this.setLegsLimp(true);
  }

  setLegsLimp(limp) {
    for (const name of ['thighL', 'thighR', 'shinL', 'shinR']) {
      for (const c of this.parts[name].colliders) c.setCollisionGroups(limp ? this.legGroupsLimp : this.legGroupsStanding);
    }
  }

  // Op de grond: elke tik op een stoottoets helpt een beetje sneller overeind.
  rally() {
    if (this.state !== 'down' || !Number.isFinite(this.getUpAt)) return;
    this.getUpAt = Math.max(2, this.getUpAt - KNOCKDOWN.rally);
  }

  startRise() {
    this.state = 'rising';
    this.riseT = 0;
    this.legsUp = false;
    // Opstaan in de richting waar de romp nu naartoe wijst; later bijdraaien naar de tegenstander.
    const q = this.rot('chest');
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q).setY(0);
    if (f.lengthSq() < 0.09) f.copy(new THREE.Vector3(0, -1, 0).applyQuaternion(q).setY(0));
    if (f.lengthSq() > 1e-6) this.yaw = Math.atan2(f.x, f.z);
    this.events.push({ type: 'rise', fighter: this });
  }

  finishRise() {
    this.state = 'up';
    this.balance = 0.35;
    this.daze = Math.max(this.daze, 0.55);
    this.stamina = Math.max(this.stamina, this.staminaCap() * 0.35);
    this.health = Math.max(this.health, this.maxHealth * 0.4);
    this.events.push({ type: 'standing', fighter: this });
  }

  // Zet de handschoenpositie (lokaal in de borst) en elleboog-pool voor één hand.
  handTarget(side, opp) {
    const p = this.punch;
    const pole = POLE_GUARD[side].clone();
    if (this.state === 'rising' && this.riseT < KNOCKDOWN.riseTime * 0.5) return { target: PUSH[side].clone(), pole, stiff: 1.2 };
    // Moeie armen en een lege tank laten de dekking zakken.
    const guard = (this.blocking ? BLOCK : GUARD)[side].clone();
    const af = this.armFatigue[side];
    guard.y -= 0.08 * af + (this.stamina < this.staminaCap() * 0.2 ? 0.04 : 0) + this.daze * 0.04;
    const guardStiff = 1 - 0.3 * af;
    if (!p || p.def.hand !== side) {
      if (p && p.def.hand !== side) guard.z -= 0.03; // andere hand blijft bij de kin
      return { target: guard, pole, stiff: guardStiff };
    }
    const mirror = side === 'L' ? 1 : -1;
    const low = p.body ? -0.06 : 0; // lijfstoten iets dieper doorzetten
    let target;
    let stiff = 1.6;
    if (p.phase === 'windup') {
      const u = easeInOut(p.t / p.windup);
      let wind;
      if (p.name === 'jab') wind = new THREE.Vector3(0.15, 0.26, 0.22);
      else if (p.name === 'cross') wind = new THREE.Vector3(-0.13, 0.24, 0.16);
      else if (p.name === 'uppercut') wind = new THREE.Vector3(-0.08, -0.02, 0.18);
      else wind = new THREE.Vector3(0.44 * mirror, 0.24, 0.16);
      if (p.body) wind.y -= 0.12;
      target = guard.clone().lerp(wind, u);
      if (p.name.endsWith('Hook')) pole.set(1.2 * mirror, 0.25, -0.2);
      if (p.name === 'uppercut') pole.set(0, -1, -0.4);
    } else if (p.phase === 'active') {
      const u = p.t / p.active;
      const aim = this.aim[side];
      if (p.name === 'jab' || p.name === 'cross') {
        const e = easeOut(u / 0.55);
        const start = p.name === 'jab' ? new THREE.Vector3(0.15, 0.26, 0.22) : new THREE.Vector3(-0.13, 0.24, 0.16);
        if (p.body) start.y -= 0.12;
        target = start.lerp(aim.clone().add(new THREE.Vector3(0, 0.08 + low, 0.12)), e);
        pole.set(0.6 * mirror, -0.6, 0);
        stiff = 2.6;
      } else if (p.name.endsWith('Hook')) {
        const e = easeOut(u / 0.75);
        const a0 = aim.clone().add(new THREE.Vector3(0.42 * mirror, 0.04 + low, -0.12));
        const a1 = aim.clone().add(new THREE.Vector3(0.0, 0.06 + low, 0.06));
        const a2 = aim.clone().add(new THREE.Vector3(-0.32 * mirror, 0.06 + low, -0.08));
        target = e < 0.5 ? a0.lerp(a1, e * 2) : a1.lerp(a2, (e - 0.5) * 2);
        pole.set(1.4 * mirror, 0.35, -0.1);
        stiff = 2.6;
      } else {
        const e = easeOut(u / 0.7);
        const a0 = aim.clone().add(new THREE.Vector3(0.0, -0.38, -0.24));
        const a1 = aim.clone().add(new THREE.Vector3(0.02, 0.14 + low, 0.04));
        target = a0.lerp(a1, e);
        pole.set(-0.1, -1, -0.6);
        stiff = 2.6;
      }
    } else {
      target = guard.clone();
      stiff = 1.3;
    }
    if (p.phase !== 'recover') {
      this._lastActive = this._lastActive || {};
      this._lastActive[side] = target.clone();
    } else if (this._lastActive && this._lastActive[side]) {
      target = this._lastActive[side].clone().lerp(guard, easeInOut(p.t / p.recover));
    }
    return { target, pole, stiff: stiff * p.gain };
  }

  footHome(side, vel) {
    const pelvis = this.parts.pelvis ? this.pos('pelvis') : new THREE.Vector3();
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    const wide = this.ducking ? 1.25 : 1;
    const local = side === 'L' ? new THREE.Vector3(0.14 * wide, 0, 0.17) : new THREE.Vector3(-0.14 * wide, 0, -0.15);
    const p = local.applyQuaternion(qYaw).add(pelvis);
    p.addScaledVector(vel, 0.14);
    p.y = ANKLE_H;
    return p;
  }

  updateFeet(dt, vel) {
    const any = this.feet.L.stepping || this.feet.R.stepping;
    const speed = Math.hypot(vel.x, vel.z);
    for (const side of ['L', 'R']) {
      const f = this.feet[side];
      if (f.stepping) {
        f.t += dt / 0.15;
        const u = Math.min(f.t, 1);
        f.pos.lerpVectors(f.from, f.to, easeInOut(u));
        f.pos.y = ANKLE_H + Math.sin(Math.PI * u) * 0.07;
        if (u >= 1) {
          f.stepping = false;
          f.pos.y = ANKLE_H;
          this.events.push({ type: 'step', fighter: this, side });
        }
      }
    }
    if (!any) {
      let best = null;
      let bestDist = speed > 0.3 ? 0.07 : 0.13;
      for (const side of ['L', 'R']) {
        const home = this.footHome(side, vel);
        const dist = home.distanceTo(this.feet[side].pos);
        if (dist > bestDist && side !== this.lastStepSide) {
          bestDist = dist;
          best = side;
        } else if (dist > bestDist * 1.8) {
          bestDist = dist;
          best = side;
        }
      }
      if (best) {
        const f = this.feet[best];
        f.from.copy(f.pos);
        f.to.copy(this.footHome(best, vel));
        f.t = 0;
        f.stepping = true;
        this.lastStepSide = best;
      }
    }
  }

  // Mis: een zware stoot die niets raakt, trekt de bokser uit balans en laat hem even open staan.
  missed(p) {
    const loss = DEFENSE.missBalance[p.name] || 0;
    if (loss) {
      this.balance = Math.max(0.25, this.balance - loss);
      p.recover *= DEFENSE.missRecover;
      this.exposed = DEFENSE.exposed;
    }
    this.events.push({ type: 'miss', fighter: this, name: p.name });
  }

  // Eén physics-stap aan spierwerk.
  update(dt, intent, opp) {
    this.clock += dt;
    const pelvisPos = this.pos('pelvis');
    const pelvisVel = this.vel('pelvis');
    const oppPos = opp.pos('pelvis');
    const toOpp = new THREE.Vector3(oppPos.x - pelvisPos.x, 0, oppPos.z - pelvisPos.z);
    const dist = toOpp.length();
    const fwd = dist > 1e-4 ? toOpp.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);

    // Conditie: stamina, balans, duizeligheid, vermoeidheid.
    if (this.state === 'up') {
      if (this.pendingDown) {
        this.pendingDown.t -= dt;
        if (this.pendingDown.t <= 0) this.knockDown(this.pendingDown.opts);
      }
    }
    if (this.state === 'up') {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) {
        const regen = (this.blocking ? STAMINA.regenBlocking : STAMINA.regen) * (1 - 0.6 * this.bodyDamage) * (0.55 + 0.45 * this.cardio);
        this.stamina = Math.min(this.staminaCap(), this.stamina + regen * dt);
      }
      this.balance = Math.min(1, this.balance + dt * (0.9 - this.daze * 0.4) * (0.6 + 0.4 * this.cardio));
      this.daze = Math.max(0, this.daze - dt * 0.12);
      this.headDamage = Math.max(0, this.headDamage - dt * FATIGUE.headDecay);
      // Energie komt deels terug, sneller als je even niet geraakt wordt.
      this.sinceHit += dt;
      const regen = RECOVERY.regen + (this.sinceHit > RECOVERY.idleAfter ? RECOVERY.regenIdle : 0);
      this.health = Math.min(this.maxHealth, this.health + regen * (0.5 + 0.5 * this.cardio) * dt);
      for (const s of ['L', 'R']) {
        if (!this.punch || this.punch.def.hand !== s) this.armFatigue[s] = Math.max(0, this.armFatigue[s] - dt * FATIGUE.armRecover * (this.blocking ? 0.4 : 1));
      }
      this.exposed = Math.max(0, this.exposed - dt);
      this.slipCool = Math.max(0, this.slipCool - dt);
    } else if (this.state === 'rising') {
      this.riseT += dt;
      this.balance = Math.min(1, this.balance + dt * 0.5);
      if (this.riseT >= KNOCKDOWN.riseTime) this.finishRise();
    } else {
      this.downTime += dt;
      this.balance = Math.max(0, this.balance - dt * 6);
      if (intent.punch) this.rally();
      if (this.state === 'down' && this.downTime >= this.getUpAt) this.startRise();
    }
    this.displayHealth += (this.health - this.displayHealth) * Math.min(1, dt * 2.2);

    const active = this.state === 'up';
    const lifting = this.state === 'rising';
    const limp = !active && !lifting;
    const riseU = lifting ? clamp(this.riseT / KNOCKDOWN.riseTime, 0, 1) : 0;
    this.blocking = active && intent.block && !this.punch;
    this.blockTime = this.blocking ? this.blockTime + dt : 0;
    this.ducking = active && intent.duck;

    // Stoten en ontwijken.
    if (active && intent.punch) this.startPunch(intent.punch, !!intent.body);
    if (active && intent.slip) this.startSlip(intent.slip);
    let slipE = 0;
    let slipV = 0; // afgeleide van slipE: het bekken schuift een klein stukje mee en weer terug
    if (this.slip) {
      this.slip.t += dt;
      // Snel opzij, even vasthouden, rustig terug.
      const t = this.slip.t;
      if (t < 0.08) {
        const u = t / 0.08;
        slipE = easeOut(u);
        slipV = (3 * (1 - u) ** 2) / 0.08;
      } else {
        slipE = clamp((DEFENSE.slipTime - t) / 0.14, 0, 1);
        slipV = slipE > 0 && slipE < 1 ? -1 / 0.14 : 0;
      }
      if (this.slip.t >= DEFENSE.slipTime) {
        this.slip = null;
        this.slipCool = DEFENSE.slipCooldown;
      }
    }
    if (this.punch) {
      const p = this.punch;
      p.t += dt;
      if (p.phase === 'windup' && p.t >= p.windup) {
        p.phase = 'active';
        p.t -= p.windup;
        this.events.push({ type: 'whoosh', fighter: this, name: p.name });
      } else if (p.phase === 'active' && p.t >= p.active) {
        p.phase = 'recover';
        p.t -= p.active;
        if (!p.hit) this.missed(p);
      } else if (p.phase === 'recover' && p.t >= p.recover) {
        this.punch = null;
        this.lastPunch = { hand: p.def.hand, ended: this.clock };
        if (this.queuedPunch) this.startPunch(this.queuedPunch.name, this.queuedPunch.body, true);
      }
    }

    // Kijkrichting.
    if (active || riseU > 0.55) {
      const targetYaw = Math.atan2(fwd.x, fwd.z);
      let dy = targetYaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * (active ? 10 : 3));
    }

    let strength;
    let support;
    if (active) {
      strength = 0.3 + 0.7 * this.balance;
      support = Math.max(this.balance, 0.25);
    } else if (lifting) {
      const e = easeInOut(riseU);
      strength = 0.15 + 0.85 * e;
      support = 0.2 + 0.8 * e;
    } else {
      strength = 0.05 * Math.max(0, 1 - this.downTime * 0.5) + 0.015;
      support = 0;
    }

    // Gewenste snelheid.
    const vDes = new THREE.Vector3();
    if (active) {
      const m = intent.move || { x: 0, z: 0 };
      vDes.set(m.x, 0, m.z);
      if (vDes.lengthSq() > 1) vDes.normalize();
      const away = vDes.dot(fwd) < -0.2;
      let speed = away ? MOVE.backSpeed : MOVE.speed;
      if (this.blocking) speed *= MOVE.blockSpeedFactor;
      if (this.ducking) speed *= 0.6;
      if (this.punch) speed *= 0.6;
      speed *= 0.75 + 0.25 * this.cardio;
      vDes.multiplyScalar(speed * (0.5 + 0.5 * this.balance));
      // Bij een stoot stapt de bokser in naar trefafstand.
      if (this.punch && this.punch.phase !== 'recover') {
        const ideal = this.punch.name.endsWith('Hook') || this.punch.name === 'uppercut' ? 0.52 : 0.56;
        const close = clamp((dist - ideal) * 7, 0, 2.6);
        vDes.addScaledVector(fwd, Math.max(close, this.punch.phase === 'active' ? this.punch.def.lunge * 0.4 : 0));
      }
      // Ontwijken: het bekken schuift mee opzij.
      if (this.slip) {
        const left = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        vDes.addScaledVector(left, this.slip.dir * 0.1 * slipV);
        // Explosieve inzet: de rompspieren gooien het bovenlijf opzij.
        if (this.slip.t < 0.08) {
          const chest = this.parts.chest.body;
          chest.applyImpulse(left.multiplyScalar(this.slip.dir * chest.mass() * 16 * dt), true);
        }
      }
      // Duizelig: kleine stapjes die de bokser zelf niet kiest.
      if (this.daze > 0.25) {
        const rnd = this.game.rng || Math.random;
        this.wobble.x += (rnd() * 2 - 1) * dt * 6;
        this.wobble.z += (rnd() * 2 - 1) * dt * 6;
        this.wobble.multiplyScalar(1 - dt * 1.5);
        if (this.wobble.length() > 1) this.wobble.setLength(1);
        vDes.addScaledVector(this.wobble, this.daze * 0.9);
      }
      if (dist < MOVE.minGap) vDes.addScaledVector(fwd, -(MOVE.minGap - dist) * 8);
      // Touwen.
      const lim = RING_HALF - 0.35;
      for (const axis of ['x', 'z']) {
        if (pelvisPos[axis] > lim && vDes[axis] > 0) vDes[axis] = -(pelvisPos[axis] - lim) * 4;
        if (pelvisPos[axis] < -lim && vDes[axis] < 0) vDes[axis] = -(pelvisPos[axis] + lim) * 4;
      }
      const moving = Math.hypot(pelvisVel.x, pelvisVel.z) / MOVE.speed;
      this.cardio = Math.max(0, this.cardio - (FATIGUE.cardioMove * Math.min(1, moving) * dt) / this.attrs.cardio);
      this.sweat = Math.min(1, this.sweat + dt * 0.0012 * (0.3 + moving));
    }

    const pelvis = this.parts.pelvis.body;
    const M = this.totalMass;
    if (!limp) {
      const acc = vDes.clone().sub(pelvisVel.clone().setY(0)).multiplyScalar(MUSCLE.move.accel);
      if (acc.length() > MUSCLE.move.maxAccel) acc.setLength(MUSCLE.move.maxAccel);
      acc.multiplyScalar(support);
      // Doelhoogte van het bekken.
      let h = BODY.pelvis.height - MOVE.stanceDrop;
      if (active) {
        if (this.ducking) h -= MOVE.duckDrop;
        if (this.punch && this.punch.name === 'uppercut') h -= this.punch.phase === 'windup' ? 0.08 : this.punch.phase === 'active' ? -0.02 : 0;
        if (this.punch && this.punch.body && this.punch.phase !== 'recover' && !this.ducking) h -= 0.14; // door de knieën voor een lijfstoot
        h -= (1 - this.balance) * 0.12 + slipE * 0.04;
      } else {
        // Opstaan: steunen, op de knieën, overeind.
        h = riseU < 0.35 ? 0.42 : riseU < 0.7 ? 0.42 + ((riseU - 0.35) / 0.35) * 0.2 : 0.62 + ((riseU - 0.7) / 0.3) * (h - 0.62);
      }
      const ay = GRAVITY + MUSCLE.height.kp * (h - pelvisPos.y) - MUSCLE.height.kd * pelvisVel.y;
      const fy = Math.max(0, M * ay * support);
      pelvis.applyImpulse({ x: M * acc.x * dt * 0.75, y: fy * dt, z: M * acc.z * dt * 0.75 }, true);
      this.parts.chest.body.applyImpulse({ x: M * acc.x * dt * 0.25, y: 0, z: M * acc.z * dt * 0.25 }, true);
    }

    // Houding: bekken en borst rechtop, gedraaid naar de tegenstander.
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    let lean = 0.06;
    let twist = 0;
    let roll = 0;
    if (this.ducking) lean += 0.38;
    else if (this.punch && this.punch.body && this.punch.phase !== 'recover') lean += 0.22;
    if (this.punch) {
      const p = this.punch;
      const d = p.def;
      if (p.phase === 'windup') twist = -d.twist * 0.35 * easeInOut(p.t / p.windup);
      else if (p.phase === 'active') {
        twist = d.twist * easeOut(p.t / (p.active * 0.6));
        lean += p.name === 'uppercut' ? -0.05 : 0.12;
      } else twist = d.twist * (1 - easeInOut(p.t / p.recover));
    }
    lean += (1 - this.balance) * -0.15;
    if (this.slip) {
      roll = -this.slip.dir * DEFENSE.slipLean * slipE;
      lean += 0.12 * slipE;
    }
    if (lifting) lean = riseU < 0.7 ? 1.0 - 0.3 * (riseU / 0.7) : 0.7 * (1 - (riseU - 0.7) / 0.3) + 0.06;
    const qPelvisT = qYaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, twist * 0.3));
    const qChestT = qYaw
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, twist))
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, lean))
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, roll));
    if (!limp) {
      this.uprightTorque('pelvis', qPelvisT, support, dt);
      this.uprightTorque('chest', qChestT, support, dt);
    }

    // Gewrichtsdoelen.
    const qPelvis = this.rot('pelvis');
    const qChest = this.rot('chest');
    const relChest = qPelvis.clone().invert().multiply(qChestT);
    this.setJointTarget('waist', relChest);
    const headLook = new THREE.Quaternion()
      .setFromAxisAngle(Y_AXIS, -twist * 0.6)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, -lean * 0.6))
      .multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, roll * 0.5));
    this.setJointTarget('neck', headLook);

    // Armen via IK.
    const chestPos = this.pos('chest');
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? BODY.shoulderX : -BODY.shoulderX;
      const shoulder = new THREE.Vector3(sx, BODY.shoulderY, 0).applyQuaternion(qChest).add(chestPos);
      const ht = this.handTarget(side, opp);
      const target = ht.target.clone().applyQuaternion(qChest).add(chestPos);
      const pole = ht.pole.clone().applyQuaternion(qChest);
      const ik = solveTwoBone(shoulder, target, LU, LF_REACH, pole);
      this.setJointTarget('shoulder' + side, qChest.clone().invert().multiply(ik.quat), ht.stiff);
      this.setHinge('elbow' + side, ik.bend, ht.stiff, strength);
      // De hand wordt ook rechtstreeks naar zijn doel getrokken (snelle, rechte stoten).
      const reachTarget = target.clone().sub(shoulder);
      if (reachTarget.length() > LU + LF_REACH) reachTarget.setLength(LU + LF_REACH);
      reachTarget.add(shoulder);
      this.pullHand(side, reachTarget, ht.stiff * strength, dt);
    }

    // Benen via IK naar de voeten. Bij het opstaan komen de benen pas onder het lijf als het bekken hoog genoeg is.
    if (lifting && !this.legsUp && riseU > 0.55 && pelvisPos.y > 0.5) {
      this.setLegsLimp(false);
      this.initFeet();
      this.legsUp = true;
    }
    if (active || (lifting && this.legsUp)) this.updateFeet(dt, pelvisVel.clone().setY(0));
    for (const side of ['L', 'R']) {
      const hx = side === 'L' ? BODY.hipX : -BODY.hipX;
      const hip = new THREE.Vector3(hx, BODY.hipY, 0).applyQuaternion(qPelvis).add(pelvisPos);
      const foot = this.feet[side].pos;
      const kneeFwd = new THREE.Vector3(0.15 * (side === 'L' ? 1 : -1), 0, 1).applyQuaternion(qYaw);
      const ik = solveTwoBone(hip, foot, LT, LS, kneeFwd);
      this.setJointTarget('hip' + side, qPelvis.clone().invert().multiply(ik.quat));
      this.setHinge('knee' + side, ik.bend, 1, strength);
    }

    // Spieren aansturen.
    for (const j of this.joints) this.driveJoint(j, strength, dt);

    // Plof op het canvas (voor geluid en camera).
    if (limp && !this.thudDone && this.pos('chest').y < 0.32) {
      this.thudDone = true;
      this.events.push({ type: 'thud', fighter: this, speed: Math.max(0, -this.vel('chest').y) });
    }
  }

  setJointTarget(name, q, gain = 1) {
    const j = this.joints.find((x) => x.name === name);
    j.target.copy(q);
    j.gain = gain;
  }

  setHinge(name, angle, gain, strength) {
    const h = this.hinges[name];
    const a = clamp(angle, h.limits[0], h.limits[1]);
    h.joint.configureMotorPosition(a, h.muscle.stiffness * gain * strength, h.muscle.damping * Math.sqrt(gain) * Math.max(strength, 0.2));
  }

  pullHand(side, target, gain, dt) {
    const fore = this.parts['foreArm' + side].body;
    const chest = this.parts.chest.body;
    const glove = this.gloveWorld(side);
    const vel = this.gloveVelocity(side).sub(v3(chest.linvel()));
    const m = fore.mass() + this.parts['upperArm' + side].body.mass() * 0.5;
    const kp = MUSCLE.hand.kp * gain;
    const kd = MUSCLE.hand.kd * Math.sqrt(gain);
    const f = target.clone().sub(glove).multiplyScalar(kp).addScaledVector(vel, -kd).multiplyScalar(m);
    if (f.length() > MUSCLE.hand.max * gain) f.setLength(MUSCLE.hand.max * gain);
    f.multiplyScalar(dt);
    fore.applyImpulseAtPoint(f, glove, true);
    chest.applyImpulse(f.multiplyScalar(-0.5), true);
  }

  uprightTorque(name, qTarget, support, dt) {
    const body = this.parts[name].body;
    const err = quatError(qTarget, this.rot(name));
    const w = v3(body.angvel());
    const I = bodyInertia(body) * 3;
    const t = err.multiplyScalar(MUSCLE.upright.kp).addScaledVector(w, -MUSCLE.upright.kd).multiplyScalar(I * support * dt);
    body.applyTorqueImpulse(t, true);
  }

  driveJoint(j, strength, dt) {
    const pb = j.parent.body;
    const cb = j.child.body;
    const qP = q4(pb.rotation());
    const qC = q4(cb.rotation());
    const qDes = qP.multiply(j.target);
    const err = quatError(qDes, qC);
    const relW = v3(cb.angvel()).sub(v3(pb.angvel()));
    const I = Math.min(bodyInertia(cb), bodyInertia(pb));
    const pivot = j.anchor.clone().applyQuaternion(qC).add(v3(cb.translation()));
    const g = j.gain * strength;
    const t = err.multiplyScalar(j.muscle.kp * g).addScaledVector(relW, -j.muscle.kd * Math.sqrt(g)).multiplyScalar(I);
    if (t.length() > j.muscle.max * g + 1) t.setLength(j.muscle.max * g + 1);
    // Zwaartekrachtcompensatie: de spier draagt het gewicht van alles onder het gewricht.
    if (j.subtree.length) {
      const comp = Math.min(1, strength * 1.15);
      for (const part of j.subtree) {
        const b = part.body;
        const com = v3(b.worldCom());
        const r = com.sub(pivot);
        t.add(new THREE.Vector3(-r.z, 0, r.x).multiplyScalar(b.mass() * 9.81 * comp));
      }
    }
    t.multiplyScalar(dt);
    cb.applyTorqueImpulse(t, true);
    const reaction = this.state === 'down' || this.state === 'out' ? 1 : j.reaction;
    if (reaction) pb.applyTorqueImpulse(t.multiplyScalar(-reaction), true);
  }

  // Duw het lichaam bij een treffer.
  applyHitImpulse(partName, dir, magnitude) {
    const part = this.parts[partName];
    if (!part) return;
    const imp = dir.clone().multiplyScalar(magnitude);
    part.body.applyImpulse(imp, true);
  }

  destroy() {
    for (const p of Object.values(this.parts)) this.world.removeRigidBody(p.body);
    this.parts = {};
  }
}
