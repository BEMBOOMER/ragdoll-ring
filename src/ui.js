// Menu's, HUD, aankondigingen en instellingen (DOM-laag boven de 3D-scène).
import { ACTIONS, keyLabel, RESERVED } from './input.js';
import { HEALTH, STAMINA, MATCH, DIFFICULTY } from './game/constants.js';
import { save } from './storage.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

export class UI {
  constructor(ctx) {
    this.ctx = ctx; // { game, input, audio, renderer, settings, actions }
    this.stack = [];
    this.current = null;
    this.announceTimer = null;
    this.hintTimer = 0;
    this.els = {
      hud: $('#hud'),
      announce: $('#announce'),
      popups: $('#popups'),
      toast: $('#toast'),
      vignette: $('#vignette'),
      flash: $('#flash'),
      clock: $('#hud-clock'),
      round: $('#hud-round'),
      hint: $('#hud-hint'),
    };
    this.bars = [0, 1].map((i) => ({
      health: $(`#p${i + 1}-health`),
      ghost: $(`#p${i + 1}-ghost`),
      stamina: $(`#p${i + 1}-stamina`),
      pips: $(`#p${i + 1}-pips`),
      name: $(`#p${i + 1}-name`),
    }));
    this.bindButtons();
    this.bindSettings();
    this.buildBindList();
    this.bindKeys();
  }

  // ---------- schermen ----------
  show(id, { push = true } = {}) {
    if (this.current && push) this.stack.push(this.current);
    for (const s of $$('.screen')) if (s.id !== 'loading') s.hidden = s.id !== id;
    this.current = id;
    const first = document.querySelector(`#${id} .btn.primary, #${id} button, #${id} input`);
    requestAnimationFrame(() => first?.focus({ preventScroll: true }));
  }

  hideAll() {
    for (const s of $$('.screen')) if (s.id !== 'loading') s.hidden = true;
    this.current = null;
    this.stack = [];
    document.activeElement?.blur?.();
  }

  back() {
    this.ctx.input.cancelCapture();
    $$('.key-btn.waiting').forEach((b) => b.classList.remove('waiting'));
    const prev = this.stack.pop();
    if (prev) this.show(prev, { push: false });
    else if (this.current === 'pause') this.ctx.actions.resume();
  }

