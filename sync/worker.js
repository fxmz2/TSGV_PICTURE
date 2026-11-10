/* Match-Shot Vereins-Sync – Cloudflare Worker mit R2-Speicher (Bindung „BUCKET“)

   Grundsatz: Der Server sieht nie lesbare Vereinsdaten. Die App verschlüsselt alles auf dem Gerät
   (AES-GCM, Schlüssel aus dem Vereins-Passwort). Hier liegen nur verschlüsselte Bytes.

   Zugang:
   - Header „X-MS-Club“: Lizenz-Hash des Vereins (wie in vereine.txt). Der Server prüft nur,
     ob der Verein freigeschaltet ist (Paket advanced, nicht abgelaufen).
   - Pfad-Teil <space>: 64 Hex-Zeichen, in der App aus Vereins-Passwort + Code abgeleitet.
     Ohne Passwort kennt niemand den Speicherplatz – lesen oder ändern ist so nicht möglich.

   Ablage in R2:
     v1/<club>/<space>/m          verschlüsseltes Manifest (Metadaten: ver)
     v1/<club>/<space>/b/<id>     verschlüsselte Fotos/Dateien (id = HMAC, 64 Hex)

   Schnittstelle (alle Antworten JSON außer Daten-Downloads):
     GET    /v1/ping                       → { ok }
     GET    /v1/s/<space>/ver              → { ver } (ver = '' wenn leer)
     GET    /v1/s/<space>/m                → Manifest-Bytes, Header X-MS-Ver
     POST   /v1/s/<space>/commit           Body: { base, m (Manifest, base64), refs: [ids] } → { ver } | 409 { ver }
     POST   /v1/s/<space>/have             Body: { ids: [...] } → { have: [...] }
     PUT    /v1/s/<space>/b/<id>           Body: Bytes → { ok }
     GET    /v1/s/<space>/b/<id>           → Bytes
     DELETE /v1/s/<space>                  → { deleted }

   Einstellungen (wrangler.toml / Dashboard → Variablen):
     LICENSE_URL      Adresse der Vereinsliste (Standard https://match-shot.de/vereine.txt)
     ALLOWED_ORIGINS  erlaubte App-Adressen, durch Komma getrennt
     QUOTA_MB         Speicher je Verein in MB (Standard 600)
     MAX_SPACES       Sync-Bereiche je Verein (Standard 3)
     DELETE_AFTER_DAYS  Stand eines Vereins ohne gültige Lizenz wird so viele Tage nach dem letzten Hochladen gelöscht (Standard 180)

   Aufräumen (wöchentlich per Cron, siehe wrangler.toml):
   - Vereine, die nicht mehr freigeschaltet sind: Stand löschen, wenn das letzte Hochladen älter als DELETE_AFTER_DAYS ist
   - abgebrochene Uploads (Fotos ohne Stand) nach 7 Tagen löschen
*/

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_BLOB = 25 * 1024 * 1024;     // je Foto/Datei (verschlüsselt)
const MAX_MANIFEST = 20 * 1024 * 1024;
const GC_AGE_MS = 24 * 3600 * 1000;    // nicht mehr benutzte Fotos erst nach einem Tag löschen
const DEFAULT_ORIGINS = 'https://match-shot.de,https://www.match-shot.de,https://fxmz2.github.io';

let licenseCache = { at: 0, text: '' };

function corsHeaders(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    return ok ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-MS-Club',
        'Access-Control-Expose-Headers': 'X-MS-Ver',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin'
    } : { 'Vary': 'Origin' };
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
}

