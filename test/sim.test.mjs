// Headless tests van physics, stoten en rondeverloop: node --test test/
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import { Game } from '../src/game/match.js';
import { AIController } from '../src/game/ai.js';
import { PUNCH_ORDER, HEALTH, MATCH } from '../src/game/constants.js';

before(async () => {
  await R.init();
});

const idle = () => ({ poll: () => ({ move: { x: 0, z: 0 }, block: false, duck: false, punch: null }) });

function scripted() {
  const c = { queue: [], block: false, duck: false, move: { x: 0, z: 0 } };
  c.poll = () => ({ move: c.move, block: c.block, duck: c.duck, punch: c.queue.shift() || null });
  return c;
}

function demoGame(gap) {
  const g = new Game(R, { startGap: gap });
  g.mode = 'demo';
  g.state = 'fight';
  return g;
}

test('boksers blijven stabiel rechtop staan zonder invoer', () => {
  const g = demoGame(2.2);
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
      const g = demoGame(gap);
      const me = scripted();
      g.setController(0, me);
      g.setController(1, idle());
      g.advance(1);
      g.drainEvents();
      me.queue.push(name);
      g.advance(0.7);
      const hits = g.drainEvents().filter((e) => e.type === 'hit');
      assert.equal(hits.length, 1, `${name} moet precies één keer raken`);
      const hit = hits[0];
      assert.ok(['head', 'chest'].includes(hit.zone), `${name} raakt ${hit.zone}`);
      assert.ok(hit.damage >= 4, `${name} doet ${hit.damage} schade`);
      assert.ok(g.fighters[1].health < HEALTH);
    }
  });
}

test('jab, linkse hoek en uppercut doen merkbare schade op het hoofd', () => {
  const min = { jab: 5, leftHook: 10, uppercut: 10 };
  for (const name of Object.keys(min)) {
    let best = 0;
    for (const gap of [0.9, 1.0, 1.1]) {
      const g = demoGame(gap);
      const me = scripted();
      g.setController(0, me);
      g.setController(1, idle());
      g.advance(1);
      g.drainEvents();
      me.queue.push(name);
      g.advance(0.7);
      for (const e of g.drainEvents()) if (e.type === 'hit' && e.zone === 'head') best = Math.max(best, e.damage);
    }
    assert.ok(best >= min[name], `${name}: beste hoofdtreffer ${best}`);
  }
});

test('dekking vangt stoten op, uppercut niet in de borst', () => {
  for (const name of ['jab', 'cross', 'leftHook', 'rightHook']) {
    const g = demoGame(0.85);
    const me = scripted();
    const opp = scripted();
    opp.block = true;
    g.setController(0, me);
    g.setController(1, opp);
    g.advance(1);
    g.drainEvents();
    me.queue.push(name);
    g.advance(0.7);
    const hits = g.drainEvents().filter((e) => e.type === 'hit');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].blocked, true, `${name} moet geblokt worden`);
    assert.ok(hits[0].damage < 3);
  }
});

test('stamina daalt per stoot en herstelt daarna', () => {
  const g = demoGame(2.2);
  const me = scripted();
  g.setController(0, me);
  g.setController(1, idle());
  g.advance(0.5);
  const f = g.fighters[0];
  me.queue.push('uppercut');
  g.advance(0.1);
  assert.ok(f.stamina < 90);
  g.advance(3);
  assert.ok(f.stamina > 99);
});

test('knock-out eindigt de ronde en de volgende ronde begint met volle energie', () => {
  const g = new Game(R, { startGap: 1.0 });
  const me = scripted();
  g.setController(0, me);
  g.setController(1, idle());
  g.startMatch();
  assert.equal(g.state, 'intro');
  g.advance(MATCH.introTime + 0.2);
  assert.equal(g.state, 'fight');
  g.fighters[1].health = 4;
  me.queue.push('cross');
  g.advance(0.7);
  assert.equal(g.fighters[1].ko, true, 'tegenstander is knock-out');
  assert.equal(g.state, 'ko');
  const events = [];
  for (let i = 0; i < 40 && g.state !== 'intro'; i++) {
    g.advance(0.25);
    events.push(...g.drainEvents().map((e) => e.type));
  }
  assert.ok(events.includes('roundEnd'));
  assert.equal(g.roundsWon[0], 1);
  assert.equal(g.round, 2);
  assert.equal(g.state, 'intro');
  assert.ok(g.fighters.every((f) => f.health === HEALTH && !f.ko));
});

test('na de bel wint wie de meeste energie heeft', () => {
  const g = new Game(R);
  g.setController(0, idle());
  g.setController(1, idle());
  g.startMatch();
  g.advance(MATCH.introTime + 0.2);
  g.fighters[0].health = 50;
  g.roundClock = 0.05;
  g.advance(0.1);
  assert.equal(g.state, 'roundEnd');
  assert.equal(g.roundsWon[1], 1);
});

test('wedstrijd eindigt na twee gewonnen rondes', () => {
  const g = new Game(R);
  g.setController(0, idle());
  g.setController(1, idle());
  g.startMatch();
  for (let r = 0; r < 2; r++) {
    g.advance(MATCH.introTime + 0.2);
    g.fighters[1].health = 10;
    g.roundClock = 0.05;
    g.advance(0.1);
    if (g.state === 'roundEnd') g.advance(MATCH.roundEndHold + 0.1);
  }
  assert.equal(g.state, 'matchEnd');
  assert.equal(g.matchWinner, 0);
  assert.deepEqual(g.roundsWon, [2, 0]);
});

test('AI tegen AI: volledige wedstrijd blijft stabiel en eindigt', () => {
  const g = new Game(R);
  g.setController(0, new AIController('normal'));
  g.setController(1, new AIController('hard'));
  g.startMatch();
  for (let i = 0; i < 600 && g.state !== 'matchEnd'; i++) {
    g.advance(0.5);
    g.drainEvents();
    for (const f of g.fighters) {
      const p = f.pos();
      assert.ok(Number.isFinite(p.x) && Math.abs(p.x) < 4 && Math.abs(p.z) < 4, 'binnen de ring');
    }
  }
  assert.equal(g.state, 'matchEnd');
  assert.ok(g.matchStats[0].landed + g.matchStats[1].landed > 5);
});
