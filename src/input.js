// Toetsenbord, muis en gamepad → intentie van de speler.
// Bewegen is schermrelatief: de camera houdt de speler altijd links in beeld.
import { load, save } from './storage.js';

export const ACTIONS = [
  { id: 'forward', label: 'Vooruit' },
  { id: 'back', label: 'Achteruit' },
  { id: 'left', label: 'Zijstap (de ring in)' },
  { id: 'right', label: 'Zijstap (naar je toe)' },
  { id: 'jab', label: 'Jab' },
  { id: 'cross', label: 'Directe' },
  { id: 'leftHook', label: 'Linkse hoek' },
  { id: 'rightHook', label: 'Rechtse hoek' },
  { id: 'uppercut', label: 'Uppercut' },
  { id: 'block', label: 'Dekking (vasthouden)' },
  { id: 'duck', label: 'Bukken / lijfstoot (vasthouden)' },
  { id: 'slipLeft', label: 'Ontwijken links' },
  { id: 'slipRight', label: 'Ontwijken rechts' },
];

export const DEFAULT_BINDINGS = {
  forward: 'KeyD',
  back: 'KeyA',
  left: 'KeyW',
  right: 'KeyS',
  jab: 'KeyJ',
  cross: 'KeyK',
  leftHook: 'KeyU',
  rightHook: 'KeyI',
  uppercut: 'KeyL',
  block: 'Space',
  duck: 'ShiftLeft',
  slipLeft: 'KeyQ',
  slipRight: 'KeyE',
};

// Vaste extra toetsen die niet te wijzigen zijn.
const FIXED = { ArrowRight: 'forward', ArrowLeft: 'back', ArrowUp: 'left', ArrowDown: 'right' };
export const RESERVED = ['Escape', 'KeyM', 'KeyP', 'Tab'];
const PUNCH_IDS = ['jab', 'cross', 'leftHook', 'rightHook', 'uppercut'];
const SLIP_IDS = { slipLeft: 1, slipRight: -1 };

