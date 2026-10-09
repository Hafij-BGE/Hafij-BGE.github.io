import { KINDS, SECTIONS, CV_SEED, dueLabel, textOf } from './schema.js';
import { CloudStore, LocalStore, newId, wipeLocal, parseSetup, loadSetup, saveSetup } from './store.js';
import qrcode from 'qrcode-generator';

// "Add another device": the setup travels in the URL fragment (#setup=…), which browsers never
// send to any server. Save it on this device, then wipe it from the address bar and history.
(function takeSetupLink() {
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  let ok = false;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const parsed = parseSetup(decodeURIComponent(escape(atob(b64))));
    if (parsed) ok = saveSetup(parsed);
  } catch (e) {}
  history.replaceState(null, '', location.pathname);
  if (!ok) setTimeout(() => toast('That setup code could not be read. Try scanning it again.', true), 600);
})();

// Built-in project identifiers (not secrets: data is locked to the owner's accounts by Firestore rules,
// and the key only works from the owner's sites). A per-device setup remains as a fallback.
const builtIn = parseSetup(JSON.stringify(window.FIREBASE_CONFIG || {}));
const cfg = builtIn || loadSetup();
const hasCfg = !!cfg;

let store;
let items = [], byId = {}, user = null, status = '', authKnown = false;
let deferredInstall = null;
let editor = null;            // { kind, item, isNew, newPhotos:[], removedPhotos:[], dirty }
let pendingOpen = null;       // a just-created record not yet echoed back by the store
const ui = { showDone: false, filters: {} };

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = { projectName: id => (id && byId[id] ? byId[id].title : '') };
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- icons ---------------- */
const I = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  lab: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  research: '<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  profile: '<circle cx="12" cy="8" r="5"/><path d="M8.5 12.5 7 21l5-3 5 3-1.5-8.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  img: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

/* ---------------- routing ---------------- */
function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const r = { view: p[0] || 'home' };
  const sec = SECTIONS.find(s => s.id === r.view);
  if (sec) {
    r.section = sec;
    r.kind = sec.kinds.includes(p[1]) ? p[1] : sec.kinds[0];
    if (p[2] === 'new') r.edit = 'new';
    if (p[2] === 'edit' && p[3]) r.edit = p[3];
  }
  return r;
}
const go = h => { if (location.hash !== h) location.hash = h; else render(); };
addEventListener('hashchange', () => { openEditorFromRoute(); render(); });

/* ---------------- boot ---------------- */
function boot() {
  store = hasCfg ? new CloudStore(cfg) : new LocalStore();
  store.on('auth', u => { user = u; authKnown = true; if (!u) items = []; render(); });
  store.on('items', list => {
    items = list; byId = Object.fromEntries(list.map(x => [x.id, x]));
    if (editor) {
      const cur = byId[editor.item.id];
      if (!editor.isNew && !editor.warned && cur && editor.origUpdatedAt && cur.updatedAt !== editor.origUpdatedAt) {
        editor.warned = true;
        toast('Heads up: this record was just changed on another device.', true);
      }
      return renderChrome();
    }
    render();
  });
  store.on('status', s => { status = s; renderStatus(); });
  store.on('error', msg => toast(msg, true));
  store.on('denied', () => {
    alert('This Google account is not allowed to open this Research Log. You will be signed out.');
    store.signOut();
  });
  if (store.mode === 'cloud') store.on('items', () => offerMigration());
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
}

/* ---------------- render ---------------- */
function render() {
  if (!authKnown) { app.innerHTML = `<div class="splash"><div class="logo-tiles big"><i></i><i></i><i></i><i></i></div></div>`; return; }
  if (!user) return renderSignIn();
  if (!app.querySelector('.shell')) app.innerHTML = shellHTML();
  renderChrome();
  const r = route();
  const view = app.querySelector('#view');
  let html = '';
  if (r.section) html = sectionHTML(r);
  else if (r.view === 'search') html = searchHTML();
  else if (r.view === 'settings') html = settingsHTML();
  else html = homeHTML();
  view.innerHTML = html;
  view.scrollTop = 0;
  if (r.view === 'search') { const q = view.querySelector('#q'); q && q.focus(); }
  const fab = app.querySelector('#fab');
  fab.hidden = !r.section;
  if (r.section) fab.setAttribute('aria-label', 'Add ' + KINDS[r.kind].label.toLowerCase());
  openEditorFromRoute();
}

