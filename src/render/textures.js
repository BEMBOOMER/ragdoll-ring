// Procedurele textures: geen afbeeldingsbestanden, alles wordt bij het laden getekend.
// Tegelbare ruis levert huidporiën, leernerf, canvasweefsel en touwvlechten, met een
// bijpassende normal map. Basistextures worden één keer gemaakt en gedeeld; schade
// (blauwe plekken, zwelling, cuts, bloed) wordt per bokser op een eigen canvas geschilderd.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const cache = new Map();
const once = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tegelbare waardenruis: elk octaaf herhaalt zich precies over de texture.
class Noise {
  constructor(seed, max = 256) {
    const r = rng(seed);
    this.max = max;
    this.v = new Float32Array(max * max);
    for (let i = 0; i < this.v.length; i++) this.v[i] = r();
  }
  at(x, y, px, py = px) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let fx = x - xi;
    let fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % px) + px) % px;
    const y0 = ((yi % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const m = this.max;
    const a = this.v[y0 * m + x0];
    const b = this.v[y0 * m + x1];
    const c = this.v[y1 * m + x0];
    const d = this.v[y1 * m + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  // u, v in [0, 1); bx/by = aantal cellen van het grofste octaaf.
  fbm(u, v, bx, by, octaves = 4, gain = 0.5) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let px = bx;
    let py = by;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(u * px, v * py, Math.min(px, this.max), Math.min(py, this.max));
      norm += amp;
      amp *= gain;
      px *= 2;
      py *= 2;
    }
    return sum / norm;
  }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function texture(c, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

// Hoogteveld → normal map (OpenGL-conventie, zoals three.js verwacht).
function normalMap(h, w, hgt, strength, repeat) {
  const c = canvas(w, hgt);
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  const at = (x, y) => h[((y + hgt) % hgt) * w + ((x + w) % w)];
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      let nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      let ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return texture(c, { srgb: false, repeat });
}

// Grijswaarden-albedo: wordt vermenigvuldigd met de kleur van het materiaal.
function grayMap(h, w, hgt, lo, hi) {
  const c = canvas(w, hgt);
  const g = c.getContext('2d');
  const img = g.createImageData(w, hgt);
  for (let i = 0; i < w * hgt; i++) {
    const v = clamp(lo + (hi - lo) * h[i], 0, 1) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- huid ----------
// Neutraal detail (vlekjes en poriën); de huidskleur komt van het materiaal.
export function skinDetail() {
  return once('skin', () => {
    const w = 256;
    const n = new Noise(11);
    const pores = new Noise(12);
    const h = new Float32Array(w * w);
    const tone = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / w;
        const blot = n.fbm(u, v, 4, 4, 3);
        const p = pores.at(u * 128, v * 128, 128);
        const i = y * w + x;
        tone[i] = blot * 0.8 + p * 0.2;
        h[i] = p * 0.7 + blot * 0.3;
      }
    }
    const c = grayMap(tone, w, w, 0.88, 1.0);
    return { canvas: c, map: texture(c, { repeat: [1, 1] }), normalMap: normalMap(h, w, w, 1.0, [1, 1]) };
  });
}

// Waar ligt een lokale richting op een three.js-bol (SphereGeometry-uv)?
export function sphereUV(d) {
  const theta = Math.acos(clamp(d.y, -1, 1));
  let u = Math.atan2(d.z, -d.x) / (Math.PI * 2);
  if (u < 0) u += 1;
  return { u, v: theta / Math.PI };
}

// Schade op de huid van één bokser. Bovenop het basisdetail worden roodheid,
// blauwe plekken, cuts en bloed geschilderd; dat blijft staan tot het gevecht klaar is.
export class DamageSkin {
  constructor(width = 512, height = 256) {
    this.canvas = canvas(width, height);
    this.g = this.canvas.getContext('2d');
    this.texture = texture(this.canvas);
    this.reset();
  }

  reset() {
    const { canvas: c, g } = this;
    // Basisdetail op ware grootte herhaald (ook als het een echte huidtexture is).
    g.fillStyle = g.createPattern(skinDetail().canvas, 'repeat');
    g.fillRect(0, 0, c.width, c.height);
    this.bruise = 0;
    this.cuts = 0;
    this.bleed = 0;
    this.texture.needsUpdate = true;
  }

  // Teken een vlek, ook over de naad van de bol heen. Multiply: herhaalde treffers
  // maken de plek steeds donkerder, zoals een blauwe plek die opbouwt.
  blob(u, v, r, color, alpha, mode = 'multiply') {
    const { canvas: c, g } = this;
    g.save();
    g.globalCompositeOperation = mode;
    const x = u * c.width;
    const y = v * c.height;
    const rad = r * c.width;
    for (const dx of [-c.width, 0, c.width]) {
      if (x + dx + rad < 0 || x + dx - rad > c.width) continue;
      const grd = g.createRadialGradient(x + dx, y, 0, x + dx, y, rad);
      grd.addColorStop(0, color.replace('A', alpha));
      grd.addColorStop(1, color.replace('A', 0));
      g.fillStyle = grd;
      g.fillRect(x + dx - rad, y - rad, rad * 2, rad * 2);
    }
    g.restore();
  }

  // d = lokale richting vanaf het midden, strength 0..1, blood = bloed toegestaan.
  hit(d, strength, { blood = true, spot = null } = {}) {
    const { u, v } = sphereUV(d);
    const s = clamp(strength, 0, 1);
    // Rood worden, en bij herhaling blauw-paars.
    this.blob(u, v, 0.045 + s * 0.035, 'rgba(240,190,180,A)', 0.1 + s * 0.12);
    this.bruise += s;
    if (this.bruise > 1.2) this.blob(u, v, 0.03 + s * 0.025, 'rgba(160,128,148,A)', clamp(0.05 + s * 0.1, 0, 0.18));
    if (blood && s > 0.55) {
      if (spot === 'nose') this.bleed = Math.min(1, this.bleed + s * 0.5);
      else if ((spot === 'forehead' || spot === 'temple' || spot === 'jaw') && this.cuts < 4 && this.bruise > 2) this.cut(u, v, s);
    }
    if (blood && this.bleed > 0.3) this.nosebleed();
    this.texture.needsUpdate = true;
  }

  cut(u, v, s) {
    const { canvas: c, g } = this;
    this.cuts++;
    const x = u * c.width;
    const y = v * c.height;
    const len = 10 + s * 14;
    const ang = -0.3 + Math.random() * 0.6;
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(70,0,0,0.9)';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5);
    g.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5);
    g.stroke();
    // Bloed loopt naar beneden.
    g.strokeStyle = 'rgba(150,8,8,0.75)';
    g.lineWidth = 1.6;
    for (let k = 0; k < 3; k++) {
      const sx = x + (Math.random() - 0.5) * len * 0.8;
      g.beginPath();
      g.moveTo(sx, y);
      g.lineTo(sx + (Math.random() - 0.5) * 3, y + 8 + Math.random() * 22 * s);
      g.stroke();
    }
    g.restore();
  }

  nosebleed() {
    const { canvas: c, g } = this;
    // De neus zit vooraan (u = 0.25), iets onder het midden.
    const x = 0.25 * c.width;
    const y = 0.56 * c.height;
    g.save();
    g.strokeStyle = `rgba(140,6,6,${0.35 + this.bleed * 0.4})`;
    g.lineCap = 'round';
    g.lineWidth = 1.8;
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + side * 3, y);
      g.lineTo(x + side * 4, y + 8 + this.bleed * 16);
      g.stroke();
    }
    g.restore();
  }
}

