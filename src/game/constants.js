// Alle afstelbare waarden van het spel op één plek.
// Afstanden in meters, tijden in seconden, massa in kilogram.

export const PHYSICS_DT = 1 / 120;
export const GRAVITY = 9.81;

export const RING_HALF = 3.4; // binnenkant van de touwen
export const FIGHT_START_GAP = 2.2; // afstand tussen bekkens bij de start

// Lichaamsmaten (orthodoxe bokser, ±1,80 m).
export const BODY = {
  pelvis: { size: [0.17, 0.1, 0.11], mass: 10, height: 1.0 },
  chest: { size: [0.18, 0.19, 0.12], mass: 18, offset: 0.32 },
  head: { radius: 0.12, mass: 5, offset: 0.37 },
  upperArm: { radius: 0.055, half: 0.11, mass: 2.2 },
  foreArm: { radius: 0.048, half: 0.1, mass: 1.4 },
  glove: { radius: 0.085, mass: 0.45 },
  thigh: { radius: 0.075, half: 0.135, mass: 7 },
  shin: { radius: 0.058, half: 0.15, mass: 4 },
  shoulderX: 0.22,
  shoulderY: 0.14,
  hipX: 0.1,
  hipY: -0.06,
};

// Spieren: stijfheid (kp) en demping (kd), genormaliseerd op traagheid.
export const MUSCLE = {
  shoulder: { kp: 420, kd: 34, max: 260 },
  neck: { kp: 260, kd: 26, max: 120 },
  waist: { kp: 380, kd: 36, max: 900 },
  hip: { kp: 360, kd: 34, max: 700 },
  elbow: { stiffness: 900, damping: 55 },
  knee: { stiffness: 900, damping: 60 },
  hand: { kp: 320, kd: 28, max: 1100 },
  upright: { kp: 340, kd: 34 },
  height: { kp: 160, kd: 22 },
  move: { accel: 9, maxAccel: 22 },
};

export const MOVE = {
  speed: 2.3,
  backSpeed: 1.8,
  blockSpeedFactor: 0.55,
  duckDrop: 0.2,
  stanceDrop: 0.06,
  minGap: 0.42,
};

// Stoten. damage = basisschade bij een schone treffer op het hoofd.
// Tijden: windup → active (treffer telt) → recover.
export const PUNCHES = {
  jab: {
    label: 'Jab',
    hand: 'L',
    damage: 8,
    stamina: 7,
    windup: 0.05,
    active: 0.14,
    recover: 0.14,
    refSpeed: 5.5,
    impulse: 5,
    stagger: 0.12,
    lunge: 0.9,
    twist: -0.12,
  },
  cross: {
    label: 'Directe',
    hand: 'R',
    damage: 11,
    stamina: 11,
    windup: 0.08,
    active: 0.16,
    recover: 0.2,
    refSpeed: 6.5,
    impulse: 9,
    stagger: 0.22,
    lunge: 1.2,
    twist: 0.42,
  },
  leftHook: {
    label: 'Linkse hoek',
    hand: 'L',
    damage: 13,
    stamina: 14,
    windup: 0.12,
    active: 0.18,
    recover: 0.22,
    refSpeed: 6,
    impulse: 11,
    stagger: 0.3,
    lunge: 0.8,
    twist: -0.55,
  },
  rightHook: {
    label: 'Rechtse hoek',
    hand: 'R',
    damage: 14,
    stamina: 15,
    windup: 0.13,
    active: 0.18,
    recover: 0.24,
    refSpeed: 6,
    impulse: 12,
    stagger: 0.32,
    lunge: 0.8,
    twist: 0.6,
  },
  uppercut: {
    label: 'Uppercut',
    hand: 'R',
    damage: 16,
    stamina: 17,
    windup: 0.14,
    active: 0.18,
    recover: 0.26,
    refSpeed: 5.5,
    impulse: 13,
    stagger: 0.4,
    lunge: 0.7,
    twist: 0.25,
  },
};

export const PUNCH_ORDER = ['jab', 'cross', 'leftHook', 'rightHook', 'uppercut'];

// Vermenigvuldigers per geraakt lichaamsdeel.
export const ZONES = {
  head: 1.0,
  chest: 0.7,
  pelvis: 0.55,
  block: 0.12, // in de dekking
};

export const HEALTH = 120;
export const STAMINA = {
  max: 100,
  regen: 20,
  regenBlocking: 9,
  regenDelay: 0.35,
  tiredFactor: 0.55, // kracht als je te weinig stamina hebt
  blockDrain: 0.35, // deel van de stootschade dat de verdediger als stamina verliest
};

export const MATCH = {
  roundsToWin: 2,
  maxRounds: 5,
  roundTime: 75,
  introTime: 2.6,
  koSlowmo: 1.1,
  koHold: 2.4,
  roundEndHold: 2.4,
};

export const DIFFICULTY = {
  easy: { label: 'Makkelijk', react: 0.12, cooldown: [1.1, 2.0], aggression: 0.45, combo: 0.1, power: 0.85 },
  normal: { label: 'Normaal', react: 0.32, cooldown: [0.65, 1.3], aggression: 0.65, combo: 0.3, power: 1 },
  hard: { label: 'Zwaar', react: 0.55, cooldown: [0.38, 0.85], aggression: 0.85, combo: 0.5, power: 1.08 },
};