function renderChrome() {
  const r = route();
  app.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.v === (r.section ? r.section.id : r.view)));
  const titles = { home: 'Research Log', search: 'Search', settings: 'Settings' };
  app.querySelector('#title').textContent = r.section ? r.section.label : titles[r.view] || 'Research Log';
  renderStatus();
}

function renderStatus() {
  const el = app.querySelector('#sync');
  if (!el) return;
  const map = {
    synced: ['ok', 'Synced'], saving: ['busy', 'Saving…'], connecting: ['busy', 'Connecting…'],
    offline: ['off', 'Offline · will sync'], local: ['warn', 'This device only'],
  };
  const [cls, txt] = map[status] || ['busy', '…'];
  el.className = 'sync ' + cls; el.innerHTML = `<i></i>${txt}`;
}

function shellHTML() {
  const nav = [['home', 'Home', '#/home'], ['lab', 'Lab', '#/lab'], ['research', 'Research', '#/research'], ['profile', 'Profile', '#/profile'], ['settings', 'Settings', '#/settings']];
  return `<div class="shell">
    <nav class="nav" aria-label="Sections">
      <div class="nav-brand"><div class="logo-tiles"><i></i><i></i><i></i><i></i></div><b>Research Log</b></div>
      ${nav.map(([v, l, h]) => `<a href="${h}" data-v="${v}">${icon(v)}<span>${l}</span></a>`).join('')}
    </nav>
    <div class="main">
      <header class="appbar">
        <h1 id="title">Research Log</h1>
        <span id="sync" class="sync"></span>
        <a class="iconbtn" href="#/search" aria-label="Search">${icon('search')}</a>
      </header>
      <main id="view"></main>
    </div>
    <button id="fab" class="fab" data-act="add" hidden>${icon('plus')}</button>
    <div id="sheet" class="sheet" hidden></div>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>`;
}

function renderSignIn() {
  app.innerHTML = `<div class="signin">
    <div class="logo-tiles big"><i></i><i></i><i></i><i></i></div>
    <h1>Research Log</h1>
    <p>Lab notebook, research progress and academic record — synced between your phone and the web, backed up to your Google account.</p>
    <button class="btn primary big" data-act="signin">
      <svg viewBox="0 0 48 48" class="g" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Sign in with Google</button>
    <p class="small">Your data is private to your Google account.</p>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>`;
}

