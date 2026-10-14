// Headless tests van physics, stoten, knock-outs en wedstrijdregels: node --test test/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { Game } from '../src/game/match.js';
import { AIController } from '../src/game/ai.js';
import { knockoutRoll, headSpot } from '../src/game/impact.js';
import { PUNCH_ORDER, HEALTH, MATCH, KNOCKDOWN, ROSTER, COMBO } from '../src/game/constants.js';

before(async () => {
  await R.init();
});

const idle = () => ({ poll: () => ({ move: { x: 0, z: 0 }, block: false, duck: false, punch: null }) });

function scripted() {
  const c = { queue: [], block: false, duck: false, body: false, slip: 0, move: { x: 0, z: 0 } };
  c.poll = () => {
    const slip = c.slip;
    c.slip = 0;
    return { move: c.move, block: c.block, duck: c.duck, body: c.body, slip, punch: c.queue.shift() || null };
  };
  return c;
}

// Reproduceerbaar toeval.
function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sandbox: geen rondeverloop, invoer altijd aan. rng 0.999 = nooit een toevallige knockdown.
function sandbox(gap, rng = () => 0.999) {
  const g = new Game(R, { startGap: gap, rng });
  g.mode = 'sandbox';
  g.state = 'fight';
  return g;
}

// Gevecht dat direct in de ronde staat.
function fight(opts = {}) {
  const g = new Game(R, { startGap: 1.0, rng: () => 0.999, ...opts });
  const me = scripted();
  const opp = scripted();
  g.setController(0, me);
  g.setController(1, opp);
  g.startMatch();
  g.advance(MATCH.introTime + 0.2);
  return { g, me, opp };
}

const hitsOf = (events) => events.filter((e) => e.type === 'hit');

test('boksers blijven stabiel rechtop staan zonder invoer', () => {
  const g = sandbox(2.2);
  g.setController(0, idle());
  g.setController(1, idle());
  g.advance(6);
  for (const f of g.fighters) {
    const head = f.headPos();
    assert.ok(Number.isFinite(head.x) && Number.isFinite(head.y), 'geen NaN');
    assert.ok(head.y > 1.45, `hoofd staat op ${head.y.toFixed(2)} m`);
    assert.ok(Math.abs(f.pos().x) < 1.6, 'blijft op zijn plek');
  }
});

for (const gap of [0.75, 1.0]) {
  test(`elke stoot raakt een stilstaande tegenstander op ${gap} m`, () => {
    for (const name of PUNCH_ORDER) {
      const g = sandbox(gap);
      const me = scripted();
      g.setController(0, me);
      g.setController(1, idle());
      g.advance(1);
      g.drainEvents();
      me.queue.push(name);
      g.advance(0.7);
      const hits = hitsOf(g.drainEvents());
      assert.equal(hits.length, 1, `${name} moet precies één keer raken`);
      const hit = hits[0];
      assert.ok(['head', 'chest'].includes(hit.zone), `${name} raakt ${hit.zone}`);
      assert.ok(hit.damage >= 4, `${name} doet ${hit.damage} schade`);
      assert.ok(hit.impulse > 3 && Number.isFinite(hit.severity), `${name}: impuls ${hit.impulse}`);
      assert.ok(g.fighters[1].health < HEALTH);
    }
  });
}

test('jab, linkse hoek en uppercut doen merkbare schade op het hoofd', () => {
  const min = { jab: 5, leftHook: 10, uppercut: 10 };
  for (const name of Object.keys(min)) {
    let best = 0;
    for (const gap of [0.9, 1.0, 1.1]) {
      const g = sandbox(gap);
      const me = scripted();
      g.setController(0, me);
      g.setController(1, idle());
      g.advance(1);
      g.drainEvents();
      me.queue.push(name);
      g.advance(0.7);
      for (const e of hitsOf(g.drainEvents())) if (e.zone === 'head') best = Math.max(best, e.damage);
    }
    assert.ok(best >= min[name], `${name}: beste hoofdtreffer ${best}`);
  }
});

test('een hoek draait het hoofd harder weg dan een jab', () => {
  const spin = {};
  for (const name of ['jab', 'rightHook']) {
    const g = sandbox(0.85);
    const me = scripted();
    g.setController(0, me);
    g.setController(1, idle());
    g.advance(1);
    g.drainEvents();
    me.queue.push(name);
    g.advance(0.7);
    spin[name] = hitsOf(g.drainEvents())[0].spin;
  }
  assert.ok(spin.rightHook > spin.jab * 1.5, `hoek ${spin.rightHook.toFixed(1)} vs jab ${spin.jab.toFixed(1)} rad/s`);
});

