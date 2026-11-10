/*
 * Instagram-Grafiken für Match-Shot erzeugen (nicht Teil der App).
 * Start:  node marketing/instagram/render.js
 * Ergebnis: marketing/instagram/out/ (Karussell 1–11 + Einzelbild „Vorteile“, je 1080x1350)
 * Die Bilder kommen aus landing/ – neue Screenshots dort ersetzen und neu erzeugen.
 */
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright')); }
(async () => {
    const out = path.join(__dirname, 'out'); fs.mkdirSync(out, { recursive: true });
    const b = await chromium.launch(), p = await b.newPage({ viewport: { width: 1080, height: 1350 } });
    await p.goto('file://' + path.join(__dirname, 'vorteile.html')); await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(out, 'Match-Shot_Vorteile.png') });
    await p.goto('file://' + path.join(__dirname, 'karussell.html')); await p.waitForTimeout(800);
    const slides = await p.$$('.s');
    for (let i = 0; i < slides.length; i++) await slides[i].screenshot({ path: path.join(out, `Match-Shot_${i + 1}.png`) });
    await b.close(); console.log(`${slides.length + 1} Bilder in ${out}`);
})();
