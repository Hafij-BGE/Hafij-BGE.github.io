// "Ask AI": a chain of AI providers ("channels"). Each question goes to the first channel that is
// available; if it hits a limit or fails, the next one is tried automatically. Keys are the owner's
// own, kept in his private settings; requests go straight from his browser to the provider.

export const PROVIDERS = {
  openrouter: { name: 'OpenRouter', site: 'https://openrouter.ai/', keyHint: 'sk-or-…', defaultModel: 'openrouter/free' },
  gemini: { name: 'Google Gemini', site: 'https://aistudio.google.com/', keyHint: 'AIza…', defaultModel: '' },
  groq: { name: 'Groq', site: 'https://console.groq.com/', keyHint: 'gsk_…', defaultModel: '' },
  mistral: { name: 'Mistral', site: 'https://console.mistral.ai/', keyHint: '', defaultModel: 'mistral-small-latest' },
};
const OPENAI_BASE = { openrouter: 'https://openrouter.ai/api/v1', groq: 'https://api.groq.com/openai/v1', mistral: 'https://api.mistral.ai/v1' };

/* ---- per-device memory of which channels are resting after a limit ---- */
const STATE_KEY = 'rl.aiState';
export function aiState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; } }
function setState(id, patch) {
  const s = aiState(); s[id] = { ...(s[id] || {}), ...patch };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
}
export const restingUntil = id => { const u = (aiState()[id] || {}).until || 0; return u > Date.now() ? u : 0; };
export const clearRest = id => setState(id, { until: 0 });
const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };

class ChannelError extends Error {
  constructor(msg, kind, rest) { super(msg); this.kind = kind; this.rest = rest; }
}

/* ---- one request to one channel ---- */
async function callOnce(ch, messages, signal) {
  let res;
  try {
    if (ch.provider === 'gemini') {
      const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ch.model)}:generateContent?key=${encodeURIComponent(ch.key)}`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents, ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}), generationConfig: { temperature: 0.3 } }),
      });
    } else {
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${ch.key}` };
      if (ch.provider === 'openrouter') { headers['HTTP-Referer'] = location.origin; headers['X-Title'] = 'Research Log'; }
      res = await fetch(`${OPENAI_BASE[ch.provider]}/chat/completions`, {
        method: 'POST', signal, headers, body: JSON.stringify({ model: ch.model, messages, temperature: 0.3 }),
      });
    }
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ChannelError(navigator.onLine ? 'could not be reached from the browser' : 'no internet connection', navigator.onLine ? 'network' : 'offline', 60e3);
  }
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (e) {}
  const errMsg = (body && (body.error && (body.error.message || body.error.status || body.error)) || body && body.message) || text.slice(0, 200) || res.statusText;
  if (!res.ok) {
    const msg = String(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
    const retry = Number(res.headers.get('retry-after')) * 1000;
    const daily = /per[ -]?day|daily|quota|RPD|free-models-per-day|exhausted/i.test(msg);
    if (res.status === 429 || res.status === 402 || (res.status === 403 && daily)) {
      throw new ChannelError(daily ? 'daily limit reached' : 'rate limit reached', 'limit', daily ? nextUtcMidnight() - Date.now() : (retry || 60e3));
    }
    if (res.status === 401 || (res.status === 403 && /key|auth|permission/i.test(msg))) throw new ChannelError('key not accepted — check it in Settings', 'auth', 24 * 3600e3);
    if (res.status === 404 || (res.status === 400 && /model/i.test(msg))) throw new ChannelError(`model “${ch.model}” not available — pick another in Settings`, 'model', 3600e3);
    if (res.status >= 500) throw new ChannelError('provider is having problems', 'server', 120e3);
    throw new ChannelError(msg.slice(0, 160), 'request', 0);
  }
  let out = '', used = ch.model;
  if (ch.provider === 'gemini') {
    const c = body && body.candidates && body.candidates[0];
    out = c && c.content && (c.content.parts || []).map(p => p.text || '').join('') || '';
    if (!out && c && c.finishReason) throw new ChannelError(`no answer (${c.finishReason})`, 'empty', 0);
  } else {
    const c = body && body.choices && body.choices[0];
    out = (c && c.message && (typeof c.message.content === 'string' ? c.message.content : (c.message.content || []).map(p => p.text || '').join(''))) || '';
    used = (body && body.model) || ch.model;
  }
  if (!out.trim()) throw new ChannelError('empty answer', 'empty', 0);
  return { text: out.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim(), model: used };
}

