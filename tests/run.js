/*
 * ClubShot – automatische Tests (Playwright / Chromium)
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
    const names = ['Max_Muster', 'Max_Muster_TOR', 'Tim_Test', 'Ben_Beispiel'];
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
    console.log(`ClubShot-Tests auf ${BASE}`);

    await section('Start, Sicherheit, Demo-Modus', async () => {
        const page = await newPage(browser);
        await page.goto(BASE);
        await page.waitForTimeout(800);
        check('Freischalt-Fenster erscheint', await page.isVisible('#license-overlay'));
        await page.click('#license-demo');
        await waitReady(page);
        const counts = await page.evaluate(() => [stammdaten.players.length, stammdaten.opponents.length, stammdaten.sponsors.length]);
        check('Demo füllt Beispieldaten', counts[0] >= 18 && counts[1] >= 6 && counts[2] >= 3, counts.join('/'));
        check('Export Beitrag 4:5 = 1200x1500', (await exportSize(page, 'capture-post-feed')) === '1200x1500');
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
        // Foto-Umschalter
        await page.click('.tab-btn[data-tab="potm"]');
        await page.selectOption('#in-potm-player', 'Max Muster');
        await page.evaluate(() => { setVal('in-photo-type-potm', 'tor'); updateAllViews(); });
        check('Torjubel-Foto umschaltbar', await page.evaluate(() => $('out-potm-img').src === findPlayer('Max Muster').torImg));
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
        await page.evaluate(() => { $('in-new-name-stack').checked = true; updateNeuzugang(); });
        check('Neuzugang: Name untereinander', await page.$eval('#out-new-name', e => e.innerHTML.includes('<br>')));
        check('Spielervorstellung ohne Position & Mannschaft', await page.$eval('#out-new-chips', e => e.style.display === 'none'));
        // Kästen abschaltbar
        await page.evaluate(() => { setVal('in-box-mode-neuzugang', 'none'); updateTabDesign('neuzugang'); });
        check('Ohne Kästen hinter der Schrift', await page.$eval('#out-new-name', e => getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'));
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