  bindButtons() {
    const a = this.ctx.actions;
    const map = {
      play: () => a.play(),
      controls: () => this.show('controls'),
      settings: () => this.show('settings'),
      howto: () => this.show('howto'),
      back: () => this.back(),
      resume: () => a.resume(),
      restart: () => a.play(),
      quit: () => a.quit(),
      rematch: () => a.play(),
      'reset-binds': () => {
        this.ctx.input.resetBindings();
        this.buildBindList();
        this.toast('Standaardtoetsen hersteld');
      },
    };
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      this.ctx.audio.unlock();
      this.ctx.audio.uiClick();
      map[btn.dataset.action]?.();
    });
    document.addEventListener('pointerover', (e) => {
      if (e.target.closest?.('.btn, .difficulty button, .key-btn')) this.ctx.audio.uiHover();
    });
    for (const b of $$('.difficulty button')) {
      b.addEventListener('click', () => {
        this.ctx.audio.unlock();
        this.ctx.audio.uiClick();
        this.setDifficulty(b.dataset.diff);
      });
    }
    this.setDifficulty(this.ctx.settings.difficulty);
    $('#pause-btn').addEventListener('click', () => a.pause());
  }

  setDifficulty(key) {
    if (!DIFFICULTY[key]) key = 'normal';
    this.ctx.settings.difficulty = key;
    for (const b of $$('.difficulty button')) b.setAttribute('aria-checked', String(b.dataset.diff === key));
    this.persist();
  }

  persist() {
    save('rr-settings', this.ctx.settings);
  }

  bindSettings() {
    const s = this.ctx.settings;
    for (const el of $$('[data-setting]')) {
      const key = el.dataset.setting;
      if (el.type === 'range') {
        const out = el.parentElement.querySelector('output');
        el.value = Math.round(s[key] * 100);
        out.textContent = el.value + '%';
        el.addEventListener('input', () => {
          s[key] = el.value / 100;
          out.textContent = el.value + '%';
          this.ctx.audio.setVolumes({ [key]: s[key] });
          this.persist();
        });
        el.addEventListener('change', () => this.ctx.audio.uiClick());
      } else {
        el.checked = !!s[key];
        el.addEventListener('change', () => {
          s[key] = el.checked;
          this.applySetting(key);
          this.persist();
          this.ctx.audio.uiClick();
        });
      }
    }
  }

  applySetting(key) {
    const s = this.ctx.settings;
    if (key === 'shake') this.ctx.renderer.shakeEnabled = s.shake;
    if (key === 'muted') this.ctx.audio.setMuted(s.muted);
  }

  syncSettings() {
    for (const el of $$('[data-setting]')) {
      const key = el.dataset.setting;
      if (el.type === 'checkbox') el.checked = !!this.ctx.settings[key];
    }
  }

  buildBindList() {
    const list = $('#bind-list');
    const input = this.ctx.input;
    list.innerHTML = '';
    for (const act of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'bind-row';
      const label = document.createElement('span');
      label.textContent = act.label;
      const btn = document.createElement('button');
      btn.className = 'key-btn';
      btn.dataset.bind = act.id;
      btn.textContent = keyLabel(input.bindings[act.id]);
      btn.setAttribute('aria-label', `${act.label}: ${keyLabel(input.bindings[act.id])}. Klik om te wijzigen.`);
      btn.addEventListener('click', () => this.startRebind(btn, act));
      row.append(label, btn);
      list.append(row);
    }
  }

  startRebind(btn, act) {
    const input = this.ctx.input;
    $$('.key-btn.waiting').forEach((b) => {
      b.classList.remove('waiting');
      b.textContent = keyLabel(input.bindings[b.dataset.bind]);
    });
    btn.classList.add('waiting');
    btn.textContent = 'Druk op een toets…';
    input.captureNext((code) => {
      btn.classList.remove('waiting');
      if (code === 'Escape') {
        btn.textContent = keyLabel(input.bindings[act.id]);
        return;
      }
      if (RESERVED.includes(code) || code.startsWith('Arrow')) {
        btn.textContent = keyLabel(input.bindings[act.id]);
        this.toast(`${keyLabel(code)} is gereserveerd`);
        return;
      }
      const swapped = input.rebind(act.id, code);
      this.buildBindList();
      const nb = document.querySelector(`.key-btn[data-bind="${act.id}"]`);
      nb?.classList.add('changed');
      nb?.focus();
      if (swapped) {
        const other = ACTIONS.find((x) => x.id === swapped);
        this.toast(`${keyLabel(code)} gewisseld met ${other.label}`);
        document.querySelector(`.key-btn[data-bind="${swapped}"]`)?.classList.add('changed');
      }
      this.updateHint();
      this.ctx.audio.uiClick();
    });
  }

  bindKeys() {
    const input = this.ctx.input;
    input.on('key', (e) => {
      this.ctx.audio.unlock();
      if (input.capture) return;
      if (e.code === 'KeyM') {
        const s = this.ctx.settings;
        s.muted = !s.muted;
        this.ctx.audio.setMuted(s.muted);
        this.syncSettings();
        this.persist();
        this.toast(s.muted ? 'Geluid uit' : 'Geluid aan');
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        e.preventDefault();
        if (this.current && this.current !== 'menu' && this.current !== 'result') this.back();
        else if (!this.current && this.ctx.game.mode === 'match') this.ctx.actions.pause();
        return;
      }
      // Pijltjes navigeren door menu's.
      if (this.current && (e.code === 'ArrowDown' || e.code === 'ArrowUp')) {
        const items = $$(`#${this.current} button:not([hidden]), #${this.current} input`);
        const i = items.indexOf(document.activeElement);
        const ni = e.code === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[ni]?.focus();
        e.preventDefault();
      }
    });
  }

  // Gamepad in menu's.
  padNav(pad) {
    if (!pad || !this.current) return;
    if (pad.back) this.back();
    this.padCool = (this.padCool || 0) - 1;
    if (this.padCool > 0) return;
    if (Math.abs(pad.y) > 0.6) {
      const items = $$(`#${this.current} button, #${this.current} input`);
      const i = items.indexOf(document.activeElement);
      const ni = pad.y > 0 ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[ni]?.focus();
      this.padCool = 12;
    }
    if (pad.punch === 'uppercut' && document.activeElement?.click) document.activeElement.click();
  }

  // ---------- HUD ----------
  showHud(show) {
    this.els.hud.hidden = !show;
    if (show) {
      const names = this.ctx.game.names;
      this.bars[0].name.textContent = names[0];
      this.bars[1].name.textContent = names[1];
    }
  }

  updateHint() {
    const b = this.ctx.input.bindings;
    const k = (id) => `<kbd>${keyLabel(b[id])}</kbd>`;
    this.els.hint.innerHTML =
      `${k('back')}${k('forward')}${k('left')}${k('right')} bewegen · ${k('block')} dekking · ${k('duck')} bukken<br>` +
      `${k('jab')} jab · ${k('cross')} directe · ${k('leftHook')} ${k('rightHook')} hoeken · ${k('uppercut')} uppercut · <kbd>Esc</kbd> pauze`;
  }

  showHint() {
    this.updateHint();
    this.els.hint.classList.remove('fade');
    this.hintTimer = 9;
  }

  updateHud(dt) {
    const game = this.ctx.game;
    if (this.els.hud.hidden) return;
    game.fighters.forEach((f, i) => {
      const b = this.bars[i];
      const h = Math.max(0, f.health / HEALTH);
      b.health.style.transform = `scaleX(${h})`;
      b.ghost.style.transform = `scaleX(${Math.max(h, f.displayHealth / HEALTH)})`;
      b.health.classList.toggle('low', h < 0.25);
      b.stamina.style.transform = `scaleX(${f.stamina / STAMINA.max})`;
      b.stamina.classList.toggle('tired', f.stamina < 25);
      const pips = MATCH.roundsToWin;
      if (b.pips.childElementCount !== pips) b.pips.innerHTML = '<i class="pip"></i>'.repeat(pips);
      [...b.pips.children].forEach((p, k) => p.classList.toggle('on', k < game.roundsWon[i]));
    });
    const t = Math.ceil(game.roundClock);
    this.els.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.els.clock.classList.toggle('urgent', t <= 10 && game.state === 'fight');
    this.els.round.textContent = `RONDE ${game.round}`;
    const me = game.fighters[0];
    this.els.vignette.classList.toggle('danger', game.mode === 'match' && !me.ko && me.health / HEALTH < 0.25);
    if (this.hintTimer > 0 && game.state === 'fight') {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.els.hint.classList.add('fade');
    }
  }

  announce(html, ms = 1100) {
    const el = this.els.announce;
    clearTimeout(this.announceTimer);
    el.innerHTML = `<span>${html}</span>`;
    this.announceTimer = setTimeout(() => {
      el.firstChild?.classList.add('out');
      this.announceTimer = setTimeout(() => (el.innerHTML = ''), 350);
    }, ms);
  }

  clearAnnounce() {
    clearTimeout(this.announceTimer);
    this.els.announce.innerHTML = '';
  }

  popup(e) {
    if (!this.ctx.settings.numbers) return;
    const p = this.ctx.renderer.project(e.pos);
    if (!p.visible) return;
    const el = document.createElement('div');
    el.className = 'popup' + (e.blocked ? ' block' : e.damage >= 14 ? ' big' : '');
    const label = e.blocked ? 'GEBLOKT' : e.counter ? 'COUNTER' : '';
    el.innerHTML = `${e.blocked ? '' : Math.round(e.damage)}${label ? `<small>${label}</small>` : ''}`;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.els.popups.append(el);
    setTimeout(() => el.remove(), 950);
  }

  flash() {
    const f = this.els.flash;
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }

  toast(text) {
    const t = this.els.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  onEvent(e) {
    const game = this.ctx.game;
    if (game.mode !== 'match') return;
    const names = game.names;
    switch (e.type) {
      case 'roundStart': {
        const decisive = game.roundsWon[0] === MATCH.roundsToWin - 1 && game.roundsWon[1] === MATCH.roundsToWin - 1;
        const last = game.round === MATCH.maxRounds;
        this.announce(`RONDE ${e.round}${decisive || last ? '<small>BESLISSENDE RONDE</small>' : ''}`, 900);
        if (e.round === 1) this.showHint();
        break;
      }
      case 'countdown':
        if (e.n <= 2) this.announce(String(e.n), 600);
        break;
      case 'fight':
        this.announce('<b class="gold">VECHT!</b>', 650);
        break;
      case 'hit':
        this.popup(e);
        if (e.ko) this.flash();
        break;
      case 'ko':
        this.announce(`<b class="red">K.O.!</b><small>${names[e.winner]} WINT DE RONDE</small>`, 2600);
        break;
      case 'timeUp':
        this.announce(`TIJD!<small>${e.winner === null ? 'GELIJKSPEL' : `RONDE VOOR ${names[e.winner]}`}</small>`, 2000);
        break;
      case 'matchEnd':
        setTimeout(() => this.showResult(), e.reason === 'time' ? 2200 : 400);
        break;
      default:
        break;
    }
  }

  showResult() {
    const game = this.ctx.game;
    if (game.mode !== 'match' || game.state !== 'matchEnd') return;
    this.clearAnnounce();
    const won = game.matchWinner === 0;
    const title = $('#result-title');
    title.textContent = won ? 'JIJ WINT!' : 'CPU WINT';
    title.classList.toggle('lose', !won);
    const kos = game.roundHistory.filter((r) => r.reason === 'ko').length;
    const diff = DIFFICULTY[this.ctx.settings.difficulty].label.toLowerCase();
    $('#result-sub').textContent = `${game.roundsWon[0]}–${game.roundsWon[1]} in rondes · ${kos} knock-out${kos === 1 ? '' : 's'} · ${diff}`;
    const s = game.matchStats;
    const pct = (x) => (x.thrown ? Math.round((x.landed / x.thrown) * 100) + '%' : '—');
    const rows = [
      ['Stoten', s[0].thrown, s[1].thrown],
      ['Raak', s[0].landed, s[1].landed],
      ['Trefzekerheid', pct(s[0]), pct(s[1])],
      ['Schade', Math.round(s[0].damage), Math.round(s[1].damage)],
      ['Geblokt', s[0].blocked, s[1].blocked],
      ['Knock-outs', s[0].knockdowns, s[1].knockdowns],
    ];
    $('#result-stats').innerHTML =
      `<div class="h"></div><div class="h v">${game.names[0]}</div><div class="h v">${game.names[1]}</div>` +
      rows.map(([k, a, b]) => `<div>${k}</div><div class="v b">${a}</div><div class="v r">${b}</div>`).join('');
    this.ctx.input.enabled = false;
    this.show('result', { push: false });
  }
}
