// Read-only links and the public website feed.
// A link holds two parts after "#": the record's id and a 256-bit key. The data is stored encrypted
// (AES-256-GCM) in shares/{id}; the key exists only in the link and in the owner's private settings,
// so the database never holds anything readable. Only the record types the owner ticks are included,
// records marked Private never are, and personal notes / contact details can be left out.
import { KINDS } from './schema.js';

export const SENSITIVE = ['notes', 'email', 'supervisorEmail', 'fit'];
// What the public website may show, and which records of each type.
export const SITE_KINDS = ['publication', 'talk', 'award', 'project'];
const siteOk = (x, cfg) => {
  if (x.kind === 'publication') return cfg.inProgress || ['Published', 'Accepted'].includes(x.status);
  if (x.kind === 'project') return ['Active', 'Done'].includes(x.status);
  return true;
};

const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

export function newLink(name) {
  return { id: b64u(crypto.getRandomValues(new Uint8Array(18))), key: b64u(crypto.getRandomValues(new Uint8Array(32))), name, created: Date.now() };
}
export const linkUrl = l => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}view.html#${l.id}.${l.key}`;

// The records a viewer may see, with only the fields that are allowed.
export function snapshot(items, cfg, { site = false } = {}) {
  const byId = Object.fromEntries(items.map(x => [x.id, x]));
  const shown = x => x && !x.noShare && cfg.kinds.includes(x.kind) && KINDS[x.kind] && (!site || siteOk(x, cfg));
  const out = items.filter(shown).map(x => {
    const rec = { id: x.id, kind: x.kind };
    for (const f of KINDS[x.kind].fields) {
      let v = x[f.key];
      if (f.type === 'photos' || v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      if ((site || cfg.hideNotes) && SENSITIVE.includes(f.key)) continue;
      if (site && f.type === 'checklist') continue;
      if (f.type === 'ref') { const t = byId[v]; if (!shown(t)) continue; v = t.title; }
      rec[f.key] = v;
    }
    if (x.updatedAt) rec.updatedAt = x.updatedAt;
    return rec;
  });
  out.sort((a, b) => a.kind.localeCompare(b.kind) || String(a.title).localeCompare(String(b.title)));
  return out;
}

export async function seal(link, payload) {
  const key = await crypto.subtle.importKey('raw', fromB64u(link.key), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(payload))));
  return { v: 1, iv: b64(iv), data: b64(ct) };
}
export async function unseal(keyB64u, doc) {
  const key = await crypto.subtle.importKey('raw', fromB64u(keyB64u), 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(doc.iv), c => c.charCodeAt(0)) }, key, Uint8Array.from(atob(doc.data), c => c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(pt));
}