/* ---------------- home ---------------- */
function homeHTML() {
  const name = (user.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const of = k => items.filter(x => x.kind === k);
  const soon = of('task').filter(t => !t.done && t.due && (new Date(t.due) - new Date(today())) / 864e5 <= 7).sort(KINDS.task.sort);
  const expiring = of('inventory').filter(x => KINDS.inventory.warn(x));
  const recent = of('experiment').sort(KINDS.experiment.sort).slice(0, 4);
  const active = of('project').filter(p => p.status === 'Active').sort(KINDS.project.sort);
  const local = store.mode === 'local';

  return `
  ${local ? `<div class="banner warn"><b>Not syncing yet.</b> Data stays in this browser until you connect Google sync. <a href="#/settings">Connect</a></div>` : ''}
  <section class="hello">
    <h2>${greet}${name ? ', ' + esc(name) : ''}</h2>
    <p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  </section>
  <div class="quick">
    ${[['lab', 'experiment', 'Experiment'], ['research', 'task', 'Task'], ['lab', 'inventory', 'Sample'], ['research', 'paper', 'Paper']]
      .map(([s, k, l]) => `<a class="qbtn" href="#/${s}/${k}/new" style="--c:${KINDS[k].color}">${icon('plus')}${l}</a>`).join('')}
  </div>
  ${items.length === 0 ? `<section class="card welcome">
     <h3>Start with what you already have</h3>
     <p>Import your publications, talks, awards and current projects from your CV in one tap. You can edit or delete them later.</p>
     <button class="btn primary" data-act="seed">Import CV &amp; projects</button></section>` : ''}
  <div class="grid2">
    <section class="card">
      <h3>Due this week</h3>
      ${soon.length ? `<ul class="rows">${soon.map(rowHTML).join('')}</ul>` : `<p class="muted">Nothing due in the next 7 days.</p>`}
      <a class="more" href="#/research/task">All tasks</a>
    </section>
    <section class="card">
      <h3>Active projects</h3>
      ${active.length ? `<ul class="rows">${active.map(rowHTML).join('')}</ul>` : `<p class="muted">No active projects.</p>`}
      <a class="more" href="#/research/project">All projects</a>
    </section>
    <section class="card">
      <h3>Recent lab entries</h3>
      ${recent.length ? `<ul class="rows">${recent.map(rowHTML).join('')}</ul>` : `<p class="muted">No experiments recorded yet.</p>`}
      <a class="more" href="#/lab/experiment">Lab notebook</a>
    </section>
    <section class="card">
      <h3>Stock alerts</h3>
      ${expiring.length ? `<ul class="rows">${expiring.map(rowHTML).join('')}</ul>` : `<p class="muted">Nothing expired or expiring within 30 days.</p>`}
      <a class="more" href="#/lab/inventory">Inventory</a>
    </section>
  </div>
  <section class="card">
    <h3>At a glance</h3>
    <div class="counts">
      ${SECTIONS.flatMap(s => s.kinds.map(k => `<a href="#/${s.id}/${k}" style="--c:${KINDS[k].color}"><b>${of(k).length}</b><span>${KINDS[k].plural}</span></a>`)).join('')}
    </div>
  </section>`;
}

/* ---------------- section list ---------------- */
function sectionHTML(r) {
  const K = KINDS[r.kind];
  let list = items.filter(x => x.kind === r.kind);
  const doneCount = r.kind === 'task' ? list.filter(t => t.done).length : 0;
  if (r.kind === 'task' && !ui.showDone) list = list.filter(t => !t.done);
  const f = (ui.filters[r.kind] || '').trim().toLowerCase();
  if (f) list = list.filter(x => textOf(x).includes(f));
  list.sort(K.sort);
  return `
  <div class="seg" role="tablist">
    ${r.section.kinds.map(k => `<a role="tab" href="#/${r.section.id}/${k}" class="${k === r.kind ? 'on' : ''}" aria-selected="${k === r.kind}">${KINDS[k].plural}<span>${items.filter(x => x.kind === k).length}</span></a>`).join('')}
  </div>
  <div class="toolbar">
    <input id="filter" class="filter" type="search" placeholder="Filter ${K.plural.toLowerCase()}…" value="${esc(ui.filters[r.kind] || '')}" aria-label="Filter">
    ${r.kind === 'task' ? `<label class="toggle"><input type="checkbox" data-act="showdone" ${ui.showDone ? 'checked' : ''}> Show done (${doneCount})</label>` : ''}
  </div>
  ${list.length ? `<ul class="rows big">${list.map(rowHTML).join('')}</ul>`
    : `<div class="empty">${icon(r.section.id)}<p>${f ? 'No matches.' : `No ${K.plural.toLowerCase()} yet.`}</p>
       ${f ? '' : `<a class="btn primary" href="#/${r.section.id}/${r.kind}/new">${icon('plus')} Add ${K.label.toLowerCase()}</a>`}</div>`}`;
}

function sectionOf(kind) { return SECTIONS.find(s => s.kinds.includes(kind)).id; }

function badgeClass(v) {
  if (['Completed', 'Done', 'Published', 'Read', 'In stock', 'Accepted'].includes(v)) return 'g';
  if (['In progress', 'Active', 'Reading', 'Under review', 'Submitted', 'Revision'].includes(v)) return 'b';
  if (['Failed', 'Expired', 'Used up', 'High'].includes(v)) return 'r';
  if (['Low', 'On hold', 'Repeated'].includes(v)) return 'a';
  return 'n';
}

function linkOf(x) {
  const v = x.doi || x.link || x.source;
  if (!v) return '';
  return /^10\.\d/.test(v) ? 'https://doi.org/' + v : (/^https?:\/\//.test(v) ? v : '');
}

function rowHTML(x) {
  const K = KINDS[x.kind];
  const href = `#/${sectionOf(x.kind)}/${x.kind}/edit/${x.id}`;
  const badge = K.badge && K.badge(x);
  const warn = K.warn && K.warn(x);
  const overdue = x.kind === 'task' && !x.done && x.due && x.due < today();
  const link = linkOf(x);
  const photos = (x.photos || []).length;
  return `<li class="row ${x.done ? 'done' : ''}" style="--c:${K.color}">
    ${K.checkable ? `<label class="chk"><input type="checkbox" data-act="toggle" data-id="${x.id}" ${x.done ? 'checked' : ''} aria-label="Mark done"><i></i></label>` : '<span class="dot"></span>'}
    <a class="rowmain" href="${href}">
      <span class="t">${esc(x.title || '(untitled)')}</span>
      <span class="s ${overdue ? 'late' : ''}">${esc(K.sub(x, ctx))}</span>
      ${K.progress ? `<span class="bar"><i style="width:${Math.min(100, K.progress(x))}%"></i></span>` : ''}
    </a>
    <span class="tail">
      ${photos ? `<span class="pc" title="${photos} photo${photos > 1 ? 's' : ''}">${icon('img')}${photos}</span>` : ''}
      ${warn ? `<span class="badge r">${esc(warn)}</span>` : badge ? `<span class="badge ${badgeClass(badge)}">${esc(badge)}</span>` : ''}
      ${link ? `<a class="iconbtn sm" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Open link">${icon('ext')}</a>` : ''}
    </span>
  </li>`;
}

/* ---------------- search ---------------- */
function searchHTML() {
  return `<div class="toolbar"><input id="q" class="filter" type="search" placeholder="Search everything — experiments, protocols, papers…" value="${esc(ui.q || '')}" aria-label="Search"></div>
  <div id="results">${searchResults()}</div>`;
}
function searchResults() {
  const q = (ui.q || '').trim().toLowerCase();
  if (!q) return `<p class="muted pad">Type to search across all ${items.length} records.</p>`;
  const hits = items.filter(x => textOf(x).includes(q));
  if (!hits.length) return `<p class="muted pad">No results for “${esc(ui.q)}”.</p>`;
  const groups = {};
  hits.forEach(x => (groups[x.kind] ||= []).push(x));
  return Object.entries(groups).map(([k, list]) =>
    `<h3 class="grouph">${KINDS[k].plural} <span>${list.length}</span></h3><ul class="rows big">${list.sort(KINDS[k].sort).map(rowHTML).join('')}</ul>`).join('');
}

/* ---------------- settings ---------------- */
function settingsHTML() {
  const local = store.mode === 'local';
  return `
  <section class="card">
    <h3>Account</h3>
    <div class="acct">
      ${user.photo ? `<img src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">` : `<div class="logo-tiles"><i></i><i></i><i></i><i></i></div>`}
      <div><b>${esc(user.name || 'Local mode')}</b><span>${esc(user.email || '')}</span></div>
    </div>
    ${local ? `<p class="banner warn">Google sync isn't connected on this device yet, so records are saved only in this browser.</p>
      <h3 style="margin-top:16px">Connect Google sync</h3>
      <p class="muted small">Paste your Firebase setup (the <code>firebaseConfig = { … }</code> block). It is saved only in this browser — it is not part of the website and is not sent anywhere except to your own Firebase project.</p>
      <textarea id="setupText" class="setup" rows="6" spellcheck="false" autocomplete="off" placeholder="apiKey: &quot;…&quot;, authDomain: &quot;…&quot;, projectId: &quot;…&quot;, appId: &quot;…&quot;"></textarea>
      <div class="btnrow"><button class="btn primary" data-act="connect">Connect and sign in</button></div>`
      : `<p class="muted">Records sync live between all devices signed in with this Google account and are stored in your own Firebase project. Only your account can read them. The app also keeps an offline copy on this device so you can work without a connection.</p>
         <button class="btn" data-act="signout">Sign out and erase this device's copy</button>`}
  </section>
  ${local ? '' : builtIn ? `<section class="card">
    <h3>Use on other devices</h3>
    <p class="muted">Open <b>hafij-bge.github.io/tracker</b> on any phone, tablet or computer and sign in with Google. Everything stays in sync live.</p>
  </section>` : `<section class="card">
    <h3>Add another device</h3>
    <p class="muted">Use as many phones, tablets and computers as you like — all stay in sync live. To set one up, show the code here and scan it with the other device's camera, then sign in with Google there.</p>
    <div class="btnrow">
      <button class="btn primary" data-act="showqr">Show setup code</button>
      <button class="btn" data-act="copysetup">${icon('copy')} Copy setup link</button>
    </div>
    <div id="qrbox" class="qrbox" hidden></div>
    <p class="small muted">The code holds your project's connection details — not your password and not your data, which only your Google account can open. Share it only with your own devices.</p>
  </section>`}
  <section class="card">
    <h3>Install</h3>
    <p class="muted">Use the same app on your phone and computer.</p>
    <div class="btnrow">
      ${deferredInstall ? `<button class="btn primary" data-act="install">${icon('download')} Install on this device</button>` : ''}

    </div>
    <p class="small muted">On Android, open this page in Chrome and choose <b>⋮ → Add to Home screen</b>, or install your private Android app.</p>
  </section>
  <section class="card">
    <h3>Backup</h3>
    <p class="muted">An extra copy you control: export everything as a file you can keep in Google Drive.</p>
    <div class="btnrow">
      <button class="btn" data-act="export">${icon('download')} Export data (.json)</button>
      <label class="btn">${icon('upload')} Import data<input type="file" accept="application/json,.json" data-act="import" hidden></label>
      <button class="btn" data-act="seed">Import CV &amp; projects</button>
    </div>
    <p class="small muted">Exports include all records but not photos. The file contains your private notes — keep it somewhere only you can access.</p>
  </section>
  <section class="card">
    <h3>About</h3>
    <p class="muted">Research Log · ${items.length} records · <a href="../">hafij-bge.github.io</a></p>
  </section>`;
}

/* ---------------- editor ---------------- */
function openEditorFromRoute() {
  const r = route();
  const sheet = app.querySelector('#sheet');
  if (!sheet) return;
  if (!r.edit) { if (editor) closeEditor(true); return; }
  if (editor && (editor.item.id === r.edit || (r.edit === 'new' && editor.isNew))) return;
  const K = KINDS[r.kind];
  let item, isNew = r.edit === 'new';
  if (isNew) {
    item = { id: newId(), kind: r.kind };
    K.fields.forEach(f => { if (f.default) item[f.key] = f.default(); });
  } else {
    const src = byId[r.edit] || (pendingOpen && pendingOpen.id === r.edit ? pendingOpen : null);
    if (!src) { if (items.length) go(`#/${r.section.id}/${r.kind}`); return; }
    item = structuredClone(src);
  }
  editor = { kind: r.kind, item, isNew, newPhotos: [], removedPhotos: [], dirty: false, origUpdatedAt: item.updatedAt || null };
  sheet.innerHTML = editorHTML();
  sheet.hidden = false;
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => sheet.classList.add('open'));
  loadPhotos();
  if (isNew) setTimeout(() => sheet.querySelector('[name="title"]')?.focus(), 60);
}

