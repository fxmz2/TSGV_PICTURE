const http=require('http'),fs=require('fs'),path=require('path');const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'../..'),PORT=8895,BASE=`http://localhost:${PORT}/index.html`,OUT=__dirname+'/img/';
const LIST='HANDBUCH-1 = SC Lilaheim = Wappen/SC_Lilaheim.png = 2099-12-31 = advanced\n';
const T={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.wasm':'application/wasm','.json':'application/json'};
const srv=http.createServer((q,r)=>{const p=decodeURIComponent(new URL(q.url,BASE).pathname);const f=path.join(ROOT,p);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r)});
(async()=>{await new Promise(r=>srv.listen(PORT,r));const b=await chromium.launch({args:['--lang=de-DE']});
const pg=await (await b.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:2,locale:'de-DE',timezoneId:'Europe/Berlin'})).newPage();
pg.on('pageerror',e=>console.log('ERR',e.message));pg.on('dialog',d=>d.accept());
await pg.route('**/vereine.txt*',r=>r.fulfill({status:200,contentType:'text/plain; charset=utf-8',body:LIST}));
await pg.goto(BASE);await pg.waitForTimeout(800);
await pg.fill('#license-input','HANDBUCH-1');await Promise.all([pg.waitForEvent('load',{timeout:8000}).catch(()=>null),pg.click('#license-submit')]);
await pg.waitForFunction(()=>typeof appReady!=='undefined'&&appReady,null,{timeout:20000});await pg.waitForTimeout(800);
if(await pg.isVisible('#wizard-overlay'))await pg.click('#wizard-overlay .license-cancel');
await pg.evaluate(async()=>{await loadDemoData(false);document.querySelectorAll('.toast,#toast').forEach(t=>t.remove());});
await pg.waitForTimeout(800);

