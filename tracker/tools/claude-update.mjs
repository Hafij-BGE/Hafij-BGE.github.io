// Encrypt a Research Log update with the owner's code and add it to <site>/tracker/updates/.
// Usage: node claude-update.mjs <code> <items.json> <siteDir>
import fs from 'node:fs'; import path from 'node:path';
const [code, input, site] = process.argv.slice(2);
if (!code || !input || !site) { console.error('usage: node claude-update.mjs <code> <items.json> <siteDir>'); process.exit(1); }
const payload = JSON.parse(fs.readFileSync(input, 'utf8'));
const items = (payload.items || payload).map(({ _delete, ...x }) => x);           // updates never delete
const enc = new TextEncoder(), b64 = u => Buffer.from(u).toString('base64');
const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 200000;
const base = await crypto.subtle.importKey('raw', enc.encode(code.trim()), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
// Optional: AI channels (provider, key, model) for the owner's private settings.
const ai = payload.ai && Array.isArray(payload.ai.channels) ? { channels: payload.ai.channels } : undefined;
const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify({ v: 1, items, ...(ai ? { ai } : {}) }))));
const dir = path.join(site, 'tracker', 'updates'); fs.mkdirSync(dir, { recursive: true });
const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Buffer.from(crypto.getRandomValues(new Uint8Array(3))).toString('hex');
fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) }));
const idxPath = path.join(dir, 'index.json');
const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { files: [] };
idx.files.push(id); fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
console.log(`update ${id}: ${items.length} records${ai ? ` + ${ai.channels.length} AI channels` : ''} encrypted`);
