// Impactmodel: zet een echte botsing tussen vuist en doel om in een impuls,
// hoofdversnelling (lineair en draaiend) en een ernst. Uit de ernst en de toestand
// van de verdediger volgt de kans op wankelen, een knockdown of een knock-out.
// De drempels zijn speltuning, geen medische waarden.
import * as THREE from 'three';
import { IMPACT, KO, SPOTS } from './constants.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Zachte drempel: 0 onder a, 1 boven b.
export function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Trefplek op het hoofd uit de richting vanaf het midden (lokaal: +Z voor, +X links, +Y boven).
export function headSpot(d) {
  if (d.z > 0.35) {
    if (d.y < -0.3) return Math.abs(d.x) > 0.45 ? 'jaw' : 'chin';
    if (Math.abs(d.x) > 0.55) return d.y > 0.1 ? 'temple' : 'jaw';
    if (d.y > 0.4) return 'forehead';
    return 'nose';
  }
  if (Math.abs(d.x) > 0.5) return d.y < -0.1 ? 'jaw' : 'temple';
  if (d.y > 0.55) return 'crown';
  return 'back';
}

// Trefplek op de romp uit het lokale contactpunt op de borstkas.
// De lever zit rechts in het lijf: bij de verdediger is dat lokaal -X.
export function bodySpot(part, local) {
  if (part === 'pelvis') return 'belly';
  if (local.y > -0.05) return 'chest';
  if (local.x < -0.07) return 'liver';
  if (local.x > 0.07) return 'ribs';
  return 'solar';
}

// Fysieke botsing. vRel = snelheid handschoen t.o.v. doel, normal = van doelmidden naar
// de handschoen, contact = trefpunt, center = midden van het doel, mass = slagmassa.
// brace (0..1) = hoe goed de verdediger zich schrap zet: dat verhoogt de massa die meebeweegt.
export function collide({ zone, vRel, normal, contact, center, up, mass, brace }) {
  const head = zone === 'head';
  const speed = vRel.length();
  const vn = Math.max(0, -vRel.dot(normal));
  const clean = speed > 1e-6 ? vn / speed : 0;
  const mT = (head ? IMPACT.headMass : IMPACT.bodyMass) * (1 + IMPACT.brace * brace);
  const mu = (mass * mT) / (mass + mT);
  // Botsing langs de normaal met terugvering; zijwaarts gaat maar een deel over (wrijving).
  const Jn = normal.clone().multiplyScalar(-vn * mu * (1 + IMPACT.restitution));
  const vt = vRel.clone().addScaledVector(normal, vn);
  const Jt = vt.multiplyScalar(mu * IMPACT.friction);
  const J = Jn.add(Jt);
  const impulse = J.length();
  const dvLin = impulse / mT;
  let dOmega = 0;
  if (head) {
    // Het hoofd draait om de nek: draaipunt onder het midden van het hoofd.
    const pivot = center.clone().addScaledVector(up, -IMPACT.neckPivot);
    const r = contact.clone().sub(pivot);
    const L = new THREE.Vector3().crossVectors(r, J).length();
    const I = (IMPACT.headInertia + IMPACT.headMass * IMPACT.neckPivot ** 2) * (1 + IMPACT.brace * brace);
    dOmega = L / I;
  }
  return { J, impulse, dvLin, dOmega, clean, speed };
}

// Ernst van de treffer: lineaire en draaiende hoofdversnelling, gewogen naar de trefplek.
export function severityOf(zone, spot, impact) {
  const s = SPOTS[spot] || SPOTS.nose;
  const glance = smooth(0.15, IMPACT.glance + 0.15, impact.clean) * 0.65 + 0.35;
  if (zone === 'head') {
    const lin = impact.dvLin / IMPACT.refLin;
    const rot = impact.dOmega / IMPACT.refRot;
    return ((1 - IMPACT.rotWeight) * lin + IMPACT.rotWeight * rot) * s.ko * glance;
  }
  return (impact.impulse / IMPACT.refBody) * s.ko * glance;
}

// Hoe goed een bokser een treffer opvangt (1 = fris). Kin, eerdere schade, vermoeidheid en
// duizeligheid tellen mee; niemand wordt immuun.
export function resistanceOf(f, zone) {
  const energy = clamp(f.stamina / f.staminaCap(), 0, 1) * 0.6 + f.cardio * 0.4;
  if (zone === 'head') {
    return f.attrs.chin * (1 - 0.5 * clamp(f.headDamage, 0, 1)) * (0.78 + 0.22 * energy) * (1 - 0.25 * f.daze);
  }
  return f.attrs.core * (1 - 0.45 * clamp(f.bodyDamage, 0, 1)) * (0.75 + 0.25 * energy);
}

// Uitkomst van één treffer. rng is injecteerbaar voor reproduceerbare tests.
export function knockoutRoll({ zone, spot, severity, resistance, sensitivity = 1, rng = Math.random }) {
  const x = (severity * sensitivity) / Math.max(resistance, 0.05);
  if (zone === 'head') {
    const pOut = smooth(KO.out[0], KO.out[1], x);
    const pDown = Math.max(pOut, smooth(KO.down[0], KO.down[1], x));
    const r = rng();
    if (r < pOut) return { result: x > KO.waveOff ? 'waveOff' : 'out', x };
    if (r < pDown) return { result: 'down', x };
    if (x > KO.rocked) return { result: 'rocked', x, amount: clamp((x - KO.rocked) / 0.6, 0, 1) };
    return { result: null, x };
  }
  const liver = spot === 'liver' || spot === 'solar';
  const pDown = smooth(KO.body[0], KO.body[1], x) * (liver ? 1 : 0.5);
  if (rng() < pDown) return { result: 'bodyDown', x };
  if (x > 0.7) return { result: 'winded', x, amount: clamp((x - 0.7) / 0.6, 0, 1) };
  return { result: null, x };
}

// Soort knockdown voor de commentaarregel en de herhaling.
export function classifyKnockdown({ zone, counter, defender, single }) {
  if (zone !== 'head') return 'body';
  if (counter) return 'counter';
  if (defender.health <= 0 || defender.headDamage > 0.65) return 'accumulation';
  if (defender.cardio < 0.3 || defender.stamina < defender.staminaCap() * 0.15) return 'exhaustion';
  return single ? 'flash' : 'accumulation';
}

export const KNOCKDOWN_LABELS = {
  flash: 'Flash-knock-out',
  counter: 'Counter-knock-out',
  accumulation: 'Opgebouwde schade',
  exhaustion: 'Uitputting',
  body: 'Lijfstoot',
  tko: 'Technische knock-out',
  stoppage: 'Staande TKO',
};