test('dekking vangt stoten op, uppercut niet in de borst', () => {
  for (const name of ['jab', 'cross', 'leftHook', 'rightHook']) {
    const g = sandbox(0.85);
    const me = scripted();
    const opp = scripted();
    opp.block = true;
    g.setController(0, me);
    g.setController(1, opp);
    g.advance(1);
    g.drainEvents();
    me.queue.push(name);
    g.advance(0.7);
    const hits = hitsOf(g.drainEvents());
    assert.equal(hits.length, 1);
    assert.equal(hits[0].blocked, true, `${name} moet geblokt worden`);
    assert.ok(hits[0].damage < 3);
  }
});

// Rechte lijfstoten kunnen nog op de ellebogen stuiten; hoeken gaan om de dekking heen.
test('hoeken naar het lijf gaan onder een hoge dekking door', () => {
  for (const name of ['leftHook', 'rightHook']) {
    const g = sandbox(0.85);
    const me = scripted();
    const opp = scripted();
    opp.block = true;
    g.setController(0, me);
    g.setController(1, opp);
    g.advance(1);
    g.drainEvents();
    me.body = true;
    me.queue.push(name);
    g.advance(0.7);
    const hits = hitsOf(g.drainEvents());
    assert.equal(hits.length, 1, `${name} naar het lijf raakt één keer`);
    assert.equal(hits[0].blocked, false, `${name} naar het lijf gaat erdoor (${hits[0].spot})`);
    assert.ok(['liver', 'solar', 'ribs', 'belly'].includes(hits[0].spot), `${name} raakt ${hits[0].spot}`);
  }
});

test('pareren: dekking net op tijd tikt een directe weg', () => {
  const g = sandbox(0.9);
  const me = scripted();
  const opp = scripted();
  g.setController(0, me);
  g.setController(1, opp);
  g.advance(1);
  g.drainEvents();
  me.queue.push('cross');
  const events = [];
  for (let i = 0; i < 80; i++) {
    if (!opp.block && g.fighters[0].punch?.phase === 'active') opp.block = true;
    g.advance(1 / 120);
    events.push(...g.drainEvents());
  }
  const hit = hitsOf(events)[0];
  assert.ok(hit?.parried, 'geparreerd');
  assert.equal(hit.damage, 0);
  assert.equal(g.fighters[1].health, HEALTH);
});

test('vroeg ontwijken (buiten de slaande hand) laat een directe missen', () => {
  const g = sandbox(0.9);
  const me = scripted();
  const opp = scripted();
  g.setController(0, me);
  g.setController(1, opp);
  g.advance(1);
  g.drainEvents();
  opp.slip = -1; // weg van de rechterhand van de aanvaller
  g.advance(0.1);
  me.queue.push('cross');
  g.advance(0.6);
  const events = g.drainEvents();
  assert.equal(hitsOf(events).length, 0, 'geen treffer');
  assert.ok(events.some((e) => e.type === 'miss'), 'misser gemeld');
  assert.ok(g.fighters[0].exposed > 0 || g.fighters[0].balance < 1, 'aanvaller staat uit balans');
});

test('perfecte combinatie: de andere hand in de herstelfase is goedkoper', () => {
  const g = sandbox(2.2); // buiten bereik: alleen kosten en timing
  const me = scripted();
  g.setController(0, me);
  g.setController(1, idle());
  g.advance(0.5);
  const f = g.fighters[0];
  me.queue.push('cross');
  g.advance(0.05);
  while (!(f.punch?.phase === 'recover' && f.punch.t > f.punch.recover * 0.3)) g.advance(1 / 120);
  const before = f.stamina;
  me.queue.push('leftHook');
  g.advance(1 / 120);
  const start = g.drainEvents().filter((e) => e.type === 'punchStart').pop();
  assert.equal(start.timing, 'perfect');
  const cost = before - f.stamina;
  assert.ok(cost < 14 * 0.9, `kost ${cost.toFixed(1)} (los: 14)`);
  assert.ok(f.punch.windup < 0.12 * 0.9, 'snellere aanloop');
  assert.ok(COMBO.perfectCost < 1);
});