// ---------- leer (handschoenen, hoekkussens) ----------
export function leather() {
  return once('leather', () => {
    const w = 256;
    const hgt = 128;
    const n = new Noise(21);
    const grain = new Noise(22);
    const h = new Float32Array(w * hgt);
    const tone = new Float32Array(w * hgt);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / hgt;
        const gr = grain.fbm(u, v, 64, 32, 2);
        const soft = n.fbm(u, v, 4, 2, 3);
        const i = y * w + x;
        h[i] = gr;
        tone[i] = 0.82 + soft * 0.1 + gr * 0.08;
      }
    }
    const c = grayMap(tone, w, hgt, 0, 1);
    const g = c.getContext('2d');
    // Naad met stiksels rond de handschoen en een lichte glans bovenop.
    for (const vy of [0.32, 0.68]) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, vy * hgt - 1, w, 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      for (let x = 0; x < w; x += 6) g.fillRect(x, vy * hgt + 2, 3, 1);
    }
    const shine = g.createLinearGradient(0, 0, 0, hgt);
    shine.addColorStop(0, 'rgba(255,255,255,0.14)');
    shine.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.fillStyle = shine;
    g.fillRect(0, 0, w, hgt);
    for (const vy of [0.32, 0.68]) for (let x = 0; x < w; x++) h[Math.round(vy * hgt) * w + x] = 0;
    return { canvas: c, map: texture(c), normalMap: normalMap(h, w, hgt, 2.4) };
  });
}

