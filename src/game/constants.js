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
// mass = effectieve slagmassa (kg): hoeveel lichaam er achter de vuist zit.
// spin = gewone rompdraaiing (rad/s) bij de treffer; wat een combinatie daarbovenop haalt, telt als momentum.
// Tijden: windup → active (treffer telt) → recover.
export const PUNCHES = {
  jab: {
    label: 'Jab',
    hand: 'L',
    mass: 2.2,
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
    spin: 1,
  },
  cross: {
    label: 'Directe',
    hand: 'R',
    mass: 4.2,
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
    spin: 2,
  },
  leftHook: {
    label: 'Linkse hoek',
    hand: 'L',
    mass: 4.4,
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
    spin: 4.6,
  },
  rightHook: {
    label: 'Rechtse hoek',
    hand: 'R',
    mass: 4.8,
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
    spin: 5,
  },
  uppercut: {
    label: 'Uppercut',
    hand: 'R',
    mass: 4.6,
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
    spin: 2.5,
  },
};

export const PUNCH_ORDER = ['jab', 'cross', 'leftHook', 'rightHook', 'uppercut'];

// Vermenigvuldigers per geraakt lichaamsdeel (schade op de energiebalk).
export const ZONES = {
  head: 1.0,
  chest: 0.7,
  pelvis: 0.55,
  block: 0.12, // in de dekking
};

// Trefplekken. ko = gevoeligheid voor (k)nockdowns, dmg = schadefactor.
export const SPOTS = {
  chin: { label: 'kin', ko: 1.45, dmg: 1.1 },
  jaw: { label: 'kaak', ko: 1.3, dmg: 1.05 },
  temple: { label: 'slaap', ko: 1.2, dmg: 1.05 },
  nose: { label: 'neus', ko: 0.95, dmg: 1.0 },
  forehead: { label: 'voorhoofd', ko: 0.7, dmg: 0.9 },
  crown: { label: 'kruin', ko: 0.6, dmg: 0.85 },
  back: { label: 'achterhoofd', ko: 0.8, dmg: 0.9 },
  liver: { label: 'lever', ko: 1.6, dmg: 1.1 },
  solar: { label: 'maagkuil', ko: 1.25, dmg: 1.0 },
  ribs: { label: 'ribben', ko: 1.0, dmg: 1.0 },
  chest: { label: 'borst', ko: 0.5, dmg: 0.9 },
  belly: { label: 'buik', ko: 0.9, dmg: 1.0 },
  guard: { label: 'dekking', ko: 0, dmg: 1.0 },
};

// Impactmodel (impact.js): botsing tussen vuist en doel met een effectieve slagmassa.
// De referentiewaarden zijn speltuning, geen medische drempels.
export const IMPACT = {
  restitution: 0.3, // terugvering handschoen ↔ doel
  friction: 0.35, // deel van de zijwaartse snelheid dat bij een schampstoot overgaat
  headMass: 5,
  headInertia: 0.03, // kg·m² om het midden van het hoofd
  neckPivot: 0.12, // draaipunt van de nek onder het midden van het hoofd (m)
  bodyMass: 28, // romp
  brace: 1.3, // extra effectieve massa als de nek of buik is aangespannen
  refLin: 4.5, // m/s hoofdsnelheid die als zwaar telt
  refRot: 30, // rad/s
  refBody: 50, // N·s op de romp
  rotWeight: 0.6, // aandeel van de draaiing in de ernst
  glance: 0.45, // onder deze verhouding (recht erop / totaal) schampt een stoot
  applyScale: 0.4, // deel van de berekende impuls dat extra op het lichaam wordt gezet
  spin: 0.5, // deel van de draaiing dat het hoofd meekrijgt
};

// Knock-outkansen als functie van x = ernst / weerstand (zachte drempels).
export const KO = {
  down: [1.0, 1.7], // knockdown-kans loopt hier van 0 naar 1
  out: [1.35, 2.3], // blijft liggen
  waveOff: 2.5, // de scheidsrechter breekt meteen af
  rocked: 0.7, // vanaf hier wankelt de bokser
  body: [1.15, 2.0], // lijfstoot-knockdown
  bodyDelay: 0.35, // een leverstoot valt met vertraging
};

export const HEALTH = 260;
export const STAMINA = {
  max: 100,
  regen: 20,
  regenBlocking: 9,
  regenDelay: 0.35,
  tiredFactor: 0.55, // kracht als je te weinig stamina hebt
  blockDrain: 0.35, // deel van de stootschade dat de verdediger als stamina verliest
  minCap: 0.45, // met lege cardio is nog dit deel van de stamina bruikbaar
};

