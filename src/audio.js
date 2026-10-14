// Procedureel geluid met de Web Audio API: geen geluidsbestanden nodig.
// Bussen: master ← { sfx, crowd, ui }, met een limiter op de master.
// Volumes zijn 0..1 schuifwaarden en worden perceptueel (kwadratisch) omgezet.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const vary = (x, amount = 0.06) => x * (1 + (Math.random() * 2 - 1) * amount);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volumes = { master: 0.8, sfx: 0.9, crowd: 0.6 };
    this.voice = true;
    this.excitement = 0.2;
  }

  // Moet vanuit een gebruikersactie (klik/toets) worden aangeroepen.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master.connect(limiter).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.crowdBus = ctx.createGain();
    this.ui = ctx.createGain();
    this.sfx.connect(this.master);
    this.crowdBus.connect(this.master);
    this.ui.connect(this.master);
    // Korte zaalgalm voor de effecten.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.6, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.sfx.connect(this.reverb).connect(wet).connect(this.master);
    this.noise = this.noiseBuffer(2);
    this.applyVolumes();
    this.startCrowd();
    this.ready = true;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const curve = (x) => clamp(x, 0, 1) ** 2;
    this.master.gain.setTargetAtTime(this.muted ? 0 : curve(this.volumes.master), t, 0.03);
    this.sfx.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.03);
    this.ui.gain.setTargetAtTime(curve(this.volumes.sfx) * 0.8, t, 0.03);
    this.crowdBus.gain.setTargetAtTime(curve(this.volumes.crowd), t, 0.03);
  }

  // ---------- bouwstenen ----------
  noiseHit({ time = 0, dur = 0.12, freq = 1200, q = 1, type = 'bandpass', gain = 0.5, sweepTo = null, bus = this.sfx, attack = 0.002 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + time;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = vary(1, 0.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random() * Math.max(0, this.noise.duration - dur - 0.1), dur + 0.05);
  }

  tone({ time = 0, freq = 440, to = null, dur = 0.2, type = 'sine', gain = 0.3, bus = this.sfx, attack = 0.003 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + time;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- spelgeluiden ----------
  punchHit(damage, zone, ko = false) {
    if (!this.ready) return;
    const p = clamp(damage / 16, 0.25, 1.3);
    // Lage dreun.
    this.tone({ freq: vary(zone === 'head' ? 120 : 90), to: 42, dur: 0.16 + p * 0.1, gain: 0.55 * p, type: 'sine' });
    // Leren klap.
    this.noiseHit({ dur: 0.07 + p * 0.03, freq: vary(zone === 'head' ? 2200 : 1300), q: 0.9, gain: 0.6 * p });
    this.noiseHit({ dur: 0.18, freq: 380, type: 'lowpass', q: 0.7, gain: 0.45 * p });
    if (zone === 'head' && damage > 10) this.noiseHit({ time: 0.01, dur: 0.05, freq: 5200, q: 2, gain: 0.25 * p });
    if (ko) {
      this.tone({ freq: 70, to: 28, dur: 0.9, gain: 0.7, type: 'sine' });
      this.noiseHit({ dur: 0.6, freq: 200, type: 'lowpass', gain: 0.5 });
    }
    this.cheer(0.15 + p * 0.35);
  }

  block(damage) {
    if (!this.ready) return;
    const p = clamp(damage / 2, 0.3, 1);
    this.noiseHit({ dur: 0.06, freq: vary(750), q: 1.4, gain: 0.45 * p });
    this.tone({ freq: vary(210), to: 120, dur: 0.08, gain: 0.25 * p, type: 'triangle' });
  }

  whoosh(name) {
    if (!this.ready) return;
    const heavy = name === 'leftHook' || name === 'rightHook' || name === 'uppercut';
    this.noiseHit({ dur: heavy ? 0.22 : 0.14, freq: vary(heavy ? 500 : 800), sweepTo: heavy ? 1800 : 2400, q: 1.6, gain: heavy ? 0.16 : 0.12, attack: 0.04 });
  }

  step() {
    if (!this.ready) return;
    this.noiseHit({ dur: 0.05, freq: vary(260, 0.2), type: 'lowpass', q: 0.8, gain: 0.07 });
  }

  bell(times = 1) {
    if (!this.ready) return;
    const partials = [1, 2.76, 5.4, 8.93];
    for (let k = 0; k < times; k++) {
      partials.forEach((m, i) => {
        this.tone({ time: k * 0.32, freq: 880 * m, dur: 2.2 / (i + 1), gain: 0.22 / (i + 1), type: 'sine', attack: 0.001 });
      });
    }
  }

  countdown(n) {
    if (!this.ready) return;
    this.tone({ freq: 520, dur: 0.12, gain: 0.18, type: 'square', bus: this.ui });
  }

  fight() {
    if (!this.ready) return;
    this.bell(1);
    this.cheer(0.6);
  }

  koRoar() {
    if (!this.ready) return;
    this.cheer(1);
    // "Oooh" van de zaal: gefilterde zaagtanden in een koor.
    const ctx = this.ctx;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 150 + Math.random() * 90;
      o.frequency.setValueAtTime(f0 * 1.15, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + 1.6);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 520;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o.connect(f).connect(g).connect(this.crowdBus);
      o.start(t);
      o.stop(t + 1.9);
    }
  }

  // Scheidsrechter: een tik per tel, en zijn stem als de browser Nederlandse spraak heeft.
  count(n) {
    if (!this.ready) return;
    this.tone({ freq: n >= 8 ? 700 : 560, dur: 0.09, gain: 0.16, type: 'triangle', bus: this.ui });
    this.say(['één', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien'][n - 1]);
  }

  box() {
    if (!this.ready) return;
    this.say('Boks!');
    this.cheer(0.5);
  }

  say(text) {
    if (!text || this.muted || !this.voice) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'nl-NL';
      u.rate = 1.15;
      u.pitch = 0.8;
      u.volume = clamp(this.volumes.master * this.volumes.sfx, 0, 1);
      const nl = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith('nl'));
      if (nl) u.voice = nl;
      synth.cancel();
      synth.speak(u);
    } catch {
      // Geen spraak beschikbaar: de tik is genoeg.
    }
  }

  // Een lichaam dat op het canvas klapt.
  thud(speed = 2) {
    if (!this.ready) return;
    const p = clamp(speed / 3, 0.3, 1);
    this.tone({ freq: 62, to: 34, dur: 0.35, gain: 0.6 * p, type: 'sine' });
    this.noiseHit({ dur: 0.22, freq: 180, type: 'lowpass', q: 0.8, gain: 0.5 * p });
    this.noiseHit({ time: 0.02, dur: 0.08, freq: 900, q: 1, gain: 0.15 * p });
  }

  parry() {
    if (!this.ready) return;
    this.noiseHit({ dur: 0.05, freq: vary(1600), q: 2, gain: 0.35 });
    this.tone({ freq: vary(320), to: 180, dur: 0.06, gain: 0.15, type: 'triangle' });
  }

  slip() {
    if (!this.ready) return;
    this.noiseHit({ dur: 0.12, freq: vary(1400), sweepTo: 700, q: 1.2, gain: 0.06, attack: 0.03 });
  }

  // Zware ademhaling als de speler moe is.
  breath(intensity = 0.5) {
    if (!this.ready) return;
    const g = 0.04 + intensity * 0.07;
    this.noiseHit({ dur: 0.32, freq: vary(900, 0.15), q: 0.7, gain: g, attack: 0.08 });
    this.noiseHit({ time: 0.42, dur: 0.38, freq: vary(650, 0.15), q: 0.7, gain: g * 0.8, attack: 0.1 });
  }

  uiClick() {
    if (!this.ready) return;
    this.tone({ freq: 660, to: 990, dur: 0.07, gain: 0.12, type: 'triangle', bus: this.ui });
  }

  uiHover() {
    if (!this.ready) return;
    this.tone({ freq: 1200, dur: 0.03, gain: 0.04, type: 'sine', bus: this.ui });
  }

  // ---------- publiek ----------
  startCrowd() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.5;
    const murmur = ctx.createBiquadFilter();
    murmur.type = 'lowshelf';
    murmur.frequency.value = 300;
    murmur.gain.value = 6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.05;
    // Langzame golving.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    src.connect(lp).connect(murmur).connect(this.crowdGain).connect(this.crowdBus);
    src.start();
    lfo.start();
  }

  cheer(amount) {
    if (!this.ready) return;
    this.excitement = clamp(this.excitement + amount * 0.5, 0, 1);
    const t = this.ctx.currentTime;
    const g = this.crowdGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.05 + amount * 0.22, t + 0.12);
    g.setTargetAtTime(0.05, t + 0.4, 0.9 + amount);
    if (amount > 0.4) {
      this.noiseHit({ dur: 0.9 + amount, freq: 1100, q: 0.6, gain: 0.12 * amount, bus: this.crowdBus, attack: 0.15 });
    }
  }
}