// Try each enabled channel in order, skipping those resting after a limit. Reports every switch.
export async function askChain(channels, messages, { onTry, signal } = {}) {
  const usable = channels.filter(c => c.enabled !== false && c.key && c.model);
  if (!usable.length) throw new Error('No AI channel is set up yet. Add one in Settings → AI channels.');
  const notes = [];
  const fresh = usable.filter(c => !restingUntil(c.id));
  // If every channel is resting, still try them all (a limit may have reset early).
  const order = fresh.length ? fresh : usable;
  for (const ch of order) {
    onTry && onTry(ch, notes);
    try {
      const r = await callOnce(ch, messages, signal);
      setState(ch.id, { until: 0, last: Date.now(), error: '' });
      return { ...r, channel: ch, notes };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      setState(ch.id, { until: e.rest ? Date.now() + e.rest : 0, error: e.message, errAt: Date.now() });
      notes.push(`${ch.label || PROVIDERS[ch.provider].name}: ${e.message}`);
    }
  }
  const err = new Error('Every AI channel failed or is at its limit right now.');
  err.notes = notes;
  throw err;
}

// Available models for a channel (free ones only, for OpenRouter).
export async function listModels(provider, key) {
  if (provider === 'openrouter') {
    const r = await fetch('https://openrouter.ai/api/v1/models');
    if (!r.ok) throw new Error('OpenRouter did not answer.');
    const list = ((await r.json()).data || []).filter(m => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
    return ['openrouter/free', ...list.map(m => m.id).sort()];
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error(r.status === 400 || r.status === 403 ? 'Key not accepted.' : 'Gemini did not answer.');
    return ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, '')).filter(n => /gemini/i.test(n) && !/embedding|image|tts|audio|live/i.test(n));
  }
  const r = await fetch(`${OPENAI_BASE[provider]}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(r.status === 401 ? 'Key not accepted.' : `${PROVIDERS[provider].name} did not answer.`);
  return ((await r.json()).data || []).map(m => m.id).filter(id => !/whisper|tts|embed|guard|moderation|ocr|orpheus|playai/i.test(id)).sort();
}
// A sensible first pick from a model list.
export function pickDefault(provider, models) {
  const prefer = {
    gemini: [/gemini-[\d.]+-flash$/, /flash(?!.*lite)/, /flash/],
    groq: [/gpt-oss-120b/, /llama.*70b/, /qwen/, /llama/],
    mistral: [/mistral-small-latest/, /mistral-medium-latest/, /small/],
    openrouter: [/^openrouter\/free$/],
  }[provider] || [];
  for (const re of prefer) { const hit = models.filter(m => re.test(m)).sort().reverse()[0]; if (hit) return hit; }
  return models[0] || '';
}

/* ---- data files: the app computes the numbers; the AI only explains them ---- */
export function parseDelimited(text) {
  const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n', 1)[0];
  const delim = [',', '\t', ';'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.filter(r => r.some(v => v.trim() !== ''));
  if (clean.length < 2) return null;
  const header = clean[0].map((h, i) => h.trim() || `column ${i + 1}`);
  return { header, rows: clean.slice(1).map(r => header.map((_, i) => (r[i] ?? '').trim())), delim };
}
const num = v => { const s = String(v).replace(/\s/g, '').replace(/,(?=\d{1,2}$)/, '.'); return s !== '' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(s) ? parseFloat(s) : NaN; };
const missingVal = v => v === '' || /^(na|n\/a|nan|null|none|-|—)$/i.test(v);
export function describe(table) {
  const { header, rows } = table;
  const cols = header.map((h, i) => {
    const vals = rows.map(r => r[i]);
    const present = vals.filter(v => !missingVal(v));
    const nums = present.map(num).filter(Number.isFinite);
    if (present.length && nums.length >= present.length * 0.9) {
      const s = [...nums].sort((a, b) => a - b);
      const mean = s.reduce((a, b) => a + b, 0) / s.length;
      const sd = s.length > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / (s.length - 1)) : 0;
      const q = p => { const k = (s.length - 1) * p, f = Math.floor(k); return s[f] + (s[Math.min(f + 1, s.length - 1)] - s[f]) * (k - f); };
      return { name: h, type: 'number', n: s.length, missing: vals.length - present.length, mean, sd, min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[s.length - 1] };
    }
    const counts = {}; present.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const idLike = top.length === present.length && present.length > 5;   // e.g. sample IDs: values are not shown
    return { name: h, type: 'text', n: present.length, missing: vals.length - present.length, distinct: top.length, idLike, top: idLike ? [] : top.slice(0, 5) };
  });
  // Pearson correlations between number columns (strongest first).
  const numIdx = cols.map((c, i) => (c.type === 'number' ? i : -1)).filter(i => i >= 0);
  const cors = [];
  for (let a = 0; a < numIdx.length; a++) for (let b = a + 1; b < numIdx.length; b++) {
    const pairs = rows.map(r => [num(r[numIdx[a]]), num(r[numIdx[b]])]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (pairs.length < 3) continue;
    const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
    let sxy = 0, sxx = 0, syy = 0; pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
    if (sxx && syy) cors.push({ a: header[numIdx[a]], b: header[numIdx[b]], r: sxy / Math.sqrt(sxx * syy), n: pairs.length });
  }
  cors.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  // Number columns split by each grouping column (2–10 groups), e.g. titre by vaccine/control.
  const groups = [];
  cols.forEach((g, gi) => {
    if (g.type !== 'text' || g.idLike || g.distinct < 2 || g.distinct > 10) return;
    numIdx.forEach(ni => {
      const by = {};
      rows.forEach(r => { const k = r[gi], v = num(r[ni]); if (!missingVal(k) && Number.isFinite(v)) (by[k] ||= []).push(v); });
      const stats = Object.entries(by).map(([k, v]) => {
        const s = v.sort((a, b) => a - b), m = s.reduce((a, b) => a + b, 0) / s.length;
        const sd = s.length > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / (s.length - 1)) : 0;
        const mid = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
        return { group: k, n: s.length, mean: m, sd, median: mid };
      });
      if (stats.length >= 2) groups.push({ by: g.name, col: header[ni], stats });
    });
  });
  return { rows: rows.length, cols, cors: cors.slice(0, 8), groups: groups.slice(0, 12) };
}
export const fmtNum = v => (v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : Number(v.toFixed(Math.abs(v) < 10 ? 3 : 2)).toString());
export function describeText(name, d) {
  const L = [`Data file "${name}": ${d.rows} rows, ${d.cols.length} columns. Statistics computed exactly by the app:`];
  d.cols.forEach(c => L.push(c.type === 'number'
    ? `- ${c.name} (number): n=${c.n}, missing=${c.missing}, mean=${fmtNum(c.mean)}, sd=${fmtNum(c.sd)}, min=${fmtNum(c.min)}, Q1=${fmtNum(c.q1)}, median=${fmtNum(c.median)}, Q3=${fmtNum(c.q3)}, max=${fmtNum(c.max)}`
    : `- ${c.name} (text): n=${c.n}, missing=${c.missing}, ${c.idLike ? 'all values different (identifier column; values not shown)' : `${c.distinct} distinct; most common: ${c.top.map(([v, k]) => `${v} (${k})`).join(', ')}`}`));
  d.groups.forEach(g => L.push(`${g.col} by ${g.by}: ` + g.stats.map(s => `${s.group}: n=${s.n}, mean=${fmtNum(s.mean)}, sd=${fmtNum(s.sd)}, median=${fmtNum(s.median)}`).join('; ')));
  if (d.cors.length) L.push('Pearson correlations (strongest first): ' + d.cors.map(c => `${c.a} vs ${c.b}: r=${c.r.toFixed(3)} (n=${c.n})`).join('; '));
  return L.join('\n');
}
