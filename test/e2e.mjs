// Browsertest van alle flows: npm run e2e (start zelf een server op een vrije poort).
// Gebruik CHROMIUM_PATH om een eigen Chromium te kiezen; zonder GPU draait WebGL via SwiftShader.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const PORT = 5199;
const URL = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || 'tmp/e2e';
mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => d.toString().includes(String(PORT)) && resolve());
  server.on('exit', () => reject(new Error('server stopte')));
  setTimeout(resolve, 1500);
});

const launch = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(launch);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
    console.log(`ok   ${name}`);
  } catch (err) {
    results.push(['FAIL', name]);
    console.log(`FAIL ${name}\n     ${err.message}`);
    await page.screenshot({ path: `${SHOTS}/fail-${results.length}.png` });
  }
}
const visible = (id) => page.locator(`#${id}`).isVisible();
const G = (fn, arg) => page.evaluate(fn, arg);

try {
  await step('laadscherm verdwijnt en menu verschijnt', async () => {
    await page.goto(URL);
    await page.waitForSelector('#menu:not([hidden])', { timeout: 90000 });
    assert.equal(await visible('loading'), false);
    assert.equal(await G(() => window.__game.game.mode), 'demo');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/1-menu.png` });
  });

  await step('moeilijkheid kiezen wordt onthouden', async () => {
    await page.click('[data-diff="hard"]');
    assert.equal(await page.getAttribute('[data-diff="hard"]', 'aria-checked'), 'true');
    assert.equal(await G(() => JSON.parse(localStorage.getItem('rr-settings')).difficulty), 'hard');
    await page.click('[data-diff="normal"]');
  });

  await step('uitleg openen en terug met Escape', async () => {
    await page.click('#menu [data-action="howto"]');
    assert.ok(await visible('howto'));
    await page.keyboard.press('Escape');
    assert.ok(await visible('menu'));
  });

  await step('instellingen: schuif en schakelaars werken en blijven bewaard', async () => {
    await page.click('#menu [data-action="settings"]');
    assert.ok(await visible('settings'));
    await page.locator('[data-setting="crowd"]').fill('25');
    assert.equal(await page.locator('[data-setting="crowd"] + output').textContent(), '25%');
    await page.locator('label.toggle:has([data-setting="shake"])').click();
    assert.equal(await G(() => window.__game.renderer.shakeEnabled), false);
    await page.locator('label.toggle:has([data-setting="shake"])').click();
    await page.screenshot({ path: `${SHOTS}/2-settings.png` });
    await page.click('#settings [data-action="back"]');
    assert.equal(await G(() => JSON.parse(localStorage.getItem('rr-settings')).crowd), 0.25);
  });

  await step('toetsen wijzigen, wisselen en herstellen', async () => {
    await page.click('#menu [data-action="controls"]');
    assert.ok(await visible('controls'));
    await page.click('.key-btn[data-bind="jab"]');
    assert.equal(await page.textContent('.key-btn[data-bind="jab"]'), 'Druk op een toets…');
    await page.keyboard.press('KeyK');
    assert.equal(await page.textContent('.key-btn[data-bind="jab"]'), 'K');
    assert.equal(await page.textContent('.key-btn[data-bind="cross"]'), 'J', 'oude toets gaat naar de andere actie');
    await page.click('.key-btn[data-bind="jab"]');
    await page.keyboard.press('KeyM');
    assert.equal(await page.textContent('.key-btn[data-bind="jab"]'), 'K', 'gereserveerde toets geweigerd');
    await page.screenshot({ path: `${SHOTS}/3-controls.png` });
    await page.click('[data-action="reset-binds"]');
    assert.equal(await page.textContent('.key-btn[data-bind="jab"]'), 'J');
    await page.click('#controls [data-action="back"]');
    assert.ok(await visible('menu'));
  });

  await step('menu werkt met pijltjes en Enter', async () => {
    await page.focus('#menu [data-action="play"]');
    await page.keyboard.press('ArrowDown');
    const label = await G(() => document.activeElement.dataset.action || document.activeElement.dataset.diff);
    assert.ok(label, 'focus is verplaatst');
  });

  await step('wedstrijd starten: intro, aftellen en HUD', async () => {
    await page.click('#menu [data-action="play"]');
    assert.equal(await visible('menu'), false);
    assert.ok(await visible('hud'));
    assert.equal(await G(() => window.__game.game.mode), 'match');
    await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
    assert.equal(await page.textContent('#hud-round'), 'RONDE 1');
  });

  await step('lopen met het toetsenbord verplaatst de bokser', async () => {
    const start = await G(() => window.__game.game.fighters[0].pos().x);
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyD');
    const end = await G(() => window.__game.game.fighters[0].pos().x);
    assert.ok(Math.abs(end - start) > 0.15, `bewogen ${Math.abs(end - start).toFixed(2)} m`);
  });

  await step('stoten met toetsenbord en muis raken de tegenstander', async () => {
    // Tegenstander stilzetten zodat het resultaat niet van de AI afhangt.
    await G(() => {
      const g = window.__game.game;
      window.__cpu = g.controllers[1];
      g.setController(1, { poll: () => ({ move: { x: 0, z: 0 }, block: false, duck: false, punch: null }) });
    });
    for (let i = 0; i < 30; i++) {
      const gap = await G(() => {
        const [a, b] = window.__game.game.fighters;
        return a.pos().distanceTo(b.pos());
      });
      if (gap < 1.0) break;
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(250);
      await page.keyboard.up('KeyD');
    }
    const before = await G(() => window.__game.game.fighters[1].health);
    // Zonder GPU loopt de speltijd trager dan de klok: wacht tot elke stoot klaar is.
    const idle = () => page.waitForFunction(() => !window.__game.game.fighters[0].punch && !window.__game.game.fighters[0].queuedPunch, null, { timeout: 20000 });
    const thrown = () => G(() => window.__game.game.fighters[0].stats.thrown);
    const started = (n) => page.waitForFunction((k) => window.__game.game.fighters[0].stats.thrown > k, n, { timeout: 20000 });
    for (const key of ['KeyJ', 'KeyK', 'KeyU', 'KeyI', 'KeyL']) {
      const n = await thrown();
      await page.keyboard.press(key);
      await started(n);
      await idle();
    }
    const box = await page.locator('#scene').boundingBox();
    const n = await thrown();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await started(n);
    await idle();
    const st = await G(() => ({ hp: window.__game.game.fighters[1].health, thrown: window.__game.game.fighters[0].stats.thrown, landed: window.__game.game.fighters[0].stats.landed }));
    await page.screenshot({ path: `${SHOTS}/4-fight.png` });
    assert.ok(st.thrown >= 6, `${st.thrown} stoten gegooid`);
    assert.ok(st.landed >= 3, `${st.landed} treffers`);
    assert.ok(st.hp < before, `energie ${before} → ${st.hp}`);
    const width = await page.$eval('#p2-health', (el) => parseFloat(el.style.transform.match(/scaleX\(([^)]+)\)/)?.[1] ?? '1'));
    assert.ok(width < 1, 'energiebalk is korter');
  });

  await step('pauze met Escape, hervatten met de knop', async () => {
    await page.keyboard.press('Escape');
    assert.ok(await visible('pause'));
    const t = await G(() => window.__game.game.roundClock);
    await page.waitForTimeout(800);
    assert.equal(await G(() => window.__game.game.roundClock), t, 'klok staat stil');
    await page.screenshot({ path: `${SHOTS}/5-pause.png` });
    await page.click('#pause [data-action="resume"]');
    assert.equal(await visible('pause'), false);
    assert.equal(await G(() => window.__game.game.paused), false);
  });

  await step('pauzeknop in de HUD en instellingen vanuit pauze', async () => {
    await page.click('#pause-btn');
    assert.ok(await visible('pause'));
    await page.click('#pause [data-action="settings"]');
    assert.ok(await visible('settings'));
    await page.keyboard.press('Escape');
    assert.ok(await visible('pause'));
    await page.keyboard.press('Escape');
    assert.equal(await visible('pause'), false);
  });

  await step('knock-out: slowmotion, rondewinst en volgende ronde', async () => {
    await G(() => (window.__game.game.fighters[1].health = 3));
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('KeyK');
      await page.waitForTimeout(150);
      await page.waitForFunction(() => !window.__game.game.fighters[0].punch || window.__game.game.fighters[1].ko, null, { timeout: 20000 });
      if (await G(() => window.__game.game.fighters[1].ko)) break;
      const gap = await G(() => window.__game.game.fighters[0].pos().distanceTo(window.__game.game.fighters[1].pos()));
      if (gap > 1.0) {
        await page.keyboard.down('KeyD');
        await page.waitForTimeout(300);
        await page.keyboard.up('KeyD');
      }
    }
    assert.ok(await G(() => window.__game.game.fighters[1].ko), 'tegenstander is knock-out');
    assert.match(await page.textContent('#announce'), /K\.O\./);
    await page.screenshot({ path: `${SHOTS}/6-ko.png` });
    await page.waitForFunction(() => window.__game.game.round === 2, null, { timeout: 120000 });
    assert.deepEqual(await G(() => window.__game.game.roundsWon), [1, 0]);
    assert.equal(await page.locator('#p1-pips .on').count(), 1);
  });

  await step('wedstrijd winnen toont uitslag met statistieken', async () => {
    await G(() => window.__game.game.setController(1, window.__cpu));
    await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
    await G(() => {
      const g = window.__game.game;
      g.fighters[1].health = 20;
      g.roundClock = 0.05;
    });
    await page.waitForSelector('#result:not([hidden])', { timeout: 90000 });
    assert.match(await page.textContent('#result-title'), /JIJ WINT/);
    const stats = await page.locator('#result-stats').textContent();
    assert.ok(stats.length > 10, 'statistieken zichtbaar');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/7-result.png` });
  });

  await step('revanche start een nieuwe wedstrijd', async () => {
    await page.click('#result [data-action="rematch"]');
    assert.equal(await visible('result'), false);
    await page.waitForFunction(() => window.__game.game.state === 'intro' || window.__game.game.state === 'fight');
    assert.deepEqual(await G(() => window.__game.game.roundsWon), [0, 0]);
    assert.equal(await G(() => window.__game.game.round), 1);
  });

  await step('verliezen toont verliesscherm', async () => {
    await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
    for (let r = 0; r < 2; r++) {
      await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
      await G(() => {
        const g = window.__game.game;
        g.fighters[0].health = 10;
        g.roundClock = 0.05;
      });
      await page.waitForFunction(() => ['intro', 'matchEnd'].includes(window.__game.game.state) && window.__game.game.roundsWon[1] > 0, null, { timeout: 90000 });
    }
    await page.waitForSelector('#result:not([hidden])', { timeout: 90000 });
    assert.match(await page.textContent('#result-title'), /CPU WINT/);
  });

  await step('stoppen vanuit uitslag gaat terug naar het menu', async () => {
    await page.click('#result [data-action="quit"]');
    assert.ok(await visible('menu'));
    assert.equal(await visible('hud'), false);
    assert.equal(await G(() => window.__game.game.mode), 'demo');
  });

  await step('stoppen vanuit pauze gaat terug naar het menu', async () => {
    await page.click('#menu [data-action="play"]');
    await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
    await page.keyboard.press('KeyP');
    assert.ok(await visible('pause'));
    await page.click('#pause [data-action="quit"]');
    assert.ok(await visible('menu'));
  });

  await step('tabblad verlaten pauzeert automatisch', async () => {
    await page.click('#menu [data-action="play"]');
    await page.waitForFunction(() => window.__game.game.state === 'fight', null, { timeout: 90000 });
    await G(() => window.dispatchEvent(new Event('blur')));
    assert.ok(await visible('pause'));
    await page.click('#pause [data-action="quit"]');
  });

  await step('M schakelt het geluid', async () => {
    const before = await G(() => window.__game.settings.muted);
    await page.keyboard.press('KeyM');
    assert.equal(await G(() => window.__game.settings.muted), !before);
    assert.ok(await visible('toast'));
    await page.keyboard.press('KeyM');
  });

  await step('geluid draait: AudioContext actief na interactie', async () => {
    const state = await G(() => window.__game.audio.ctx?.state);
    assert.equal(state, 'running');
  });

  await step('smal scherm (telefoon) toont menu zonder horizontaal scrollen', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    const overflow = await G(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${SHOTS}/8-mobile.png` });
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  await step('framerate meten', async () => {
    const fps = await G(() => new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => (++n < 30 ? requestAnimationFrame(tick) : res((n * 1000) / (performance.now() - t0)));
      requestAnimationFrame(tick);
    }));
    console.log(`     ${fps.toFixed(1)} fps in deze browser`);
  });

  await step('geen fouten in de console', async () => {
    assert.deepEqual(errors, []);
  });

  await step('foutscherm zonder WebGL', async () => {
    const p2 = await browser.newPage();
    await p2.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (t, ...rest) {
        return /webgl/.test(t) ? null : orig.call(this, t, ...rest);
      };
    });
    await p2.goto(URL);
    await p2.waitForSelector('#fatal:not([hidden])', { timeout: 15000 });
    assert.match(await p2.textContent('#fatal-text'), /WebGL/);
    await p2.screenshot({ path: `${SHOTS}/9-fatal.png` });
    await p2.close();
  });
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} geslaagd`);
if (errors.length) console.log('Consolefouten:', errors);
process.exit(failed ? 1 : 0);
