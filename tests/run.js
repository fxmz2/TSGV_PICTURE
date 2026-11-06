/*
 * Match-Shot – automatische Tests (Playwright / Chromium)
 *
 * Start:  cd tests && npm install && npx playwright install chromium && npm test
 * Optional: HEADED=1 npm test   (Browser sichtbar)
 *
 * Die Tests starten einen kleinen lokalen Webserver auf dem Projektordner, ersetzen
 * vereine.txt durch eine Test-Liste (fixtures/vereine.test.txt) und erzeugen ihre
 * Testbilder selbst – es werden keine echten Spielerfotos benötigt.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_LIST = fs.readFileSync(path.join(__dirname, 'fixtures', 'vereine.test.txt'), 'utf8');
const TMP = path.join(__dirname, '.tmp');
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}/index.html`;

/* ---------- kleiner statischer Webserver ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.tflite': 'application/octet-stream' };
const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, BASE).pathname);
    const file = path.join(ROOT, p === '/' ? 'index.html' : p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
});

/* ---------- Mini-Testrahmen ---------- */
let passed = 0, failed = 0;
function check(name, ok, detail = '') {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? '  → ' + detail : ''}`); }
}
async function section(title, fn) {
    console.log(`\n▶ ${title}`);
    try { await fn(); } catch (e) { failed++; console.log(`  ❌ Abbruch: ${e.message.split('\n')[0]}`); }
}

async function newPage(browser, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
    const page = await ctx.newPage();
    page.errors = [];
    page.external = [];
    page.dialogs = [];
    page.answers = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('request', r => { const u = r.url(); if (!/^(http:\/\/localhost|data:|blob:)/.test(u)) page.external.push(u); });
    page.on('dialog', d => { page.dialogs.push(d.message()); const a = page.answers.length ? page.answers.shift() : true; !a ? d.dismiss() : typeof a === 'string' ? d.accept(a) : d.accept(); });
    await page.route('**/vereine.txt*', r => r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: FIXTURE_LIST }));
    return page;
}
async function waitReady(page) {
    await page.waitForTimeout(800);
    await page.waitForFunction(() => typeof appReady !== 'undefined' && appReady, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    if (await page.isVisible('#wizard-overlay')) await page.click('#wizard-overlay .license-cancel');
}
async function enterCode(page, code) {
    if (!(await page.isVisible('#license-overlay'))) { await page.click('.tab-btn[data-tab="start"]'); await page.click('.club-card-btn'); }
    await page.fill('#license-input', code);
    await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => null), page.click('#license-submit')]);
    await waitReady(page);
}
async function exportSize(page, id) {
    return page.evaluate(async id => { const c = await renderElementToCanvas(document.getElementById(id)); return c.width + 'x' + c.height; }, id);
}

/* Testbilder erzeugen (einfarbige „Porträts“) */
async function makePhotos(browser) {
    fs.mkdirSync(TMP, { recursive: true });
    const page = await browser.newPage();
    const names = ['Max_Muster', 'Max_Muster_TOR', 'Max_Muster_SPEZIAL', 'Tim_Test', 'Ben_Beispiel'];
    for (const [i, n] of names.entries()) {
        await page.setContent(`<div id=p style="width:300px;height:380px;background:hsl(${i * 80},60%,45%);display:flex;align-items:center;justify-content:center;font:bold 60px Arial;color:#fff">${n[0]}${n.includes('TOR') ? '⚽' : ''}</div>`);
        await page.locator('#p').screenshot({ path: path.join(TMP, n + '.png') });
    }
    await page.close();
    return names.map(n => path.join(TMP, n + '.png'));
}

(async () => {
    await new Promise(r => server.listen(PORT, r));
    const browser = await chromium.launch({ headless: !process.env.HEADED });
    const photos = await makePhotos(browser);
    console.log(`Match-Shot-Tests auf ${BASE}`);

    await section('Start, Sicherheit, Demo-Modus', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(800);
        check('Freischalt-Fenster erscheint', await page.isVisible('#license-overlay'));
        check('Landingpage beim ersten Besuch', await page.evaluate(() => $('license-overlay').classList.contains('landing-mode') && document.querySelectorAll('.lp-gallery img').length >= 13 && document.querySelectorAll('.lp-role').length === 2));
        await page.evaluate(() => document.querySelectorAll('#license-overlay img[loading="lazy"]').forEach(i => i.loading = 'eager'));
        await page.waitForTimeout(800);
        check('Landingpage: alle Bilder geladen', await page.evaluate(() => [...document.querySelectorAll('.lp-gallery img, .lp-step img, .lp-role img')].every(i => i.complete && i.naturalWidth > 0)));
        check('Landingpage: Testmonat per E-Mail anfragen', await page.evaluate(() => /^mailto:info@match-shot\.de\?subject=[\s\S]*Testmonat[\s\S]*&body=[\s\S]*Wappen/.test(decodeURIComponent($('lp-buy-btn').href))));
        check('Landingpage: Preise Basis & Advanced', await page.evaluate(() => { const t = $('lp-prices')?.textContent || ''; return document.querySelectorAll('.lp-price').length === 2 && /24,99/.test(t) && /39,99/.test(t) && /14 Vorlagen/.test(document.querySelector('.lp-feats').textContent); }));
        check('Impressum, Datenschutz & AGB ohne Platzhalter, mit neuer Adresse', await page.evaluate(async () => { const pages = await Promise.all(['impressum.html', 'datenschutz.html', 'agb.html'].map(f => fetch(f).then(r => r.text())));
            return pages.every(t => !/class="todo"|\[[A-ZÄÖÜ][^\]]*\]|clubshotinfo|Netlify/.test(t) && t.includes('info@match-shot.de') && t.includes('Schwäbisch Gmünd')); }));
        check('Landingpage: Instagram-Link aktiv', await page.evaluate(() => $('lp-insta-btn').href === 'https://www.instagram.com/match_shot_de/' && !$('lp-insta-btn').hasAttribute('aria-disabled')));
        check('Landingpage ohne seitliches Scrollen', await page.evaluate(() => $('license-overlay').scrollWidth <= $('license-overlay').clientWidth + 1));
        await page.click('#license-demo');
        await waitReady(page);
        await page.reload();
        await waitReady(page);
        check('Nach dem Freischalten keine Landingpage mehr', await page.evaluate(() => $('license-overlay').hidden && !document.documentElement.classList.contains('lp-boot')));
        const counts = await page.evaluate(() => [stammdaten.players.length, stammdaten.opponents.length, stammdaten.sponsors.length]);
        check('Demo füllt Beispieldaten', counts[0] >= 18 && counts[1] >= 6 && counts[2] >= 3, counts.join('/'));
        check('Export Beitrag 4:5 = 1200x1500', (await exportSize(page, 'capture-post-feed')) === '1200x1500');
        // Ein Bild, das nie fertig lädt, darf die Erstellung nicht dauerhaft blockieren
        await page.route('**/haengt.png', () => {});
        const stuck = await page.evaluate(async () => { const img = document.createElement('img'); img.src = 'haengt.png?' + Date.now(); img.className = 'test-stuck';
            $('capture-post-story').appendChild(img); const t0 = performance.now();
            try { const c = await renderElementToCanvas($('capture-post-story')); return { ok: c.width === 1200, s: Math.round((performance.now() - t0) / 1000) }; }
            finally { img.remove(); } });
        const cloned = await page.evaluate(async () => { const tpl = $('capture-post-feed'); const { holder, clone } = await prepareExportClone(tpl);
            try { let n = -1; await html2canvas(clone, { ...captureOptions(clone, 1), onclone: d => { n = d.images.length; } });
                return { kopiert: n, vorlage: clone.querySelectorAll('img').length, app: document.images.length }; } finally { holder.remove(); } });
        check('Erstellung kopiert nur die Vorlage (nicht die ganze App)', cloned.kopiert <= cloned.vorlage && cloned.app > cloned.vorlage * 2, JSON.stringify(cloned));
        check('Hängendes Bild blockiert die Erstellung nicht', stuck.ok && stuck.s < 15, JSON.stringify(stuck));
        check('Export Story = 1200x2133', (await exportSize(page, 'capture-post-story')) === '1200x2133');
        check('Keine Verbindungen zu fremden Servern', page.external.length === 0, page.external.join(', '));
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await section('Lizenzen, Pakete, Daten je Verein', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(600);
        await page.fill('#license-input', 'TEST-OLD1');
        await page.click('#license-submit');
        await page.waitForTimeout(800);
        check('Abgelaufener Code wird abgelehnt', /abgelaufen/i.test(await page.textContent('#license-error')));
        await enterCode(page, 'TEST-BAS1');
        check('Basis-Paket erkannt', /Basis/.test(await page.textContent('#club-card-code')));
        check('Advanced-Reiter gesperrt', (await page.$$eval('.tab-btn.locked', l => l.map(b => b.dataset.tab).sort().join(','))) === 'eckball,neuzugang,sponsor,wochenende');
        await page.click('.tab-btn[data-tab="eckball"]');
        check('Gesperrter Reiter zeigt Hinweis', await page.isVisible('#editor-locked'));
        await page.click('.tab-btn[data-tab="stammdaten"]');
        await page.fill('#new-player-name', 'Nur Basis');
        await page.click('button:has-text("Spieler speichern")');
        await page.waitForTimeout(500);
        page.answers.push(false);   // keine Daten übernehmen
        await enterCode(page, 'TEST-ADV1');
        check('Advanced: keine Sperren', (await page.$$eval('.tab-btn.locked', l => l.length)) === 0);
        check('Neuer Verein startet leer', (await page.evaluate(() => stammdaten.players.length)) === 0);
        await enterCode(page, 'TEST-BAS1');
        check('Daten des ersten Vereins wieder da', (await page.evaluate(() => stammdaten.players.map(p => p.name).join(','))) === 'Nur Basis');
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await section('Spieler, Fotos, Einwilligungen, Zusatzspieler', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(600);
        await enterCode(page, 'TEST-ADV1');
        await page.click('.tab-btn[data-tab="stammdaten"]');
        await page.setInputFiles('#bulk-photo-upload', photos);
        await page.waitForTimeout(2000);
        const p = await page.evaluate(() => { const x = findPlayer('Max Muster'); return x && !!x.img && !!x.torImg; });
        check('Mehrfach-Upload mit Torjubel-Foto', p);
        // Eigener Hintergrund: standardmäßig für Story & Beitrag, Format nachträglich änderbar
        await page.evaluate(() => { $('new-template-img').closest('details').open = true; });
        await page.setInputFiles('#new-template-img', photos[0]);
        await page.waitForFunction(() => stammdaten.templates.length > 0, null, { timeout: 8000 });
        const bg = await page.evaluate(async () => { const t = stammdaten.templates[0], r = { format: t.format };
            renderBgThumbs('post');
            r.grids = ['feed', 'story'].every(f => !!document.querySelector(`#thumb-grid-post-${f} [data-bg="${t.id}"]`));
            selectBg('post', 'feed', t.id); selectBg('post', 'story', t.id);
            r.used = getBgValue('post', 'feed') === t.id && getBgValue('post', 'story') === t.id && $('capture-post-story').style.backgroundImage.includes('blob:');
            await setTemplateFormat(0, 'feed');
            r.feedOnly = getBgValue('post', 'story') === DEFAULT_BG && !document.querySelector(`#thumb-grid-post-story [data-bg="${t.id}"]`) && getBgValue('post', 'feed') === t.id;
            stammdaten.templates = []; await onStammdatenChanged('templates'); selectBg('post', 'feed', DEFAULT_BG); selectBg('post', 'story', DEFAULT_BG);
            return r; });
        check('Hintergrund einmal hochladen → für Story & Beitrag (Format änderbar)', bg.format === 'both' && bg.grids && bg.used && bg.feedOnly, JSON.stringify(bg));
        // Foto-Umschalter
        await page.click('.tab-btn[data-tab="potm"]');
        await page.selectOption('#in-potm-player', 'Max Muster');
        await page.evaluate(() => { setVal('in-photo-type-potm', 'tor'); updateAllViews(); });
        check('Torjubel-Foto umschaltbar', await page.evaluate(() => $('out-potm-img').src === findPlayer('Max Muster').torImg));
        // Spezial-Foto (3. Bild): per Mehrfach-Upload, umschaltbar, ohne Spezial-Foto → normales Foto
        const sp = await page.evaluate(() => { const r = { has: !!findPlayer('Max Muster').specialImg };
            setVal('in-photo-type-potm', 'special'); updateAllViews(); r.shown = $('out-potm-img').src === findPlayer('Max Muster').specialImg;
            setVal('in-potm-player', 'Tim Test'); updatePotm(); r.fallback = $('out-potm-img').src === findPlayer('Tim Test').img;
            setVal('in-photo-type-potm', 'normal'); setVal('in-potm-player', 'Max Muster'); updateAllViews(); return r; });
        check('Spezial-Foto: Upload, Auswahl und Ersatz durch normales Foto', sp.has && sp.shown && sp.fallback, JSON.stringify(sp));
        check('Foto-Fenster mit drei Fotos', await page.evaluate(() => { openPhotoDialog(stammdaten.players.findIndex(x => x.name === 'Max Muster'));
            const n = document.querySelectorAll('#photo-rows .photo-row').length; const ok = !$('photo-overlay').hidden; closePhotoDialog(); return n === 3 && ok; }));
        check('Freistellung je Foto entfernbar (andere bleiben)', await page.evaluate(async () => { const i = stammdaten.players.findIndex(x => x.name === 'Max Muster'), p = stammdaten.players[i];
            p.cutImg = p.img; p.torCutImg = p.torImg; openPhotoDialog(i); const btns = document.querySelectorAll('#photo-rows .sd-btn.active').length;
            await togglePhotoCutout('img'); const r = !p.cutImg && !!p.torCutImg && btns === 2; delete p.torCutImg; closePhotoDialog(); return r; }));
        // Zusatzspieler
        await page.click('.tab-btn[data-tab="post"]');
        await page.evaluate(() => { setVal('in-xp1-post', 'Tim Test'); updateTabDesign('post'); });
        check('Zusatzspieler sichtbar', (await page.$$eval('#capture-post-feed .extra-player', l => l.filter(e => e.style.display !== 'none').length)) === 1);
        // Einwilligungen
        await page.click('.tab-btn[data-tab="stammdaten"]');
        await page.check('#sd-consent-check');
        await page.click('.tab-btn[data-tab="post"]');
        page.answers.push(false);
        page.dialogs.length = 0;
        await page.click('#view-post .download-btn >> nth=0');
        await page.waitForTimeout(500);
        check('Warnung bei fehlender Einwilligung', /Einwilligung/.test(page.dialogs[0] || ''));
        // Leeren
        await page.click('.tab-btn[data-tab="kader"]');
        await page.selectOption('#kader-player-1', 'Max Muster');
        await page.click('button:has-text("Kader leeren")');
        await page.waitForTimeout(300);
        check('Kader leeren', (await page.inputValue('#kader-player-1')) === 'Keiner');
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await section('Design, Ansicht, Sponsoren, Spielplan', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(600);
        await page.click('#license-demo');
        await waitReady(page);
        // Design auf alle Reiter
        await page.evaluate(() => { setVal('in-frame-shape-post', 'shield'); setVal('in-font-title-post', "'Anton', sans-serif"); updateTabDesign('post'); });
        page.answers.push(true, false);
        await page.evaluate(() => applyDesignToAllTabs('post'));
        check('Design auf alle Reiter übertragen', await page.evaluate(() => val('in-frame-shape-kader') === 'shield' && val('in-font-title-kader').includes('Anton')));
        // Ansicht anpassen
        await page.evaluate(() => uiPreset('simple'));
        check('Einfach-Modus blendet Bereiche aus', await page.$eval('#editor-ergebnis [data-section="labels"]', e => e.hidden));
        await page.waitForTimeout(600);
        await page.reload();
        await waitReady(page);
        check('Ansicht bleibt nach Neuladen', await page.$eval('#editor-ergebnis [data-section="labels"]', e => e.hidden));
        await page.evaluate(() => uiPreset('all'));
        // Sponsoren-Raster
        await page.evaluate(() => { selectedSponsors.ergebnis = stammdaten.sponsors.map(s => s.name); $('in-show-sponsors-ergebnis').checked = true; setVal('in-sponsor-layout-ergebnis', 'grid'); renderSelectedSponsors('ergebnis'); });
        check('Sponsoren als Raster', await page.$eval('#capture-ergebnis-feed .sponsor-banner', b => b.classList.contains('sb-grid') && b.style.display === 'grid'));
        // Spielplan-Erkennung
        const games = await page.evaluate(() => parseSchedule('So, 05.10.2099 15:00 SV Demo 1920 - FC Musterstadt\n12.10.2099 14:30 FV Testingen - SV Demo 1920\n19.10.2099 13:00 TSV Demoheim (H)', ['SV Demo 1920']));
        check('Spielplan wird erkannt', games.length === 3 && games[0].venue === 'heim' && games[1].venue === 'auswaerts' && games[1].opp === 'FV Testingen', JSON.stringify(games));
        // Nummern optional
        check('Rückennummern standardmäßig aus', (await page.$$eval('#pitch .player-number-badge', l => l.length)) === 0);
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await section('Verschieben: Sponsoren einzeln, Beitrag+Story, Wappen, Zurücksetzen', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(600);
        await page.click('#license-demo');
        await waitReady(page);
        await page.evaluate(() => switchTab('post'));
        // Sponsorenlogos einzeln verschieben – Position bleibt beim Neuaufbau und nach dem Laden
        await page.evaluate(() => { selectedSponsors.post = stammdaten.sponsors.map(s => s.name); $('in-show-sponsors-post').checked = true; $('in-sponsor-free-post').checked = true; renderSelectedSponsors('post'); });
        const logoId = await page.$eval('#capture-post-feed .sponsor-banner .movable', e => e.id);
        await page.evaluate(id => { setElOffset(document.getElementById(id), 40, -60); setVal('in-sponsor-size-post', '120'); renderSelectedSponsors('post'); }, logoId);
        check('Sponsorenlogo einzeln verschiebbar', await page.evaluate(id => { const o = getElOffset(document.getElementById(id)); return o.x === 40 && o.y === -60; }, logoId));
        await page.evaluate(() => { const d = collectSlotData(); applySlotData(JSON.parse(JSON.stringify(d))); renderAll(); });
        check('Logo-Position nach dem Laden', await page.evaluate(id => getElOffset(document.getElementById(id)).x === 40, logoId));
        // Wappen übereinander mit Abstand
        await page.evaluate(() => { setVal('in-logo-dir-post', 'column'); setVal('in-logo-gap-post', '50'); updateTabDesign('post'); });
        check('Wappen übereinander mit Abstand', await page.$eval('#team-logos-post-container', e => getComputedStyle(e).flexDirection === 'column' && getComputedStyle(e).rowGap === '50px'));
        // Beitrag + Story gemeinsam
        await page.evaluate(() => { prefs.syncFormats = true; selectElement(document.getElementById('team-logos-post-container')); nudgeSelectedScale(0.3); selectElement(null); prefs.syncFormats = false; });
        check('Beitrag & Story gemeinsam skaliert', await page.evaluate(() => getElScale(document.getElementById('team-logos-post-story-container')) === 1.3));
        await page.evaluate(() => { selectElement(document.getElementById('team-logos-post-container')); nudgeSelectedScale(0.2); selectElement(null); });
        check('Ohne 🔗 bleibt die Story unverändert', await page.evaluate(() => getElScale(document.getElementById('team-logos-post-story-container')) === 1.3 && getElScale(document.getElementById('team-logos-post-container')) === 1.5));
        // Gezielt zurücksetzen: nur Wappen im Beitrag
        await page.evaluate(() => setElOffset(document.getElementById('team-logos-post-container'), 900, 0));
        await page.evaluate(() => resetTabDefaults('post'));
        const row = await page.evaluate(() => [...document.querySelectorAll('#reset-list .reset-row')].map(r => r.textContent).find(t => /Wappen/.test(t) && /außerhalb/.test(t)));
        check('Zurücksetzen-Liste zeigt Element außerhalb des Bildes', !!row);
        await page.click('#reset-overlay button:has-text("Auswahl zurücksetzen")');
        check('Nur ausgewähltes Element zurückgesetzt', await page.evaluate(id => getElScale(document.getElementById('team-logos-post-container')) === 1
            && getElOffset(document.getElementById('team-logos-post-container')).x === 0
            && getElScale(document.getElementById('team-logos-post-story-container')) === 1.3
            && getElOffset(document.getElementById(id)).x === 40 && val('in-logo-dir-post') === 'column', logoId));
        // Aufstellung: Spieler verschieben (je Formation), Kapitän, Profi-Look, Spielfeld
        await page.evaluate(() => { switchTab('story'); const n = stammdaten.players.filter(p => p.group !== 'Trainer').map(p => p.name);
            setVal('formation-select', '4-3-3'); for (let i = 1; i <= 11; i++) setVal('player-' + i, n[(i - 1) % n.length]); setVal('in-captain', n[1]); buildFormation(); });
        const pcId = await page.$eval('#pitch .player-card:last-child', e => e.id);
        await page.evaluate(id => { setElOffset(document.getElementById(id), 0, 30); setVal('formation-select', '4-4-2'); buildFormation(); }, pcId);
        check('Neue Formation startet auf Standard', await page.evaluate(() => [...document.querySelectorAll('#pitch .player-card')].every(e => !getElOffset(e).y)));
        await page.evaluate(() => { setVal('formation-select', '4-3-3'); buildFormation(); });
        check('Formation merkt sich verschobene Spieler', await page.evaluate(id => getElOffset(document.getElementById(id)).y === 30, pcId));
        check('Kapitän mit „(C)“ hinter dem Namen', (await page.$$eval('#pitch .player-name', l => l.filter(e => /\(C\)/.test(e.textContent)).length)) === 1);
        await page.evaluate(() => { setVal('in-pitch-namemode-story', 'last'); $('in-lineup-match').checked = true; buildFormation(); });
        check('Nur Nachname auf dem Spielfeld', await page.$$eval('#pitch .player-name', l => l.every(e => !/\S\s+\S/.test(e.textContent.replace(' (C)', '').trim()))));
        check('Gegner & Datum im Kopf', await page.$eval('#lineup-match', e => e.style.display === 'block' && /vs/i.test(e.textContent)));
        await page.evaluate(() => { $('in-lm-names-story').checked = false; $('in-lm-date-story').checked = true; setVal('in-lm-layout-story', 'stack'); buildFormation(); });
        check('Gegner-Kopf: nur Wappen + Datum wählbar', await page.evaluate(() => !document.querySelector('#lm-teams .lm-name') && document.querySelectorAll('#lm-teams .lm-logo').length === 2));
        check('Paarung einzeln verschiebbar', await page.evaluate(() => $('lm-teams').classList.contains('movable') && syncPartners($('lm-teams')).map(e => e.id).join() === 'lm-teams-feed'));
        await page.evaluate(() => { setVal('in-color-text-story', '#111111'); setVal('in-box-mode-story', 'custom'); setVal('in-box-color-story', '#ffffff'); setVal('in-box-opacity-story', '80'); updateTabDesign('story'); });
        check('Schriftfarbe gilt auch für die Datumszeile', await page.$eval('#lm-date', e => getComputedStyle(e).color === 'rgb(17, 17, 17)'));
        check('Kästen-Farbe gilt für Namensschilder', await page.$eval('#pitch .player-name', e => getComputedStyle(e).backgroundColor === 'rgba(255, 255, 255, 0.8)'));
        await page.evaluate(() => { setVal('in-pitch-namemode-story', 'stack'); buildFormation(); });
        check('Spielernamen untereinander', await page.$eval('#pitch .player-name', e => e.innerHTML.includes('<br>')));
        check('Neue Schriften in der Auswahl', await page.evaluate(() => ['Big Shoulders', 'Rubik Dirt'].every(f => [...$('in-font-story').options].some(o => o.value.includes(f)))));
        check('Titel standardmäßig „Startaufstellung“', /startaufstellung/i.test(await page.textContent('#out-story-title')));
        await page.evaluate(() => { setVal('in-player-style-story', 'pro'); setVal('in-field-style-story', 'grass'); setVal('in-field-view-story', 'persp'); $('in-pitch-bench-story').checked = true; buildFormation(); });
        check('Profi-Look mit gezeichnetem Spielfeld', await page.evaluate(() => $('pitch').classList.contains('pc-pro') && !!document.querySelector('#pitch .field-img') && $('pitch-bench').style.display === 'flex'));
        check('Export Aufstellung mit Spielfeld', (await exportSize(page, 'capture-story')) === '1200x2133');

        // Spielervorstellung: Position & Mannschaft optional
        await page.evaluate(() => { switchTab('neuzugang'); const pl = stammdaten.players.find(x => x.position && x.team); setVal('in-new-player', pl.name); setVal('in-new-mode', 'vorstellung'); $('in-new-show-position').checked = false; $('in-new-show-team').checked = false; updateNeuzugang(); });
        await page.evaluate(() => { setVal('in-new-namefmt', 'stack'); updateNeuzugang(); });
        check('Neuzugang: Name untereinander', await page.$eval('#out-new-name', e => e.innerHTML.includes('<br>')));
        // Spitzname & Namensformat
        const nickInfo = await page.evaluate(() => { const pl = stammdaten.players.find(x => x.name === val('in-new-player')); pl.nick = 'Testi'; setVal('in-new-namefmt', 'nick'); updateNeuzugang();
            const a = $('out-new-name').textContent; setVal('in-new-namefmt', 'last'); updateNeuzugang(); const b = $('out-new-name').textContent; delete pl.nick; setVal('in-new-namefmt', 'nick'); updateNeuzugang();
            return { a, b, c: $('out-new-name').textContent, last: pl.name.split(' ').slice(1).join(' ') }; });
        check('Spitzname als Name', nickInfo.a === 'Testi', JSON.stringify(nickInfo));
        check('Nur Nachname', nickInfo.b === nickInfo.last, JSON.stringify(nickInfo));
        check('Ohne Spitzname → Nachname', nickInfo.c === nickInfo.last, JSON.stringify(nickInfo));
        check('Namensformat wird gespeichert', await page.evaluate(() => { const d = collectSlotData(); setVal('in-new-namefmt', 'full'); applySlotData(d); return val('in-new-namefmt') === 'nick'; }));
        check('Alte Stände (untereinander) werden übernommen', await page.evaluate(() => { const d = collectSlotData(); delete d.newNameFmt; d.newNameStack = true; applySlotData(d); const ok = val('in-new-namefmt') === 'stack'; setVal('in-new-namefmt', 'full'); updateNeuzugang(); return ok; }));
        check('Spielervorstellung ohne Position & Mannschaft', await page.$eval('#out-new-chips', e => e.style.display === 'none'));
        // Kästen abschaltbar
        await page.evaluate(() => { setVal('in-box-mode-neuzugang', 'none'); updateTabDesign('neuzugang'); });
        check('Ohne Kästen hinter der Schrift', await page.$eval('#out-new-name', e => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'));
        await page.evaluate(() => { $('in-accent-line-neuzugang').checked = false; updateTabDesign('neuzugang'); });
        check('Akzent-Linie unter dem Namen abschaltbar', await page.$eval('#out-new-name', e => getComputedStyle(e).borderBottomStyle === 'none'));
        // Textausrichtung: Reiter + einzelner Text
        await page.evaluate(() => { setVal('in-text-align-neuzugang', 'left'); updateTabDesign('neuzugang'); });
        check('Texte linksbündig (Reiter)', await page.$eval('#out-new-title', e => getComputedStyle(e).textAlign === 'left'));
        await page.evaluate(() => { const t = $('out-new-text').closest('.draggable-text'); selectElement(t); cycleAlignSelected(); cycleAlignSelected(); selectElement(null); });
        check('Einzelner Text rechtsbündig', await page.$eval('#out-new-text', e => getComputedStyle(e).textAlign === 'right'));
        await page.evaluate(() => { setVal('in-text-align-neuzugang', 'center'); updateTabDesign('neuzugang'); });
        // Für mehrere Spieler auf einmal (Bilder)
        await page.evaluate(() => { openBulkDialog(); [...document.querySelectorAll('#bulk-list input[data-bulk-player]')].forEach((cb, i) => cb.checked = i < 2);
            document.querySelector('[data-bulk-fmt="feed"]').checked = false; });
        await page.click('#bulk-run');
        await page.waitForFunction(() => !$('bulk-result').hidden || /Fehler/.test($('bulk-progress').textContent), null, { timeout: 60000 });
        check('Massenerstellung: 2 Spieler → 2 Story-Bilder', await page.evaluate(() => packFiles.length === 2 && packFiles[0].name !== packFiles[1].name));
        await page.evaluate(() => closeBulkDialog());
        // Design-Stile
        await page.evaluate(() => { switchTab('post'); applyStyle('post', 'retro'); });
        check('Design-Stil „Retro“ wirkt', await page.evaluate(() => val('in-frame-shape-post') === 'square' && val('in-box-mode-post') === 'custom'));
        page.answers.push('Test-Stil');
        await page.evaluate(() => saveCurrentStyle('post'));
        await page.waitForTimeout(300);
        check('Eigener Stil gespeichert', await page.evaluate(() => (stammdaten.designStyles || []).some(x => x.name === 'Test-Stil')));
        // Video: Ebenen für die Animation
        const layers = await page.evaluate(async () => { const r = await renderVideoLayers($('capture-ergebnis')); return { n: r.layers.length, w: r.base.width }; });
        check('Video: Ebenen werden erzeugt', layers.n >= 4 && layers.w === 1080, JSON.stringify(layers));
        // Verschobene Spieler: Name darf im Video nicht abgeschnitten werden (letztes Bild = Foto)
        const vcut = await page.evaluate(async () => {
            switchTab('story'); buildFormation(); const cards = [...document.querySelectorAll('#pitch .player-card')];
            setElOffset(cards[0], 0, 75); setElOffset(cards[cards.length - 1], 10, 70);
            const tpl = $('capture-story'); const { base, layers } = await renderVideoLayers(tpl);
            const comp = document.createElement('canvas'); comp.width = base.width; comp.height = base.height; const g = comp.getContext('2d');
            g.drawImage(base, 0, 0); layers.forEach(L => g.drawImage(L.canvas, L.x, L.y));
            const { holder, clone } = await prepareExportClone(tpl); let full; try { full = await html2canvas(clone, captureOptions(clone, VIDEO_SCALE)); } finally { holder.remove(); }
            const a = g.getImageData(0, 0, comp.width, comp.height).data, f = full.getContext('2d').getImageData(0, 0, full.width, full.height).data;
            let bad = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - f[i]) + Math.abs(a[i + 1] - f[i + 1]) + Math.abs(a[i + 2] - f[i + 2]) > 60) bad++;
            resetPlayerPositions(); return bad; });
        check('Video: verschobene Spieler werden nicht abgeschnitten', vcut === 0, vcut + ' abweichende Bildpunkte');
        const vo = await page.evaluate(() => { const def = videoOptions('ergebnis'); setVal('in-vid-speed-ergebnis', 'xslow'); setVal('in-vid-gap-ergebnis', 'long'); setVal('in-vid-dist-ergebnis', 'far');
            const slow = videoOptions('ergebnis'); const saved = collectSlotData().tabSettings.ergebnis;
            ['speed', 'gap', 'dist'].forEach(k => setVal(`in-vid-${k}-ergebnis`, k === 'dist' ? 'short' : 'normal'));
            return { def: def.dur, slow: slow.dur, gap: slow.gap[0], dist: slow.dist, saved: saved.vidSpeed + '/' + saved.vidGap + '/' + saved.vidDist }; });
        check('Video: Tempo, Abstand und Einflug-Weg einstellbar', vo.def === 0.6 && vo.slow === 1.5 && vo.gap === 0.75 && vo.dist === 6 && vo.saved === 'xslow/long/far', JSON.stringify(vo));
        // Video: eigene Reihenfolge der Elemente (Liste mit Ziehen / ▲▼, wird gespeichert und beim Video genutzt)
        const vord = await page.evaluate(async () => { switchTab('post'); delete vidOrder['capture-post-feed'];
            const nat = await vidUnitsFor('capture-post-feed'); const r = { n: nat.length };
            await openVidOrder('post'); r.list = document.querySelectorAll('#vo-list .vo-item').length === nat.length && !$('vidorder-overlay').hidden;
            const last = voState.items[voState.items.length - 1].key;
            for (let i = voState.items.length - 1; i > 0; i--) moveVidOrder(i, -1);
            r.first = voState.items[0].key === last;
            r.used = (await vidUnitsFor('capture-post-feed'))[0].key === last;
            r.saved = collectSlotData().vidOrder['capture-post-feed'][0] === last;
            await resetVidOrder(); r.reset = !vidOrder['capture-post-feed'] && voState.items[0].key === nat[0].key;
            closeVidOrder(); return r; });
        check('Video: Reihenfolge der Elemente einstellbar', vord.n >= 3 && vord.list && vord.first && vord.used && vord.saved && vord.reset, JSON.stringify(vord));
        await page.evaluate(() => openVidOrder('post')); await page.waitForFunction(() => document.querySelectorAll('#vo-list .vo-handle').length >= 3);
        const vh = await page.$$('#vo-list .vo-handle'), va = await vh[vh.length - 1].boundingBox(), vb = await vh[0].boundingBox();
        const vlast = await page.evaluate(() => voState.items[voState.items.length - 1].key);
        await page.mouse.move(va.x + va.width / 2, va.y + va.height / 2); await page.mouse.down(); await page.mouse.move(vb.x + vb.width / 2, vb.y + 2, { steps: 8 }); await page.mouse.up();
        check('Video-Reihenfolge per Ziehen', await page.evaluate(k => { const ok = voState.items[0].key === k && vidOrder['capture-post-feed'][0] === k; delete vidOrder['capture-post-feed']; closeVidOrder(); return ok; }, vlast));
        const vsp = await page.evaluate(() => { switchTab('post'); const c = $('team-logos-post-container'), r = {};
            r.def = val('in-vs-pos-post'); const dir = val('in-logo-dir-post'); setVal('in-logo-dir-post', 'row');
            ['top', 'center', 'bottom'].forEach(p => { setVal('in-vs-pos-post', p); updateTabDesign('post'); const a = c.querySelector('.logos-vs').getBoundingClientRect(), b = c.querySelector('.logo').getBoundingClientRect();
                r[p] = Math.round((a.top + a.height / 2 - b.top) / b.height * 100); });
            setVal('in-vs-size-post', '200'); updateTabDesign('post'); r.big = parseFloat(getComputedStyle(c.querySelector('.logos-vs')).fontSize) > parseFloat(getComputedStyle(c).fontSize) * 1.8;
            setVal('in-vs-size-post', '100'); setVal('in-vs-pos-post', 'center'); setVal('in-logo-dir-post', dir); updateTabDesign('post'); return r; });
        check('„VS“ bei der Ankündigung: Position oben/mittig/unten und Größe', vsp.def === 'center' && vsp.top < 25 && Math.abs(vsp.center - 50) <= 8 && vsp.bottom > 75 && vsp.big, JSON.stringify(vsp));
        // Ankündigung: Titel automatisch nach Spielort, Datum per Kalender, Spielstand als Zahlen
        const pk = await page.evaluate(() => { switchTab('post'); const r = {};
            setVal('in-post-title-mode', 'auto'); setVal('in-post-venue', 'auswaerts'); updatePostFields(); r.away = $('out-post-title').textContent === 'AUSWÄRTSSPIEL' && $('in-post-title').disabled;
            setVal('in-post-venue', 'heim'); updatePostFields(); r.home = $('out-post-title').textContent === 'HEIMSPIEL';
            setVal('in-post-title-mode', 'custom'); setVal('in-post-title', 'DERBY'); updatePostFields(); r.custom = $('out-post-title').textContent === 'DERBY';
            const d = collectSlotData(); delete d.postTitleMode; applySlotData(d); r.migr = val('in-post-title-mode') === 'custom';
            setVal('in-post-title-mode', 'auto'); updatePostFields();
            const db = $('in-post-date').previousElementSibling; db.querySelector('.dp-d').value = '2026-11-07'; db.querySelector('.dp-f').value = 'short';
            db.querySelector('.dp-f').dispatchEvent(new Event('change', { bubbles: true })); r.date = val('in-post-date');
            setVal('in-post-date', 'Samstag, 14.11.'); r.parsed = new Date(db.querySelector('.dp-d').value).getDay() === 6 && db.querySelector('.dp-f').value === 'long';
            const tb = $('in-tor-score').nextElementSibling; tb.querySelector('.sp-a').value = '2'; tb.querySelector('.sp-a').dispatchEvent(new Event('input', { bubbles: true }));
            tb.querySelector('.sp-b').value = '1'; tb.querySelector('.sp-b').dispatchEvent(new Event('input', { bubbles: true })); r.score = val('in-tor-score');
            setVal('wk-score-1', 'abgesagt'); r.free = $('wk-score-1').nextElementSibling.hidden && $('wk-score-1').style.display !== 'none'; setVal('wk-score-1', '');
            setErgMode('absage'); r.forced = $('in-ergebnis-score').nextElementSibling.hidden; setErgMode('ergebnis'); r.back = !$('in-ergebnis-score').nextElementSibling.hidden;
            return r; });
        check('Ankündigung: Titel automatisch/eigener, Datum aus Kalender, Spielstand als Zahlen', pk.away && pk.home && pk.custom && pk.migr && pk.date === 'Sa, 07.11.' && pk.parsed && pk.score === '2 : 1' && pk.free && pk.forced && pk.back, JSON.stringify(pk));
        check('Wochenende: lange Vereinsnamen werden verkleinert statt abgeschnitten', await page.evaluate(() => { switchTab('wochenende');
            stammdaten.opponents.push({ name: 'SpVgg Vorlagendorfhausen-Musterberg' }); refreshOpponentDropdown(); setVal('wk-team-1', 'A-Jugend'); setVal('wk-opp-1', 'SpVgg Vorlagendorfhausen-Musterberg'); setVal('wk-score-1', '0:1'); updateWochenende();
            const els = [...document.querySelectorAll('#view-wochenende .fit-text')].filter(e => e.clientWidth); const ok = els.length > 0 && els.every(e => e.scrollWidth <= e.clientWidth + 1);
            stammdaten.opponents.pop(); refreshOpponentDropdown(); setVal('wk-team-1', ''); setVal('wk-opp-1', ''); setVal('wk-score-1', ''); updateWochenende(); return ok; }));
        // Wochenende als Vorschau: Spiele aller Versionen aus den Ankündigungen übernehmen, danach auf Ergebnisse umschalten
        const wkp = await page.evaluate(async () => { const r = {}, O = stammdaten.opponents.map(o => o.name); switchTab('wochenende');
            const keepPost = [val('in-post-opponent-select'), val('in-post-venue'), val('in-post-date'), val('in-post-time')], keepV2 = await localforage.getItem(STORE.slot('v2'));
            setVal('in-post-opponent-select', O[0]); setVal('in-post-venue', 'heim'); setVal('in-post-date', 'Sonntag, 08.11.'); setVal('in-post-time', '15:00 Uhr');
            const d2 = collectSlotData(); d2.opponentSelect = O[1]; d2.venue = 'auswaerts'; d2.postDate = 'Samstag, 07.11.'; d2.postTime = '13:30 Uhr';
            await localforage.setItem(STORE.slot('v2'), d2); setVal('wk-score-1', '9:9');
            await importWeekendFromVersions();
            const rows = readWeekendRows();
            r.import = wkMode() === 'vorschau' && rows.length >= 2 && rows[0].opp === O[0] && rows[0].time === '15:00' && /-11-08$/.test(rows[0].date) && rows[1].venue === 'auswaerts' && rows[1].time === '13:30' && rows[0].score === '';
            const when = [...document.querySelectorAll('#out-wk-list-feed .wk-when')].map(e => e.textContent);
            r.view = val('in-wk-title') === 'SPIELTAG' && when[0] === 'So 08.11.15:00' && !document.querySelector('#out-wk-list-feed .wk-score');
            r.caption = /gegen .* · So 08\.11\. · 15:00 Uhr/.test(buildCaption('wochenende')) && /bei /.test(buildCaption('wochenende'));
            const d = collectSlotData(); r.saved = d.inputs['in-wk-mode'] === 'vorschau' && d.inputs['wk-time-2'] === '13:30';
            setWkMode('ergebnis'); setVal('wk-score-1', '2:1'); updateWochenende();
            r.results = val('in-wk-title') === 'ERGEBNISSE' && readWeekendRows()[0].opp === O[0] && !!document.querySelector('#out-wk-list-feed .wk-score.win') && !document.querySelector('#out-wk-list-feed .wk-when');
            const old = JSON.parse(JSON.stringify(collectSlotData())); delete old.inputs['in-wk-mode']; for (let i = 1; i <= WK_MAX; i++) { delete old.inputs[`wk-date-${i}`]; delete old.inputs[`wk-time-${i}`]; }
            setWkMode('vorschau'); applySlotData(old); updateWochenende(); r.old = wkMode() === 'ergebnis' && val('wk-time-1') === '';
            for (let i = 1; i <= WK_MAX; i++) clearWeekendRow(i);
            [['in-post-opponent-select', 0], ['in-post-venue', 1], ['in-post-date', 2], ['in-post-time', 3]].forEach(([id, k]) => setVal(id, keepPost[k]));
            if (keepV2) await localforage.setItem(STORE.slot('v2'), keepV2); else await localforage.removeItem(STORE.slot('v2'));
            updateAllViews(); return r; });
        check('Wochenende-Vorschau: Spiele aller Versionen aus den Ankündigungen (Tag, Anstoß, Heim/Auswärts), Bildtext', wkp.import && wkp.view && wkp.caption, JSON.stringify(wkp));
        check('Wochenende: Vorschau gespeichert, Umschalten auf Ergebnisse behält Spiele, alte Stände = Ergebnisse', wkp.saved && wkp.results && wkp.old, JSON.stringify(wkp));
        // Farben & Schrift: Hinweise „wirkt auf“, Zeigen, und umgekehrt vom Element zur Einstellung
        const roles = await page.evaluate(async () => { switchTab('post'); const host = $('design-controls-post'), r = {};
            host.querySelector('details[data-section="colors"]').open = true; renderRoleHints('post');
            r.title = /HEIMSPIEL|AUSWÄRTS|DERBY/i.test(host.querySelector('.role-hint[data-role="title"]').textContent);
            r.unusedBox = host.querySelector('[data-role-ctl="boxbg"]').classList.contains('role-unused');
            r.frame = /Wappen/.test(host.querySelector('.role-hint[data-role="frame"]').textContent);
            r.targets = roleTargets('post', DESIGN_ROLES.find(x => x.key === 'title')).some(el => el.id === 'out-post-title');
            r.restored = getComputedStyle($('out-post-title')).color !== 'rgb(255, 0, 255)';
            selectElement($('txt-post-title')); showElementRoles(); r.pop = !$('role-pop').hidden && /Überschriften|Schriftfarbe/.test($('role-pop').textContent);
            jumpToRole('post', 'text'); r.jump = $('role-pop').hidden && !selectedEl && host.querySelector('details[data-section="colors"]').open;
            return r; });
        check('Farben & Schrift: „wirkt auf“, nicht genutzte ausgegraut, vom Element zur Einstellung', Object.values(roles).every(Boolean), JSON.stringify(roles));
        // Uhrzeit als Stunde/Minute + „Uhr“ statt Freitext
        const tp = await page.evaluate(() => { switchTab('post'); const src = $('in-post-time'), box = src.nextElementSibling, r = {};
            const h = box.querySelector('.tp-h'), m = box.querySelector('.tp-m'), u = box.querySelector('.tp-u');
            h.value = '9'; h.dispatchEvent(new Event('input', { bubbles: true })); m.value = '5'; m.dispatchEvent(new Event('input', { bubbles: true }));
            r.a = src.value; u.checked = false; u.dispatchEvent(new Event('change', { bubbles: true })); r.b = src.value;
            setVal('in-post-time', '18:30 Uhr'); r.c = [h.value, m.value, u.checked].join('/'); updatePostFields(); r.out = $('out-post-time').textContent;
            setVal('in-kader-meeting', '13:45 Uhr am Sportplatz'); const kb = $('in-kader-meeting').nextElementSibling; r.k = [kb.querySelector('.tp-h').value, kb.querySelector('.tp-x').value].join('/');
            return r; });
        check('Uhrzeit mit zwei Kästchen und „Uhr“ an/aus', tp.a === '9:05 Uhr' && tp.b === '9:05' && tp.c === '18/30/true' && tp.out === '18:30 Uhr' && tp.k === '13/am Sportplatz', JSON.stringify(tp));
        check('Video-Knöpfe an den Vorlagen', (await page.$$eval('.video-btn', l => l.length)) >= 20);
        // Import: Auswahl-Dialog und Zusammenführen
        const backup = await page.evaluate(async () => await (await buildBackup()).blob.text());
        fs.mkdirSync(TMP, { recursive: true });
        fs.writeFileSync(path.join(TMP, 'backup.json'), backup);
        await page.evaluate(async () => { stammdaten.players.push({ name: 'Nur Lokal', group: 'Spieler' }); await saveStammdaten(); });
        await page.setInputFiles('#json-import-input', path.join(TMP, 'backup.json'));
        await page.waitForTimeout(500);
        check('Import zeigt Auswahl', await page.evaluate(() => !$('import-overlay').hidden));
        await page.evaluate(() => document.querySelectorAll('#import-list input').forEach(cb => cb.checked = cb.dataset.imp === 'players'));
        await page.click('#import-overlay button:has-text("Importieren")');
        await page.waitForTimeout(800);
        check('Zusammenführen behält lokale Spieler', await page.evaluate(() => !!findPlayer('Nur Lokal')));

        // 7er / 9er
        const small = await page.evaluate(() => { switchTab('story'); setTeamSize('7'); const r = { f: val('formation-select'), cards: document.querySelectorAll('#pitch .player-card').length };
            const d = collectSlotData(); setTeamSize('11'); applySlotData(d); buildFormation(); r.restored = val('formation-select') + '/' + val('in-team-size'); setTeamSize('11'); return r; });
        check('7er-Aufstellung mit 7 Spielern', small.cards === 7 && small.f === '2-3-1', JSON.stringify(small));
        check('Spielform wird gespeichert', small.restored === '2-3-1/7', small.restored);
        // Präsentiert von
        // Design neu geordnet + ✨ Extras (Kästen, Überschriften, Riesen-Text, Hintergrund-Ebenen, neue Stile)
        const ex = await page.evaluate(async () => { const r = {}, host = $('design-controls-tor'), sec = k => host.querySelector(`details[data-section="${k}"]`);
            const order = [...host.querySelectorAll('details[data-section]')].map(d => d.dataset.section);
            r.order = ['styles', 'colors', 'boxes', 'design', 'logo', 'extras'].every((k, i, a) => !i || order.indexOf(k) > order.indexOf(a[i - 1]));
            r.moved = !sec('colors').querySelector('#in-text-effect-tor') && !!sec('extras').querySelector('#in-text-effect-tor') && !!sec('boxes').querySelector('#in-box-mode-tor') && !!sec('boxes').querySelector('#in-frame-shape-tor')
                && !!$('design-controls-post').querySelector('details[data-section="logo"] #in-logo-size-post');
            switchTab('tor'); setVal('in-tor-minute', '67. Min');
            setVal('in-box-fill-tor', 'stripes'); setVal('in-box-edge-tor', 'neon'); setVal('in-title-style-tor', 'outline'); setVal('in-title-rot-tor', 'vl');
            setVal('in-big-mode-tor', 'auto'); setVal('in-ov-grad-tor', 'bottom'); setVal('in-ov-pattern-tor', 'halftone'); updateAllViews();
            const v = $('view-tor'), big = $('bigtxt-capture-tor');
            r.box = v.classList.contains('bx-img') && /svg/.test(v.style.getPropertyValue('--box-img')) && v.classList.contains('bx-edge-neon');
            r.title = v.classList.contains('tt-outline') && v.classList.contains('tt-vert-l') && getComputedStyle(document.querySelector('#capture-tor .title-dyn')).color === 'rgba(0, 0, 0, 0)';
            r.big = big.style.display !== 'none' && big.textContent === "67'";
            r.ov = document.querySelector('#capture-tor .bg-ov').classList.contains('on') && document.querySelectorAll('#capture-tor .bg-ov > div').length === 2;
            r.badge = $('ex-count-tor').textContent.includes('aktiv') && !$('ex-count-tor').hidden;
            r.export = (await renderElementToCanvas($('capture-tor'))).width === 1200;
            const d = collectSlotData(); r.saved = d.tabSettings.tor.boxFill === 'stripes' && d.tabSettings.tor.bigMode === 'auto';
            const old = JSON.parse(JSON.stringify(d)); ['boxFill', 'boxEdge', 'titleStyle', 'titleRot', 'bigMode', 'ovGrad', 'ovPattern'].forEach(k => delete old.tabSettings.tor[k]);
            applySlotData(old); updateAllViews(); r.old = val('in-box-fill-tor') === 'solid' && !v.classList.contains('bx-img') && $('bigtxt-capture-tor').style.display === 'none';
            applyStyle('tor', 'neonnacht'); r.style = val('in-box-edge-tor') === 'neon' && val('in-ov-grad-tor') === 'vignette';
            applyStyle('tor', 'klassisch'); r.styleReset = val('in-box-edge-tor') === 'none' && val('in-ov-grad-tor') === 'none';
            setVal('in-box-shadow-tor', 'hard'); resetExtras('tor'); r.reset = val('in-box-shadow-tor') === 'none' && $('ex-count-tor').hidden;
            setVal('in-tor-minute', ''); updateAllViews();
            // *Wort* = Akzentfarbe, Beitragstext ohne Sternchen
            switchTab('sponsor'); const keepT = val('in-spon-title'); setVal('in-spon-title', '*DANKE* Partner'); updateSponsorPost();
            r.hl = !!document.querySelector('#out-spon-title .hl') && $('out-spon-title').textContent === 'DANKE Partner' && !buildCaption('sponsor').includes('*');
            setVal('in-spon-title', keepT); updateSponsorPost();
            return r; });
        check('Design-Bereiche neu geordnet (Kästen & Rahmen, Hintergrund, Wappen beim Logo, Extras)', ex.order && ex.moved, JSON.stringify(ex));
        check('Extras: Kasten-Muster/Neon, Umriss- und Hochkant-Titel, Riesen-Text, Hintergrund-Ebenen, Export', ex.box && ex.title && ex.big && ex.ov && ex.badge && ex.export, JSON.stringify(ex));
        check('Extras: gespeichert, alte Stände unverändert, Stile setzen/entfernen Extras, Zurücksetzen', ex.saved && ex.old && ex.style && ex.styleReset && ex.reset, JSON.stringify(ex));
        check('*Wort* erscheint in Akzentfarbe, Beitragstext ohne Sternchen', ex.hl, JSON.stringify(ex));
        // 🧩 Layouts (alle Pakete): Elemente neu anordnen, Zurücksetzen führt zum Layout, gespeichert, alte Stände = Klassisch
        const lay = await page.evaluate(async () => { const r = {};
            switchTab('tor'); applyLayout('tor', 'poster');
            const ph = $('img-tor-player-feed'), tpl = $('capture-tor-feed');
            r.applied = $('view-tor').classList.contains('lay-tor-poster') && ph.style.top === Math.round(30 * tpl.querySelector('.tpl-content').offsetHeight / 500) + 'px' && document.querySelector('#layout-grid-tor [data-layout="poster"]').classList.contains('active');
            ph.style.top = '5px'; resetTabAll('tor'); r.reset = ph.style.top === ph.getAttribute('data-default-top') && ph.getAttribute('data-default-top') !== '200px';
            r.export = (await renderElementToCanvas($('capture-tor'))).width === 1200;
            r.saved = collectSlotData().tabSettings.tor.layout === 'poster';
            switchTab('post'); applyLayout('post', 'player'); r.player = val('in-logo-dir-post') === 'column' && parseFloat($('team-logos-post-container').dataset.x) < 0;
            applyLayout('post', 'classic'); r.back = val('in-logo-dir-post') === 'row' && !parseFloat($('team-logos-post-container').dataset.x || 0) && !$('view-post').classList.contains('lay-post-player');
            switchTab('ergebnis'); applyLayout('ergebnis', 'scoreboard'); r.board = $('view-ergebnis').classList.contains('lay-ergebnis-scoreboard') && val('in-logo-gap-ergebnis') === '65';
            applyLayout('ergebnis', 'classic');
            const old = JSON.parse(JSON.stringify(collectSlotData())); delete old.tabSettings.tor.layout;
            applySlotData(old); updateTabDesign('tor'); r.old = val('in-layout-tor') === 'classic' && !$('view-tor').classList.contains('lay-tor-poster');
            applyLayout('tor', 'classic'); return r; });
        check('Layouts: Tor-Plakat, Ankündigung mit Spieler, Ergebnis-Anzeigetafel; Zurücksetzen zum Layout; Export', lay.applied && lay.reset && lay.export && lay.player && lay.back && lay.board, JSON.stringify(lay));
        check('Layouts: gespeichert, alte Stände klassisch', lay.saved && lay.old, JSON.stringify(lay));
        // Foto-Effekte + Sticker (✨ Extras)
        const fx = await page.evaluate(async () => { const r = {}; switchTab('potm');
            const img = $('out-potm-img'), before = img.getAttribute('src');
            setVal('in-photo-fx-potm', 'outline-w'); updateAllViews(); await new Promise(res => setTimeout(res, 1200));
            r.fx = img.getAttribute('src') !== before && /^data:image\/(webp|png)/.test(img.getAttribute('src')) && img.dataset.fxSrc === before;
            updatePotm(); afterViewsUpdated(); await new Promise(res => setTimeout(res, 400)); r.stays = img.getAttribute('src') !== before;
            setVal('in-photo-fx-potm', 'none'); updateAllViews(); r.off = img.getAttribute('src') === before;
            customTexts.potm = (customTexts.potm || []).filter(c => c.type !== 'sticker');
            addSticker('potm', 'blitz'); addSticker('potm', 'stern');
            const st = document.querySelectorAll('#capture-potm .sticker-el');
            r.sticker = st.length === 2 && st[0].style.left !== st[1].style.left && !!st[0].querySelector('img.ct-sticker') && document.querySelectorAll('#st-list-potm .st-item').length === 2 && $('ct-count-potm').textContent === '0';
            const it = document.querySelector('#st-list-potm .st-item select[data-field="colorMode"]'); it.value = 'white'; it.dispatchEvent(new Event('change', { bubbles: true }));
            r.color = decodeURIComponent(document.querySelector('#capture-potm .ct-sticker').src).includes('#ffffff');
            r.saved = (collectSlotData().customTexts.potm || []).filter(c => c.type === 'sticker').length === 2;
            updateTabDesign('potm'); r.badge = /2 aktiv/.test($('ex-count-potm').textContent);
            r.export = (await renderElementToCanvas($('capture-potm'))).width === 1200;
            customTexts.potm = customTexts.potm.filter(c => c.type !== 'sticker'); renderCustomTextEditors('potm'); renderCustomTextElements('potm'); updateTabDesign('potm');
            return r; });
        check('Foto-Effekte (Sticker-Rand, bleibt nach Aktualisieren, abschaltbar)', fx.fx && fx.stays && fx.off, JSON.stringify(fx));
        check('Sticker: einfügen (versetzt), Farbe, gespeichert, Zähler, Export', fx.sticker && fx.color && fx.saved && fx.badge && fx.export, JSON.stringify(fx));
        // Werkzeuge (⋯ Mehr: Drehen, genaue Werte), Einrasten an anderen Elementen, Reel-Einflug-Arten
        const tools = await page.evaluate(async () => { const r = {}; switchTab('ergebnis');
            const el = $('out-ergebnis-score'); selectElement(el); toggleElMore(true);
            r.panel = !$('el-more').hidden && $('em-scale').value === String(Math.round(getElScale(el) * 100));
            rotateSelected(5); rotateSelected(5); r.rot = el.dataset.rot === '10' && el.style.getPropertyValue('--el-rot') === '10deg';
            setSelectedExact('y', 150); r.exact = el.style.top === '150px';
            const d = collectSlotData(); r.saved = d.positions['out-ergebnis-score']?.rot === 10;
            setElRot(el, 0); applySlotData(d); r.loaded = $('out-ergebnis-score').dataset.rot === '10';
            resetElement($('out-ergebnis-score')); r.reset = !$('out-ergebnis-score').dataset.rot;
            selectElement(null); r.closed = $('el-more').hidden;
            // Einrasten: Text nahe an der linken Kante eines anderen Elements
            const t = $('out-ergebnis-text').closest('.draggable-text'), tpl = $('capture-ergebnis');
            const sc = $('out-erg-scorers-wrap'); const box = sc.querySelector('.scorer-box').getBoundingClientRect(), tr = tpl.getBoundingClientRect(), k = tr.width / tpl.offsetWidth;
            const keep = [t.style.left]; const tb = contentRect(t); t.style.left = ((parseFloat(t.style.left) || 0) + (box.left - tb.left) / k + 3) + 'px';
            const info = snapInfo(t); r.snap = !!info && info.gx !== null && Math.abs(info.gx - (box.left - tr.left) / k) < 1;
            t.style.left = keep[0]; resetElement(t);
            // Reel
            r.anim = !!$('in-vid-anim-ergebnis') && (setVal('in-vid-anim-ergebnis', 'spin'), videoOptions('ergebnis').anim === 'spin');
            const { base, layers } = await renderVideoLayers($('capture-ergebnis-feed'));
            r.vid = typeof MediaRecorder === 'undefined' || (await recordVideo(base, layers.slice(0, 2), null, { ...videoOptions('ergebnis'), gap: [0.1, 1] })).size > 1000;
            setVal('in-vid-anim-ergebnis', 'fly');
            return r; });
        check('Werkzeuge: ⋯ Mehr mit Drehen und genauen Werten (gespeichert, zurücksetzbar)', tools.panel && tools.rot && tools.exact && tools.saved && tools.loaded && tools.reset && tools.closed, JSON.stringify(tools));
        check('Einrasten an Kanten anderer Elemente', tools.snap, JSON.stringify(tools));
        check('Reel: Einflug-Arten (z.B. Hereindrehen) und Aufnahme', tools.anim && tools.vid, JSON.stringify(tools));
        // ✏️ Textfeld im Bild bearbeiten + 🔒 Sperre
        const ee = await page.evaluate(async () => { const r = {}; switchTab('ergebnis');
            const t = document.querySelector('#capture-ergebnis-feed .title-dyn').closest('.draggable-text'), other = document.querySelector('#capture-ergebnis-feed [id^="out-ergebnis-text"]').closest('.draggable-text');
            selectElement(t); r.btn = !$('el-edit-btn').hidden; openElEdit(); r.open = !$('el-edit').hidden && $('ee-text').value === val('in-ergebnis-title');
            const ta = $('ee-text'); ta.value = 'SIEG!'; ta.dispatchEvent(new Event('input')); r.text = val('in-ergebnis-title') === 'SIEG!' && $('out-ergebnis-title-feed').textContent === 'SIEG!';
            setElStyle('color', '#ff0000'); setElStyle('weight', '900'); setElStyle('fx', 'hollow');
            const h = t.querySelector('.title-dyn'), cs = getComputedStyle(h), cs2 = getComputedStyle(other.querySelector('p'));
            r.style = cs.fontWeight === '900' && cs.color === 'rgba(0, 0, 0, 0)' && cs2.fontWeight !== '900';
            r.saved = collectSlotData().elStyles[t.id]?.color === '#ff0000';
            const d = collectSlotData(); applyElStyle(t, null); applySlotData(d); applyAllElStyles(); r.loaded = t.classList.contains('es-hollow');
            r.export = (await renderElementToCanvas($('capture-ergebnis-feed'))).width === 1200;
            resetElStyle(); r.reset = !elStyles[t.id] && !t.classList.contains('es-color');
            closeElEdit(); setVal('in-ergebnis-title', 'ENDERGEBNIS'); updateErgebnis();
            // Eingabefeld eines festen Textes (Label) wird gefunden
            switchTab('tor'); const tt = document.querySelector('#capture-tor .title-dyn').closest('.draggable-text'); r.label = !!elTextSource(tt)?.label;
            // Sperre: Element
            switchTab('ergebnis'); selectElement(t); toggleLockSelected(); r.lock = t.dataset.lock === '1' && $('el-lock-btn').textContent === '🔒' && collectSlotData().positions[t.id]?.lock === true;
            const top0 = t.style.top, rc = t.getBoundingClientRect();
            t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: rc.x + 20, clientY: rc.y + 10, button: 0, pointerType: 'mouse' }));
            t.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: rc.x + 80, clientY: rc.y + 60, pointerType: 'mouse' }));
            t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'mouse' }));
            r.noMove = t.style.top === top0;
            toggleLockSelected(); r.unlock = !t.dataset.lock;
            // Sperre: alle
            toggleLockAll(); r.all = document.body.classList.contains('lock-move') && isMoveLocked(other) && /gesperrt/.test(document.querySelector('#view-ergebnis .lock-all-btn').textContent);
            toggleLockAll(); r.allOff = !document.body.classList.contains('lock-move');
            selectElement(null); return r; });
        check('✏️ Textfeld bearbeiten: Text, Farbe/Stärke/Effekt nur für dieses Feld, gespeichert, Export, zurücksetzen', ee.btn && ee.open && ee.text && ee.style && ee.saved && ee.loaded && ee.export && ee.reset && ee.label, JSON.stringify(ee));
        check('🔒 Verschieben sperren (je Element gespeichert, für alle)', ee.lock && ee.noMove && ee.unlock && ee.all && ee.allOff, JSON.stringify(ee));
        // 🧹 Inhalte eines Reiters leeren (neues Spiel) – Design und Einstellungen bleiben
        const clr = await page.evaluate(() => { const r = {}, P = stammdaten.players[0].name, O = stammdaten.opponents[0].name;
            switchTab('ergebnis'); setVal('in-ergebnis-score', '4 : 2'); setVal('in-ergebnis-text', 'Derbysieg'); setVal('erg-scorer-1', P); setVal('erg-minute-1', '12');
            setVal('in-erg-shownames', ''); setVal('in-box-fill-ergebnis', 'dots'); updateErgebnis();
            r.btn = !!document.querySelector('#editor-ergebnis .clear-tab-btn');
            clearTabContent('ergebnis');
            r.erg = val('in-ergebnis-score') === '0 : 0' && val('in-ergebnis-text') !== 'Derbysieg' && val('erg-scorer-1') === 'Keiner' && val('erg-minute-1') === '' && val('in-box-fill-ergebnis') === 'dots';
            setVal('in-box-fill-ergebnis', 'solid'); updateTabDesign('ergebnis');
            switchTab('tor'); setVal('in-tor-player', P); setVal('in-tor-minute', '67. Min'); setVal('in-tor-opp-mode', 'names'); updateTor();
            clearTabContent('tor'); r.tor = val('in-tor-player') === 'Keiner' && val('in-tor-minute') === '' && val('in-tor-opp-mode') === 'names';
            setVal('in-tor-opp-mode', 'logos'); updateTor();
            switchTab('post'); setVal('in-post-opponent-select', O); clearTabContent('post'); r.post = val('in-post-opponent-select') === '';
            r.story = !document.querySelector('#editor-story .clear-tab-btn');
            return r; });
        check('🧹 Inhalte leeren (Ergebnis, Tor, Ankündigung), Design und Einstellungen bleiben', clr.btn && clr.erg && clr.tor && clr.post && clr.story, JSON.stringify(clr));
        // 🔍 Bildausschnitt je Spielerfoto (Fokus + Zoom), Leeren-Knopf oben im Inhalt
        const crop = await page.evaluate(async () => { const r = {}; switchTab('geburtstag');
            const P = stammdaten.players.find(p => p.img).name; setVal('in-bday-player', P); updateGeburtstag(); afterViewsUpdated();
            const img = $('out-bday-img-feed'); selectElement(img.closest('.draggable-img'));
            r.btn = !$('el-crop-btn').hidden; openCropEdit(); r.open = !$('crop-edit').hidden && !!$('cr-img');
            const orig = img.getAttribute('src'); r.rect = !!$('cr-rect') && !$('cr-rect').hidden;
            setCrop({ x: 50, y: 30, z: 2 }, true); await new Promise(res => setTimeout(res, 900));
            const f = findPlayer(P).focus?.img; r.saved = !!f && f.z === 2 && Math.abs(f.y - 30) < 1;
            r.zoom = img.getAttribute('src') !== orig && img.dataset.fxSrc === orig && parseFloat($('cr-rect').style.width) > 40 && parseFloat($('cr-rect').style.width) < 60;
            setCropFit('contain'); await new Promise(res => setTimeout(res, 300));
            r.whole = getComputedStyle(img).objectFit === 'contain' && img.getAttribute('src') === orig && $('cr-rect').hidden;
            setCropFit('cover'); await new Promise(res => setTimeout(res, 600)); r.back = img.getAttribute('src') !== orig;
            switchTab('story'); r.other = true;
            switchTab('geburtstag'); r.export = (await renderElementToCanvas($('capture-geburtstag-feed'))).width === 1200;
            selectElement(img.closest('.draggable-img')); openCropEdit(); setCrop(null, true); await new Promise(res => setTimeout(res, 300));
            r.reset = !findPlayer(P).focus && img.getAttribute('src') === orig;
            closeCropEdit(); selectElement(null);
            const first = document.querySelector('#editor-ergebnis .clear-tab-btn'), sec = first.closest('.details-body') || first.parentElement;
            r.clearTop = [...sec.children].indexOf(first) <= 1;
            return r; });
        check('🔍 Bildausschnitt: Rahmen ziehen/zoomen, ganzes Bild, gespeichert, Export, zurücksetzen', crop.btn && crop.open && crop.rect && crop.saved && crop.zoom && crop.whole && crop.back && crop.export && crop.reset, JSON.stringify(crop));
        check('🧹 Leeren-Knopf steht oben im Inhalt', crop.clearTop, JSON.stringify(crop));
        check('„Präsentiert von“ mit Sponsor', await page.evaluate(() => { switchTab('post'); setVal('in-pb-sponsor-post', stammdaten.sponsors[0].name); updateTabDesign('post');
            const ok = [...document.querySelectorAll('#view-post .presented-by')].every(e => e.style.display !== 'none' && /PRÄSENTIERT/.test(e.textContent));
            setVal('in-pb-sponsor-post', ''); updateTabDesign('post'); return ok && [...document.querySelectorAll('#view-post .presented-by')].every(e => e.style.display === 'none'); }));
        // Neuzugang: Rückennummer auf Trikotfarbe immer lesbar (weiß auf dunkel, schwarz auf hell)
        const num = await page.evaluate(() => { const keep = val('cfg-color-jersey'), r = {}; switchTab('neuzugang'); const sn = $('in-new-show-number').checked; $('in-new-show-number').checked = true; setVal('in-new-number', '7'); updateNeuzugang();
            const col = () => getComputedStyle(document.querySelector('#view-neuzugang .transfer-number')).color;
            setVal('cfg-color-jersey', '#5b2a86'); updateDesignSettings(); r.dark = col() === 'rgb(255, 255, 255)';
            setVal('cfg-color-jersey', '#f1c40f'); updateDesignSettings(); r.light = col() === 'rgb(17, 17, 17)';
            setVal('cfg-color-jersey', keep); updateDesignSettings(); $('in-new-show-number').checked = sn; setVal('in-new-number', ''); updateNeuzugang(); return r; });
        check('Neuzugang: Rückennummer passt sich der Trikotfarbe an (lesbar)', num.dark && num.light, JSON.stringify(num));
        // Sponsor: Logo-Kasten in verschiedenen Formen oder ganz ohne Kasten, Name ausblendbar, alte Stände → Standard
        const spon = await page.evaluate(async () => { const r = {}; switchTab('sponsor'); setVal('in-spon-select', stammdaten.sponsors[0].name); updateSponsorPost();
            const c = $('out-spon-card'), cs = () => getComputedStyle(c);
            r.def = c.classList.contains('ss-rounded') && cs().backgroundColor === 'rgb(255, 255, 255)';
            setVal('in-spon-shape', 'circle'); updateSponsorPost(); r.circle = c.offsetWidth === c.offsetHeight && cs().borderRadius === '50%';
            setVal('in-spon-shape', 'shield'); setVal('in-spon-border', 'frame'); updateSponsorPost(); r.shield = /svg/.test(c.style.backgroundImage) && cs().backgroundColor === 'rgba(0, 0, 0, 0)';
            r.shieldExport = (await renderElementToCanvas($('capture-sponsor'))).width === 1200;
            setVal('in-spon-shape', 'square'); setVal('in-spon-boxcolor', '#112233'); updateSponsorPost(); r.square = cs().backgroundColor === 'rgb(17, 34, 51)' && cs().borderTopWidth === '3px';
            setVal('in-spon-shape', 'none'); setVal('in-spon-showname', 'no'); updateSponsorPost();
            r.none = cs().backgroundColor === 'rgba(0, 0, 0, 0)' && cs().boxShadow === 'none' && document.querySelector('#editor-sponsor .spon-box-only').hidden && $('out-spon-name').style.display === 'none';
            const d = collectSlotData(); r.saved = d.inputs['in-spon-shape'] === 'none' && d.inputs['in-spon-showname'] === 'no';
            const old = JSON.parse(JSON.stringify(d)); ['in-spon-shape', 'in-spon-boxcolor', 'in-spon-border', 'in-spon-showname'].forEach(k => delete old.inputs[k]);
            applySlotData(old); updateSponsorPost(); r.old = val('in-spon-shape') === 'rounded' && val('in-spon-showname') === 'yes' && c.classList.contains('ss-rounded') && $('out-spon-name').style.display === '';
            return r; });
        check('Sponsor: Logo-Kasten als Kreis, Schild, eckig (Farbe/Rahmen) oder ohne Kasten, Name ausblendbar', spon.def && spon.circle && spon.shield && spon.shieldExport && spon.square && spon.none, JSON.stringify(spon));
        check('Sponsor: Kasten-Einstellungen gespeichert, alte Stände wie bisher', spon.saved && spon.old, JSON.stringify(spon));
        // Ergebnis: Spielabsage, Countdown
        const modes = await page.evaluate(() => { switchTab('ergebnis'); setErgMode('absage'); const a = [val('in-ergebnis-title'), !!document.querySelector('#out-ergebnis-score .erg-stamp'), $('out-erg-scorers-wrap').style.display];
            setErgMode('countdown'); const d = new Date(); d.setDate(d.getDate() + 4); setVal('erg-cd-date', d.toISOString().slice(0, 10)); updateErgebnis(); const c = $('out-ergebnis-score').textContent;
            setVal('erg-cd-date', ''); setErgMode('ergebnis'); return { a, c, back: val('in-ergebnis-title') }; });
        check('Spielabsage mit Stempel, ohne Torschützen', modes.a[0] === 'SPIELABSAGE' && modes.a[1] && modes.a[2] === 'none', JSON.stringify(modes));
        check('Countdown zählt Tage bis zum Datum', /^4\s*TAGE$/.test(modes.c), modes.c);
        check('Zurück zum Endergebnis', modes.back === 'ENDERGEBNIS');
        const many = await page.evaluate(() => { const P = stammdaten.players.filter(x => (x.group || 'Spieler') === 'Spieler').map(x => x.name);
            const visible = () => [...document.querySelectorAll('#scorer-controls .scorer-row')].filter(r => r.style.display !== 'none').length;
            const start = visible(); showMoreScorers(); const more = visible();
            for (let i = 1; i <= 20; i++) { setVal('erg-scorer-' + i, P[i % P.length]); setVal('erg-minute-' + i, String(i * 4)); } updateErgebnis();
            const saved = Object.keys(collectSlotData().inputs).filter(k => /^erg-scorer-/.test(k)).length;
            const r = { start, more, filled: visible(), saved, lines: document.querySelectorAll('#out-erg-scorers .scorer-line').length };
            for (let i = 1; i <= SCORER_MAX; i++) { setVal('erg-scorer-' + i, 'Keiner'); setVal('erg-minute-' + i, ''); } updateErgebnis(); return r; });
        const mins = await page.evaluate(() => { const t = $('in-tor-minute'), e = $('erg-minute-1'), r = {};
            r.select = t.tagName === 'SELECT' && e.tagName === 'SELECT';
            r.range = [...t.options].some(o => o.value === '0. Min') && [...t.options].some(o => o.value === '120. Min') && [...e.options].some(o => o.value === '90+3');
            setVal('in-tor-minute', '88. Min'); updateTor(); r.shown = $('out-tor-minute').textContent === '88. Min';
            setVal('erg-minute-1', "17'"); r.old = val('erg-minute-1') === "17'";   // ältere, frei eingetippte Werte bleiben erhalten
            setVal('erg-minute-1', ''); return r; });
        check('Minute als Auswahl 0–120 (Tor & Torschützen), alte Werte bleiben', Object.values(mins).every(Boolean), JSON.stringify(mins));
        check('Bis zu 25 Torschützen (zuerst 10, mehr per Knopf)', many.start === 10 && many.more === 15 && many.filled >= 20 && many.saved === 25 && many.lines > 0, JSON.stringify(many));
        // Tor: Gegner aus der Ankündigung (Anzeigetafel Heim links), Spielart, Vorlage als Foto oder Zeile, ins Ergebnis übernehmen
        const tor = await page.evaluate(() => { const r = {}, P = stammdaten.players.filter(x => (x.group || 'Spieler') === 'Spieler').map(x => x.name);
            const opp = stammdaten.opponents[0].name; switchTab('tor');
            setVal('in-post-opponent-select', opp); setVal('in-post-venue', 'auswaerts'); updateMatchup();
            setVal('in-tor-player', P[0]); setVal('in-tor-assist', P[1]); setVal('in-tor-score', '0 : 1'); setVal('in-tor-minute', '67. Min'); setVal('in-tor-kind', 'Kopfball');
            setVal('in-tor-opp-mode', 'names'); setVal('in-tor-assist-mode', 'photo'); updateTor();
            const names = [...document.querySelectorAll('#capture-tor .tb-team span')].map(e => e.textContent);
            r.board = names.length === 2 && names[0] === opp && names[1] === getTeamName() && $('out-tor-score').textContent === '0 : 1';
            r.sub = $('out-tor-minute').textContent === '67. Min · Kopfball';
            r.photo = $('out-tor-assist-wrap').style.display === 'flex' && !document.querySelector('#out-tor-player-name .tor-assist-line');
            r.info = $('tor-match-info').textContent.includes(opp) && /Auswärtsspiel/.test($('tor-match-info').textContent);
            setVal('in-post-venue', 'heim'); updateMatchup(); r.home = document.querySelector('#capture-tor .tb-team span').textContent === getTeamName();
            setVal('in-tor-assist-mode', 'line'); updateTor();
            r.line = $('out-tor-assist-wrap').style.display === 'none' && /Vorlage/.test(document.querySelector('#out-tor-player-name-feed .tor-assist-line')?.textContent || '');
            setVal('in-tor-opp-mode', 'off'); updateTor(); r.off = !$('out-tor-score').closest('.tor-details').classList.contains('tor-board') && !document.querySelector('#capture-tor .tb-team');
            const d = collectSlotData(); r.saved = d.torOppMode === 'off' && d.torAssistMode === 'line' && d.torKind === 'Kopfball';
            const old = JSON.parse(JSON.stringify(d)); delete old.torOppMode; delete old.torAssistMode; delete old.torKind;
            setVal('in-tor-opp-mode', 'logos'); applySlotData(old); r.migrated = val('in-tor-opp-mode') === 'off' && val('in-tor-assist-mode') === 'line';
            setVal('in-tor-score', '1 : 0'); addTorToErgebnis(); addTorToErgebnis();
            r.erg = val('erg-scorer-1') === P[0] && val('erg-minute-1') === '67' && val('in-ergebnis-score') === '1 : 0' && val('erg-scorer-2') !== P[0];
            setVal('erg-scorer-1', 'Keiner'); setVal('erg-minute-1', ''); setVal('in-tor-assist', 'Keiner'); setVal('in-tor-kind', ''); setVal('in-tor-opp-mode', 'logos'); setVal('in-tor-assist-mode', 'photo'); updateErgebnis(); updateTor();
            return r; });
        check('Tor: Gegner als Anzeigetafel (Heim links) aus der Ankündigung, Spielart, Vorlage als Foto oder Zeile', tor.board && tor.sub && tor.photo && tor.info && tor.home && tor.line && tor.off, JSON.stringify(tor));
        check('Tor: neue Einstellungen gespeichert, alte Stände ohne Gegner-Anzeige', tor.saved && tor.migrated, JSON.stringify(tor));
        check('Tor: „Auch beim Ergebnis eintragen“ (ohne doppelten Eintrag)', tor.erg, JSON.stringify(tor));
        check('Export Tor Story mit Anzeigetafel', (await exportSize(page, 'capture-tor')) === '1200x2133');
        // Freie Vorlage & Mannschaftsfoto
        check('Freie Vorlage', await page.evaluate(() => { switchTab('frei'); setVal('in-frei-title', 'SOMMERFEST'); setVal('in-frei-icon-mode', 'emoji'); updateFrei(); return $('out-frei-title').textContent === 'SOMMERFEST' && $('out-frei-icon-feed').textContent.length > 0; }));
        check('Export freie Vorlage', (await exportSize(page, 'capture-frei')) === '1200x2133');
        const tf = await page.evaluate(async () => {
            switchTab('teamfoto');
            const c = document.createElement('canvas'); c.width = 600; c.height = 400; c.getContext('2d').fillStyle = '#3d8b37'; c.getContext('2d').fillRect(0, 0, 600, 400);
            const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
            await uploadTeamPhoto({ target: { files: [new File([blob], 'Team.jpg', { type: 'image/jpeg' })], value: '' } });
            setVal('in-tf-team', ''); fillTeamfotoNames();
            return { photos: (stammdaten.teamPhotos || []).length, src: !!$('out-tf-photo').getAttribute('src'), names: /HINTEN/.test($('out-tf-names').textContent) };
        });
        check('Mannschaftsfoto mit Foto und Namen', tf.photos === 1 && tf.src && tf.names, JSON.stringify(tf));
        const board = await page.evaluate(() => { tfClearBoard(); const n = tfPool()[0]; tfMove(n, 'front', null);
            const r = { front: tfBoard.front.join(), text: val('in-tf-row3'), saved: (collectSlotData().tfBoard?.front || []).join(), n };
            tfMove(n, 'missing', 0); r.missing = val('in-tf-missing'); r.front2 = tfBoard.front.length; return r; });
        check('Teamfoto: Spieler auf Reihen verteilen (gespeichert, Text befüllt)', board.front === board.n && board.text.length > 0 && board.saved === board.n && board.missing.length > 0 && board.front2 === 0, JSON.stringify(board));
        const tfl = await page.evaluate(() => { tfClearBoard(); const [a, b2] = tfPool();
            tfToggleRow('middle', false); const zones = [...document.querySelectorAll('#tf-board .tf-zone')].map(z => z.dataset.zone).join();
            tfBoard.view = 'list'; renderTfBoard(); const sels = document.querySelectorAll('#tf-board select[data-tf-player]').length;
            tfMove(a, 'front', null); tfMove(b2, 'front', null); tfReorder('front', 0, 1);
            const r = { zones, sels, order: tfBoard.front.join() === [b2, a].join(), mid: val('in-tf-row2') };
            tfToggleRow('middle', true); tfBoard.view = 'board'; renderTfBoard(); return r; });
        check('Teamfoto: Reihe ausblenden, Liste zuweisen, Reihenfolge ▲▼', !tfl.zones.includes('middle') && tfl.sels > 0 && tfl.order && tfl.mid === '', JSON.stringify(tfl));
        check('Export Mannschaftsfoto', (await exportSize(page, 'capture-teamfoto-feed')) === '1200x1500');
        // Spieler umbenennen: Name wird in der Aufstellung mitgenommen
        const oldName = await page.evaluate(() => val('player-1'));
        page.answers.push('Umbenannt Neu');
        await page.evaluate(n => renameEntry('players', stammdaten.players.findIndex(p => p.name === n)), oldName);
        await page.waitForTimeout(400);
        check('Spieler umbenannt', await page.evaluate(n => !findPlayer(n) && !!findPlayer('Umbenannt Neu'), oldName));
        check('Umbenannt auch in der Aufstellung', await page.evaluate(() => val('player-1') === 'Umbenannt Neu'));
        check('Umbenannt auch im gespeicherten Stand', await page.evaluate(async () => (await localforage.getItem(STORE.slot(currentVersion))).inputs['player-1'] === 'Umbenannt Neu'));
        // Mehrere Spieler auf einmal bearbeiten: Namen (auch vertauscht), Nummer, Mannschaft, Löschen
        const mass = await page.evaluate(async () => {
            stammdaten.players.push({ name: 'Weg Damit' }, { name: 'tausch_a' }, { name: 'tausch_b' });
            await onStammdatenChanged('players');
            const lineupName = val('player-1');
            openMassEdit('players');
            const row = n => massRows().find(r => r.querySelector('.mass-name').value === n) || (() => { throw new Error('Zeile fehlt: ' + n + ' / ' + massRows().map(r => r.querySelector('.mass-name').value).join('|')); })();
            const r = { rows: massRows().length === stammdaten.players.length };
            const lr = row(lineupName);
            lr.querySelector('.mass-name').value = 'Massen Neu';
            lr.querySelector('.mass-nr').value = '77';
            row('tausch_a').querySelector('.mass-name').value = 'tausch_b';
            row('tausch_b').querySelector('.mass-name').value = 'tausch_a';
            massTidyNames();
            r.tidy = !!row('Tausch A') && !!row('Tausch B');
            row('Weg Damit').querySelector('.mass-check').checked = true; massDeleteSelected();
            if (stammdaten.teams?.length) { row('Massen Neu').querySelector('.mass-check').checked = true; setVal('mass-team', stammdaten.teams[0]); massApplyToSelected(); }
            await saveMassEdit();
            const p = findPlayer('Massen Neu');
            r.saved = !!p && p.number === '77' && (!stammdaten.teams?.length || p.team === stammdaten.teams[0]);
            r.lineup = val('player-1') === 'Massen Neu';
            r.deleted = !findPlayer('Weg Damit');
            r.closed = $('mass-overlay').hidden;
            r.stored = (await localforage.getItem(STORE.slot(currentVersion))).inputs['player-1'] === 'Massen Neu';
            openMassEdit('players'); const a = massRows()[0].querySelector('.mass-name'), b = massRows()[1].querySelector('.mass-name');
            a.value = b.value; await saveMassEdit(); r.dupBlocked = !$('mass-overlay').hidden && a.classList.contains('bad'); closeMassEdit();
            stammdaten.players = stammdaten.players.filter(x => !/^Tausch /.test(x.name)); await onStammdatenChanged('players');
            return r; });
        check('Mehrere Spieler auf einmal bearbeiten (Namen, Nummer, Mannschaft, Löschen, Doppelte verhindert)', Object.values(mass).every(Boolean), JSON.stringify(mass));
        check('Gegner: mehrere auf einmal umbenennen', await page.evaluate(async () => { const o = stammdaten.opponents[0]?.name; if (!o) return true;
            openMassEdit('opponents'); massRows()[0].querySelector('.mass-name').value = 'Gegner Massen'; await saveMassEdit();
            const ok = !!stammdaten.opponents.find(x => x.name === 'Gegner Massen'); await applyRenames('opponents', new Map([['Gegner Massen', o]])); return ok && !!stammdaten.opponents.find(x => x.name === o); }));
        // Gegner & Sponsoren umbenennen (inkl. einzeln verschobenem Sponsor-Logo)
        const prep = await page.evaluate(async () => {
            const opp = stammdaten.opponents[0].name; setVal('in-post-opponent-select', opp);
            const sp = stammdaten.sponsors[0].name; selectedSponsors.post = [sp];
            const id = sponsorLogoId('capture-post-feed', sp);
            const d = collectSlotData(); d.positions[id] = { x: 15, y: 5, scale: 1 }; applySlotData(d); renderAll(); await saveSlotNow();
            return { opp, sp };
        });
        page.answers.push('Gegner Neu');
        await page.evaluate(n => renameEntry('opponents', stammdaten.opponents.findIndex(o => o.name === n)), prep.opp);
        await page.waitForTimeout(300);
        check('Gegner umbenannt (auch in der Ankündigung)', await page.evaluate(() => !!stammdaten.opponents.find(o => o.name === 'Gegner Neu') && val('in-post-opponent-select') === 'Gegner Neu'));
        page.answers.push('Sponsor Neu');
        await page.evaluate(n => renameEntry('sponsors', stammdaten.sponsors.findIndex(o => o.name === n)), prep.sp);
        await page.waitForTimeout(300);
        check('Sponsor umbenannt (Auswahl & Logo-Position bleiben)', await page.evaluate(async () => {
            const d = await localforage.getItem(STORE.slot(currentVersion));
            return !!stammdaten.sponsors.find(o => o.name === 'Sponsor Neu') && selectedSponsors.post.includes('Sponsor Neu') && d.positions[sponsorLogoId('capture-post-feed', 'Sponsor Neu')]?.x === 15;
        }));
        // Eckball 2.0: 16:9, freie Spieler mit Rollen, Darstellungen, Gegner, Zonen, Spiegeln, Varianten, Pfeile
        const eck = await page.evaluate(() => { switchTab('eckball'); resetEckballPositions(); const r = { start: curEck().arrows.length };
            setVal('eck-new-color', 'red'); setVal('eck-new-line', 'solid'); setVal('eck-new-shape', '1'); addEckArrow();
            const pth = document.querySelector('#eck-arrow-svg > path');
            r.arrow = / Q /.test(pth.getAttribute('d')) && pth.getAttribute('stroke') === ECK_ARROW_COLORS.red && !pth.getAttribute('stroke-dasharray');
            r.legacy = normEckArrows(LEGACY_DEFAULT_ARROWS).length;
            deleteEckArrow(curEck().arrows[0].id); r.after = curEck().arrows.length;
            setVal('eck-add-role', 'cover'); addEckPlayer();
            r.cover = curEck().players.filter(p => p.role === 'cover').length;
            const name = stammdaten.players[0].name;
            setEckPlayer(curEck().players[0].id, 'name', name);
            r.tokens = document.querySelectorAll('#eckball-players-container .eck-tok').length === curEck().players.length;
            r.legend = $('eck-legend').textContent.includes(formatEckName(name)) && /ABSICHERUNG/.test($('eck-legend').textContent);
            r.styles = ['circle', 'square', 'jersey', 'dot'].map(t => { setEckOpt('token', t); return document.querySelector('#eckball-players-container .eck-tok').classList.contains('eck-tok-' + t); }).every(Boolean);
            setEckOpt('token', 'circle'); setEckOpt('showNames', false); r.noNames = !document.querySelector('.eck-tok-name'); setEckOpt('showNames', true);
            eckOppTemplate('zone'); r.opps = document.querySelectorAll('#eck-opps .eck-opp').length;
            setVal('eck-zone-tpl', 'near'); addEckZone(); r.zone = document.querySelectorAll('#eck-zones .eck-zone').length === 1;
            const z0 = { ...curEck().zones[0] }, x0 = curEck().players[0].x;
            mirrorEck(); r.mirror = curEck().players[0].x === eckR(68 - x0) && curEck().side === 'right' && curEck().zones[0].x === eckR(68 - z0.x - z0.w);
            return r; });
        check('Eckball: ohne Standardpfeile, Pfeil mit Farbe/Linie/Bogen', eck.start === 0 && eck.arrow && eck.legacy === 0 && eck.after === 0, JSON.stringify(eck));
        check('Eckball: freie Spieler mit Rollen (3× Absicherung), Legende, Darstellungen, Namen optional', eck.cover === 3 && eck.tokens && eck.legend && eck.styles && eck.noNames, JSON.stringify(eck));
        check('Eckball: Gegenspieler, Zonen, Seite spiegeln', eck.opps === 9 && eck.zone && eck.mirror, JSON.stringify(eck));
        page.answers.push('Kurz');
        const vars = await page.evaluate(async () => { addEckVariant(); const r = { n: eck2.variants.length, name: curEck().name, active: eck2.active };
            curEck().players.pop(); updateEckball(); selectEckVariant(0); r.sep = eck2.variants[0].players.length === eck2.variants[1].players.length + 1;
            await saveSlotNow(); r.saved = (await localforage.getItem(STORE.slot(currentVersion))).eck2.variants.length;
            eckZoomBy(1); r.zoom = $('capture-eckball').style.transform !== `scale(${Math.min(1, $('eck-stage').clientWidth / 800)})` && $('eck-scaler').style.overflow === 'auto';
            eckZoomBy(-5); toggleEckFull(true); r.full = $('eck-stage').classList.contains('eck-full'); toggleEckFull(false);
            setEckOpt('view', 'half'); r.half = eckView().s < 9; setEckOpt('view', 'box');
            return r; });
        check('Eckball: mehrere Varianten (gespeichert), Zoom, Vollbild, Ausschnitt', vars.n === 2 && vars.name === 'Kurz' && vars.active === 1 && vars.sep && vars.saved === 2 && vars.zoom && vars.full && vars.half, JSON.stringify(vars));
        const pad = await page.evaluate(() => { const p = curEck().players[0], x0 = p.x, y0 = p.y; eckSelect('p:' + p.id);
            const r = { mark: !!document.querySelector('#eckball-players-container .eck-tok.eck-sel') };
            eckNudge(1, 0); eckNudge(1, 0); eckNudge(0, 1); r.fine = [eckR(p.x - x0), eckR(p.y - y0)].join();
            toggleEckStep(); eckNudge(0, 1); toggleEckStep(); r.big = eckR(p.y - y0);
            addEckArrow(); const a = curEck().arrows.at(-1), ax = [a.x1, a.x2]; eckSelect('a:' + a.id); eckNudge(-1, 0); r.arrow = eckR(ax[0] - a.x1) === 0.5 && eckR(ax[1] - a.x2) === 0.5;
            r.mid = !!document.querySelector('.tactics-arrow-handle.mid-handle'); r.opts = $('eck-sel').options.length > curEck().players.length;
            eckDeleteSel(); r.del = !curEck().arrows.some(x => x.id === a.id); return r; });
        check('Eckball: Steuerkreuz verschiebt Auswahl (fein/grob), ganzer Pfeil, Entfernen', pad.mark && pad.fine === '1,0.5' && pad.big === 2.5 && pad.arrow && pad.mid && pad.opts && pad.del, JSON.stringify(pad));
        check('Export Eckball 16:9 = 2400x1350', (await exportSize(page, 'capture-eckball')) === '2400x1350');
        const mig = await page.evaluate(() => { const keep = collectSlotData(), d = JSON.parse(JSON.stringify(keep)); delete d.eck2;
            const [a, b] = stammdaten.players.map(p => p.name);
            Object.assign(d.inputs, { 'eck-player-1': a, 'eck-player-4': b, 'eck-role-4': 'zielspieler' }); d.eckNodes = JSON.parse(JSON.stringify(defaultEckNodes));
            applySlotData(d); updateEckball();
            const r = { n: eck2.variants.length, taker: curEck().players.find(p => p.role === 'taker')?.name === a, target: curEck().players.some(p => p.role === 'target' && p.name === b) };
            applySlotData(keep); updateEckball(); r.back = eck2.variants.length; return r; });
        check('Eckball: alte Stände (feste 11 Plätze) werden übernommen', mig.n === 1 && mig.taker && mig.target && mig.back === 2, JSON.stringify(mig));
        // Startseite: Kacheln
        await page.evaluate(() => switchTab('start'));
        check('Startseite zeigt Vorlagen-Kacheln', (await page.$$eval('#create-grid .create-tile', l => l.length)) >= 10);
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await section('Handy (Touch, Samsung-Galaxy-Größe)', async () => {
        const page = await newPage(browser, { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
            userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36' });
        await page.goto(BASE);
        await page.waitForTimeout(600);
        await page.click('#license-demo');
        await waitReady(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        check('Kein seitliches Scrollen der Seite', !overflow);
        check('Reiterleiste sichtbar', await page.isVisible('#tab-bar'));
        check('Export auf dem Handy', (await exportSize(page, 'capture-post-feed')) === '1200x1500');
        check('Keine JavaScript-Fehler', page.errors.length === 0, page.errors.join(' | '));
        await page.context().close();
    });

    await browser.close();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\n${failed ? '❌' : '✅'} ${passed} bestanden, ${failed} fehlgeschlagen`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