function closeEditor(fromRoute) {
  const sheet = app.querySelector('#sheet');
  editor = null;
  sheet.classList.remove('open');
  document.body.classList.remove('noscroll');
  setTimeout(() => { if (!editor) { sheet.hidden = true; sheet.innerHTML = ''; } }, 180);
  if (!fromRoute) { const r = route(); go(`#/${r.section.id}/${r.kind}`); }
}

function fieldHTML(f, item) {
  const v = item[f.key];
  const id = 'f_' + f.key;
  const lab = `<label for="${id}">${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</label>`;
  switch (f.type) {
    case 'textarea': return `<div class="fld">${lab}<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v || '')}</textarea></div>`;
    case 'select': return `<div class="fld half">${lab}<select id="${id}" name="${f.key}"><option value="">—</option>${f.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
    case 'ref': {
      const opts = items.filter(x => x.kind === f.ref).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      return `<div class="fld half">${lab}<select id="${id}" name="${f.key}"><option value="">— none —</option>${opts.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}</select></div>`;
    }
    case 'date': return `<div class="fld half">${lab}<input id="${id}" name="${f.key}" type="date" value="${esc(v || '')}"></div>`;
    case 'number': return `<div class="fld half">${lab}<input id="${id}" name="${f.key}" type="number" inputmode="numeric" value="${esc(v ?? '')}"></div>`;
    case 'range': return `<div class="fld">${lab}<div class="rangewrap"><input id="${id}" name="${f.key}" type="range" min="0" max="100" step="5" value="${Number(v) || 0}"><output>${Number(v) || 0}%</output></div></div>`;
    case 'check': return `<div class="fld half"><label class="toggle big"><input name="${f.key}" type="checkbox" ${v ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
    case 'tags': return `<div class="fld">${lab}<input id="${id}" name="${f.key}" type="text" value="${esc((v || []).join(', '))}" placeholder="comma, separated, tags"></div>`;
    case 'url': return `<div class="fld">${lab}<input id="${id}" name="${f.key}" type="text" inputmode="url" value="${esc(v || '')}" placeholder="${esc(f.placeholder || 'https://…')}"></div>`;
    case 'photos': return `<div class="fld">${lab}<div class="photos" id="photos"></div>
      <label class="btn">${icon('camera')} Add photo<input type="file" accept="image/*" multiple data-act="addphoto" hidden></label></div>`;
    default: return `<div class="fld">${lab}<input id="${id}" name="${f.key}" type="text" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}" ${f.required ? 'required' : ''}></div>`;
  }
}

function editorHTML() {
  const { kind, item, isNew } = editor;
  const K = KINDS[kind];
  return `<div class="sheet-bg" data-act="cancel"></div>
  <form class="sheet-panel" id="edform" novalidate>
    <header class="sheet-head">
      <button type="button" class="iconbtn" data-act="cancel" aria-label="Close">${icon('close')}</button>
      <h2>${isNew ? 'New ' + K.label.toLowerCase() : K.label}</h2>
      <button type="submit" class="btn primary">Save</button>
    </header>
    <div class="sheet-body">
      <div class="fields">${K.fields.map(f => fieldHTML(f, item)).join('')}</div>
      ${isNew ? '' : `<div class="sheet-foot">
        ${['experiment', 'protocol'].includes(kind) ? `<button type="button" class="btn" data-act="duplicate">${icon('copy')} Duplicate</button>` : ''}
        <button type="button" class="btn danger" data-act="delete">${icon('trash')} Delete</button>
        <span class="small muted">Last saved ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ''}</span>
      </div>`}
    </div>
  </form>`;
}