// Nur für die Fotos: Browser-Bedienelemente auf Deutsch darstellen (der Test-Browser kennt nur Englisch)
async function germanize(){await pg.evaluate(()=>{
  document.querySelectorAll('input[type=file]').forEach(inp=>{if(inp.dataset.gz||!inp.offsetWidth)return;inp.dataset.gz=1;const d=document.createElement('div');
    d.style.cssText='display:flex;align-items:center;gap:10px;border:1px solid #ccc;border-radius:6px;padding:6px;background:#fff;font-size:13px;margin-bottom:8px';
    d.innerHTML=`<span style="background:#005f73;color:#fff;border-radius:6px;padding:6px 12px;font-weight:bold">${inp.multiple?'Dateien auswählen':'Datei auswählen'}</span><span>Keine Datei ausgewählt</span>`;
    inp.style.display='none';inp.after(d);});
  document.querySelectorAll('input[type=date],input[type=time]').forEach(inp=>{if(inp.dataset.gz||!inp.offsetWidth)return;inp.dataset.gz=1;const t=document.createElement('input');t.type='text';t.className=inp.className;
    const cs=getComputedStyle(inp);t.style.cssText=`width:${inp.offsetWidth}px;height:${inp.offsetHeight}px;box-sizing:border-box;`;
    let v=inp.value; if(inp.type==='date'&&v){const [y,m,dd]=v.split('-');v=`${dd}.${m}.${y}`;} else if(inp.type==='date') v='TT.MM.JJJJ'; else if(!v) v='--:--';
    t.value=v; inp.style.display='none'; inp.after(t);});
});}
// Hilfsfunktion: Bereich öffnen und fotografieren
async function shot(name,tab,sel,opts={}){
  const box=await pg.evaluate(([tab,sel,o])=>{switchTab(tab);
    let el;
    if(sel.startsWith('summary:')){const t=sel.slice(8);const s=[...document.querySelectorAll(`#editor-${tab} summary, #editor-${tab} details > summary`)].find(x=>x.textContent.includes(t));if(!s)return null;el=s.parentElement;el.open=true;
      if(o.openParent){let p=el.parentElement.closest('details');while(p){p.open=true;p=p.parentElement.closest('details');}}}
    else el=document.querySelector(sel);
    if(!el)return null; el.scrollIntoView({block:'start'}); const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};},[tab,sel,opts]);
  if(!box){console.log('MISSING',name,sel);return;}
  await germanize(); await pg.waitForTimeout(350);
  const b2=await pg.evaluate(([tab,sel])=>{let el;if(sel.startsWith('summary:')){const t=sel.slice(8);el=[...document.querySelectorAll(`#editor-${tab} summary`)].find(x=>x.textContent.includes(t)).parentElement;}else el=document.querySelector(sel);const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};},[tab,sel]);
  const h=Math.min(b2.h,opts.maxH||900);
  await pg.screenshot({path:OUT+name+'.png',clip:{x:b2.x-4,y:Math.max(0,b2.y-4),width:b2.w+8,height:h+8}});
  console.log('ok',name,Math.round(b2.w)+'x'+Math.round(h));
}
await pg.evaluate(()=>{setVal('cfg-team-name','');updateMatchup();applyClubBranding();applyCrestColors&&applyCrestColors('start');renderAll&&renderAll();});await pg.waitForTimeout(500);
await shot('einst-verein','start','summary:Vereinsname, Wappen',{maxH:760});
await shot('einst-versionen','start','summary:Versionen / Mannschaften');
await shot('einst-backup','start','summary:Backup & Export');
await shot('daten-spieler','stammdaten','summary:Spieler & Trainer',{maxH:820});
await shot('daten-hintergruende','stammdaten','summary:Eigene Hintergründe',{maxH:600});
await shot('ankuendigung','post','#editor-post',{maxH:900});
await shot('aufstellung','story','#editor-story',{maxH:900});
await shot('tor','tor','#editor-tor',{maxH:900});
await shot('ergebnis','ergebnis','#editor-ergebnis',{maxH:700});
await shot('kader','kader','#editor-kader',{maxH:700});
await shot('kalender','kalender','#editor-kalender',{maxH:700});
await shot('wochenende','wochenende','#editor-wochenende',{maxH:700});
await shot('farben','post','summary:Farben & Schrift',{maxH:800,openParent:true});
await shot('beitragstext','post','summary:Text für den Beitrag',{maxH:500,openParent:true});
await shot('reel','post','summary:Video (Reel)',{maxH:500,openParent:true});
await shot('sponsoren-tab','post','summary:Sponsoren',{maxH:600,openParent:true});
await pg.evaluate(()=>{switchTab('tor');applyLayout('tor','poster');});
await pg.setViewportSize({width:1280,height:2400});
async function hostShot(name,openSec,maxH){
  await pg.evaluate(o=>{const h=$('design-controls-tor');h.querySelectorAll('details:not(.sect)').forEach(d=>d.open=false);h.querySelectorAll('details.sect').forEach(d=>d.open=true);for(let d=h.closest('details');d;d=d.parentElement.closest('details'))d.open=true;
    document.querySelectorAll('#editor-tor details').forEach(d=>{if(d.contains(h))d.open=true;});if(o)h.querySelector(`details[data-section="${o}"]`).open=true;},openSec);
  await germanize();await pg.waitForTimeout(300);
  const r=await pg.evaluate(o=>{const h=$('design-controls-tor');const el=o?h.querySelector(`details[data-section="${o}"]`):h;el.scrollIntoView({block:'start'});const b=el.getBoundingClientRect();return {x:b.x-4,y:Math.max(0,b.y-4),width:b.width+8,height:b.height+8};},openSec);
  r.height=Math.min(r.height,maxH);await pg.screenshot({path:OUT+name+'.png',clip:r});console.log('ok',name);
}
await hostShot('aussehen',null,900);
await hostShot('layout','layout',420);
await pg.evaluate(()=>{applyLayout('tor','classic');setVal('in-box-fill-tor','stripes');setVal('in-ov-grad-tor','bottom');updateAllViews();});
await hostShot('extras','extras',1800);await pg.setViewportSize({width:1280,height:1000});
await pg.setViewportSize({width:390,height:844});await pg.evaluate(()=>{switchTab('ergebnis');if(!document.body.classList.contains('show-preview'))toggleMobileView();selectElement($('out-ergebnis-score'));rotateSelected(-6);toggleElMore(true);});
await pg.waitForTimeout(300);
await pg.screenshot({path:OUT+'werkzeug.png',clip:await pg.evaluate(()=>{const r=$('el-toolbar').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})});
await pg.evaluate(()=>{toggleElMore(false);selectElement(null);resetExtras('tor');if(document.body.classList.contains('show-preview'))toggleMobileView();});await pg.setViewportSize({width:1280,height:1000});
await pg.evaluate(()=>{switchTab('tor');applyStyle('tor','neonnacht');applyLayout('tor','split');updateAllViews();});await pg.waitForTimeout(1200);
await pg.evaluate(async()=>{const c=await renderElementToCanvas($('capture-tor'));window.__x=c.toDataURL('image/jpeg',0.85);});
require('fs').writeFileSync(OUT+'bsp-neon.jpg',Buffer.from((await pg.evaluate(()=>window.__x)).split(',')[1],'base64'));
await pg.evaluate(()=>{switchTab('ergebnis');applyStyle('ergebnis','zeitung');applyLayout('ergebnis','bigscore');updateAllViews();});await pg.waitForTimeout(800);
await pg.evaluate(async()=>{const c=await renderElementToCanvas($('capture-ergebnis'));window.__x=c.toDataURL('image/jpeg',0.85);});
require('fs').writeFileSync(OUT+'bsp-zeitung.jpg',Buffer.from((await pg.evaluate(()=>window.__x)).split(',')[1],'base64'));
await b.close();srv.close();})();