export function keyLabel(code) {
  if (!code) return '—';
  const names = {
    Space: 'Spatie',
    ShiftLeft: 'Shift links',
    ShiftRight: 'Shift rechts',
    ControlLeft: 'Ctrl links',
    ControlRight: 'Ctrl rechts',
    AltLeft: 'Alt links',
    AltRight: 'Alt rechts',
    MetaLeft: 'Cmd links',
    MetaRight: 'Cmd rechts',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = [];
    this.slips = [];
    this.bindings = { ...DEFAULT_BINDINGS, ...(load('rr-bindings') || {}) };
    this.capture = null;
    this.listeners = {};
    this.gamepadIndex = null;
    this.prevPad = [];
    this.mouse = { left: false, right: false };
    this.enabled = false;
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.down.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
      this.emit('gamepad', { connected: true, id: e.gamepad.id });
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
      this.emit('gamepad', { connected: false });
    });
  }

  on(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  emit(name, data) {
    for (const fn of this.listeners[name] || []) fn(data);
  }

  bindMouse(el) {
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) this.pressed.push('jab');
      if (e.button === 2) this.pressed.push('cross');
      if (e.button === 1) this.pressed.push('uppercut');
      e.preventDefault();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  actionFor(code) {
    for (const [id, c] of Object.entries(this.bindings)) if (c === code) return id;
    return FIXED[code] || null;
  }

  onKey(e, isDown) {
    if (this.capture && isDown) {
      e.preventDefault();
      const cb = this.capture;
      this.capture = null;
      cb(e.code);
      return;
    }
    const action = this.actionFor(e.code);
    if (isDown && !e.repeat) this.emit('key', e);
    if (!action) return;
    // Voorkom scrollen/knopacties tijdens het spelen.
    if (this.enabled) e.preventDefault();
    if (isDown) {
      if (!this.down.has(action) && PUNCH_IDS.includes(action) && this.enabled) this.pressed.push(action);
      if (!this.down.has(action) && SLIP_IDS[action] && this.enabled) this.slips.push(SLIP_IDS[action]);
      this.down.add(action);
    } else this.down.delete(action);
  }

  // Vergeet ingedrukte toetsen en wachtende stoten (bij pauze, menu en start).
  clear() {
    this.down.clear();
    this.pressed.length = 0;
    this.slips.length = 0;
  }

  // Wacht op de volgende toets (voor opnieuw toewijzen).
  captureNext(cb) {
    this.capture = cb;
  }
  cancelCapture() {
    this.capture = null;
  }

  rebind(action, code) {
    // Bestaat de toets al bij een andere actie, dan wisselen ze om.
    const other = Object.keys(this.bindings).find((k) => this.bindings[k] === code && k !== action);
    if (other) this.bindings[other] = this.bindings[action];
    this.bindings[action] = code;
    save('rr-bindings', this.bindings);
    return other;
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
    save('rr-bindings', this.bindings);
  }

  readPad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    const pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) return null;
    const btn = (i) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
    const now = pad.buttons.map((_, i) => btn(i));
    const edge = (i) => now[i] && !this.prevPad[i];
    // Rechterstick opzij = ontwijken (alleen op de flank, zoals een knop).
    const rx = pad.axes[2] || 0;
    const slip = Math.abs(rx) > 0.6 && Math.abs(this.prevSlipX || 0) <= 0.6 ? (rx < 0 ? 1 : -1) : 0;
    this.prevSlipX = rx;
    const res = {
      x: Math.abs(pad.axes[0]) > 0.18 ? pad.axes[0] : 0,
      y: Math.abs(pad.axes[1]) > 0.18 ? pad.axes[1] : 0,
      slip,
      block: btn(7),
      duck: btn(6),
      punch: edge(2) ? 'jab' : edge(3) ? 'cross' : edge(4) ? 'leftHook' : edge(5) ? 'rightHook' : edge(0) ? 'uppercut' : null,
      start: edge(9),
      back: edge(1),
    };
    if (btn(12)) res.y = -1;
    if (btn(13)) res.y = 1;
    if (btn(14)) res.x = -1;
    if (btn(15)) res.x = 1;
    this.prevPad = now;
    return res;
  }
}

// Zet invoer om in een intentie voor de bokser.
export class PlayerController {
  constructor(input, getBasis) {
    this.input = input;
    this.getBasis = getBasis;
    this.pad = null;
  }

  poll() {
    const inp = this.input;
    const d = inp.down;
    let sx = (d.has('forward') ? 1 : 0) - (d.has('back') ? 1 : 0);
    let sy = (d.has('left') ? 1 : 0) - (d.has('right') ? 1 : 0);
    let punch = inp.pressed.shift() || null;
    let slip = inp.slips.shift() || 0;
    let block = d.has('block');
    let duck = d.has('duck');
    const pad = this.pad;
    if (pad) {
      if (pad.x || pad.y) {
        sx = pad.x;
        sy = -pad.y;
      }
      block = block || pad.block;
      duck = duck || pad.duck;
      punch = punch || pad.punch;
      slip = slip || pad.slip;
    }
    // Snel na elkaar gedrukte stoten blijven bewaard voor de volgende frames (max. twee).
    if (inp.pressed.length > 2) inp.pressed.length = 2;
    if (inp.slips.length > 1) inp.slips.length = 1;
    const { forward, right } = this.getBasis();
    const mx = right.x * sx + forward.x * sy;
    const mz = right.z * sx + forward.z * sy;
    const len = Math.hypot(mx, mz);
    const move = len > 1 ? { x: mx / len, z: mz / len } : { x: mx, z: mz };
    // Bukken + stoot = lijfstoot.
    return { move, block, duck, punch, body: !!punch && duck, slip };
  }
}