// Per handschoen een eigen kopie, zodat er bloed op kan komen.
export class GloveSkin {
  constructor() {
    const base = leather();
    this.canvas = canvas(base.canvas.width, base.canvas.height);
    this.g = this.canvas.getContext('2d');
    this.texture = texture(this.canvas);
    this.reset();
  }
  reset() {
    this.g.fillStyle = this.g.createPattern(leather().canvas, 'repeat');
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
  }
  stain(amount) {
    const { canvas: c, g } = this;
    for (let k = 0; k < 3 + amount * 6; k++) {
      g.fillStyle = `rgba(120,0,0,${0.25 + Math.random() * 0.35})`;
      g.beginPath();
      g.arc(c.width * (0.15 + Math.random() * 0.2), c.height * (0.35 + Math.random() * 0.4), 1 + Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    this.texture.needsUpdate = true;
  }
}

// ---------- satijnen broekje ----------
// Grijswaarden met plooien en glansbanen; de teamkleur komt van het materiaal.
export function satin(label = '') {
  return once('satin:' + label, () => {
    const w = 512;
    const hgt = 256;
    const n = new Noise(31);
    const tone = new Float32Array(w * hgt);
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / hgt;
        const fold = n.fbm(u, v * 0.25, 12, 2, 3);
        const sheen = Math.pow(Math.abs(Math.sin((u * 12 + fold * 2.2) * Math.PI)), 6);
        tone[y * w + x] = 0.78 + fold * 0.12 + sheen * 0.12;
      }
    }
    const c = grayMap(tone, w, hgt, 0, 1);
    const g = c.getContext('2d');
    // Brede tailleband en een naam op de voorkant (u = 0.25).
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, hgt * 0.22, w, hgt * 0.1);
    if (label) {
      g.font = '900 30px "Anton", Impact, "Arial Black", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.fillText(label, w * 0.25, hgt * 0.42);
    }
    return { map: texture(c) };
  });
}

// ---------- ring ----------
export function ringCanvas() {
  return once('ring', () => {
    const w = 1024;
    const n = new Noise(41);
    const weave = new Float32Array(w * w);
    const dirt = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / w;
        const i = y * w + x;
        // Canvasweefsel: kruisende draden.
        weave[i] = 0.5 + 0.25 * Math.sin(x * 1.6) * Math.sin(y * 1.6) + 0.15 * Math.sin((x + y) * 0.8);
        dirt[i] = n.fbm(u, v, 6, 6, 4);
      }
    }
    const c = canvas(w, w);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(512, 512, 80, 512, 512, 720);
    grd.addColorStop(0, '#2c3e66');
    grd.addColorStop(1, '#16213b');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, w);
    // Vuil, zweet en schuifsporen.
    const img = g.getImageData(0, 0, w, w);
    for (let i = 0; i < w * w; i++) {
      const d = dirt[i];
      const k = 0.86 + d * 0.22 + (weave[i] - 0.5) * 0.06;
      img.data[i * 4] *= k;
      img.data[i * 4 + 1] *= k;
      img.data[i * 4 + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    const r = rng(42);
    g.strokeStyle = 'rgba(255,255,255,0.035)';
    g.lineCap = 'round';
    for (let k = 0; k < 70; k++) {
      const x = 200 + r() * 624;
      const y = 200 + r() * 624;
      const a = r() * Math.PI * 2;
      const len = 20 + r() * 60;
      g.lineWidth = 3 + r() * 8;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * 20, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    // Rand.
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 10;
    g.strokeRect(40, 40, 944, 944);
    // Middencirkel met logo.
    g.beginPath();
    g.arc(512, 512, 230, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,214,102,0.55)';
    g.stroke();
    g.fillStyle = 'rgba(255,214,102,0.9)';
    g.font = '900 92px "Anton", Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('RAGDOLL', 512, 470);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText('RING', 512, 566);
    // Hoekdriehoeken.
    const corner = (x, y, col, dx, dy) => {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + dx * 170, y);
      g.lineTo(x, y + dy * 170);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    };
    corner(44, 44, 'rgba(47,123,255,0.55)', 1, 1);
    corner(980, 980, 'rgba(255,59,59,0.55)', -1, -1);
    corner(980, 44, 'rgba(255,255,255,0.18)', -1, 1);
    corner(44, 980, 'rgba(255,255,255,0.18)', 1, -1);
    const rough = grayMap(dirt, w, w, 0.95, 0.75);
    return { map: texture(c), normalMap: normalMap(weave, w, w, 0.5), roughnessMap: texture(rough, { srgb: false }) };
  });
}

