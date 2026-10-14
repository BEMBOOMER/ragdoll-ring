// Menu's, HUD, aankondigingen en instellingen (DOM-laag boven de 3D-scène).
import { ACTIONS, keyLabel, RESERVED } from './input.js';
import { HEALTH, STAMINA, DIFFICULTY, ROSTER, STYLES, SPOTS, PUNCHES, JUDGES } from './game/constants.js';
import { KNOCKDOWN_LABELS } from './game/impact.js';
import { save } from './storage.js';

const DECISIONS = { unanimous: 'Unanieme jurybeslissing', split: 'Verdeelde jurybeslissing', majority: 'Meerderheidsbeslissing', draw: 'Gelijkspel' };
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

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
      count: $('#count'),
      rally: $('#rally'),
      replay: $('#replay'),
      replayCard: $('#replay-card'),
    };
    this.bars = [0, 1].map((i) => ({
      health: $(`#p${i + 1}-health`),
      ghost: $(`#p${i + 1}-ghost`),
      stamina: $(`#p${i + 1}-stamina`),
      cap: $(`#p${i + 1}-cap`),
      scap: $(`#p${i + 1}-scap`),
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
    const first = document.querySelector(`#${id} .btn.primary`) || document.querySelector(`#${id} button, #${id} input`);
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
      'opp-prev': () => this.cycleOpponent(-1),
      'opp-next': () => this.cycleOpponent(1),
      'skip-replay': () => this.ctx.renderer.stopReplay(),
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
    // Keuzegroepen: moeilijkheid, aantal rondes, rondeduur.
    const groups = [
      ['diff', (v) => this.setDifficulty(v)],
      ['rounds', (v) => this.setChoice('rounds', Number(v))],
      ['roundtime', (v) => this.setChoice('roundTime', Number(v))],
    ];
    for (const [attr, fn] of groups) {
      for (const b of $$(`[data-${attr}]`)) {
        b.addEventListener('click', () => {
          this.ctx.audio.unlock();
          this.ctx.audio.uiClick();
          fn(b.dataset[attr]);
        });
      }
    }
    this.setDifficulty(this.ctx.settings.difficulty);
    this.setChoice('rounds', this.ctx.settings.rounds);
    this.setChoice('roundTime', this.ctx.settings.roundTime);
    this.showOpponent();
    $('#pause-btn').addEventListener('click', () => a.pause());
  }

  setDifficulty(key) {
    if (!DIFFICULTY[key]) key = 'normal';
    this.ctx.settings.difficulty = key;
    for (const b of $$('[data-diff]')) b.setAttribute('aria-checked', String(b.dataset.diff === key));
    this.persist();
  }

  setChoice(key, value) {
    const attr = key === 'rounds' ? 'rounds' : 'roundtime';
    const options = $$(`[data-${attr}]`).map((b) => Number(b.dataset[attr]));
    if (!options.includes(value)) value = options[0];
    this.ctx.settings[key] = value;
    for (const b of $$(`[data-${attr}]`)) b.setAttribute('aria-checked', String(Number(b.dataset[attr]) === value));
    this.persist();
  }

  // Tegenstander kiezen: willekeurig of een vaste bokser uit de selectie.
  cycleOpponent(step) {
    const ids = ['random', ...ROSTER.map((r) => r.id)];
    const i = Math.max(0, ids.indexOf(this.ctx.settings.opponent));
    this.ctx.settings.opponent = ids[(i + step + ids.length) % ids.length];
    this.showOpponent();
    this.persist();
  }

  showOpponent() {
    const r = ROSTER.find((x) => x.id === this.ctx.settings.opponent);
    if (!r) this.ctx.settings.opponent = 'random';
    $('#opp-name').textContent = r ? `${r.name} ‘${r.nick}’` : 'Willekeurige tegenstander';
    $('#opp-style').textContent = r ? STYLES[r.style].label : 'Zes stijlen, elk gevecht anders';
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
          if (key in this.ctx.audio.volumes) this.ctx.audio.setVolumes({ [key]: s[key] });
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
    if (key === 'blood') this.ctx.renderer.blood = s.blood;
    if (key === 'voice') this.ctx.audio.voice = s.voice;
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
      if (this.ctx.renderer.replay) {
        e.preventDefault();
        this.ctx.renderer.stopReplay();
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
    if (pad && this.ctx.renderer.replay && (pad.start || pad.punch)) this.ctx.renderer.stopReplay();
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
      `${k('back')}${k('forward')}${k('left')}${k('right')} bewegen · ${k('block')} dekking · ${k('duck')} bukken (+ stoot = lijf) · ${k('slipLeft')}${k('slipRight')} ontwijken<br>` +
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
      b.health.classList.toggle('low', f.health < f.maxHealth * 0.25);
      b.cap.style.transform = `scaleX(${1 - f.maxHealth / HEALTH})`;
      b.stamina.style.transform = `scaleX(${f.stamina / STAMINA.max})`;
      b.stamina.classList.toggle('tired', f.stamina < f.staminaCap() * 0.25);
      b.scap.style.transform = `scaleX(${1 - f.staminaCap() / STAMINA.max})`;
      // Stipjes: hoe vaak deze bokser al gevloerd is.
      if (b.pips.childElementCount !== f.knockdowns) b.pips.innerHTML = '<i class="pip on" title="knockdown"></i>'.repeat(f.knockdowns);
    });
    this.els.clock.textContent = clock(Math.ceil(game.roundClock));
    this.els.clock.classList.toggle('urgent', game.roundClock <= 10 && game.state === 'fight');
    this.els.round.textContent = `RONDE ${game.round}/${game.rules.rounds}`;
    const me = game.fighters[0];
    this.els.vignette.classList.toggle('danger', game.mode === 'match' && me.state === 'up' && me.health < me.maxHealth * 0.25);
    // Telling: groot getal, en een oproep om op te staan als de speler ligt.
    const counting = game.mode === 'match' && game.state === 'count';
    if (!counting && this.els.count.textContent) this.els.count.textContent = '';
    this.els.rally.hidden = !(counting && game.count.who === 0 && me.state === 'down');
    if (this.hintTimer > 0 && game.state === 'fight') {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.els.hint.classList.add('fade');
    }
  }

  showCount(n) {
    const el = this.els.count;
    el.textContent = String(n);
    el.classList.toggle('late', n >= 8);
    el.classList.remove('tick');
    void el.offsetWidth;
    el.classList.add('tick');
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
    this.els.count.textContent = '';
  }

  popup(e) {
    if (!this.ctx.settings.numbers) return;
    const p = this.ctx.renderer.project(e.pos);
    if (!p.visible) return;
    const el = document.createElement('div');
    el.className = 'popup' + (e.blocked ? ' block' : e.damage >= 14 || e.outcome === 'rocked' ? ' big' : '');
    let label = '';
    if (e.parried) label = 'GEPAREERD';
    else if (e.blocked) label = 'GEBLOKT';
    else if (e.knockdown) label = 'KNOCKDOWN';
    else if (e.counter) label = 'COUNTER';
    else if (e.outcome === 'rocked') label = 'WANKELT';
    else if (e.zone !== 'head' && (e.spot === 'liver' || e.spot === 'solar')) label = SPOTS[e.spot].label.toUpperCase();
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

  // Ronde-uitslag vanuit de speler gezien: "10-9 · 10-9 · 9-10".
  cardLine(cards) {
    return cards.map(([a, b]) => `${a}-${b}`).join(' · ');
  }

  onEvent(e) {
    const game = this.ctx.game;
    if (game.mode !== 'match') return;
    const names = game.names;
    switch (e.type) {
      case 'roundStart': {
        const last = e.round === e.rounds && e.rounds > 1;
        this.announce(`RONDE ${e.round}${last ? '<small>LAATSTE RONDE</small>' : ''}`, 900);
        if (e.round === 1) this.showHint();
        break;
      }
      case 'countdown':
        if (e.n <= 2) this.announce(String(e.n), 600);
        break;
      case 'fight':
        this.announce('<b class="gold">BOX!</b>', 650);
        break;
      case 'hit':
        this.popup(e);
        if (e.knockdown) this.flash();
        break;
      case 'down': {
        const kind = KNOCKDOWN_LABELS[e.kind] || '';
        this.announce(`<b class="red">KNOCKDOWN</b><small>${names[e.fighter]} GAAT NEER${kind ? ' · ' + kind.toUpperCase() : ''}</small>`, 1600);
        break;
      }
      case 'count':
        this.showCount(e.n);
        break;
      case 'resume':
        this.els.count.textContent = '';
        this.announce('<b class="gold">BOX!</b>', 650);
        break;
      case 'ko': {
        const title = e.method === 'ko' ? 'K.O.!' : 'T.K.O.!';
        const why = e.kind === 'stoppage' ? 'DE SCHEIDSRECHTER STOPT HET' : e.kind === 'tko' ? 'DRIE KNOCKDOWNS' : (KNOCKDOWN_LABELS[e.kind] || '').toUpperCase();
        this.els.count.textContent = '';
        this.announce(`<b class="red">${title}</b><small>${names[e.winner]} WINT${why ? ' · ' + why : ''}</small>`, 2400);
        break;
      }
      case 'timeUp':
        this.announce(e.final ? 'EINDE<small>DE JURY BESLIST</small>' : `EINDE RONDE ${game.round}`, 1800);
        break;
      case 'roundEnd':
        setTimeout(() => {
          if (game.state === 'roundEnd') this.announce(`RONDE ${e.round}<small>JURY: ${this.cardLine(e.cards)}</small>`, 1300);
        }, 1700);
        break;
      case 'matchEnd':
        if (e.method !== 'decision' && e.replay && this.ctx.settings.replay) setTimeout(() => this.startReplay(e.replay), 300);
        else setTimeout(() => this.showResult(), e.method === 'decision' ? 2200 : 400);
        break;
      default:
        break;
    }
  }

  // Herhaling van de beslissende klap, met meetwaarden uit de simulatie.
  startReplay(clip) {
    const game = this.ctx.game;
    if (game.mode !== 'match' || game.state !== 'matchEnd') return;
    this.clearAnnounce();
    const hit = clip.impact;
    const card = this.els.replayCard;
    if (hit) {
      const spot = SPOTS[hit.spot]?.label || hit.zone;
      const kind = KNOCKDOWN_LABELS[game.koKind] || KNOCKDOWN_LABELS[hit.knockdown] || '';
      const rows = [
        ['Stoot', `${PUNCHES[hit.punch].label}${hit.body ? ' (lijf)' : ''}`],
        ['Trefplek', spot],
        ['Vuistsnelheid', `${hit.speed.toFixed(1)} m/s`],
        ['Impuls', `${hit.impulse.toFixed(1)} N·s`],
      ];
      if (hit.zone === 'head') rows.push(['Hoofd', `${hit.headSpeed.toFixed(1)} m/s · ${hit.spin.toFixed(0)} rad/s`]);
      rows.push(['Ernst', `${hit.ratio.toFixed(2)}× weerstand`]);
      if (hit.counter) rows.push(['Timing', 'counter']);
      card.innerHTML = `<div class="title">${kind || 'Knock-out'}</div>` + rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
    } else card.innerHTML = '<div class="title">Het einde</div>';
    this.els.replay.hidden = false;
    this.showHud(false);
    this.ctx.renderer.playReplay(clip, () => {
      this.els.replay.hidden = true;
      this.showResult();
    });
  }

  methodText() {
    const g = this.ctx.game;
    const at = g.endAt ? `ronde ${g.endAt.round} · ${clock(g.endAt.clock)}` : '';
    const totals = g.totals().map(([a, b]) => `${a}-${b}`).join(', ');
    if (g.method === 'ko') return `Knock-out in ${at}${KNOCKDOWN_LABELS[g.koKind] ? ' · ' + KNOCKDOWN_LABELS[g.koKind] : ''}`;
    if (g.method === 'tko') return g.koKind === 'stoppage' ? `Scheidsrechter stopt het in ${at}` : `TKO in ${at} · drie knockdowns`;
    return `${DECISIONS[g.decision] || 'Jurybeslissing'}${g.cards[0].length ? ' · ' + totals : ''}`;
  }

  showResult() {
    const game = this.ctx.game;
    if (game.mode !== 'match' || game.state !== 'matchEnd') return;
    this.clearAnnounce();
    this.els.replay.hidden = true;
    const w = game.matchWinner;
    const title = $('#result-title');
    title.textContent = w === 0 ? 'JIJ WINT!' : w === 1 ? `${game.names[1]} WINT` : 'GELIJKSPEL';
    title.classList.toggle('lose', w === 1);
    const diff = DIFFICULTY[this.ctx.settings.difficulty].label.toLowerCase();
    $('#result-sub').textContent = `${this.methodText()} · ${diff}`;
    const s = game.matchStats;
    const pct = (x) => (x.thrown ? Math.round((x.landed / x.thrown) * 100) + '%' : '—');
    const rows = [
      ['Stoten', s[0].thrown, s[1].thrown],
      ['Raak', s[0].landed, s[1].landed],
      ['Trefzekerheid', pct(s[0]), pct(s[1])],
      ['Schade', Math.round(s[0].damage), Math.round(s[1].damage)],
      ['Geblokt', s[0].blocked, s[1].blocked],
      ['Knockdowns', s[0].knockdowns, s[1].knockdowns],
    ];
    $('#result-stats').innerHTML =
      `<div class="h"></div><div class="h v">${game.names[0]}</div><div class="h v">${game.names[1]}</div>` +
      rows.map(([k, a, b]) => `<div>${k}</div><div class="v b">${a}</div><div class="v r">${b}</div>`).join('');
    // Scorekaarten van de jury (ook bij een KO: de stand tot dan).
    const totals = game.totals();
    $('#result-cards').innerHTML = game.cards[0].length
      ? JUDGES.map((j, k) => `<div>Jury ${j.name}</div><div class="v">${totals[k][0]}</div><div class="v">${totals[k][1]}</div>`).join('')
      : '';
    this.ctx.input.enabled = false;
    this.show('result', { push: false });
  }
}
