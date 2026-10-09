// Read-only viewer for a shared link: #<id>.<key>. No sign-in, no editing.
// Fetches one encrypted record and opens it with the key from the link, which never leaves this browser.
import { KINDS, SECTIONS, APP_GROUPS, appGroup } from './schema.js';
import CFG from './firebase-config.js';
import { unseal } from './share.js';
import { formatRef, linkHref, linkTypeLabel } from './refs.js';

const root = document.getElementById('v');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = { projectName: v => v || '', title: v => v || '', activity: () => '' };
const state = { data: null, kind: null, q: '' };

function fail(msg) {
  root.innerHTML = `<div class="signin"><div class="logo-tiles big"><i></i><i></i><i></i><i></i></div><h1>Research Log</h1><p>${esc(msg)}</p></div>`;
}

async function load() {
  const m = /^#([A-Za-z0-9_-]{20,})\.([A-Za-z0-9_-]{40,})$/.exec(location.hash);
  if (!m) return fail('This link is incomplete. Ask for the full link again.');
  const [, id, key] = m;
  let doc;
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${CFG.projectId}/databases/(default)/documents/shares/${id}?key=${CFG.apiKey}`, { cache: 'no-store', referrerPolicy: 'strict-origin' });
    if (res.status === 404 || res.status === 403) return fail('This link has been turned off, or it does not exist.');
    if (!res.ok) throw new Error(res.status);
    const f = (await res.json()).fields || {};
    doc = { iv: f.iv && f.iv.stringValue, data: f.data && f.data.stringValue, updatedAt: f.updatedAt && Number(f.updatedAt.integerValue) };
  } catch (e) { return fail('Could not load right now. Check your connection and reload the page.'); }
  try { state.data = await unseal(key, doc); }
  catch (e) { return fail('This link is not valid. Ask for the full link again.'); }
  state.data.updatedAt = doc.updatedAt || state.data.generatedAt;
  const present = SECTIONS.flatMap(s => s.kinds).filter(k => state.data.items.some(x => x.kind === k));
  state.kind = present[0] || null;
  render();
}

function fmt(f, v) {
  switch (f.type) {
    case 'textarea': return esc(v).replace(/\n/g, '<br>');
    case 'url': {
      const u = /^10\.\d/.test(v) ? 'https://doi.org/' + v : v;
      return /^https?:\/\//.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(v)}</a>` : esc(v);
    }
    case 'links': return `<ul class="vlist">${(v || []).map(l => { const h = linkHref(l.url); return `<li><span class="badge n">${esc(linkTypeLabel(l.type))}</span> ${h ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>` : esc(l.label || l.url)}</li>`; }).join('')}</ul>`;
    case 'refs': return `<ol class="vlist refs">${(v || []).map(r => `<li>${esc(formatRef(r))}</li>`).join('')}</ol>`;
    case 'check': return v ? 'Yes' : 'No';
    case 'range': return `${Number(v) || 0}%`;
    case 'tags': case 'checklist': return (v || []).map(t => `<span class="badge n">${esc(t)}</span>`).join(' ');
    default: return esc(v);
  }
}
function rowHTML(x) {
  const K = KINDS[x.kind];
  const badge = K.badge && K.badge(x), warn = K.warn && K.warn(x);
  const details = K.fields.filter(f => f.key !== 'title' && f.type !== 'photos' && x[f.key] !== undefined && x[f.key] !== '')
    .map(f => `<div class="vf"><dt>${esc(f.label.replace(/\s*\(.*\)$/, ''))}</dt><dd>${fmt(f, x[f.key])}</dd></div>`).join('');
  return `<li class="vrow" style="--c:${K.color}"><details>
    <summary><span class="dot"></span><span class="rowmain"><span class="t">${esc(x.title)}</span><span class="s">${esc(K.sub(x, ctx))}</span>
      ${K.progress ? `<span class="bar"><i style="width:${Math.min(100, K.progress(x))}%"></i></span>` : ''}</span>
      ${warn ? `<span class="badge r">${esc(warn)}</span>` : badge ? `<span class="badge n">${esc(badge)}</span>` : ''}</summary>
    ${details ? `<dl class="vdl">${details}</dl>` : '<p class="muted small">No further details.</p>'}
  </details></li>`;
}

function render() {
  const d = state.data;
  const kinds = SECTIONS.flatMap(s => s.kinds).filter(k => d.items.some(x => x.kind === k));
  const q = state.q.trim().toLowerCase();
  let list = d.items.filter(x => x.kind === state.kind && (!q || JSON.stringify(x).toLowerCase().includes(q)));
  if (state.kind) list.sort(KINDS[state.kind].sort);
  let body;
  if (!kinds.length) body = `<div class="empty"><p>Nothing has been shared here yet.</p></div>`;
  else if (!list.length) body = `<div class="empty"><p>No matches.</p></div>`;
  else if (state.kind === 'application') {
    body = APP_GROUPS.map(g => [g, list.filter(x => appGroup(x) === g.id)]).filter(([, l]) => l.length)
      .map(([g, l]) => `<section class="appgroup g-${g.id}"><h3 class="grouph"><i></i>${g.label} <span>${l.length}</span></h3><ul class="vrows">${l.map(rowHTML).join('')}</ul></section>`).join('');
  } else body = `<ul class="vrows">${list.map(rowHTML).join('')}</ul>`;
  root.innerHTML = `<header class="vhead">
      <div class="logo-tiles"><i></i><i></i><i></i><i></i></div>
      <div><h1>${esc(d.name ? d.name + ' · Research Log' : 'Research Log')}</h1>
      <p>Read-only view${d.updatedAt ? ` · updated ${esc(new Date(d.updatedAt).toLocaleString())}` : ''}</p></div>
    </header>
    <main class="vmain">
      ${kinds.length > 1 ? `<div class="seg" role="tablist">${kinds.map(k => `<a role="tab" href="#" data-k="${k}" class="${k === state.kind ? 'on' : ''}" aria-selected="${k === state.kind}">${esc(KINDS[k].plural)}<span>${d.items.filter(x => x.kind === k).length}</span></a>`).join('')}</div>` : ''}
      ${kinds.length ? `<div class="toolbar"><input id="vq" class="filter" type="search" placeholder="Search ${esc(KINDS[state.kind].plural.toLowerCase())}…" value="${esc(state.q)}" aria-label="Search"></div>` : ''}
      ${body}
      <p class="small muted vfoot">Shared by the owner from a private Research Log. You can view but not change anything.</p>
    </main>`;
}
root.addEventListener('click', e => {
  const a = e.target.closest('a[data-k]');
  if (!a) return;
  e.preventDefault(); state.kind = a.dataset.k; state.q = ''; render();
});
root.addEventListener('input', e => {
  if (e.target.id !== 'vq') return;
  state.q = e.target.value; const pos = e.target.selectionStart; render();
  const q = document.getElementById('vq'); q.focus(); q.setSelectionRange(pos, pos);
});
addEventListener('hashchange', () => location.reload());
load();