// Gevlochten touw: schuine strepen, herhaald over de lengte.
export function rope() {
  return once('rope', () => {
    const w = 64;
    const hgt = 64;
    const h = new Float32Array(w * hgt);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) h[y * w + x] = 0.5 + 0.5 * Math.sin(((x + y) / w) * Math.PI * 2 * 3);
    const c = grayMap(h, w, hgt, 0.72, 1);
    return { map: texture(c, { repeat: [1, 40] }), normalMap: normalMap(h, w, hgt, 3, [1, 40]) };
  });
}

// Betonvloer van de zaal.
export function floor() {
  return once('floor', () => {
    const w = 512;
    const n = new Noise(51);
    const c = canvas(w, w);
    const g = c.getContext('2d');
    const img = g.createImageData(w, w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const v = y / w;
        const d = Math.hypot(u - 0.5, v - 0.5) * 2;
        const base = 30 - d * 22;
        const k = n.fbm(u, v, 8, 8, 4);
        const val = clamp(base * (0.75 + k * 0.5), 4, 255);
        const i = (y * w + x) * 4;
        img.data[i] = val * 0.95;
        img.data[i + 1] = val;
        img.data[i + 2] = val * 1.15;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { map: texture(c) };
  });
}

// Bloedvlek op het canvas.
export function bloodStain() {
  return once('stain', () => {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    const r = rng(61);
    for (let k = 0; k < 7; k++) {
      const x = 32 + (r() - 0.5) * 22;
      const y = 32 + (r() - 0.5) * 22;
      const rad = 3 + r() * 9;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(110,4,4,0.9)');
      grd.addColorStop(0.7, 'rgba(90,0,0,0.6)');
      grd.addColorStop(1, 'rgba(90,0,0,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fill();
    }
    return texture(c);
  });
}

// ---------- echte textures ----------
// Staat er in assets/textures/manifest.json een afbeelding voor een texture, dan vervangt die
// de procedurele versie: bijvoorbeeld door Codex gemaakte of gefotografeerde textures.
// Sleutels: skin, leather, ring, rope, floor; per sleutel map, normalMap of roughnessMap.
// Zie assets/textures/README.md.
const OVERRIDABLE = { skin: skinDetail, leather, ring: ringCanvas, rope, floor };

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadTextureOverrides(base = 'assets/textures/') {
  let manifest;
  try {
    const res = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    manifest = await res.json();
  } catch {
    return [];
  }
  const jobs = [];
  for (const [key, maps] of Object.entries(manifest || {})) {
    if (!OVERRIDABLE[key] || typeof maps !== 'object') continue;
    const set = OVERRIDABLE[key]();
    for (const [slot, file] of Object.entries(maps)) {
      const tex = set[slot];
      if (!tex?.isTexture || typeof file !== 'string') continue;
      jobs.push(
        loadImage(base + file)
          .then((img) => {
            // De afbeelding komt in hetzelfde canvas: alles wat de texture al gebruikt, krijgt hem mee.
            const c = tex.image;
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            tex.needsUpdate = true;
            return `${key}.${slot}`;
          })
          .catch(() => null)
      );
    }
  }
  return (await Promise.all(jobs)).filter(Boolean);
}