// Vermoeidheid op langere termijn.
export const FATIGUE = {
  cardioPerStamina: 0.00028, // cardio-verlies per verbruikt staminapunt
  cardioMove: 0.0012, // per seconde lopen op volle snelheid
  cardioBody: 0.0025, // per schadepunt op het lijf
  armPerStamina: 0.006, // armvermoeidheid per staminapunt van een stoot
  armBlock: 0.01, // per punt opgevangen schade in de dekking
  armRecover: 0.06, // per seconde
  armSlow: 0.4, // maximaal verlies aan armsnelheid
  headDecay: 0.002, // herstel van hoofdschade per seconde
};

// Energie (de grote balk) herstelt deels; een deel van elke treffer gaat blijvend van het maximum af.
export const RECOVERY = {
  regen: 1.2, // per seconde, altijd
  regenIdle: 2.0, // extra per seconde als je even niet geraakt wordt
  idleAfter: 1.5,
  permanent: 0.3, // deel van de schade dat van het maximum afgaat
  minMax: 0.35, // het maximum zakt nooit onder dit deel van HEALTH
};

// Herstel in de hoek tussen rondes.
export const CORNER = { health: 0.25, head: 0.2, body: 0.1, cardio: 0.12, arm: 0.7 };

// Combinaties: de volgende stoot kan in de herstelfase van de vorige beginnen.
export const COMBO = {
  perfect: [0.15, 0.75], // deel van de herstelfase waarin de andere hand perfect aansluit
  late: 0.12, // of zo kort na het einde van de vorige stoot
  perfectCost: 0.8,
  perfectWindup: 0.7,
  perfectGain: 1.15,
  poorCost: 1.25,
  poorGain: 0.85,
  poorBalance: 0.1,
  momentum: 0.3, // extra slagmassa als de romp sneller dan normaal de goede kant op draait
};

export const DEFENSE = {
  slipTime: 0.34,
  slipCooldown: 0.12,
  slipLean: 0.42,
  slipStamina: 3,
  parryWindow: 0.2, // dekking zo kort voor de treffer = pareren
  parryBalance: 0.2,
  missBalance: { cross: 0.14, leftHook: 0.2, rightHook: 0.22, uppercut: 0.18 },
  missRecover: 1.35,
  exposed: 0.45, // zo lang staat een bokser open na een misser
  guardLeak: 0.55, // vanaf deze armvermoeidheid lekt een geblokte powerstoot door
};

export const KNOCKDOWN = {
  countStart: 0.9, // seconden na de val tot "één"
  countStep: 0.9,
  mandatory: 8, // verplichte telling tot acht
  tko: 3, // knockdowns in één ronde = TKO
  riseTime: 1.8,
  rally: 0.2, // seconden sneller opstaan per tik op een stoottoets
  stoppage: { impair: 0.7, daze: 0.6, hits: 4, window: 3.5 }, // staande TKO
};

export const MATCH = {
  rounds: 3,
  roundTime: 90,
  introTime: 2.6,
  koSlowmo: 1.1,
  koHold: 2.4,
  roundEndHold: 3.2,
};
export const ROUND_OPTIONS = [3, 6, 12];
export const TIME_OPTIONS = [60, 90, 180];

// Drie juryleden met elk een eigen kijk (10-point must).
export const JUDGES = [
  { name: 'Van Dijk', clean: 1, aggression: 0.35, generalship: 0.25, defense: 0.35 },
  { name: 'Moreau', clean: 1, aggression: 0.6, generalship: 0.2, defense: 0.15 },
  { name: 'Haddad', clean: 1, aggression: 0.2, generalship: 0.35, defense: 0.55 },
];
export const JUDGING = { noise: 2.5, even: 1.5 };

export const DIFFICULTY = {
  easy: { label: 'Makkelijk', react: 0.15, delay: 0.2, cooldown: [1.2, 2.1], aggression: 0.45, combo: 0.1, power: 0.85 },
  normal: { label: 'Normaal', react: 0.38, delay: 0.13, cooldown: [0.75, 1.45], aggression: 0.65, combo: 0.3, power: 1 },
  hard: { label: 'Zwaar', react: 0.6, delay: 0.08, cooldown: [0.5, 1.0], aggression: 0.85, combo: 0.5, power: 1.08 },
};