test('vermoeide arm slaat trager', () => {
  const speed = {};
  for (const tired of [false, true]) {
    const g = sandbox(0.9);
    const me = scripted();
    g.setController(0, me);
    g.setController(1, idle());
    g.advance(1);
    g.drainEvents();
    if (tired) g.fighters[0].armFatigue.R = 1;
    me.queue.push('cross');
    g.advance(0.7);
    speed[tired] = hitsOf(g.drainEvents())[0].speed;
  }
  assert.ok(speed.true < speed.false * 0.95, `fris ${speed.false.toFixed(2)} m/s, moe ${speed.true.toFixed(2)} m/s`);
});

test('stamina daalt per stoot en herstelt daarna', () => {
  const g = sandbox(2.2);
  const me = scripted();
  g.setController(0, me);
  g.setController(1, idle());
  g.advance(0.5);
  const f = g.fighters[0];
  me.queue.push('uppercut');
  g.advance(0.1);
  assert.ok(f.stamina < 90);
  g.advance(3);
  assert.ok(f.stamina > f.staminaCap() - 1);
  assert.ok(f.cardio < 1, 'cardio zakt een beetje');
});

test('trefplek op het hoofd volgt uit de richting', () => {
  assert.equal(headSpot(new THREE.Vector3(0, -0.6, 0.8)), 'chin');
  assert.equal(headSpot(new THREE.Vector3(0.7, -0.5, 0.5)), 'jaw');
  assert.equal(headSpot(new THREE.Vector3(0, 0, 1)), 'nose');
  assert.equal(headSpot(new THREE.Vector3(0.95, 0.2, 0.1)), 'temple');
});

test('knock-outkans hangt van de ernst af, niet van een minimum aan schade', () => {
  const always = () => 0;
  assert.equal(knockoutRoll({ zone: 'head', spot: 'chin', severity: 0.4, resistance: 1, rng: always }).result, null);
  assert.equal(knockoutRoll({ zone: 'head', spot: 'chin', severity: 1.3, resistance: 1, rng: always }).result, 'down');
  assert.equal(knockoutRoll({ zone: 'head', spot: 'chin', severity: 1.8, resistance: 1, rng: always }).result, 'out');
  assert.equal(knockoutRoll({ zone: 'head', spot: 'chin', severity: 1.2, resistance: 1, rng: () => 0.999 }).result, 'rocked');
  // Weerstand verlaagt de drempel: dezelfde stoot is gevaarlijker voor een aangeslagen bokser.
  assert.equal(knockoutRoll({ zone: 'head', spot: 'chin', severity: 0.9, resistance: 0.5, rng: always }).result, 'out');
});

test('één schone stoot kan een frisse bokser vloeren', () => {
  // Hoge KO-gevoeligheid (sandbox-instelling) en geluk: de energiebalk speelt geen rol.
  const { g, me } = fight({ startGap: 0.9, rng: () => 0, rules: { rounds: 3, roundTime: 60, sensitivity: 4 } });
  g.drainEvents();
  me.queue.push('rightHook');
  g.advance(0.7);
  const hit = hitsOf(g.drainEvents())[0];
  assert.ok(hit, 'raak');
  assert.ok(hit.knockdown, `knockdown (${hit.outcome})`);
  assert.ok(g.fighters[1].health > HEALTH * 0.8, 'nog bijna volle energie');
  assert.ok(g.fighters[1].grounded);
});

test('knockdown: telling, opstaan met spierkracht en verder vechten', () => {
  const { g } = fight();
  const f = g.fighters[1];
  f.knockDown({ kind: 'flash', dir: new THREE.Vector3(1, 0.2, 0), getUp: 2 });
  g.advance(0.05);
  assert.equal(g.state, 'count');
  const counts = [];
  let resumed = false;
  for (let i = 0; i < 60 && !resumed; i++) {
    g.advance(0.25);
    for (const e of g.drainEvents()) {
      if (e.type === 'count') counts.push(e.n);
      if (e.type === 'resume') resumed = true;
    }
  }
  assert.ok(resumed, 'gevecht gaat verder');
  assert.equal(g.state, 'fight');
  assert.ok(counts.includes(KNOCKDOWN.mandatory), `telling tot acht: ${counts}`);
  assert.ok(!counts.includes(10));
  assert.equal(f.state, 'up');
  g.advance(1);
  assert.ok(f.headPos().y > 1.4, `staat weer: hoofd op ${f.headPos().y.toFixed(2)} m`);
  assert.equal(f.knockdowns, 1);
  assert.ok(g.matchStats[0].knockdowns === 1);
});

