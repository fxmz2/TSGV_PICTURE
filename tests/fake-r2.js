/* Nachbau des Cloudflare-R2-Speichers (nur was sync/worker.js braucht) – für die Tests */
class FakeR2 {
    constructor() { this.store = new Map(); this.n = 0; }
    _obj(key, v) { return { key, size: v.data.byteLength, etag: v.etag, uploaded: v.uploaded, customMetadata: v.meta }; }
    async head(key) { const v = this.store.get(key); return v ? this._obj(key, v) : null; }
    async get(key) {
        const v = this.store.get(key);
        if (!v) return null;
        return { ...this._obj(key, v), body: v.data.slice(0), arrayBuffer: async () => v.data.slice(0) };
    }
    async put(key, value, opts = {}) {
        const cur = this.store.get(key);
        if (opts.onlyIf && opts.onlyIf.etagMatches && (!cur || cur.etag !== opts.onlyIf.etagMatches)) return null;
        const data = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) : value);
        const v = { data, etag: 'e' + (++this.n), uploaded: new Date(), meta: opts.customMetadata || {} };
        this.store.set(key, v);
        return this._obj(key, v);
    }
    async delete(keys) { (Array.isArray(keys) ? keys : [keys]).forEach(k => this.store.delete(k)); }
    async list({ prefix = '', cursor, limit = 1000, delimiter } = {}) {
        const keys = [...this.store.keys()].filter(k => k.startsWith(prefix)).sort();
        const objects = [], prefixes = new Set();
        keys.forEach(k => {
            if (delimiter) { const rest = k.slice(prefix.length), i = rest.indexOf(delimiter); if (i >= 0) { prefixes.add(prefix + rest.slice(0, i + 1)); return; } }
            objects.push(this._obj(k, this.store.get(k)));
        });
        const start = cursor ? parseInt(cursor, 10) : 0;
        const page = objects.slice(start, start + limit);
        const truncated = start + limit < objects.length;
        return { objects: page, truncated, cursor: truncated ? String(start + limit) : undefined, delimitedPrefixes: [...prefixes] };
    }
}
module.exports = { FakeR2 };