async function loadPhotos() {
  const box = app.querySelector('#photos');
  if (!box || !editor) return;
  const ids = (editor.item.photos || []).filter(id => !editor.removedPhotos.includes(id));
  const existing = ids.map(id => `<figure data-pid="${id}"><div class="ph-load"></div><button type="button" class="ph-x" data-act="rmphoto" data-pid="${id}" aria-label="Remove photo">${icon('close')}</button></figure>`);
  const fresh = editor.newPhotos.map((d, i) => `<figure><img src="${d}" alt="New photo ${i + 1}" data-act="viewphoto"><button type="button" class="ph-x" data-act="rmnew" data-i="${i}" aria-label="Remove photo">${icon('close')}</button></figure>`);
  box.innerHTML = existing.concat(fresh).join('') || '<p class="small muted">No photos yet.</p>';
  for (const id of ids) {
    const data = await store.getPhoto(id).catch(() => null);
    const fig = box.querySelector(`figure[data-pid="${id}"] .ph-load`);
    if (fig) fig.outerHTML = data ? `<img src="${data}" alt="Photo" data-act="viewphoto">` : `<div class="ph-load err">unavailable</div>`;
  }
}

function readForm() {
  const form = app.querySelector('#edform');
  const K = KINDS[editor.kind];
  const out = { ...editor.item };
  K.fields.forEach(f => {
    if (f.type === 'photos') return;
    const el = form.elements[f.key];
    if (!el) return;
    if (f.type === 'check') out[f.key] = el.checked;
    else if (f.type === 'tags') out[f.key] = el.value.split(',').map(s => s.trim()).filter(Boolean);
    else if (f.type === 'number' || f.type === 'range') out[f.key] = el.value === '' ? null : Number(el.value);
    else out[f.key] = el.value.trim();
  });
  return out;
}