/* Vereinsliste lesen (1 Minute zwischengespeichert) – nur Zeilen mit Hash zählen */
async function licenseText(env) {
    if (env.LICENSE_TEXT !== undefined) return env.LICENSE_TEXT;   // für Tests
    if (Date.now() - licenseCache.at < 60000 && licenseCache.text) return licenseCache.text;
    const url = env.LICENSE_URL || 'https://match-shot.de/vereine.txt';
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000), { cf: { cacheTtl: 60 } });
    if (!res.ok) throw new Error('license list ' + res.status);
    const text = await res.text();
    licenseCache = { at: Date.now(), text };
    return text;
}
function parseDate(s) {
    const t = String(s || '').trim();
    let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
}
async function clubAllowed(env, hash) {
    if (!HEX64.test(hash)) return false;
    const text = await licenseText(env);
    const today = new Date().toISOString().slice(0, 10);
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const parts = t.split('=').map(s => s.trim());
        if ((parts[0] || '').toLowerCase() !== hash) continue;
        const until = parseDate(parts[3]);
        const tier = /^basis$/i.test(parts[4] || '') ? 'basis' : 'advanced';
        return tier === 'advanced' && (!until || until >= today);
    }
    return false;
}

async function listAll(bucket, prefix, delimiter) {
    const objects = [], prefixes = [];
    let cursor;
    do {
        const r = await bucket.list({ prefix, cursor, limit: 1000, delimiter });
        objects.push(...r.objects);
        if (r.delimitedPrefixes) prefixes.push(...r.delimitedPrefixes);
        cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return { objects, prefixes };
}
async function spaceUsage(bucket, base) {
    const { objects } = await listAll(bucket, base);
    return objects.reduce((s, o) => s + (o.size || 0), 0);
}
function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function newVer() {
    const r = crypto.getRandomValues(new Uint8Array(6));
    return Date.now().toString(36) + '-' + Array.from(r, b => b.toString(16).padStart(2, '0')).join('');
}

async function handle(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/v1/ping') return json({ ok: true }, 200, cors);

    const m = path.match(/^\/v1\/s\/([0-9a-f]{64})(?:\/(ver|m|commit|have|b\/([0-9a-f]{64})))?$/);
    if (!m) return json({ error: 'not found' }, 404, cors);
    const club = String(req.headers.get('X-MS-Club') || '').toLowerCase();
    let allowed = false;
    try { allowed = await clubAllowed(env, club); } catch (e) { return json({ error: 'license list unavailable' }, 503, cors); }
    if (!allowed) return json({ error: 'club not allowed' }, 403, cors);

    const bucket = env.BUCKET;
    const space = m[1], what = m[2] || '', blobId = m[3];
    const base = `v1/${club}/${space}/`;
    const quota = (parseInt(env.QUOTA_MB, 10) || 600) * 1024 * 1024;

    if (what === 'ver' && req.method === 'GET') {
        const h = await bucket.head(base + 'm');
        return json({ ver: h?.customMetadata?.ver || '' }, 200, cors);
    }
    if (what === 'm' && req.method === 'GET') {
        const o = await bucket.get(base + 'm');
        if (!o) return json({ error: 'empty' }, 404, cors);
        return new Response(o.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-MS-Ver': o.customMetadata?.ver || '', ...cors } });
    }
    if (what === 'have' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        const ids = Array.isArray(body?.ids) ? body.ids.filter(x => HEX64.test(x)) : [];
        const { objects } = await listAll(bucket, base + 'b/');
        const present = new Set(objects.map(o => o.key.slice(base.length + 2)));
        return json({ have: ids.filter(id => present.has(id)) }, 200, cors);
    }
    if (blobId && req.method === 'PUT') {
        const len = parseInt(req.headers.get('Content-Length') || '0', 10);
        if (len > MAX_BLOB) return json({ error: 'too large' }, 413, cors);
        const data = await req.arrayBuffer();
        if (!data.byteLength || data.byteLength > MAX_BLOB) return json({ error: 'too large' }, 413, cors);
        const existsSpace = await bucket.head(base + 'm');
        if (!existsSpace) {
            const { prefixes } = await listAll(bucket, `v1/${club}/`, '/');
            const max = parseInt(env.MAX_SPACES, 10) || 3;
            if (!prefixes.includes(base) && prefixes.length >= max) return json({ error: 'too many spaces' }, 403, cors);
        }
        if (await spaceUsage(bucket, base) + data.byteLength > quota) return json({ error: 'quota' }, 413, cors);
        await bucket.put(base + 'b/' + blobId, data);
        return json({ ok: true }, 200, cors);
    }
    if (blobId && req.method === 'GET') {
        const o = await bucket.get(base + 'b/' + blobId);
        if (!o) return json({ error: 'missing' }, 404, cors);
        return new Response(o.body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', ...cors } });
    }
    if (what === 'commit' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        if (!body || typeof body.m !== 'string') return json({ error: 'bad request' }, 400, cors);
        const manifest = b64ToBytes(body.m);
        if (!manifest.byteLength || manifest.byteLength > MAX_MANIFEST) return json({ error: 'too large' }, 413, cors);
        const refs = new Set((Array.isArray(body.refs) ? body.refs : []).filter(x => HEX64.test(x)));
        const cur = await bucket.head(base + 'm');
        const curVer = cur?.customMetadata?.ver || '';
        if (String(body.base || '') !== curVer) return json({ error: 'conflict', ver: curVer }, 409, cors);
        if (!cur) {
            const { prefixes } = await listAll(bucket, `v1/${club}/`, '/');
            const max = parseInt(env.MAX_SPACES, 10) || 3;
            if (!prefixes.includes(base) && prefixes.length >= max) return json({ error: 'too many spaces' }, 403, cors);
        }
        const { objects } = await listAll(bucket, base + 'b/');
        const present = new Set(objects.map(o => o.key.slice(base.length + 2)));
        const missing = [...refs].filter(id => !present.has(id));
        if (missing.length) return json({ error: 'missing blobs', missing }, 400, cors);
        const ver = newVer();
        const put = await bucket.put(base + 'm', manifest, { customMetadata: { ver }, onlyIf: cur ? { etagMatches: cur.etag } : undefined });
        if (!put) return json({ error: 'conflict', ver: curVer }, 409, cors);
        // Aufräumen: Fotos, die kein Stand mehr braucht und älter als ein Tag sind
        const now = Date.now();
        const old = objects.filter(o => !refs.has(o.key.slice(base.length + 2)) && now - new Date(o.uploaded).getTime() > GC_AGE_MS).map(o => o.key);
        for (let i = 0; i < old.length; i += 1000) await bucket.delete(old.slice(i, i + 1000));
        return json({ ver }, 200, cors);
    }
    if (!what && req.method === 'DELETE') return json({ deleted: await deletePrefix(bucket, base) }, 200, cors);
    return json({ error: 'method not allowed' }, 405, cors);
}

async function deletePrefix(bucket, prefix) {
    const { objects } = await listAll(bucket, prefix);
    const keys = objects.map(o => o.key);
    for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
    return keys.length;
}
async function cleanup(env, now = Date.now()) {
    const bucket = env.BUCKET, days = parseInt(env.DELETE_AFTER_DAYS, 10) || 180;
    const { prefixes: clubs } = await listAll(bucket, 'v1/', '/');
    let deleted = 0;
    for (const cp of clubs) {
        const allowed = await clubAllowed(env, cp.slice(3, -1));   // Fehler beim Laden der Liste → Abbruch, nichts wird gelöscht
        const { prefixes: spaces } = await listAll(bucket, cp, '/');
        for (const sp of spaces) {
            const m = await bucket.head(sp + 'm');
            if (m) {
                if (!allowed && now - new Date(m.uploaded).getTime() > days * 864e5) deleted += await deletePrefix(bucket, sp);
            } else {
                const { objects } = await listAll(bucket, sp);
                const newest = Math.max(0, ...objects.map(o => new Date(o.uploaded).getTime()));
                if (now - newest > 7 * 864e5) deleted += await deletePrefix(bucket, sp);
            }
        }
    }
    return deleted;
}

export default {
    async fetch(req, env) {
        try { return await handle(req, env); }
        catch (e) { return json({ error: 'server error' }, 500, corsHeaders(req, env)); }
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(cleanup(env));
    },
    cleanup   // für Tests
};