// Vechtstijlen van de computer. range = afstand bij het afwachten, close = bij het aanvallen.
export const STYLES = {
  outboxer: {
    label: 'Outboxer',
    range: 1.12, close: 0.88, strafe: 0.6, pace: 1.0, combo: 0.25, body: 0.12, counter: 0.35, slip: 0.35, block: 0.4, retreatHurt: true,
    weights: { jab: 52, cross: 24, leftHook: 9, rightHook: 7, uppercut: 4 },
  },
  pressure: {
    label: 'Pressure fighter',
    range: 0.8, close: 0.68, strafe: 0.2, pace: 1.25, combo: 0.45, body: 0.38, counter: 0.15, slip: 0.2, block: 0.55, retreatHurt: false,
    weights: { jab: 22, cross: 22, leftHook: 24, rightHook: 18, uppercut: 14 },
  },
  counter: {
    label: 'Counterpuncher',
    range: 1.0, close: 0.8, strafe: 0.4, pace: 0.65, combo: 0.3, body: 0.2, counter: 0.9, slip: 0.6, block: 0.25, retreatHurt: true,
    weights: { jab: 30, cross: 30, leftHook: 22, rightHook: 10, uppercut: 8 },
  },
  slugger: {
    label: 'Slugger',
    range: 0.9, close: 0.74, strafe: 0.15, pace: 0.85, combo: 0.15, body: 0.2, counter: 0.25, slip: 0.1, block: 0.35, retreatHurt: false,
    weights: { jab: 14, cross: 30, leftHook: 20, rightHook: 22, uppercut: 14 },
  },
  swarmer: {
    label: 'Swarmer',
    range: 0.72, close: 0.62, strafe: 0.3, pace: 1.35, combo: 0.6, body: 0.42, counter: 0.15, slip: 0.25, block: 0.45, retreatHurt: false,
    weights: { jab: 16, cross: 18, leftHook: 28, rightHook: 20, uppercut: 18 },
  },
  boxerPuncher: {
    label: 'Boxer-puncher',
    range: 0.96, close: 0.78, strafe: 0.4, pace: 1.05, combo: 0.4, body: 0.25, counter: 0.45, slip: 0.35, block: 0.4, retreatHurt: true,
    weights: { jab: 32, cross: 26, leftHook: 18, rightHook: 14, uppercut: 10 },
  },
};

// Lichaamseigenschappen; 1 = gemiddeld. Ze sturen de simulatie, geen schadevermenigvuldigers:
// power = slagmassa, speed = armspieren, chin/neck = weerstand tegen hoofdtreffers, core = lijf.
export const DEFAULT_ATTRS = { power: 1, speed: 1, chin: 1, neck: 1, core: 1, cardio: 1 };

export const PLAYER_PROFILE = { id: 'player', name: 'JIJ', short: 'JIJ', style: null, attrs: {} };

// Tegenstanders (fictief).
export const ROSTER = [
  {
    id: 'vos', name: 'Dirk Vos', short: 'VOS', nick: 'De Hamer', style: 'slugger',
    attrs: { power: 1.15, speed: 0.93, chin: 1.1, neck: 1.1, cardio: 0.9 },
    look: { primary: 0xe8323c, trim: 0xffd666, glove: 0xd42330, skin: 0xc68e6a, hair: 0x3a2a1c },
  },
  {
    id: 'elamrani', name: 'Yassin El Amrani', short: 'EL AMRANI', nick: 'Schaduw', style: 'outboxer',
    attrs: { power: 0.92, speed: 1.1, chin: 0.95, cardio: 1.15 },
    look: { primary: 0x1fa37a, trim: 0xf2f2f2, glove: 0xd42330, skin: 0xa8734f, hair: 0x120c08 },
  },
  {
    id: 'kowalski', name: 'Mika Kowalski', short: 'KOWALSKI', nick: 'De Muur', style: 'pressure',
    attrs: { power: 1.02, speed: 0.96, chin: 1.2, neck: 1.15, core: 1.15, cardio: 1.1 },
    look: { primary: 0x2b2b30, trim: 0xe8323c, glove: 0xd42330, skin: 0xe2b392, hair: 0xb8925a },
  },
  {
    id: 'dossantos', name: 'Rafael dos Santos', short: 'DOS SANTOS', nick: 'Spiegel', style: 'counter',
    attrs: { power: 1.0, speed: 1.08, chin: 0.95, cardio: 1.0 },
    look: { primary: 0xf2c230, trim: 0x1b1b1b, glove: 0xd42330, skin: 0x8d5a3b, hair: 0x0f0b09 },
  },
  {
    id: 'janssen', name: 'Bram Janssen', short: 'JANSSEN', nick: 'Wervelwind', style: 'swarmer',
    attrs: { power: 0.95, speed: 1.05, chin: 1.0, core: 1.05, cardio: 1.2 },
    look: { primary: 0xff7a1a, trim: 0x111111, glove: 0xd42330, skin: 0xd9a27c, hair: 0x6b3a1e },
  },
  {
    id: 'okafor', name: 'Chidi Okafor', short: 'OKAFOR', nick: 'De Professor', style: 'boxerPuncher',
    attrs: { power: 1.06, speed: 1.02, chin: 1.05, neck: 1.05, cardio: 1.05 },
    look: { primary: 0x7a3cff, trim: 0xffd666, glove: 0xd42330, skin: 0x5c3b28, hair: 0x0b0806 },
  },
];