function saveEditor() {
  const data = readForm();
  if (!data.title) { toast('Please add a title first.', true); app.querySelector('#edform [name="title"]').focus(); return; }
  // Several devices at once: never silently overwrite a change made elsewhere.
  if (!editor.isNew && !(pendingOpen && pendingOpen.id === data.id)) {
    const cur = byId[data.id];
    if (!cur) { if (!confirm('This record was deleted on another device. Save it again?')) return; }
    else if (editor.origUpdatedAt && cur.updatedAt !== editor.origUpdatedAt &&
      !confirm('This record was changed on another device while you were editing. Save your version and replace that change?')) return;
  }
  const photos = (data.photos || []).filter(id => !editor.removedPhotos.includes(id));
  for (const d of editor.newPhotos) { const pid = store.savePhoto(d, data.id); if (pid) photos.push(pid); }
  editor.removedPhotos.forEach(id => store.removePhoto(id));
  if (KINDS[data.kind].fields.some(f => f.type === 'photos')) data.photos = photos;
  if (!data.createdAt) data.createdAt = Date.now();
  store.save(data);
  const label = KINDS[data.kind].label;
  closeEditor();
  toast(`${label} saved`);
}

async function compress(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Could not read that image.');
  let max = 1600, q = 0.78, out = '';
  for (let tries = 0; tries < 6; tries++) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length < 700000) break;
    max *= 0.8; q -= 0.06;
  }
  return out;
}