test('blijft liggen tot tien: knock-out, gevecht voorbij, herhaling beschikbaar', () => {
  const { g, me } = fight({ startGap: 0.9 });
  me.queue.push('cross');
  g.advance(0.4);
  g.fighters[1].knockDown({ kind: 'flash', dir: new THREE.Vector3(1, 0.2, 0), getUp: Infinity });
  const types = [];
  for (let i = 0; i < 80 && g.state !== 'matchEnd'; i++) {
    g.advance(0.25);
    types.push(...g.drainEvents().map((e) => e.type));
  }
  assert.ok(types.includes('ko'));
  assert.equal(g.state, 'matchEnd');
  assert.equal(g.matchWinner, 0);
  assert.equal(g.method, 'ko');
  assert.equal(g.fighters[1].ko, true);
  const clip = g.replayClip;
  assert.ok(clip && clip.to - clip.from > 1, 'herhaling van de knock-out');
  let n = 0;
  g.replay.sample((clip.from + clip.to) / 2, (i, part, p, q) => {
    assert.ok(Number.isFinite(p[0] + p[1] + p[2] + q[3]));
    n++;
  });
  assert.equal(n, Object.keys(g.fighters[0].parts).length * 2);
});

test('drie knockdowns in één ronde is een TKO', () => {
  const { g } = fight();
  const f = g.fighters[1];
  for (let k = 0; k < 3 && g.state !== 'ko'; k++) {
    while (g.state !== 'fight') g.advance(0.25);
    f.knockDown({ kind: 'flash', getUp: 1.5 });
    g.advance(0.1);
  }
  assert.equal(g.state, 'ko');
  assert.equal(g.method, 'tko');
  g.advance(MATCH.koHold + 0.5);
  assert.equal(g.state, 'matchEnd');
  assert.equal(g.matchWinner, 0);
});

test('jury: 10-point must na elke ronde, beslissing na de laatste', () => {
  const { g, me } = fight({ startGap: 0.95, rules: { rounds: 2, roundTime: 6 } });
  for (let i = 0; i < 6; i++) {
    me.queue.push(i % 2 ? 'cross' : 'jab');
    g.advance(0.8);
  }
  g.advance(1.5);
  assert.equal(g.state, 'roundEnd');
  assert.deepEqual(g.cards.map((c) => c[0]), [[10, 9], [10, 9], [10, 9]]);
  // Conditie gaat mee naar de volgende ronde.
  const lost = g.fighters[1].maxHealth;
  g.advance(MATCH.roundEndHold + MATCH.introTime + 0.3);
  assert.equal(g.round, 2);
  assert.equal(g.state, 'fight');
  assert.ok(g.fighters[1].maxHealth <= lost + 1e-6 && g.fighters[1].maxHealth < HEALTH, 'blijvende schade blijft');
  g.advance(7);
  assert.equal(g.state, 'matchEnd');
  assert.equal(g.method, 'decision');
  assert.equal(g.decision, 'unanimous');
  assert.equal(g.matchWinner, 0);
  assert.deepEqual(g.totals(), [[20, 19], [20, 19], [20, 19]]); // ronde 2 zonder treffers: 10-10
});

test('gelijke rondes eindigen in een gelijkspel', () => {
  const { g } = fight({ rules: { rounds: 1, roundTime: 3 } });
  g.advance(3.5);
  assert.equal(g.state, 'matchEnd');
  assert.equal(g.decision, 'draw');
  assert.equal(g.matchWinner, null);
});

test('AI tegen AI: alle stijlen, volledige wedstrijd blijft stabiel en eindigt', () => {
  for (let k = 0; k < 3; k++) {
    const a = ROSTER[k * 2];
    const b = ROSTER[k * 2 + 1];
    const g = new Game(R, { rng: seeded(k + 1), rules: { rounds: 2, roundTime: 40 }, profiles: [a, b] });
    g.setController(0, new AIController('normal', a.style, seeded(10 + k)));
    g.setController(1, new AIController('hard', b.style, seeded(20 + k)));
    g.startMatch();
    let landed = 0;
    for (let i = 0; i < 600 && g.state !== 'matchEnd'; i++) {
      g.advance(0.5);
      for (const e of g.drainEvents()) if (e.type === 'hit' && !e.blocked) landed++;
      for (const f of g.fighters) {
        const p = f.pos();
        assert.ok(Number.isFinite(p.x) && Math.abs(p.x) < 4 && Math.abs(p.z) < 4, 'binnen de ring');
      }
    }
    assert.equal(g.state, 'matchEnd', `${a.style} tegen ${b.style} eindigt`);
    assert.ok(['ko', 'tko', 'decision'].includes(g.method));
    assert.ok(landed > 5, `${landed} treffers`);
  }
});