/* ---------------- actions ---------------- */
app.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (t.tagName === 'INPUT' && t.type !== 'checkbox') return;
  const r = route();
  switch (act) {
    case 'signin':
      try { await store.signIn(); } catch (err) { toast(err.message, true); }
      break;
    case 'signout':
      if (confirm('Sign out? This device\'s offline copy and its sync setup will be erased. Your synced data stays safe in your account; to use this device again, paste the setup once more.')) store.signOut();
      break;
    case 'add': go(`#/${r.section.id}/${r.kind}/new`); break;
    case 'toggle': {
      const it = byId[t.dataset.id];
      if (it) { store.save({ ...it, done: t.checked, doneAt: t.checked ? Date.now() : null }); if (t.checked) toast('Task done'); }
      break;
    }
    case 'showdone': ui.showDone = t.checked; render(); break;
    case 'cancel':
      e.preventDefault();
      if (editor && editor.dirty && !confirm('Discard your changes?')) return;
      closeEditor();
      break;
    case 'delete':
      if (!confirm(`Delete this ${KINDS[editor.kind].label.toLowerCase()}? This cannot be undone.`)) return;
      (editor.item.photos || []).forEach(id => store.removePhoto(id));
      store.remove(editor.item.id);
      closeEditor(); toast('Deleted');
      break;
    case 'duplicate': {
      const copy = readForm();
      const dup = { ...copy, id: newId(), title: copy.title + ' (copy)', photos: [], date: copy.date ? today() : copy.date, createdAt: Date.now() };
      const nid = store.save(dup);
      pendingOpen = { ...dup, id: nid };
      editor = null;
      go(`#/${r.section.id}/${r.kind}/edit/${nid}`);
      toast('Duplicated — editing the copy');
      break;
    }
    case 'rmphoto': editor.removedPhotos.push(t.dataset.pid); editor.dirty = true; loadPhotos(); break;
    case 'rmnew': editor.newPhotos.splice(Number(t.dataset.i), 1); loadPhotos(); break;
    case 'viewphoto': {
      const v = document.createElement('div');
      v.className = 'viewer'; v.innerHTML = `<img src="${t.src}" alt="Photo">`;
      v.onclick = () => v.remove(); document.body.appendChild(v);
      break;
    }
    case 'install':
      if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
      break;
    case 'export': exportData(); break;
    case 'showqr': {
      const box = app.querySelector('#qrbox');
      if (!box.hidden) { box.hidden = true; box.innerHTML = ''; t.textContent = 'Show setup code'; break; }
      const q = qrcode(0, 'M'); q.addData(setupLink()); q.make();
      box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3, scalable: true }) + '<p class="small">Scan with the new device\'s camera. Hides itself in 2 minutes.</p>';
      box.hidden = false; t.textContent = 'Hide code';
      clearTimeout(window.__qrT);
      window.__qrT = setTimeout(() => { const b = app.querySelector('#qrbox'); if (b) { b.hidden = true; b.innerHTML = ''; } const bt = app.querySelector('[data-act=showqr]'); if (bt) bt.textContent = 'Show setup code'; }, 120000);
      break;
    }
    case 'copysetup':
      try { await navigator.clipboard.writeText(setupLink()); toast('Setup link copied. Paste it only on your own devices.'); }
      catch (e) { toast('Copying was blocked by the browser. Use the setup code instead.', true); }
      break;
    case 'connect': {
      const parsed = parseSetup(app.querySelector('#setupText').value);
      if (!parsed) return toast("That doesn't look like a complete Firebase config. Paste the whole { … } block.", true);
      if (!saveSetup(parsed)) return toast('This browser blocked saving the setup (private window?).', true);
      app.querySelector('#setupText').value = '';
      location.replace(location.pathname);
      break;
    }
    case 'seed': seedCV(); break;
  }
});

app.addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.act === 'addphoto') {
    const files = [...t.files];
    t.value = '';
    for (const f of files) {
      try { editor.newPhotos.push(await compress(f)); editor.dirty = true; }
      catch (err) { toast(err.message, true); }
    }
    loadPhotos();
  } else if (t.dataset.act === 'import') {
    const f = t.files[0]; t.value = '';
    if (f) importData(f);
  } else if (editor && t.closest('#edform')) editor.dirty = true;
});

app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'filter') {
    ui.filters[route().kind] = t.value;
    const pos = t.selectionStart;
    render();
    const nf = app.querySelector('#filter'); nf.focus(); nf.setSelectionRange(pos, pos);
  } else if (t.id === 'q') {
    ui.q = t.value; app.querySelector('#results').innerHTML = searchResults();
  } else if (t.type === 'range') {
    t.nextElementSibling.textContent = t.value + '%';
    if (editor) editor.dirty = true;
  } else if (editor && t.closest('#edform')) editor.dirty = true;
});

app.addEventListener('submit', e => { if (e.target.id === 'edform') { e.preventDefault(); saveEditor(); } });
addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.viewer')) return document.querySelector('.viewer').remove();
  if (e.key === 'Escape' && editor) { if (!editor.dirty || confirm('Discard your changes?')) closeEditor(); }
});

function setupLink() {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#setup=${b64}`;
}

/* ---------------- move demo data into the synced account ---------------- */
let migrationAsked = false;
async function offerMigration() {
  if (migrationAsked || !user) return;
  migrationAsked = true;
  let local = {};
  try { local = JSON.parse(localStorage.getItem('rl.items') || '{}'); } catch (e) {}
  const list = Object.entries(local).map(([id, v]) => ({ id, ...v })).filter(x => KINDS[x.kind]);
  if (!list.length) return wipeLocal(true);
  if (!confirm(`Move ${list.length} records saved on this device before sign-in into your synced account?`)) return;
  for (const it of list) {
    const pics = [];
    for (const pid of it.photos || []) {
      let d = null; try { d = localStorage.getItem('rl.photo.' + pid); } catch (e) {}
      if (d) { const np = store.savePhoto(d, it.id); if (np) pics.push(np); }
    }
    if (it.photos) it.photos = pics;
  }
  await store.bulkSave(list);
  wipeLocal(true);
  toast(`Moved ${list.length} records into your account`);
}

/* ---------------- data tools ---------------- */
function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'research-log', exportedAt: new Date().toISOString(), items }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `research-log-${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${items.length} records`);
}

async function importData(file) {
  try {
    const json = JSON.parse(await file.text());
    const list = (json.items || json).filter(x => x && KINDS[x.kind]);
    if (!list.length) return toast('No records found in that file.', true);
    if (!confirm(`Import ${list.length} records? Records with the same ID will be replaced.`)) return;
    const clean = list.map(({ photos, ...x }) => ({ ...x, photos: (photos || []).filter(id => byId[x.id] && (byId[x.id].photos || []).includes(id)) }));
    await store.bulkSave(clean);
    toast(`Imported ${list.length} records`);
  } catch (err) { toast('That file could not be read as a Research Log export.', true); }
}

async function seedCV() {
  const have = new Set(items.map(x => x.kind + '|' + (x.title || '').toLowerCase()));
  const fresh = CV_SEED.filter(x => !have.has(x.kind + '|' + x.title.toLowerCase()))
    .map(x => ({ ...x, id: newId(), createdAt: Date.now() }));
  if (!fresh.length) return toast('Your CV records are already imported.');
  await store.bulkSave(fresh);
  toast(`Imported ${fresh.length} records from your CV`);
}

let toastTimer;
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  if (!el) return alert(msg);
  el.textContent = msg; el.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = 'toast'), isErr ? 5000 : 2200);
}

boot();
