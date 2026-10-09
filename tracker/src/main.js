import { KINDS, SECTIONS, CV_SEED, dueLabel, textOf, APP_OPEN, APP_FOLDERS, ART_FOLDERS, APP_GROUPS, appGroup } from './schema.js';
import { CloudStore, LocalStore, newId, wipeLocal, parseSetup, loadSetup, saveSetup, MAX_FILE } from './store.js';
import {
  prettyFolder, lastPart, parentOf, cleanName, fmtSize, extOf, fileKind, viewable, folderSet, childFolders,
  inFolder, underFolder, mdToHtml, buildZip, mapFolderUpload,
} from './files.js';
import { snapshot, seal, newLink, linkUrl, SITE_KINDS } from './share.js';
import { LINK_TYPES, linkTypeLabel, guessLink, linkHref, formatRef, sameRef, lookupDoi, cleanDoi, parseBib, parseRis, parsePasted, toBib, toRis, dataStatement } from './refs.js';
import { PROVIDERS, askChain, listModels, pickDefault, aiState, restingUntil, clearRest, parseDelimited, describe, describeText, fmtNum } from './ai.js';
import { loadRepos, cachedRepos, repoFor, ago, GH_USER, repoReadme, repoCommits, repoNameFromUrl } from './github.js';
import qrcode from 'qrcode-generator';
import BUNDLED_CONFIG from './firebase-config.js';

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
const builtIn = parseSetup(JSON.stringify(BUNDLED_CONFIG)) || parseSetup(JSON.stringify(window.FIREBASE_CONFIG || {}));
const cfg = builtIn || loadSetup();
const hasCfg = !!cfg;

let store;
let items = [], byId = {}, files = [], user = null, status = '', authKnown = false;
let deferredInstall = null;
let editor = null;            // { kind, item, isNew, newPhotos:[], removedPhotos:[], dirty }
let pendingOpen = null;       // a just-created record not yet echoed back by the store
const ui = { showDone: false, filters: {} };

const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = {
  projectName: id => (id && byId[id] ? byId[id].title : ''), title: id => (id && byId[id] ? byId[id].title : ''),
  activity: x => { const r = repoFor(x, (cachedRepos() || {}).repos); return r ? 'GitHub ' + ago(r.pushed) : ''; },
};
const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- icons ---------------- */
const I = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  lab: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
  research: '<path d="M4 19V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h6M8 11h6"/>',
  profile: '<circle cx="12" cy="8" r="5"/><path d="M8.5 12.5 7 21l5-3 5 3-1.5-8.5"/>',
  phd: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
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
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderplus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 15.5h7M8.5 12h4"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M11 6h1M11 9h1M11 12h1v3h-1z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
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
    // A record's own folder (PhD applications, research articles):
    // #/<section>/<kind>/open/<id>[/f/<folder>/<sub>…][/~e/<kind>/<id|new>]
    if (WS[r.kind] && p[2] === 'open' && p[3]) {
      r.ws = p[3]; r.wsKind = r.kind;
      let rest = p.slice(4);
      const ei = rest.indexOf('~e');
      if (ei >= 0) {
        const k = rest[ei + 1];
        if (KINDS[k]) { r.kind = k; r.edit = rest[ei + 2] || 'new'; }
        rest = rest.slice(0, ei);
      }
      r.folder = rest[0] === 'f' ? rest.slice(1).map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } }).join('/') : '';
      r.base = wsHref(r.ws, r.folder, r.wsKind);
    }
  }
  return r;
}
// Record types that have their own folder of files.
const WS = {
  application: {
    section: 'phd', title: 'PhD folder', list: '#/phd/application', listLabel: 'Applications', folders: APP_FOLDERS, noun: 'application',
    zipRoot: 'PhD_Applications', importLabel: 'Import application folder', wholeLabel: 'Upload the whole application folder',
    readmeHint: 'Write what this application needs — requirements, steps, contacts, interview prep. Checklists work too: <code>- [ ] Send CV</code>',
    fresh: () => ({ status: 'Researching', documents: [] }),
  },
  article: {
    section: 'research', title: 'Article folder', list: '#/research/article', listLabel: 'Articles', folders: ART_FOLDERS, noun: 'article',
    zipRoot: 'Research_Articles', importLabel: 'Import article folder', wholeLabel: 'Upload the whole article folder',
    readmeHint: 'Plan the article — aim, key results, figure list, what is left to do. Checklists work too: <code>- [ ] Figure 2</code>',
    fresh: () => ({ status: 'Drafting', progress: 0 }),
  },
};
const kindOf = id => (byId[id] && byId[id].kind) || (pendingOpen && pendingOpen.id === id && pendingOpen.kind) || 'application';
const wsHref = (id, folder, kind) => `#/${WS[kind || kindOf(id)].section}/${kind || kindOf(id)}/open/${id}` + (folder ? '/f/' + folder.split('/').map(encodeURIComponent).join('/') : '');
const listHref = r => r.base || `#/${r.section.id}/${r.kind}`;
const go = h => { if (location.hash !== h) location.hash = h; else render(); };
addEventListener('hashchange', () => { openEditorFromRoute(); render(); });

/* ---------------- boot ---------------- */
function boot() {
  store = hasCfg ? new CloudStore(cfg) : new LocalStore();
  store.on('auth', u => { user = u; authKnown = true; if (!u) items = []; render(); if (u && store.mode === 'cloud') { loadSharing(); loadAi(); } });
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
  store.on('files', list => { files = list; if (!editor) render(); });
  store.on('status', s => { status = s; renderStatus(); if (s === 'synced' || s === 'local') checkClaudeUpdates(); if (s === 'synced') schedulePublish(); });
  store.on('items', () => schedulePublish());
  loadRepos().then(() => { if (!editor && authKnown && user) render(); }).catch(() => {});
  store.on('error', msg => toast(msg, true));
  store.on('denied', () => {
    alert('This Google account is not allowed to open this Research Log. You will be signed out.');
    store.signOut();
  });
  if (store.mode === 'cloud') store.on('items', () => offerMigration());
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; render(); });
  if ('serviceWorker' in navigator) {
    // When a newer version of the app is installed, switch to it straight away — unless a record is
    // open for editing, in which case switch the next time the app comes back to the front.
    // (The very first install also fires controllerchange; there is nothing newer to load then.)
    let controller = navigator.serviceWorker.controller, updateReady = false, reloaded = false;
    const applyUpdate = () => { if (updateReady && !reloaded && !editor) { reloaded = true; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controller) updateReady = true;
      controller = navigator.serviceWorker.controller;
      applyUpdate();
    });
    navigator.serviceWorker.register('sw.js').then(reg => {
      // The Android app and home-screen installs usually resume the open page instead of reloading it,
      // so also look for a newer version whenever the app comes back to the front, and every 30 minutes.
      const check = () => reg.update().catch(() => {});
      check();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') { applyUpdate(); check(); }
      });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
  }
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
  if (r.ws) html = workspaceHTML(r);
  else if (r.section) html = sectionHTML(r);
  else if (r.view === 'search') html = searchHTML();
  else if (r.view === 'ai') html = aiHTML();
  else if (r.view === 'settings') { html = settingsHTML(); setTimeout(renderClaudeCard, 0); }
  else html = homeHTML();
  view.innerHTML = html;
  view.scrollTop = 0;
  if (ui.scrollTo) { const el = view.querySelector('#' + ui.scrollTo); ui.scrollTo = null; if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 30); }
  if (r.view === 'search') { const q = view.querySelector('#q'); q && q.focus(); }
  if (r.view === 'ai') { const q = view.querySelector('#aiq'); if (q && !('ontouchstart' in window)) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
  const fab = app.querySelector('#fab');
  fab.hidden = !r.section || !!r.ws;
  if (r.section) fab.setAttribute('aria-label', 'Add ' + KINDS[r.kind].label.toLowerCase());
  openEditorFromRoute();
}

function renderChrome() {
  const r = route();
  app.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.v === (r.section ? r.section.id : r.view)));
  const titles = { home: 'Research Log', search: 'Search', settings: 'Settings', ai: 'Ask AI' };
  app.querySelector('#title').textContent = r.ws ? WS[r.wsKind].title : r.section ? r.section.label : titles[r.view] || 'Research Log';
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
  const nav = [['home', 'Home', '#/home'], ['lab', 'Lab', '#/lab'], ['research', 'Research', '#/research'], ['phd', 'PhD', '#/phd'], ['profile', 'Profile', '#/profile'], ['settings', 'Settings', '#/settings']];
  return `<div class="shell">
    <nav class="nav" aria-label="Sections">
      <div class="nav-brand"><div class="logo-tiles"><i></i><i></i><i></i><i></i></div><b>Research Log</b></div>
      ${nav.map(([v, l, h]) => `<a href="${h}" data-v="${v}">${icon(v)}<span>${l}</span></a>`).join('')}
    </nav>
    <div class="main">
      <header class="appbar">
        <h1 id="title">Research Log</h1>
        <span id="sync" class="sync"></span>
        <a class="iconbtn aibtn" href="#/ai" aria-label="Ask AI">${icon('spark')}</a>
        <a class="iconbtn" href="#/search" aria-label="Search">${icon('search')}</a>
      </header>
      <main id="view"></main>
    </div>
    <button id="fab" class="fab" data-act="add" hidden>${icon('plus')}</button>
    <div id="sheet" class="sheet" hidden></div>
    <div id="upbar" class="upbar" hidden></div>
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
  const apps = of('application').filter(a => APP_OPEN.includes(a.status || 'Researching') || ['Submitted', 'Interview', 'Offer'].includes(a.status)).sort(KINDS.application.sort).slice(0, 5);

  return `
  ${local ? `<div class="banner warn"><b>Not syncing yet.</b> Data stays in this browser until you connect Google sync. <a href="#/settings">Connect</a></div>` : ''}
  <section class="hello">
    <h2>${greet}${name ? ', ' + esc(name) : ''}</h2>
    <p>${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
  </section>
  <div class="quick">
    ${[['lab', 'experiment', 'Experiment'], ['research', 'task', 'Task'], ['phd', 'application', 'Application'], ['research', 'article', 'Article'], ['lab', 'inventory', 'Sample'], ['research', 'paper', 'Paper']]
      .map(([s, k, l]) => `<a class="qbtn" href="#/${s}/${k}/new" style="--c:${KINDS[k].color}">${icon('plus')}${l}</a>`).join('')}
    <a class="qbtn" href="#/ai" style="--c:var(--dry)">${icon('spark')}Ask AI</a>
    <a class="qbtn" href="#/settings" data-scroll="claude" style="--c:var(--accent)">${icon('spark')}With Claude</a>
  </div>
  ${items.length === 0 ? `<section class="card welcome">
     <h3>Start with what you already have</h3>
     <p>Import your publications, talks, awards and current projects from your CV in one tap. You can edit or delete them later.</p>
     <button class="btn primary" data-act="seed">Import CV &amp; projects</button></section>` : ''}
  <div class="grid2">
    <section class="card">
      <h3>PhD applications</h3>
      ${of('application').length ? `<p class="groupline">${APP_GROUPS.map(g => [g, of('application').filter(x => appGroup(x) === g.id).length]).filter(([, n]) => n)
        .map(([g, n]) => `<a class="chip g-${g.id}" href="#/phd/application" data-group="${g.id}"><i></i>${n} ${g.label.toLowerCase()}</a>`).join('')}</p>` : ''}
      ${apps.length ? `<ul class="rows">${apps.map(rowHTML).join('')}</ul>` : `<p class="muted">No open applications yet.</p>`}
      <a class="more" href="#/phd">PhD Control Center</a>
    </section>
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
    ${githubCardHTML()}
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
    ${WS[r.kind] && canPickFolder ? `<label class="btn">${icon('folder')} ${WS[r.kind].importLabel}<input type="file" data-act="importfolder" data-kind="${r.kind}" webkitdirectory multiple hidden></label>` : ''}
    ${r.kind === 'article' ? `<button type="button" class="btn" data-act="ghpick" data-mode="new">${icon('github')} Add from GitHub</button>` : ''}
    ${r.kind === 'task' ? `<label class="toggle"><input type="checkbox" data-act="showdone" ${ui.showDone ? 'checked' : ''}> Show done (${doneCount})</label>` : ''}
  </div>
  ${r.kind === 'application' && list.length ? appGroupsHTML(list)
    : list.length ? `<ul class="rows big">${list.map(rowHTML).join('')}</ul>`
    : `<div class="empty">${icon(r.section.id)}<p>${f ? 'No matches.' : `No ${K.plural.toLowerCase()} yet.`}</p>
       ${f ? '' : `<a class="btn primary" href="#/${r.section.id}/${r.kind}/new">${icon('plus')} Add ${K.label.toLowerCase()}</a>`}</div>`}`;
}

function appGroupsHTML(list) {
  const sel = ui.appGroup || 'all';
  const groups = APP_GROUPS.map(g => ({ ...g, list: list.filter(x => appGroup(x) === g.id) }));
  const chips = `<div class="chips" role="group" aria-label="Show applications">
    <button type="button" class="chip ${sel === 'all' ? 'on' : ''}" data-act="appgroup" data-g="all" aria-pressed="${sel === 'all'}">All <span>${list.length}</span></button>
    ${groups.map(g => `<button type="button" class="chip g-${g.id} ${sel === g.id ? 'on' : ''}" data-act="appgroup" data-g="${g.id}" aria-pressed="${sel === g.id}"><i></i>${g.label} <span>${g.list.length}</span></button>`).join('')}
  </div>`;
  const shown = groups.filter(g => sel === g.id || (sel === 'all' && g.list.length));
  return chips + shown.map(g => `<section class="appgroup g-${g.id}">
    <h3 class="grouph"><i></i>${g.label} <span>${g.list.length}</span> <small>${g.hint}</small></h3>
    ${g.list.length ? `<ul class="rows big">${g.list.map(rowHTML).join('')}</ul>` : `<p class="muted pad">No ${g.label.toLowerCase()} applications.</p>`}
  </section>`).join('');
}

function sectionOf(kind) { return SECTIONS.find(s => s.kinds.includes(kind)).id; }

function badgeClass(v) {
  if (['Completed', 'Done', 'Published', 'Read', 'In stock', 'Accepted'].includes(v)) return 'g';
  if (['Offer'].includes(v)) return 'g';
  if (['In progress', 'Active', 'Reading', 'Under review', 'Submitted', 'Revision', 'Interview'].includes(v)) return 'b';
  if (['Rejected', 'Declined'].includes(v)) return 'r';
  if (['Preparing', 'Contacted supervisor'].includes(v)) return 'a';
  if (['Failed', 'Expired', 'Used up', 'High'].includes(v)) return 'r';
  if (['Low', 'On hold', 'Repeated'].includes(v)) return 'a';
  return 'n';
}

function linkOf(x) {
  const v = x.doi || x.link || x.source;
  if (!v) return '';
  return /^10\.\d/.test(v) ? 'https://doi.org/' + v : (/^https?:\/\//.test(v) ? v : '');
}

function rowHTML(x, _i, _all, hrefOverride) {
  const K = KINDS[x.kind];
  const href = hrefOverride || (WS[x.kind] ? wsHref(x.id, '', x.kind) : `#/${sectionOf(x.kind)}/${x.kind}/edit/${x.id}`);
  const nfiles = WS[x.kind] ? files.filter(f => f.app === x.id).length : 0;
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
      ${x.noShare ? `<span class="pc" title="Private: never on shared links or the website">${icon('lock')}</span>` : ''}
      ${nfiles ? `<span class="pc" title="${nfiles} file${nfiles > 1 ? 's' : ''}">${icon('file')}${nfiles}</span>` : ''}
      ${photos ? `<span class="pc" title="${photos} photo${photos > 1 ? 's' : ''}">${icon('img')}${photos}</span>` : ''}
      ${warn ? `<span class="badge r">${esc(warn)}</span>` : badge ? `<span class="badge ${badgeClass(badge)}">${esc(badge)}</span>` : ''}
      ${link ? `<a class="iconbtn sm" href="${esc(link)}" target="_blank" rel="noopener" aria-label="Open link">${icon('ext')}</a>` : ''}
    </span>
  </li>`;
}

/* ---------------- PhD application folders ----------------
   Each application is a folder, laid out like the owner's folders on his computer:
   README.md plus 01_Program_Info, 02_My_Profile, 03_Professors, 04_Templates_General (renamable),
   with sub-folders and files of any type. Files live in the owner's own Firebase database. */
const canPickFolder = !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && 'webkitdirectory' in document.createElement('input');
const appFolders = a => (Array.isArray(a.folders) ? a.folders : (WS[a.kind] || WS.application).folders);
const zipRoot = a => cleanName(a.folderName || (a.title || 'Application').replace(/\s+/g, '_')) || 'Application';
const isProfFolder = (path, a) => a && a.kind === 'application' && !!path && !path.includes('/') && /professor|supervisor|faculty|\bPIs?\b/i.test(path);
const filesOf = id => files.filter(f => f.app === id);
const profsOf = id => items.filter(x => x.kind === 'professor' && x.application === id).sort(KINDS.professor.sort);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const joinPath = (...p) => p.filter(Boolean).join('/');
function fileIcon(f) {
  const k = fileKind(f);
  return icon({ pdf: 'pdf', image: 'img', md: 'note', text: 'note', doc: 'note', zip: 'zip' }[k] || 'file');
}
function folderTitle(name) {
  const m = /^(\d+)[\s._-]+/.exec(name || '');
  return `${m ? `<i class="fnum">${esc(m[1])}</i>` : ''}${esc(prettyFolder(name))}`;
}

function workspaceHTML(r) {
  const a = byId[r.ws];
  const W = WS[r.wsKind];
  if (!a || a.kind !== r.wsKind) {
    return items.length ? `<div class="empty">${icon('folder')}<p>This ${W.noun} was not found. It may have been deleted on another device.</p>
      <a class="btn" href="${W.list}">Back to ${W.listLabel.toLowerCase()}</a></div>` : '';
  }
  const own = filesOf(a.id);
  const all = folderSet({ folders: appFolders(a) }, own);
  return r.folder ? folderHTML(r, a, own, all) : wsRootHTML(r, a, own, all);
}

function crumbsHTML(a, folder) {
  const parts = folder ? folder.split('/') : [];
  const W = WS[a.kind];
  const links = [`<a href="${W.list}">${icon('back')}${W.listLabel}</a>`];
  if (folder) links.push(`<a href="${wsHref(a.id, '', a.kind)}">${esc(a.folderName || a.title)}</a>`);
  parts.slice(0, -1).forEach((p, i) => links.push(`<a href="${wsHref(a.id, parts.slice(0, i + 1).join('/'), a.kind)}">${esc(p)}</a>`));
  return `<nav class="crumbs" aria-label="Folder path">${links.join('<span>/</span>')}</nav>`;
}

function tilesHTML(a, own, folders, extra = '') {
  return `<div class="tiles">${folders.map(path => {
    const n = underFolder(own, path).length;
    const np = isProfFolder(path, a) ? profsOf(a.id).length : 0;
    const sub = [n ? plural(n, 'file') : 'Empty', np ? `${np} professor${np > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ');
    return `<a class="tile" href="${wsHref(a.id, path)}" title="${esc(lastPart(path))}">
      <span class="tileic">${icon('folder')}</span>
      <span class="tilet">${folderTitle(lastPart(path))}</span>
      <span class="tiles-s">${sub}</span></a>`;
  }).join('')}${extra}</div>`;
}

function fileRowsHTML(list) {
  if (!list.length) return '';
  return `<ul class="rows big files">${list.map(f => `<li class="row file" style="--c:var(--phd)">
    <span class="fic k-${fileKind(f)}">${fileIcon(f)}</span>
    <button type="button" class="rowmain plain" data-act="openfile" data-id="${f.id}">
      <span class="t">${esc(f.name)}</span>
      <span class="s">${fmtSize(f.size)} · ${new Date(f.updatedAt || f.createdAt || Date.now()).toLocaleDateString()}</span>
    </button>
    <span class="tail">
      <button type="button" class="iconbtn sm" data-act="dlfile" data-id="${f.id}" aria-label="Download ${esc(f.name)}">${icon('download')}</button>
      <button type="button" class="iconbtn sm" data-act="fileinfo" data-id="${f.id}" aria-label="Rename, move or delete ${esc(f.name)}">${icon('more')}</button>
    </span></li>`).join('')}</ul>`;
}

function uploadBtns(folder, opts = {}, a) {
  return `<div class="btnrow uprow">
    <label class="btn ${opts.primary ? 'primary' : ''}">${icon('upload')} Upload files<input type="file" multiple data-act="upfiles" data-folder="${esc(folder)}" hidden></label>
    <button type="button" class="btn" data-act="newnote" data-folder="${esc(folder)}">${icon('note')} New note</button>
    <button type="button" class="btn" data-act="newfolder" data-parent="${esc(folder)}">${icon('folderplus')} New folder</button>
    ${canPickFolder ? `<label class="btn">${icon('folder')} ${opts.whole ? WS[(a && a.kind) || 'application'].wholeLabel : 'Upload a folder'}<input type="file" webkitdirectory multiple data-act="${opts.whole ? 'upappfolder' : 'upsubfolder'}" data-folder="${esc(folder)}" hidden></label>` : ''}
  </div>`;
}

function wsHeadHTML(r, a, own) {
  const K = KINDS[a.kind];
  const badge = K.badge(a), warn = K.warn(a), cal = K.calendar(a);
  const zipBtn = own.length ? `<button type="button" class="btn" data-act="zip" data-folder="">${icon('download')} Download all (.zip)</button>` : '';
  const head = (sub, facts, btns) => `<section class="card wshead k-${a.kind}">
    <div class="wstop">
      <span class="wsicon">${icon('folder')}</span>
      <div class="wsmain">
        <h2>${esc(a.title)}</h2>
        <p>${badge ? `<span class="badge ${badgeClass(badge)}">${esc(badge)}</span> ` : ''}${sub}</p>
      </div>
    </div>
    <dl class="facts">${facts.map(([t, v]) => `<div><dt>${t}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="btnrow">
      <a class="btn primary" href="${r.base}/~e/${a.kind}/${a.id}">${icon('edit')} Details</a>
      ${btns}${zipBtn}
      <a class="btn" href="#/ai" data-aifocus="${a.id}">${icon('spark')} Ask AI</a>
    </div>
  </section>`;
  if (a.kind === 'article') {
    const link = linkOf({ doi: a.doi });
    return head(esc([a.journal, a.authors].filter(Boolean).join(' · ')) || '<span class="muted small">Add the target journal and authors under Details.</span>', [
      ['Target date', `${a.target ? esc(a.target) : '—'}${warn ? ` <span class="badge r">${esc(warn)}</span>` : ''}`],
      ['Submitted', esc(a.submitted || '—')],
      ['Writing progress', `${Number(a.progress) || 0}%<span class="bar"><i style="width:${Math.min(100, Number(a.progress) || 0)}%"></i></span>`],
      ['Project', esc(ctx.title(a.project) || '—')],
    ], `${link ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${icon('ext')} DOI / preprint</a>` : ''}
      ${cal ? `<a class="btn" target="_blank" rel="noopener" href="${esc(calLink(cal))}">${icon('cal')} Target to Calendar</a>` : ''}`) + repoCardHTML(a);
  }
  const profs = profsOf(a.id);
  const contacted = profs.filter(p => p.status && p.status !== 'Not contacted').length;
  const docs = (a.documents || []).length, docsAll = KINDS.application.fields.find(f => f.key === 'documents').options.length;
  const portal = /^https?:\/\//.test(a.portal || '') ? a.portal : '';
  return head(esc([a.university, a.country].filter(Boolean).join(' · ')) || '<span class="muted small">Add the university, deadline and supervisor under Details.</span>', [
    ['Deadline', `${a.deadline ? esc(a.deadline) : '—'}${warn ? ` <span class="badge r">${esc(warn)}</span>` : ''}`],
    ['Funding', esc(a.funding || '—')],
    ['Documents ready', `${docs} of ${docsAll}`],
    ['Professors', profs.length ? `${profs.length} · ${contacted} contacted` : '—'],
  ], `${portal ? `<a class="btn" href="${esc(portal)}" target="_blank" rel="noopener">${icon('ext')} Portal</a>` : ''}
    ${cal ? `<a class="btn" target="_blank" rel="noopener" href="${esc(calLink(cal))}">${icon('cal')} Deadline to Calendar</a>` : ''}`);
}

// The article's GitHub repository: what it is, when it last changed, its latest commits.
function repoCardHTML(a) {
  const name = repoNameFromUrl(a.repo) || (repoFor(a, (cachedRepos() || {}).repos) || {}).name;
  if (!name) return `<section class="card repocard"><div class="cardhead"><h3>${icon('github')} GitHub</h3></div>
    <p class="muted">Link the repository with this article's code and analysis to see its latest activity here.</p>
    <div class="btnrow"><button type="button" class="btn" data-act="ghpick" data-mode="link">${icon('github')} Link a repository</button></div></section>`;
  const r = ((cachedRepos() || {}).repos || []).find(x => x.name.toLowerCase() === name.toLowerCase());
  setTimeout(() => fillCommits(name), 0);
  return `<section class="card repocard">
    <div class="cardhead"><h3>${icon('github')} ${esc(name)}</h3>
      <a class="btn sm" href="https://github.com/${GH_USER}/${encodeURIComponent(name)}" target="_blank" rel="noopener">${icon('ext')} Open</a></div>
    <p class="muted small">${esc([r && r.description, r && r.language, r && 'updated ' + ago(r.pushed)].filter(Boolean).join(' · ') || 'Private repository, or not found on your public GitHub.')}</p>
    <ul class="rows commits" id="commits" data-repo="${esc(name)}"><li class="muted small">Loading latest commits…</li></ul>
    <div class="btnrow"><button type="button" class="btn sm" data-act="ghpick" data-mode="link">${icon('edit')} Change repository</button></div>
  </section>`;
}
async function fillCommits(name) {
  const el = app.querySelector('#commits');
  if (!el || el.dataset.repo !== name) return;
  try {
    const list = await repoCommits(name);
    const box = app.querySelector('#commits');
    if (!box || box.dataset.repo !== name) return;
    box.innerHTML = list.length ? list.map(c => `<li class="row"><span class="dot" style="--c:var(--dry)"></span>
      <a class="rowmain" href="${esc(c.url)}" target="_blank" rel="noopener"><span class="t">${esc(c.msg)}</span><span class="s">${c.date ? ago(c.date) : ''}</span></a></li>`).join('')
      : '<li class="muted small">No commits yet.</li>';
  } catch (e) {
    const box = app.querySelector('#commits');
    if (box) box.innerHTML = '<li class="muted small">Commits are not visible — the repository may be private.</li>';
  }
}

// Pick one of your GitHub repositories: start a new article from it, or link it to this article.
async function ghPick(mode) {
  let repos;
  try { repos = await loadRepos(); } catch (e) { return toast('Could not reach GitHub right now.', true); }
  const list = repos.filter(r => r.name.toLowerCase() !== GH_USER.toLowerCase() && !/\.github\.io$/i.test(r.name));
  if (!list.length) return toast('No public repositories found on your GitHub.', true);
  const used = new Set(items.filter(x => x.kind === 'article').map(x => (repoNameFromUrl(x.repo) || '').toLowerCase()).filter(Boolean));
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>${mode === 'new' ? 'New article from GitHub' : 'Link a repository'}</h2></div>
    <div class="ovl-body"><p class="muted small">Your public repositories, most recently updated first.${mode === 'new' ? ' The repository’s README becomes the article’s README.' : ''}</p>
      <ul class="rows big">${list.map(r => `<li class="row"><span class="dot" style="--c:var(--dry)"></span>
        <button type="button" class="rowmain plain" data-repo="${esc(r.name)}"><span class="t">${esc(r.name)}</span>
        <span class="s">${esc([r.description, r.language, 'updated ' + ago(r.pushed)].filter(Boolean).join(' · '))}</span></button>
        ${used.has(r.name.toLowerCase()) ? '<span class="badge g">Has an article</span>' : ''}</li>`).join('')}</ul></div>`);
  el.querySelectorAll('[data-repo]').forEach(b => b.onclick = async () => {
    const r = list.find(x => x.name === b.dataset.repo);
    el._close();
    const url = `https://github.com/${GH_USER}/${r.name}`;
    if (mode === 'link') {
      const a = byId[route().ws];
      if (!a) return;
      store.save({ ...a, repo: url });
      return toast(`Linked ${r.name}`);
    }
    toast(`Reading ${r.name}…`);
    const readme = await repoReadme(r.name);
    const proj = items.find(x => x.kind === 'project' && repoFor(x, [r]));
    const a = {
      id: newId(), kind: 'article', title: r.description && r.description.length < 140 ? r.description : r.name.replace(/[-_]+/g, ' '),
      ...WS.article.fresh(), repo: url, project: proj ? proj.id : undefined, folderName: r.name,
      notes: readme || `# ${r.name}\n\n${r.description || ''}\n\nCode: ${url}\n`, readmeName: 'README.md', folders: ART_FOLDERS, createdAt: Date.now(),
    };
    store.save(a);
    pendingOpen = a;
    go(wsHref(a.id, '', 'article'));
    toast('Article created — rename it under Details');
  });
}

/* ---------------- article links & references ---------------- */
const rid = () => newId();
async function copyText(text, msg) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast(msg || 'Copied'); }
  catch (e) { prompt('Copy:', text); }
}
function saveArticle(a, patch, msg) {
  const cur = byId[a.id] || a;
  store.save({ ...cur, ...patch });
  if (msg) toast(msg);
}
const saveRefs = (a, refs, msg) => {
  if (JSON.stringify(refs).length > 700000) return toast('That is too many references for one article (limit about 1500).', true);
  saveArticle(a, { refs }, msg);
};

function linksCardHTML(a) {
  const links = a.links || [];
  return `<section class="card" id="linkscard">
    <div class="cardhead"><h3>${icon('link')} Links <span class="muted small">${links.length || ''}</span></h3>
      <button type="button" class="btn sm" data-act="lk-add">${icon('plus')} Add link</button></div>
    ${links.length ? `<ul class="rows linklist">${links.map(l => {
      const href = linkHref(l.url);
      return `<li class="row"><span class="ltype t-${esc(l.type)}">${esc(linkTypeLabel(l.type))}</span>
        <span class="rowmain">${href ? `<a class="t" href="${esc(href)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a>` : `<span class="t">${esc(l.label || l.url)}</span>`}
          <span class="s">${esc([l.label ? l.url : '', l.note].filter(Boolean).join(' · '))}</span></span>
        <span class="tail">
          <button type="button" class="iconbtn sm" data-act="lk-copy" data-id="${l.id}" aria-label="Copy link">${icon('copy')}</button>
          <button type="button" class="iconbtn sm" data-act="lk-edit" data-id="${l.id}" aria-label="Edit link">${icon('edit')}</button>
          <button type="button" class="iconbtn sm" data-act="lk-del" data-id="${l.id}" aria-label="Remove link">${icon('trash')}</button>
        </span></li>`;
    }).join('')}</ul>` : `<p class="muted">Keep every place this article's material lives: GitHub repositories, datasets (Zenodo, figshare, OSF), accession numbers (GEO, PRIDE, PDB, SRA), preprint, protocols, supplementary files.</p>`}
    ${links.length || a.repo ? `<div class="btnrow"><button type="button" class="btn sm" data-act="lk-das">${icon('copy')} Copy data availability statement</button></div>` : ''}
  </section>`;
}
function linkForm(a, id) {
  const l = (a.links || []).find(x => x.id === id) || { type: '', url: '', label: '', note: '' };
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>${id ? 'Edit link' : 'Add link'}</h2><button type="button" class="btn primary" data-save>Save</button></div>
    <div class="ovl-body"><div class="fields">
      <div class="fld"><label for="lk_url">Web address, DOI or accession number</label><input id="lk_url" type="text" inputmode="url" value="${esc(l.url)}" placeholder="https://github.com/…  ·  10.5281/zenodo.…  ·  GSE12345  ·  PXD024871"></div>
      <div class="fld half"><label for="lk_type">Type</label><select id="lk_type">${LINK_TYPES.map(([k, v]) => `<option value="${k}" ${k === (l.type || 'other') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="fld half"><label for="lk_label">Name</label><input id="lk_label" type="text" value="${esc(l.label)}" placeholder="e.g. Raw MS data (PRIDE)"></div>
      <div class="fld"><label for="lk_note">Note</label><input id="lk_note" type="text" value="${esc(l.note || '')}" placeholder="e.g. embargoed until publication"></div>
    </div></div>`);
  const url = el.querySelector('#lk_url'), type = el.querySelector('#lk_type');
  let typed = !!id;
  type.onchange = () => { typed = true; };
  url.oninput = () => { el._dirty = true; if (!typed) type.value = guessLink(url.value); };
  setTimeout(() => url.focus(), 50);
  el.querySelector('[data-save]').onclick = () => {
    const v = url.value.trim();
    if (!v) return toast('Add the web address or accession number.', true);
    const rec = { id: l.id || rid(), url: v, type: type.value, label: el.querySelector('#lk_label').value.trim(), note: el.querySelector('#lk_note').value.trim() || undefined };
    const links = (byId[a.id].links || []).filter(x => x.id !== rec.id);
    if (!id && links.some(x => x.url.toLowerCase() === v.toLowerCase())) return toast('That link is already saved.', true);
    if (id) { const i = (byId[a.id].links || []).findIndex(x => x.id === id); links.splice(i < 0 ? links.length : i, 0, rec); } else links.push(rec);
    el._close();
    saveArticle(a, { links }, id ? 'Link updated' : 'Link added');
  };
}
function delLink(a, id) {
  const l = (a.links || []).find(x => x.id === id);
  if (l && confirm(`Remove the link “${l.label || l.url}”?`)) saveArticle(a, { links: a.links.filter(x => x.id !== id) }, 'Link removed');
}

function refsCardHTML(a) {
  const refs = a.refs || [];
  const missing = refs.filter(r => r.doi && !r.title).length;
  return `<section class="card" id="refscard">
    <div class="cardhead"><h3>${icon('research')} References <span class="muted small">${refs.length || ''}</span></h3></div>
    <div class="btnrow">
      <button type="button" class="btn sm primary" data-act="rf-doi">${icon('plus')} Add by DOI</button>
      <button type="button" class="btn sm" data-act="rf-paste">${icon('copy')} Paste a list</button>
      <label class="btn sm">${icon('upload')} Import .bib / .ris<input type="file" accept=".bib,.ris,.txt,.bibtex,text/plain" data-act="rf-import" hidden></label>
    </div>
    ${refs.length ? `
      ${refs.length > 8 ? `<input id="rfq" class="filter rfq" type="search" placeholder="Search ${refs.length} references…" aria-label="Search references">` : ''}
      <ol class="refs">${refs.map(r => {
        const doi = r.doi ? ` <a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">doi</a>` : '';
        return `<li><span class="rtext">${esc(formatRef(r).replace(/\s*https:\/\/doi\.org\/\S+$/, ''))}${doi}</span>
          <span class="ract"><button type="button" class="iconbtn sm" data-act="rf-edit" data-id="${r.id}" aria-label="Edit reference">${icon('edit')}</button>
          <button type="button" class="iconbtn sm" data-act="rf-del" data-id="${r.id}" aria-label="Remove reference">${icon('trash')}</button></span></li>`;
      }).join('')}</ol>
      <div class="btnrow">
        <button type="button" class="btn sm" data-act="rf-copy">${icon('copy')} Copy all</button>
        <button type="button" class="btn sm" data-act="rf-bib">${icon('download')} .bib</button>
        <button type="button" class="btn sm" data-act="rf-ris">${icon('download')} .ris</button>
        <button type="button" class="btn sm" data-act="rf-sort">Sort A–Z</button>
        ${missing ? `<button type="button" class="btn sm" data-act="rf-fill">Fill details for ${missing} from DOI</button>` : ''}
      </div>
      <p class="small muted">.bib works with LaTeX/Overleaf and Zotero; .ris with EndNote, Mendeley and Zotero.</p>`
    : `<p class="muted">Add the full reference list: type or paste DOIs and the details are filled in for you, paste a numbered list, or import a .bib / .ris file exported from Zotero, Mendeley or EndNote.</p>`}
  </section>`;
}
function addRefs(a, list, how) {
  const cur = [...(byId[a.id].refs || [])];
  let added = 0, dup = 0;
  for (const r of list) {
    if (cur.some(x => sameRef(x, r))) { dup++; continue; }
    cur.push({ id: rid(), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '' && v != null)) });
    added++;
  }
  saveRefs(a, cur);
  toast(`${added} reference${added === 1 ? '' : 's'} added${how ? ' ' + how : ''}${dup ? ` · ${dup} already in the list` : ''}`);
  return added;
}
function refsByDoi(a) {
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>Add references by DOI</h2><button type="button" class="btn primary" data-save>Add</button></div>
    <div class="ovl-body"><div class="fld"><label for="rf_dois">One or more DOIs or doi.org links — one per line, or mixed into text</label>
      <textarea id="rf_dois" class="setup" rows="7" placeholder="10.1016/j.jsps.2023.06.014&#10;https://doi.org/10.34172/jhp.2023.31"></textarea></div>
      <p class="small muted">Authors, title, journal, year, volume and pages are looked up from Crossref.</p></div>`);
  setTimeout(() => el.querySelector('textarea').focus(), 50);
  el.querySelector('[data-save]').onclick = async () => {
    const dois = [...new Set((el.querySelector('textarea').value.match(/10\.\d{4,9}\/[^\s"<>,;]+/g) || []).map(d => cleanDoi(d)).filter(Boolean))];
    if (!dois.length) return toast('No DOI found in that text.', true);
    el._close();
    const found = [], bad = [];
    for (const [i, d] of dois.entries()) {
      upbar(`Looking up ${i + 1} of ${dois.length}: ${d}`, i / dois.length);
      try { found.push(await lookupDoi(d)); } catch (e) { bad.push(d); }
    }
    upbar(null);
    if (found.length) addRefs(a, found);
    if (bad.length) setTimeout(() => toast(`Not found${navigator.onLine ? '' : ' (offline)'}: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`, true), 2300);
  };
}
function refsPaste(a) {
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>Paste references</h2><button type="button" class="btn primary" data-save>Add</button></div>
    <div class="ovl-body"><div class="fld"><label for="rf_text">Paste your reference list — one per line (numbers are removed), or BibTeX / RIS text</label>
      <textarea id="rf_text" class="setup" rows="12"></textarea></div>
      <p class="small muted">References are kept exactly as you pasted them. If they contain DOIs, use “Fill details from DOI” afterwards for clean .bib/.ris export.</p></div>`);
  setTimeout(() => el.querySelector('textarea').focus(), 50);
  el.querySelector('[data-save]').onclick = () => {
    const list = parsePasted(el.querySelector('textarea').value);
    if (!list.length) return toast('No references found in that text.', true);
    el._close();
    addRefs(a, list);
  };
}
async function importRefFile(a, f) {
  const text = await f.text();
  const list = /\.ris$/i.test(f.name) || /^TY  -/m.test(text) ? parseRis(text) : /@\w+\s*\{/.test(text) ? parseBib(text) : parsePasted(text);
  if (!list.length) return toast(`No references found in ${f.name}.`, true);
  addRefs(a, list, `from ${f.name}`);
}
async function fillRefs(a) {
  const refs = [...(byId[a.id].refs || [])];
  const todo = refs.filter(r => r.doi && !r.title);
  let ok = 0;
  for (const [i, r] of todo.entries()) {
    upbar(`Looking up ${i + 1} of ${todo.length}`, i / todo.length);
    try { Object.assign(refs[refs.indexOf(r)], await lookupDoi(r.doi)); ok++; } catch (e) {}
  }
  upbar(null);
  saveRefs(a, refs, `Filled details for ${ok} of ${todo.length}`);
}
function refForm(a, id) {
  const r = (a.refs || []).find(x => x.id === id);
  if (!r) return;
  const F = [['authors', 'Authors (Family Initials; separated by ;)'], ['title', 'Title'], ['journal', 'Journal'], ['year', 'Year', 'half'], ['volume', 'Volume', 'half'],
    ['issue', 'Issue', 'half'], ['pages', 'Pages / article no.', 'half'], ['doi', 'DOI'], ['url', 'Web address'], ['text', 'Full reference as text (used when there is no title)']];
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>Reference</h2><button type="button" class="btn primary" data-save>Save</button></div>
    <div class="ovl-body"><div class="fields">${F.map(([k, lab, cls]) => k === 'text' || k === 'title'
      ? `<div class="fld"><label for="rf_${k}">${lab}</label><textarea id="rf_${k}" rows="${k === 'text' ? 3 : 2}">${esc(r[k] || '')}</textarea></div>`
      : `<div class="fld ${cls || ''}"><label for="rf_${k}">${lab}</label><input id="rf_${k}" type="text" value="${esc(r[k] || '')}"></div>`).join('')}
    </div>
    <div class="sheet-foot">${r.doi ? `<button type="button" class="btn" data-look>Refresh from DOI</button>` : ''}</div></div>`);
  el.addEventListener('input', () => { el._dirty = true; });
  const look = el.querySelector('[data-look]');
  if (look) look.onclick = async () => {
    try { const d = await lookupDoi(cleanDoi(el.querySelector('#rf_doi').value) || r.doi); F.forEach(([k]) => { if (d[k] !== undefined) el.querySelector('#rf_' + k).value = d[k]; }); el._dirty = true; }
    catch (e) { toast(e.message, true); }
  };
  el.querySelector('[data-save]').onclick = () => {
    const nr = { id: r.id };
    F.forEach(([k]) => { const v = el.querySelector('#rf_' + k).value.trim(); if (v) nr[k] = k === 'doi' ? cleanDoi(v) || v : v; });
    if (!nr.title && !nr.text && !nr.doi) return toast('Add at least a title, the full text or a DOI.', true);
    el._close();
    saveRefs(a, (byId[a.id].refs || []).map(x => (x.id === r.id ? nr : x)), 'Reference saved');
  };
}
function delRef(a, id) {
  const r = (a.refs || []).find(x => x.id === id);
  if (r && confirm(`Remove this reference?\n\n${formatRef(r).slice(0, 200)}`)) saveRefs(a, a.refs.filter(x => x.id !== id), 'Reference removed');
}

function wsRootHTML(r, a, own, all) {
  const total = own.reduce((n, f) => n + (f.size || 0), 0);
  const top = childFolders(all, '');
  return `${crumbsHTML(a, '')}
  ${wsHeadHTML(r, a, own)}
  <h3 class="grouph">${esc(a.folderName || 'Folders')}</h3>
  ${tilesHTML(a, own, top, `
    <button type="button" class="tile readme" data-act="readme"><span class="tileic">${icon('note')}</span><span class="tilet">${esc(a.readmeName || 'README.md')}</span><span class="tiles-s">${a.notes ? 'Notes & checklist' : 'Empty — tap to write'}</span></button>
    <button type="button" class="tile add" data-act="newfolder" data-parent=""><span class="tileic">${icon('folderplus')}</span><span class="tilet">New folder</span><span class="tiles-s">&nbsp;</span></button>`)}
  ${a.kind === 'article' ? linksCardHTML(a) + refsCardHTML(a) : ''}
  ${inFolder(own, '').length ? `<h3 class="grouph">Files in this folder</h3>${fileRowsHTML(inFolder(own, ''))}` : ''}
  ${uploadBtns('', { whole: true }, a)}
  <section class="card readmecard">
    <div class="cardhead"><h3>${icon('note')} ${esc(a.readmeName || 'README.md')}</h3><button type="button" class="btn sm" data-act="readme">${icon('edit')} Edit</button></div>
    ${a.notes ? `<div class="md">${mdToHtml(a.notes)}</div>` : `<p class="muted">${WS[a.kind].readmeHint}</p>`}
  </section>
  <p class="small muted">${own.length} file${own.length === 1 ? '' : 's'} · ${fmtSize(total)} · stored privately in your Google account and synced to all your devices.
  ${canPickFolder ? 'Tip: drag files from your computer onto any folder to upload them.' : ''}</p>`;
}

function folderHTML(r, a, own, all) {
  const path = r.folder;
  if (!all.includes(path)) {
    return `${crumbsHTML(a, path)}<div class="empty">${icon('folder')}<p>This folder no longer exists.</p><a class="btn" href="${wsHref(a.id)}">Back to ${esc(a.title)}</a></div>`;
  }
  const subs = childFolders(all, path);
  const here = inFolder(own, path);
  const profs = isProfFolder(path, a) ? profsOf(a.id) : null;
  return `${crumbsHTML(a, path)}
  <div class="folderhead">
    <span class="wsicon">${icon('folder')}</span>
    <div><h2>${folderTitle(lastPart(path))}</h2><p class="small muted">${esc(lastPart(path))} · ${plural(underFolder(own, path).length, 'file')}</p></div>
  </div>
  ${uploadBtns(path, { primary: true }, a)}
  ${profs ? `<section class="card">
    <div class="cardhead"><h3>${icon('person')} Professors</h3><a class="btn sm" href="${r.base}/~e/professor/new">${icon('plus')} Add professor</a></div>
    ${profs.length ? `<ul class="rows">${profs.map(p => rowHTML(p, 0, 0, `${r.base}/~e/professor/${p.id}`)).join('')}</ul>`
      : `<p class="muted">Keep track of each professor: research focus, when you emailed, when to follow up, and what they replied.</p>`}
  </section>` : ''}
  ${subs.length ? tilesHTML(a, own, subs) : ''}
  ${here.length ? fileRowsHTML(here) : (subs.length ? '' : `<div class="dropzone">${icon('upload')}<p>No files yet.<br>${canPickFolder ? 'Drag files here, or use <b>Upload files</b>.' : 'Tap <b>Upload files</b> to add PDFs, Word files, photos…'}</p></div>`)}
  <div class="folderfoot">
    ${underFolder(own, path).length ? `<button type="button" class="btn sm" data-act="zip" data-folder="${esc(path)}">${icon('download')} Download folder (.zip)</button>` : ''}
    <button type="button" class="btn sm" data-act="renamefolder" data-folder="${esc(path)}">${icon('edit')} Rename folder</button>
    <button type="button" class="btn sm danger" data-act="deletefolder" data-folder="${esc(path)}">${icon('trash')} Delete folder</button>
  </div>`;
}

/* ---- folder changes ---- */
function saveFolders(a, folders) {
  store.save({ ...byId[a.id], folders: [...new Set(folders)].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) });
}
function newFolder(a, parent) {
  const name = cleanName(prompt(parent ? `New folder inside “${lastPart(parent)}”:` : 'New folder name (e.g. 05_Interview):') || '');
  if (!name) return;
  const path = joinPath(parent, name);
  if (folderSet({ folders: appFolders(a) }, filesOf(a.id)).some(p => p.toLowerCase() === path.toLowerCase())) return toast('A folder with that name already exists.', true);
  saveFolders(a, [...appFolders(a), path]);
  toast('Folder created');
}
function renameFolder(a, path) {
  const name = cleanName(prompt('Rename folder:', lastPart(path)) || '');
  if (!name || name === lastPart(path)) return;
  const np = joinPath(parentOf(path), name);
  const all = folderSet({ folders: appFolders(a) }, filesOf(a.id));
  if (all.some(p => p.toLowerCase() === np.toLowerCase() && p !== path)) return toast('A folder with that name already exists.', true);
  const move = p => (p === path || p.startsWith(path + '/')) ? np + p.slice(path.length) : p;
  saveFolders(a, all.map(move));
  underFolder(filesOf(a.id), path).forEach(f => store.updateFile(f.id, { folder: move(f.folder) }));
  go(wsHref(a.id, np));
  toast('Folder renamed');
}
function deleteFolder(a, path) {
  const inside = underFolder(filesOf(a.id), path);
  if (!confirm(inside.length ? `Delete “${lastPart(path)}” and the ${inside.length} file${inside.length > 1 ? 's' : ''} in it? This cannot be undone.` : `Delete the empty folder “${lastPart(path)}”?`)) return;
  inside.forEach(f => store.deleteFile(f));
  const all = folderSet({ folders: appFolders(a) }, filesOf(a.id));
  saveFolders(a, all.filter(p => !(p === path || p.startsWith(path + '/'))));
  go(wsHref(a.id, parentOf(path)));
  toast('Folder deleted');
}

/* ---- uploads (one at a time, with a progress bar) ---- */
let upQueue = Promise.resolve(), uploading = 0;
addEventListener('beforeunload', e => { if (uploading) { e.preventDefault(); e.returnValue = ''; } });
function upbar(text, frac) {
  const el = app.querySelector('#upbar');
  if (!el) return;
  if (text == null) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span>${esc(text)}</span>${frac == null ? '' : `<i style="width:${Math.round(Math.min(1, frac) * 100)}%"></i>`}`;
}
function queueUpload(appId, list) {
  uploading++;
  upQueue = upQueue.then(() => uploadMany(appId, list)).catch(e => toast(e.message, true)).finally(() => { uploading--; });
  return upQueue;
}
async function uploadMany(appId, list) {
  if (store.mode !== 'cloud') return toast('Sign in with Google to store files.', true);
  const tooBig = list.filter(x => x.file.size > MAX_FILE);
  list = list.filter(x => x.file.size <= MAX_FILE);
  if (tooBig.length) toast(`Skipped ${tooBig.length} file${tooBig.length > 1 ? 's' : ''} over ${MAX_FILE / 1048576} MB: ${tooBig.map(x => x.name).slice(0, 3).join(', ')}`, true);
  const totalBytes = list.reduce((n, x) => n + x.file.size, 0);
  if (totalBytes > 150 * 1048576 && !confirm(`This uploads ${fmtSize(totalBytes)}. Your free Firebase plan holds about 1 GB in total. Continue?`)) return;
  let doneBytes = 0, added = 0, replaced = 0, same = 0, failed = 0;
  for (const [i, x] of list.entries()) {
    const existing = files.find(f => f.app === appId && (f.folder || '') === x.folder && f.name.toLowerCase() === x.name.toLowerCase());
    if (existing && existing.size === x.file.size && existing.lastModified && existing.lastModified === x.file.lastModified) { same++; doneBytes += x.file.size; continue; }
    const label = `Uploading ${list.length > 1 ? `${i + 1} of ${list.length}: ` : ''}${x.name}`;
    const prog = (sent, n) => upbar(label, totalBytes ? (doneBytes + x.file.size * sent / n) / totalBytes : 1);
    prog(0, 1);
    try {
      const meta = { name: x.name, folder: x.folder, app: appId, type: x.file.type || '', lastModified: x.file.lastModified || null };
      const res = existing ? await store.replaceFile({ ...existing, ...meta }, x.file, prog) : await store.putFile(x.file, meta, prog);
      existing ? replaced++ : added++;
      // Online: wait for each file to arrive before reading the next, so big folders don't fill the memory.
      // Offline: everything is queued on this device and uploads by itself later.
      if (navigator.onLine) await res.done;
    } catch (e) { failed++; toast(e.message || `Could not upload ${x.name}`, true); }
    doneBytes += x.file.size;
  }
  upbar(null);
  const parts = [added && `${added} uploaded`, replaced && `${replaced} replaced with newer versions`, same && `${same} already there`, failed && `${failed} failed`].filter(Boolean);
  if (parts.length) toast((navigator.onLine ? '' : 'Offline — saved on this device and will upload later. ') + parts.join(', '), !!failed);
}

async function importAppFolder(fileList, intoApp, mode, kind = 'application') {
  const m = mapFolderUpload(fileList);
  if (!m.files.length && !m.readme) return toast('That folder is empty.', true);
  const readmeText = m.readme ? await m.readme.text() : '';
  if (mode === 'sub') {   // "Upload a folder" inside a folder: it becomes a sub-folder there
    const base = joinPath(intoApp.folder, cleanName(m.top));
    const list = m.files.map(x => ({ ...x, folder: joinPath(base, x.folder) }));
    if (m.readme) list.push({ file: m.readme, folder: base, name: cleanName(m.readme.name) });
    saveFolders(intoApp.app, [...appFolders(intoApp.app), base]);
    return queueUpload(intoApp.app.id, list);
  }
  const topFolders = [...new Set(m.files.map(x => x.folder.split('/')[0]).filter(Boolean))];
  let a = intoApp || items.find(x => x.kind === kind && (x.folderName || '').toLowerCase() === m.top.toLowerCase());
  if (!a) {
    const W = WS[kind];
    if (!confirm(`Create the ${W.noun} “${prettyFolder(m.top)}” from this folder (${m.files.length} files)?\n\nYou can fill in the details afterwards under Details.`)) return;
    a = {
      id: newId(), kind, title: prettyFolder(m.top) || 'New ' + W.noun, ...W.fresh(),
      folderName: m.top, folders: topFolders.length ? topFolders : W.folders, notes: readmeText, readmeName: m.readme ? m.readme.name : undefined, createdAt: Date.now(),
    };
    store.save(a);
    pendingOpen = a;
    go(wsHref(a.id));
  } else {
    let notes = a.notes || '';
    if (readmeText.trim() && readmeText.trim() !== notes.trim() && (!notes.trim() || confirm(`Replace the README of “${a.title}” with the ${m.readme.name} from this folder?`))) notes = readmeText;
    store.save({ ...a, notes, folders: [...new Set([...appFolders(a), ...topFolders])], folderName: a.folderName || m.top, readmeName: a.readmeName || (m.readme && m.readme.name) || undefined });
    if (route().ws !== a.id) go(wsHref(a.id));
  }
  if (m.skipped) toast(`Skipped ${m.skipped} hidden system file${m.skipped > 1 ? 's' : ''}`);
  return queueUpload(a.id, m.files);
}

/* ---- opening, downloading, zipping ---- */
async function fileBlob(f) {
  upbar(`Opening ${f.name}…`);
  try { return await store.readFile(f); }
  finally { upbar(null); }
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;   // always saved as a download, never run inside the app
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function downloadFile(f) {
  try { saveBlob(await fileBlob(f), f.name); toast(`Downloaded ${f.name}`); }
  catch (e) { toast(e.message, true); }
}
async function openFile(f) {
  if (!viewable(f)) return downloadFile(f);
  let blob;
  try { blob = await fileBlob(f); } catch (e) { return toast(e.message, true); }
  if (fileKind(f) === 'image') {
    const url = URL.createObjectURL(new Blob([blob], { type: 'image/' + (extOf(f.name) === 'jpg' ? 'jpeg' : extOf(f.name)) }));
    const v = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x>${icon('close')}</button><h2>${esc(f.name)}</h2>
      <button type="button" class="btn" data-dl>${icon('download')} Download</button></div>
      <div class="ovl-img"><img src="${url}" alt="${esc(f.name)}"></div>`, () => URL.revokeObjectURL(url));
    v.querySelector('[data-dl]').onclick = () => saveBlob(blob, f.name);
    return;
  }
  textOverlay({ title: f.name, text: await blob.text(), md: fileKind(f) === 'md',
    onSave: async text => { const res = await store.replaceFile(f, new Blob([text], { type: f.type || 'text/plain' })); toast('Saved'); return res; },
    onDownload: () => saveBlob(blob, f.name) });
}
async function zipDownload(a, folder) {
  const own = filesOf(a.id);
  const list = folder ? underFolder(own, folder) : own;
  const root = folder ? lastPart(folder) : zipRoot(a);
  const rel = f => (folder ? (f.folder || '').slice(folder.length).replace(/^\//, '') : (f.folder || ''));
  const entries = [];
  if (!folder && (a.notes || '').trim()) entries.push({ path: `${root}/${cleanName(a.readmeName || 'README.md')}`, data: a.notes });
  const all = folderSet({ folders: appFolders(a) }, own).filter(p => !folder || p.startsWith(folder + '/'));
  all.filter(p => !underFolder(own, p).length).forEach(p => entries.push({ path: `${root}/${folder ? p.slice(folder.length + 1) : p}`, dir: true }));
  try {
    for (const [i, f] of list.entries()) {
      upbar(`Preparing zip: ${i + 1} of ${list.length}`, i / list.length);
      const blob = await store.readFile(f);
      entries.push({ path: [root, rel(f), f.name].filter(Boolean).join('/'), data: new Uint8Array(await blob.arrayBuffer()) });
    }
    upbar('Packing…', 1);
    saveBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `${root}.zip`);
    toast(`Downloaded ${root}.zip (${list.length} files)`);
  } catch (e) { toast(e.message, true); }
  finally { upbar(null); }
}
async function zipAllApplications() {
  const apps = items.filter(x => WS[x.kind]);
  const entries = [];
  const n = files.filter(f => byId[f.app]).length;
  let k = 0;
  try {
    for (const a of apps) {
      const root = WS[a.kind].zipRoot + '/' + zipRoot(a);
      if ((a.notes || '').trim()) entries.push({ path: `${root}/${cleanName(a.readmeName || 'README.md')}`, data: a.notes });
      for (const f of filesOf(a.id)) {
        upbar(`Preparing zip: ${++k} of ${n}`, k / Math.max(1, n));
        const blob = await store.readFile(f);
        entries.push({ path: [root, f.folder, f.name].filter(Boolean).join('/'), data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    if (!entries.length) return toast('No files yet.');
    upbar('Packing…', 1);
    saveBlob(new Blob([buildZip(entries)], { type: 'application/zip' }), `Research_Log_folders_${today()}.zip`);
    toast('Downloaded all folders');
  } catch (e) { toast(e.message, true); }
  finally { upbar(null); }
}

/* ---- full-screen panels: file viewer, notes, file details ---- */
function overlay(html, onClose) {
  closeOverlays();
  const el = document.createElement('div');
  el.className = 'ovl';
  el.innerHTML = `<div class="ovl-panel" role="dialog" aria-modal="true">${html}</div>`;
  el._close = () => { el.remove(); document.body.classList.remove('noscroll'); onClose && onClose(); };
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-x]')) { if (!el._dirty || confirm('Discard your changes?')) el._close(); } });
  document.body.appendChild(el);
  document.body.classList.add('noscroll');
  return el;
}
function closeOverlays() { document.querySelectorAll('.ovl').forEach(o => o._close ? o._close() : o.remove()); }
addEventListener('hashchange', closeOverlays);

function textOverlay({ title, text, md, onSave, onDownload, startEditing }) {
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button><h2>${esc(title)}</h2>
      <span class="ovl-acts"></span></div><div class="ovl-body"></div>`);
  const body = el.querySelector('.ovl-body'), acts = el.querySelector('.ovl-acts');
  const view = () => {
    el._dirty = false;
    body.innerHTML = text.trim() ? (md ? `<div class="md">${mdToHtml(text)}</div>` : `<pre class="plain">${esc(text)}</pre>`) : '<p class="muted">Empty.</p>';
    acts.innerHTML = `${onDownload ? `<button type="button" class="iconbtn" data-dl aria-label="Download">${icon('download')}</button>` : ''}<button type="button" class="btn primary" data-edit>${icon('edit')} Edit</button>`;
    acts.querySelector('[data-edit]').onclick = edit;
    if (onDownload) acts.querySelector('[data-dl]').onclick = onDownload;
  };
  const edit = () => {
    body.innerHTML = `<textarea class="noteedit" spellcheck="true" aria-label="${esc(title)}">${esc(text)}</textarea>
      ${md ? '<p class="small muted"># Heading · **bold** · - list · - [ ] checklist · [link](https://…)</p>' : ''}`;
    acts.innerHTML = `<button type="button" class="btn" data-cancel>Cancel</button><button type="button" class="btn primary" data-save>Save</button>`;
    const ta = body.querySelector('textarea');
    ta.addEventListener('input', () => { el._dirty = true; });
    ta.focus();
    acts.querySelector('[data-cancel]').onclick = () => { if (!el._dirty || confirm('Discard your changes?')) view(); };
    acts.querySelector('[data-save]').onclick = async () => {
      try { await onSave(ta.value); text = ta.value; view(); }
      catch (e) { toast(e.message, true); }
    };
  };
  startEditing ? edit() : view();
  return el;
}

function fileInfo(f) {
  const a = byId[f.app];
  if (!a) return;
  const all = folderSet({ folders: appFolders(a) }, filesOf(a.id));
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button><h2>File</h2>
      <button type="button" class="btn primary" data-save>Save</button></div>
    <div class="ovl-body"><div class="fields">
      <div class="fld"><label for="fi_name">Name</label><input id="fi_name" type="text" value="${esc(f.name)}"></div>
      <div class="fld"><label for="fi_folder">Folder</label><select id="fi_folder">
        <option value="">${esc(a.folderName || a.title)} (top level)</option>
        ${all.map(p => `<option value="${esc(p)}" ${p === (f.folder || '') ? 'selected' : ''}>${esc(p.replace(/\//g, ' / '))}</option>`).join('')}
      </select></div>
      <p class="small muted">${fmtSize(f.size)} · added ${new Date(f.createdAt || Date.now()).toLocaleString()}${f.updatedAt && f.updatedAt !== f.createdAt ? ` · changed ${new Date(f.updatedAt).toLocaleString()}` : ''}</p>
    </div>
    <div class="sheet-foot">
      <button type="button" class="btn" data-dl>${icon('download')} Download</button>
      <label class="btn">${icon('upload')} Replace with new version<input type="file" data-rep hidden></label>
      <button type="button" class="btn danger" data-del>${icon('trash')} Delete</button>
    </div></div>`);
  el.querySelector('[data-dl]').onclick = () => downloadFile(f);
  el.querySelector('[data-save]').onclick = () => {
    const name = cleanName(el.querySelector('#fi_name').value);
    const folder = el.querySelector('#fi_folder').value;
    if (!name) return toast('The file needs a name.', true);
    if (files.some(x => x.id !== f.id && x.app === f.app && (x.folder || '') === folder && x.name.toLowerCase() === name.toLowerCase())) return toast('A file with that name is already in that folder.', true);
    if (name !== f.name || folder !== (f.folder || '')) { store.updateFile(f.id, { name, folder }); toast(folder !== (f.folder || '') ? 'Moved' : 'Renamed'); }
    el._close();
  };
  el.querySelector('[data-rep]').onchange = e => {
    const nf = e.target.files[0];
    if (!nf) return;
    el._close();
    queueUpload(f.app, [{ file: nf, folder: f.folder || '', name: f.name, replace: true }]);
  };
  el.querySelector('[data-del]').onclick = () => {
    if (!confirm(`Delete “${f.name}”? This cannot be undone.`)) return;
    store.deleteFile(f); el._close(); toast('File deleted');
  };
}

async function newNote(a, folder) {
  let name = cleanName(prompt('Name of the new note:', 'Notes') || '');
  if (!name) return;
  if (!/\.(md|txt)$/i.test(name)) name += '.md';
  if (files.some(x => x.app === a.id && (x.folder || '') === folder && x.name.toLowerCase() === name.toLowerCase())) return toast('A file with that name is already here.', true);
  const text = `# ${name.replace(/\.(md|txt)$/i, '')}\n\n`;
  try {
    const { id } = await store.putFile(new Blob([text], { type: 'text/markdown' }), { name, folder, app: a.id, type: 'text/markdown' });
    let f = { id, name, folder, app: a.id, type: 'text/markdown', chunks: 1, size: new Blob([text]).size };
    textOverlay({ title: name, text, md: /\.md$/i.test(name), startEditing: true,
      onSave: async t => { f = files.find(x => x.id === id) || f; await store.replaceFile(f, new Blob([t], { type: 'text/markdown' })); toast('Note saved'); },
      onDownload: () => downloadFile(files.find(x => x.id === id) || f) });
  } catch (e) { toast(e.message, true); }
}

function editReadme(a) {
  textOverlay({ title: a.readmeName || 'README.md', text: a.notes || '', md: true, startEditing: !a.notes,
    onSave: async t => { store.save({ ...byId[a.id], notes: t }); toast('README saved'); } });
}

/* drag and drop files from the computer onto a folder (elsewhere a drop is ignored instead of leaving the app) */
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => e.preventDefault());
app.addEventListener('dragover', e => { if (route().ws && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); app.classList.add('dragging'); } });
app.addEventListener('dragleave', e => { if (!e.relatedTarget || !app.contains(e.relatedTarget)) app.classList.remove('dragging'); });
app.addEventListener('drop', e => {
  const r = route();
  app.classList.remove('dragging');
  if (!r.ws || !e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  const list = [...e.dataTransfer.files].filter(f => f.size || f.type).map(f => ({ file: f, folder: r.folder || '', name: cleanName(f.name) }));
  if (!list.length) return toast('To upload a whole folder, use “Upload a folder”.', true);
  queueUpload(r.ws, list);
});

/* ---------------- read-only links & the website feed ----------------
   Settings live in the owner's private meta/sharing. Whenever the log changes (and is fully synced),
   each link's snapshot is re-encrypted and written to shares/{id}; the website feed to public/site. */
let sharing = null, shareState = '', publishTimer = null;
const lastSent = {};
const defaultSharing = () => ({ links: [], site: { enabled: true, kinds: [...SITE_KINDS], inProgress: false } });
async function loadSharing() {
  try { sharing = { ...defaultSharing(), ...((await store.getMeta('sharing')) || {}) }; }
  catch (e) { sharing = defaultSharing(); }
  if (route().view === 'settings') renderShareCard();
  schedulePublish();
}
async function saveSharing() { await store.setMeta('sharing', sharing); renderShareCard(); }
function schedulePublish(delay = 4000) {
  if (store.mode !== 'cloud' || !user || !sharing) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(publishAll, delay);
}
async function publishAll() {
  // Only from a complete, server-confirmed copy of the log, so a half-loaded device never blanks a link or the website.
  if (store.mode !== 'cloud' || !user || !sharing || status !== 'synced' || !items.length) return;
  const name = user.name || '';
  let failed = '';
  for (const l of sharing.links) {
    const payload = { name, kinds: l.kinds, items: snapshot(items, l) };
    const json = JSON.stringify(payload);
    if (lastSent[l.id] === json) continue;
    try {
      const sealed = await seal(l, { ...payload, generatedAt: Date.now() });
      if (sealed.data.length > 950000) { failed = 'toolarge'; continue; }
      await store.setShare(l.id, sealed);
      lastSent[l.id] = json; l.published = Date.now();
    } catch (e) { failed = e && e.code === 'permission-denied' ? 'rules' : 'error'; }
  }
  const site = sharing.site || defaultSharing().site;
  // A research article that is Published or Accepted also counts as a publication on the website.
  const norm = t => String(t || '').trim().toLowerCase();
  const asPub = items.filter(x => x.kind === 'article' && ['Published', 'Accepted'].includes(x.status)
      && !items.some(p => p.kind === 'publication' && norm(p.title) === norm(x.title)))
    .map(x => ({ id: 'article-' + x.id, kind: 'publication', title: x.title, status: x.status, venue: x.journal, authors: x.authors, doi: x.doi,
      year: Number((x.submitted || '').slice(0, 4)) || new Date(x.updatedAt || Date.now()).getFullYear(), noShare: x.noShare, updatedAt: x.updatedAt }));
  const sitePayload = { name, items: site.enabled ? snapshot(items.concat(asPub), site, { site: true }) : [], inProgress: !!site.inProgress, off: !site.enabled };
  const sjson = JSON.stringify(sitePayload);
  if (lastSent.__site !== sjson) {
    try { await store.setSite({ json: JSON.stringify({ ...sitePayload, generatedAt: Date.now() }) }); lastSent.__site = sjson; site.published = Date.now(); }
    catch (e) { failed = e && e.code === 'permission-denied' ? 'rules' : (failed || 'error'); }
  }
  shareState = failed;
  if (route().view === 'settings') renderShareCard();
}

const kindChecks = (name, chosen, kinds) => SECTIONS.map(sec => {
  const ks = sec.kinds.filter(k => !kinds || kinds.includes(k));
  if (!ks.length) return '';
  return `<div class="kgroup"><b>${esc(sec.label)}</b>${ks.map(k => `<label class="checkopt"><input type="checkbox" name="${name}" value="${k}" ${chosen.includes(k) ? 'checked' : ''}>
    ${esc(KINDS[k].plural)} <span class="muted small">${items.filter(x => x.kind === k && !x.noShare).length}</span></label>`).join('')}</div>`;
}).join('');

function sharingHTML() { return `<section class="card" id="shareCard">${shareCardInner()}</section>`; }
function renderShareCard() { const el = app.querySelector('#shareCard'); if (el) el.innerHTML = shareCardInner(); }
function shareCardInner() {
  if (store.mode !== 'cloud') return `<h3>Read-only links &amp; website</h3><p class="muted">Sign in with Google to share.</p>`;
  if (!sharing) return `<h3>Read-only links &amp; website</h3><p class="small muted">Loading…</p>`;
  const warn = shareState === 'rules' ? `<p class="banner warn"><b>One step left:</b> paste the updated Firebase rules (from your Claude chat) so links and the website can be updated. Until then, nothing is shared.</p>`
    : shareState === 'toolarge' ? `<p class="banner warn">One link holds too much. Tick fewer record types for it.</p>`
    : shareState === 'error' ? `<p class="banner warn">Sharing could not be updated just now; it retries when you next change something.</p>` : '';
  const site = sharing.site || defaultSharing().site;
  return `<h3>${icon('link')} Read-only links</h3>
    <p class="muted">Send someone a secret link to view chosen parts of your log — no sign-in, no editing, no files or photos. It stays up to date whenever you use the app, and you can turn it off any time.</p>
    ${warn}
    ${sharing.links.length ? `<ul class="rows links">${sharing.links.map(l => `<li class="row">
      <span class="dot" style="--c:var(--dry)"></span>
      <span class="rowmain"><span class="t">${esc(l.name || 'Read-only link')}</span>
        <span class="s">${esc(l.kinds.map(k => KINDS[k] ? KINDS[k].plural : k).join(', '))}${l.hideNotes ? ' · notes hidden' : ''}</span></span>
      <span class="tail">
        <button type="button" class="btn sm" data-act="link-copy" data-id="${l.id}">${icon('copy')} Copy</button>
        <a class="iconbtn sm" href="${esc(linkUrl(l))}" target="_blank" rel="noopener" aria-label="Open as a viewer">${icon('ext')}</a>
        <button type="button" class="iconbtn sm" data-act="link-edit" data-id="${l.id}" aria-label="Change what this link shows">${icon('edit')}</button>
        <button type="button" class="iconbtn sm" data-act="link-off" data-id="${l.id}" aria-label="Turn this link off">${icon('trash')}</button>
      </span></li>`).join('')}</ul>` : ''}
    <div class="btnrow"><button type="button" class="btn primary" data-act="link-new">${icon('plus')} New read-only link</button></div>
    <h3 style="margin-top:22px">${icon('ext')} My website</h3>
    <p class="muted">Show records from this log on <a href="../" target="_blank" rel="noopener">hafij-bge.github.io</a> automatically. Notes, emails and records marked Private are never shown.</p>
    <label class="toggle big nopad"><input type="checkbox" data-act="site-on" ${site.enabled ? 'checked' : ''}> Update my website from this log</label>
    <div class="checks" ${site.enabled ? '' : 'hidden'}>${SITE_KINDS.map(k => `<label class="checkopt"><input type="checkbox" data-act="site-kind" value="${k}" ${site.kinds.includes(k) ? 'checked' : ''}> ${esc(KINDS[k].plural)}</label>`).join('')}</div>
    <label class="toggle nopad" ${site.enabled && site.kinds.includes('publication') ? '' : 'hidden'}><input type="checkbox" data-act="site-inprog" ${site.inProgress ? 'checked' : ''}> Also list manuscripts in progress (title and stage only)</label>
    <p class="small muted">Publications appear once Published or Accepted; projects while Active or Done. ${site.published ? `Last updated ${new Date(site.published).toLocaleString()}.` : ''}</p>`;
}

function linkEditor(l) {
  const isNew = !l;
  const chosen = l ? l.kinds : ['publication', 'talk', 'award', 'project'];
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>${isNew ? 'New read-only link' : 'Change link'}</h2><button type="button" class="btn primary" data-save>${isNew ? 'Create link' : 'Save'}</button></div>
    <div class="ovl-body"><div class="fields">
      <div class="fld"><label for="ln_name">Name (only you see it)</label><input id="ln_name" type="text" value="${esc(l ? l.name : '')}" placeholder="e.g. For Prof. Müller"></div>
      <div class="fld"><label>What the viewer can see</label><div class="kgroups">${kindChecks('ln_kind', chosen)}</div></div>
      <div class="fld"><label class="toggle big nopad"><input type="checkbox" id="ln_hide" ${!l || l.hideNotes ? 'checked' : ''}> Hide personal notes and contact details (notes, emails, “why this lab”)</label></div>
      <p class="small muted">Files and photos are never shared. Records you mark <b>Private</b> never appear. The link itself is the key — anyone who has it can view, so send it only to the people you mean.</p>
    </div></div>`);
  el.querySelector('[data-save]').onclick = async () => {
    const kinds = [...el.querySelectorAll('input[name=ln_kind]:checked')].map(i => i.value);
    if (!kinds.length) return toast('Tick at least one thing to show.', true);
    const name = el.querySelector('#ln_name').value.trim() || 'Read-only link';
    const hideNotes = el.querySelector('#ln_hide').checked;
    let link = l;
    if (isNew) { link = { ...newLink(name), kinds, hideNotes }; sharing.links.push(link); }
    else Object.assign(link, { name, kinds, hideNotes });
    delete lastSent[link.id];
    el._close();
    try { await saveSharing(); } catch (e) { return toast('Could not save the link settings.', true); }
    await publishAll();
    if (shareState === 'rules') return toast('Link saved. Paste the updated Firebase rules to switch it on.', true);
    if (isNew) copyLink(link); else toast('Link updated');
  };
}
async function copyLink(l) {
  if (!l) return;
  try { await navigator.clipboard.writeText(linkUrl(l)); toast('Link copied — send it only to the people you mean'); }
  catch (e) { prompt('Copy this link:', linkUrl(l)); }
}
async function removeLink(id) {
  const l = sharing.links.find(x => x.id === id);
  if (!l || !confirm(`Turn off “${l.name}”? Anyone with this link will no longer see anything.`)) return;
  sharing.links = sharing.links.filter(x => x.id !== id);
  delete lastSent[id];
  try { await store.deleteShare(id); } catch (e) {}
  await saveSharing();
  toast('Link turned off');
}
async function siteSetting(t) {
  const site = sharing.site = sharing.site || defaultSharing().site;
  if (t.dataset.act === 'site-on') site.enabled = t.checked;
  if (t.dataset.act === 'site-inprog') site.inProgress = t.checked;
  if (t.dataset.act === 'site-kind') site.kinds = t.checked ? [...new Set([...site.kinds, t.value])] : site.kinds.filter(k => k !== t.value);
  await saveSharing();
  publishAll();
}

/* ---------------- GitHub ---------------- */
function githubCardHTML() {
  const c = cachedRepos();
  const projects = items.filter(x => x.kind === 'project');
  const linked = r => projects.some(p => repoFor(p, [r]));
  const repos = c ? c.repos.filter(r => r.name.toLowerCase() !== GH_USER.toLowerCase() && !/\.github\.io$/i.test(r.name)).slice(0, 5) : null;
  return `<section class="card">
    <h3>GitHub activity</h3>
    ${repos ? (repos.length ? `<ul class="rows">${repos.map(r => `<li class="row"><span class="dot" style="--c:var(--dry)"></span>
      <a class="rowmain" href="${esc(r.url)}" target="_blank" rel="noopener"><span class="t">${esc(r.name)}</span>
        <span class="s">${esc([r.language, 'updated ' + ago(r.pushed)].filter(Boolean).join(' · '))}</span></a>
      <span class="tail">${linked(r) ? `<span class="badge g">In log</span>` : `<button type="button" class="btn sm" data-act="ghadd" data-repo="${esc(r.name)}">${icon('plus')} Project</button>`}</span></li>`).join('')}</ul>`
      : `<p class="muted">No public repositories yet.</p>`) : `<p class="muted">Checking GitHub…</p>`}
    <a class="more" href="https://github.com/${GH_USER}" target="_blank" rel="noopener">Your GitHub</a>
  </section>`;
}
function addRepoAsProject(name) {
  const r = ((cachedRepos() || {}).repos || []).find(x => x.name === name);
  if (!r) return;
  store.save({ kind: 'project', title: r.name, status: 'Active', area: 'Computational', progress: 0, links: r.url, description: r.description || '', createdAt: Date.now() });
  toast(`Added ${r.name} to your projects`);
}

/* ---------------- Ask AI ---------------- */
let aiCfg = null;
const AI_KINDS_DEFAULT = ['project', 'article', 'task', 'application', 'professor', 'experiment', 'publication'];
ui.ai = { msgs: [], kinds: null, priv: true, file: null, focus: null, busy: false, draft: '' };
async function loadAi() {
  try { aiCfg = { channels: [], ...((await store.getMeta('ai')) || {}) }; } catch (e) { aiCfg = { channels: [] }; }
  if (route().view === 'settings') renderAiCard();
  if (route().view === 'ai') render();
}
async function saveAi() { await store.setMeta('ai', aiCfg); renderAiCard(); }
const chName = c => c.label || PROVIDERS[c.provider].name;
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function chStatus(c) {
  if (c.enabled === false) return ['n', 'Off'];
  const until = restingUntil(c.id), st = aiState()[c.id] || {};
  if (until) return ['a', `Resting until ${new Date(until).toDateString() === new Date().toDateString() ? hhmm(until) : new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}${st.error ? ' — ' + st.error : ''}`];
  if (st.error && st.errAt > (st.last || 0)) return ['r', st.error];
  return ['g', st.last ? `Ready · last answered ${hhmm(st.last)}` : 'Ready'];
}

function aiCardInner() {
  if (store.mode !== 'cloud') return `<h3>${icon('spark')} AI channels</h3><p class="muted">Sign in with Google to set up AI.</p>`;
  if (!aiCfg) return `<h3>${icon('spark')} AI channels</h3><p class="small muted">Loading…</p>`;
  const list = aiCfg.channels;
  return `<h3>${icon('spark')} AI channels</h3>
    <p class="muted">Questions go to the first channel. When it hits its limit or fails, the next one answers automatically, and a resting channel is used again once its limit resets. Free keys:
      ${Object.entries(PROVIDERS).map(([k, p]) => `<a href="${p.site}" target="_blank" rel="noopener">${esc(p.name)}</a>`).join(' · ')}.</p>
    ${list.length ? `<ol class="rows chans">${list.map((c, i) => { const [cls, txt] = chStatus(c); return `<li class="row">
      <span class="chnum">${i + 1}</span>
      <span class="rowmain"><span class="t">${esc(chName(c))}</span><span class="s">${esc(c.model || 'no model chosen')}</span>
        <span class="s"><span class="badge ${cls}">${esc(txt)}</span></span></span>
      <span class="tail">
        <button type="button" class="iconbtn sm" data-act="ai-up" data-id="${c.id}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" class="iconbtn sm" data-act="ai-down" data-id="${c.id}" aria-label="Move down" ${i < list.length - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" class="iconbtn sm" data-act="ai-edit" data-id="${c.id}" aria-label="Edit channel">${icon('edit')}</button>
        <button type="button" class="iconbtn sm" data-act="ai-del" data-id="${c.id}" aria-label="Remove channel">${icon('trash')}</button>
      </span></li>`; }).join('')}</ol>` : ''}
    <div class="btnrow"><button type="button" class="btn primary" data-act="ai-add">${icon('plus')} Add channel</button>
      ${list.length ? `<a class="btn" href="#/ai">${icon('spark')} Open Ask AI</a>` : ''}</div>
    <p class="small muted">Keys are kept in your private account settings (synced to your devices) and are sent only to their own provider. Free plans may use what you send to improve their models — the Private switch on the Ask AI page keeps notes, emails and raw data out.</p>`;
}
function renderAiCard() { const el = app.querySelector('#aiCard'); if (el) el.innerHTML = aiCardInner(); }

function channelForm(id) {
  const c = aiCfg.channels.find(x => x.id === id) || { id: newId(), provider: 'openrouter', key: '', model: '', label: '', enabled: true };
  const isNew = !aiCfg.channels.some(x => x.id === c.id);
  const el = overlay(`<div class="ovl-head"><button type="button" class="iconbtn" data-x aria-label="Close">${icon('close')}</button>
      <h2>${isNew ? 'Add AI channel' : 'AI channel'}</h2><button type="button" class="btn primary" data-save>Save</button></div>
    <div class="ovl-body"><div class="fields">
      <div class="fld half"><label for="ch_prov">Provider</label><select id="ch_prov">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}" ${k === c.provider ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="fld half"><label for="ch_label">Name (optional)</label><input id="ch_label" type="text" value="${esc(c.label)}" placeholder="e.g. Gemini (fast)"></div>
      <div class="fld"><label for="ch_key">API key — <a id="ch_site" href="${PROVIDERS[c.provider].site}" target="_blank" rel="noopener">get a free key</a></label>
        <input id="ch_key" type="password" autocomplete="off" spellcheck="false" value="${esc(c.key)}" placeholder="${esc(PROVIDERS[c.provider].keyHint)}"></div>
      <div class="fld"><label for="ch_model">Model</label>
        <div class="rowflex"><input id="ch_model" type="text" list="ch_models" value="${esc(c.model)}" placeholder="Tap “Find models”"><datalist id="ch_models"></datalist>
        <button type="button" class="btn" data-find>Find models</button></div></div>
      <div class="fld"><label class="toggle big nopad"><input id="ch_on" type="checkbox" ${c.enabled !== false ? 'checked' : ''}> Use this channel</label></div>
      <div class="btnrow"><button type="button" class="btn" data-test>Test this channel</button></div>
      <p class="small muted" id="ch_msg"></p>
    </div></div>`);
  const $ = s => el.querySelector(s);
  el.addEventListener('input', () => { el._dirty = true; });
  $('#ch_prov').onchange = () => {
    const p = PROVIDERS[$('#ch_prov').value];
    $('#ch_site').href = p.site; $('#ch_key').placeholder = p.keyHint; $('#ch_model').value = p.defaultModel; $('#ch_models').innerHTML = '';
  };
  if (isNew && !c.model) $('#ch_model').value = PROVIDERS[c.provider].defaultModel;
  const msg = (t, err) => { $('#ch_msg').textContent = t; $('#ch_msg').className = 'small ' + (err ? 'errtext' : 'muted'); };
  $('[data-find]').onclick = async () => {
    msg('Looking up models…');
    try {
      const models = await listModels($('#ch_prov').value, $('#ch_key').value.trim());
      $('#ch_models').innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
      if (!$('#ch_model').value) $('#ch_model').value = pickDefault($('#ch_prov').value, models);
      msg(`${models.length} models available${$('#ch_prov').value === 'openrouter' ? ' for free' : ''}. Click the Model box to choose one.`);
    } catch (e) { msg(e.message || 'Could not list models.', true); }
  };
  const read = () => ({ ...c, provider: $('#ch_prov').value, key: $('#ch_key').value.trim(), model: $('#ch_model').value.trim(), label: $('#ch_label').value.trim(), enabled: $('#ch_on').checked });
  $('[data-test]').onclick = async () => {
    const t = read();
    if (!t.key || !t.model) return msg('Add the key and a model first.', true);
    msg('Testing…');
    clearRest(t.id);
    try {
      const r = await askChain([t], [{ role: 'user', content: 'Reply with exactly: OK' }]);
      msg(`Works — ${r.model} answered “${r.text.slice(0, 40)}”.`);
    } catch (e) { msg((e.notes && e.notes[0]) || e.message, true); }
  };
  $('[data-save]').onclick = async () => {
    const t = read();
    if (!t.key) return msg('Paste the API key.', true);
    if (!t.model) return msg('Choose a model (tap Find models).', true);
    const i = aiCfg.channels.findIndex(x => x.id === t.id);
    if (i >= 0) aiCfg.channels[i] = t; else aiCfg.channels.push(t);
    clearRest(t.id);
    el._close();
    try { await saveAi(); toast('AI channel saved'); } catch (e) { toast('Could not save the channel.', true); }
  };
}

function aiKinds() {
  const all = SECTIONS.flatMap(s => s.kinds).filter(k => items.some(x => x.kind === k));
  return { all, chosen: (ui.ai.kinds || AI_KINDS_DEFAULT).filter(k => all.includes(k)) };
}
function aiHTML() {
  const A = ui.ai;
  if (store.mode !== 'cloud') return `<div class="empty"><p>Sign in with Google to use Ask AI.</p></div>`;
  if (!aiCfg) return `<p class="muted pad">Loading…</p>`;
  const chans = aiCfg.channels.filter(c => c.enabled !== false && c.key && c.model);
  if (!chans.length) return `<section class="card aiempty">${icon('spark')}<h3>Ask AI about your research</h3>
    <p class="muted">Ask questions about your projects, articles, applications and lab records, or attach a data file (CSV) to analyse. First add at least one free AI channel — when one reaches its limit, the next takes over automatically.</p>
    <div class="btnrow"><button type="button" class="btn primary" data-act="ai-add">${icon('plus')} Add an AI channel</button></div></section>`;
  const { all, chosen } = aiKinds();
  const focus = A.focus && byId[A.focus];
  return `<section class="card aictx">
    ${focus ? `<p class="aifocus">Looking at <b>${esc(focus.title)}</b> and what is linked to it <button type="button" class="btn sm" data-act="ai-unfocus">Use whole log</button></p>`
      : `<div class="aikinds" role="group" aria-label="What the AI can see">${all.map(k => `<button type="button" class="chip ${chosen.includes(k) ? 'on' : ''}" data-act="ai-kind" data-k="${k}" aria-pressed="${chosen.includes(k)}">${esc(KINDS[k].plural)}</button>`).join('')}</div>`}
    <label class="toggle"><input type="checkbox" data-act="ai-private" ${A.priv ? 'checked' : ''}> ${icon('lock')} Private — leave out notes, emails, private records and raw data rows</label>
    ${A.file ? `<p class="aifile">${icon('file')} <b>${esc(A.file.name)}</b> <span class="muted small">${A.file.table ? `${A.file.desc.rows} rows × ${A.file.desc.cols.length} columns` : fmtSize(A.file.size)}</span>
      <button type="button" class="iconbtn sm" data-act="ai-unfile" aria-label="Remove file">${icon('close')}</button></p>` : ''}
  </section>
  <div class="aichat" id="aichat" aria-live="polite">${A.msgs.length ? A.msgs.map(aiMsgHTML).join('') : `<div class="aihint muted">
    <p>Try:</p><ul><li>Which deadlines and follow-ups are in the next 30 days?</li><li>Summarise where each of my articles stands and what is left to do.</li>
    <li>Which professors have not replied, and what should I write next?</li><li>Attach a CSV and ask: “What stands out in this data?”</li></ul></div>`}
    ${A.busy ? `<div class="aimsg bot busy"><span class="aidots"><i></i><i></i><i></i></span> <span class="small muted" id="aitry">${esc(A.trying || 'Thinking…')}</span>
      <button type="button" class="btn sm" data-act="ai-stop">Stop</button></div>` : ''}
  </div>
  <form id="aiform" class="aiform">
    <label class="iconbtn" title="Attach a data file (CSV, TSV, TXT, MD)" aria-label="Attach a data file">${icon('upload')}<input type="file" accept=".csv,.tsv,.txt,.md,.json,text/csv,text/plain" data-act="ai-file" hidden></label>
    <textarea id="aiq" rows="1" placeholder="Ask about your research…" aria-label="Your question">${esc(A.draft)}</textarea>
    <button type="submit" class="btn primary" ${A.busy ? 'disabled' : ''}>Send</button>
  </form>
  <p class="small muted aichans">${aiCfg.channels.map((c, i) => { const [cls] = chStatus(c); return `<span class="chdot ${cls}"></span>${esc(chName(c))}`; }).join(' → ')}
    · <a href="#/settings" data-scroll="aiCard">channels</a>${A.msgs.length ? ` · <a href="#" data-act="ai-clear">new chat</a>` : ''}</p>`;
}
function aiMsgHTML(m) {
  if (m.role === 'user') return `<div class="aimsg me">${esc(m.text).replace(/\n/g, '<br>')}</div>`;
  if (m.role === 'data') {
    const d = m.desc;
    return `<div class="aimsg data"><p class="small"><b>${icon('file')} ${esc(m.name)}</b> — ${d.rows} rows. Computed by the app:</p>
      <div class="mdtable"><table><tr><th>Column</th><th>n</th><th>missing</th><th>mean ± sd</th><th>median [Q1–Q3]</th><th>min–max</th></tr>
      ${d.cols.map(c => c.type === 'number' ? `<tr><td>${esc(c.name)}</td><td>${c.n}</td><td>${c.missing}</td><td>${fmtNum(c.mean)} ± ${fmtNum(c.sd)}</td><td>${fmtNum(c.median)} [${fmtNum(c.q1)}–${fmtNum(c.q3)}]</td><td>${fmtNum(c.min)}–${fmtNum(c.max)}</td></tr>`
        : `<tr><td>${esc(c.name)}</td><td>${c.n}</td><td>${c.missing}</td><td colspan="3" class="muted">${c.idLike ? 'all different (ID column)' : `${c.distinct} distinct · ${esc(c.top.slice(0, 3).map(([v, k]) => `${v} (${k})`).join(', '))}`}</td></tr>`).join('')}</table></div>
      ${d.groups.length ? `<p class="small"><b>By group</b></p><div class="mdtable"><table><tr><th>Value</th><th>Group</th><th>n</th><th>mean ± sd</th><th>median</th></tr>
        ${d.groups.map(g => g.stats.map((s, i) => `<tr><td>${i ? '' : esc(g.col) + ' <span class="muted">by ' + esc(g.by) + '</span>'}</td><td>${esc(s.group)}</td><td>${s.n}</td><td>${fmtNum(s.mean)} ± ${fmtNum(s.sd)}</td><td>${fmtNum(s.median)}</td></tr>`).join('')).join('')}</table></div>` : ''}
      ${d.cors.length ? `<p class="small">Strongest correlations: ${d.cors.slice(0, 4).map(c => `${esc(c.a)} ~ ${esc(c.b)} r = ${c.r.toFixed(2)}`).join(' · ')}</p>` : ''}</div>`;
  }
  if (m.role === 'error') return `<div class="aimsg err"><b>${esc(m.text)}</b>${m.notes && m.notes.length ? `<ul class="small">${m.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <a href="#/settings" data-scroll="aiCard" class="small">Check AI channels</a></div>`;
  return `<div class="aimsg bot"><div class="md">${mdToHtml(m.text)}</div>
    <p class="aimeta">${icon('spark')} ${esc(m.channel)} · ${esc(m.model)}${m.notes && m.notes.length ? ` · <span title="${esc(m.notes.join('\n'))}">switched ${m.notes.length}×</span>` : ''}
      <button type="button" class="iconbtn sm" data-act="ai-copy" data-i="${m.i}" aria-label="Copy answer">${icon('copy')}</button></p>
    ${m.notes && m.notes.length ? `<p class="small muted aiswitch">${m.notes.map(esc).join(' · ')}</p>` : ''}</div>`;
}

function aiContext() {
  const A = ui.ai;
  let pool = items;
  if (A.focus && byId[A.focus]) {
    const f = A.focus;
    pool = items.filter(x => x.id === f || KINDS[x.kind].fields.some(fl => fl.type === 'ref' && x[fl.key] === f));
  }
  const kinds = A.focus ? [...new Set(pool.map(x => x.kind))] : aiKinds().chosen;
  const src = A.priv ? pool : pool.map(x => ({ ...x, noShare: false }));
  const recs = snapshot(src, { kinds, hideNotes: A.priv }).map(({ id, updatedAt, ...r }) => r);
  let json = JSON.stringify(recs);
  let cut = '';
  if (json.length > 60000) { json = json.slice(0, 60000); cut = '\n(The record list was cut short because it is long; say so if the answer may depend on missing records.)'; }
  let fileTxt = '';
  if (A.file) {
    if (A.file.table) {
      fileTxt = describeText(A.file.name, A.file.desc);
      if (!A.priv) fileTxt += `\nFirst ${Math.min(40, A.file.table.rows.length)} rows:\n` + [A.file.table.header, ...A.file.table.rows.slice(0, 40)].map(r => r.join('\t')).join('\n');
    } else fileTxt = A.priv ? `A text file "${A.file.name}" is attached, but Private mode is on, so its content is not shared.` : `Text file "${A.file.name}":\n${A.file.text.slice(0, 20000)}`;
  }
  return `You are the AI assistant inside the private Research Log of ${user.name || 'a researcher'}, a biologist working on virology/vaccines at the bench and on immunopeptidomics and protein machine learning on the computer. Today is ${today()}.
Answer from the records and data below when the question is about them, and say plainly when something is not in them. Never invent numbers, dates, citations, DOIs or names. Statistics for data files were computed exactly by the app — rely on them. Be concise; use short Markdown lists or tables when they help.
${A.priv ? 'Private mode: personal notes, emails and raw data rows were left out on purpose.' : ''}
RECORDS (${recs.length}, JSON):
${json}${cut}
${fileTxt ? '\nDATA:\n' + fileTxt : ''}`;
}
let aiAbort = null;
async function aiSend(q) {
  const A = ui.ai;
  if (!q.trim() || A.busy) return;
  A.msgs.push({ role: 'user', text: q.trim() });
  A.draft = ''; A.busy = true; A.trying = 'Thinking…';
  render(); aiScroll();
  const history = A.msgs.filter(m => m.role === 'user' || m.role === 'bot').slice(-11, -1).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }));
  aiAbort = new AbortController();
  try {
    const r = await askChain(aiCfg.channels, [{ role: 'system', content: aiContext() }, ...history, { role: 'user', content: q.trim() }], {
      signal: aiAbort.signal,
      onTry: (ch, notes) => { A.trying = `${notes.length ? 'Switching to' : 'Asking'} ${chName(ch)}…`; const el = app.querySelector('#aitry'); if (el) el.textContent = A.trying; },
    });
    A.msgs.push({ role: 'bot', text: r.text, model: r.model, channel: chName(r.channel), notes: r.notes, i: A.msgs.length });
  } catch (e) {
    if (e.name === 'AbortError') A.msgs.push({ role: 'error', text: 'Stopped.' });
    else A.msgs.push({ role: 'error', text: e.message, notes: e.notes });
  } finally {
    A.busy = false; aiAbort = null;
    if (route().view === 'ai') { render(); aiScroll(); }
    else toast('Ask AI: answer ready');
  }
}
function aiScroll() { const el = app.querySelector('#aichat'); if (el) el.lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
async function aiAttach(f) {
  if (f.size > 5 * 1048576) return toast('That file is over 5 MB. Save a smaller CSV (or a part of it).', true);
  const text = await f.text();
  const table = /\.(csv|tsv|txt)$/i.test(f.name) || /csv|tab-separated/.test(f.type) ? parseDelimited(text) : null;
  const good = table && table.header.length > 1;
  ui.ai.file = good ? { name: f.name, table, desc: describe(table), size: f.size } : { name: f.name, text, size: f.size };
  if (good) ui.ai.msgs.push({ role: 'data', name: f.name, desc: ui.ai.file.desc });
  render(); aiScroll();
  toast(good ? 'Data summarised — now ask a question about it' : 'File attached');
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
  const fhits = files.filter(f => byId[f.app] && (f.name + ' ' + (f.folder || '')).toLowerCase().includes(q));
  const fileGroup = fhits.length ? `<h3 class="grouph">Files <span>${fhits.length}</span></h3><ul class="rows big files">${fhits.slice(0, 50).map(f => `<li class="row file" style="--c:var(--phd)">
    <span class="fic k-${fileKind(f)}">${fileIcon(f)}</span>
    <a class="rowmain" href="${wsHref(f.app, f.folder || '')}"><span class="t">${esc(f.name)}</span>
    <span class="s">${esc([byId[f.app].title, (f.folder || '').replace(/\//g, ' / ')].filter(Boolean).join(' · '))}</span></a></li>`).join('')}</ul>` : '';
  if (!hits.length && !fhits.length) return `<p class="muted pad">No results for “${esc(ui.q)}”.</p>`;
  const groups = {};
  hits.forEach(x => (groups[x.kind] ||= []).push(x));
  return Object.entries(groups).map(([k, list]) =>
    `<h3 class="grouph">${KINDS[k].plural} <span>${list.length}</span></h3><ul class="rows big">${list.sort(KINDS[k].sort).map(rowHTML).join('')}</ul>`).join('') + fileGroup;
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
  <section class="card" id="aiCard">${aiCardInner()}</section>
  ${sharingHTML()}
  <section class="card" id="claudeAuto">
    <h3>Let Claude add data for you</h3>
    <p class="muted">Give Claude your code once; it can then add or update your records directly. Updates reach your app encrypted, and only your signed-in app can unlock them.</p>
    <div id="claudeUpd"><p class="small muted">Loading…</p></div>
  </section>
  <section class="card" id="claude">
    <h3>Add data with Claude</h3>
    <p class="muted">Works from any Claude chat or account, and you approve every change.</p>
    <ol class="steps-plain">
      <li>Tap <b>Copy instructions</b>, paste them into a Claude chat, and add your information underneath (a list, notes, an email, a photo of a page).</li>
      <li>Copy Claude's reply and paste it below.</li>
      <li>Tap <b>Add to my log</b>. You see what will be added or changed before anything is saved.</li>
    </ol>
    <div class="btnrow"><button class="btn" data-act="copyprompt">${icon('copy')} Copy instructions</button></div>
    <textarea id="pasteData" class="setup" rows="5" spellcheck="false" placeholder='Paste Claude&#39;s reply here — it starts with {"items": …'></textarea>
    <div class="btnrow"><button class="btn primary" data-act="pasteimport">${icon('spark')} Add to my log</button></div>
  </section>
  <section class="card">
    <h3>Backup</h3>
    <p class="muted">An extra copy you control: export everything as a file you can keep in Google Drive.</p>
    <div class="btnrow">
      <button class="btn" data-act="export">${icon('download')} Export data (.json)</button>
      <label class="btn">${icon('upload')} Import data<input type="file" accept="application/json,.json" data-act="import" hidden></label>
      <button class="btn" data-act="seed">Import CV &amp; projects</button>
      ${files.length ? `<button class="btn" data-act="zipall">${icon('download')} Download all folders (.zip)</button>` : ''}
    </div>
    ${files.length ? `<p class="small muted">Files (PhD applications and articles): ${files.length} · ${fmtSize(files.reduce((n, f) => n + (f.size || 0), 0))} of about 1 GB included free in your Firebase plan.</p>` : ''}
    <p class="small muted">Exports include all records but not photos or files (download those as .zip). The file contains your private notes — keep it somewhere only you can access.</p>
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
    if (r.ws && r.kind === 'professor') item.application = r.ws;
  } else {
    const src = byId[r.edit] || (pendingOpen && pendingOpen.id === r.edit ? pendingOpen : null);
    if (!src) { if (items.length) go(listHref(r)); return; }
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
  if (!fromRoute) go(listHref(route()));
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
    case 'checklist': return `<div class="fld">${lab}<div class="checks">${f.options.map((o, i) => `<label class="checkopt"><input type="checkbox" name="${f.key}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}> ${esc(o)}</label>`).join('')}</div></div>`;
    case 'tags': return `<div class="fld">${lab}<input id="${id}" name="${f.key}" type="text" value="${esc((v || []).join(', '))}" placeholder="comma, separated, tags"></div>`;
    case 'url': return `<div class="fld">${lab}<input id="${id}" name="${f.key}" type="text" inputmode="url" value="${esc(v || '')}" placeholder="${esc(f.placeholder || 'https://…')}"></div>`;
    case 'links': case 'refs': return '';   // edited inside the article's folder page
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
      <div class="fields">${K.fields.map(f => fieldHTML(f, item)).join('')}
        <div class="fld"><label class="toggle privtoggle"><input type="checkbox" name="noShare" ${item.noShare ? 'checked' : ''}> ${icon('lock')} Private — never show on read-only links or the website</label></div></div>
      ${isNew ? '' : `<div class="sheet-foot">
        ${['experiment', 'protocol'].includes(kind) ? `<button type="button" class="btn" data-act="duplicate">${icon('copy')} Duplicate</button>` : ''}
        ${K.calendar && K.calendar(item) ? `<a class="btn" target="_blank" rel="noopener" href="${esc(calLink(K.calendar(item)))}">${icon('cal')} Add to Google Calendar</a>` : ''}
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
  out.noShare = form.elements.noShare && form.elements.noShare.checked ? true : undefined;
  K.fields.forEach(f => {
    if (['photos', 'links', 'refs'].includes(f.type)) return;
    const el = form.elements[f.key];
    if (!el) return;
    if (f.type === 'checklist') { out[f.key] = [...app.querySelectorAll(`#edform input[name="${f.key}"]:checked`)].map(c => c.value); return; }
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
    case 'appgroup': ui.appGroup = t.dataset.g; render(); break;
    case 'ghadd': addRepoAsProject(t.dataset.repo); break;
    case 'ghpick': ghPick(t.dataset.mode); break;
    case 'ai-add': channelForm(null); break;
    case 'ai-edit': channelForm(t.dataset.id); break;
    case 'ai-del': { const c = aiCfg.channels.find(x => x.id === t.dataset.id); if (c && confirm(`Remove the AI channel “${chName(c)}”? Its key is deleted from your settings.`)) { aiCfg.channels = aiCfg.channels.filter(x => x !== c); await saveAi(); } break; }
    case 'ai-up': case 'ai-down': {
      const L = aiCfg.channels, i = L.findIndex(x => x.id === t.dataset.id), j = act === 'ai-up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < L.length) { [L[i], L[j]] = [L[j], L[i]]; await saveAi(); }
      break;
    }
    case 'ai-kind': { const { chosen } = aiKinds(); ui.ai.kinds = chosen.includes(t.dataset.k) ? chosen.filter(k => k !== t.dataset.k) : [...chosen, t.dataset.k]; render(); break; }
    case 'ai-private': ui.ai.priv = t.checked; if (!t.checked) toast('Private is off: notes and raw data rows will be sent to the AI provider', true); render(); break;
    case 'ai-unfocus': ui.ai.focus = null; render(); break;
    case 'ai-unfile': ui.ai.file = null; render(); break;
    case 'ai-stop': if (aiAbort) aiAbort.abort(); break;
    case 'ai-clear': e.preventDefault(); ui.ai.msgs = []; ui.ai.file = null; render(); break;
    case 'ai-copy': { const m = ui.ai.msgs[Number(t.dataset.i)]; if (m) copyText(m.text, 'Answer copied'); break; }
    case 'link-new': linkEditor(null); break;
    case 'link-edit': linkEditor(sharing.links.find(l => l.id === t.dataset.id)); break;
    case 'link-copy': copyLink(sharing.links.find(l => l.id === t.dataset.id)); break;
    case 'link-off': removeLink(t.dataset.id); break;
    case 'site-on': case 'site-kind': case 'site-inprog': siteSetting(t); break;
    case 'cancel':
      e.preventDefault();
      if (editor && editor.dirty && !confirm('Discard your changes?')) return;
      closeEditor();
      break;
    case 'delete': {
      const own = WS[editor.kind] ? files.filter(f => f.app === editor.item.id) : [];
      if (!confirm(`Delete this ${KINDS[editor.kind].label.toLowerCase()}${own.length ? ` and its ${own.length} file${own.length > 1 ? 's' : ''}` : ''}? This cannot be undone.`)) return;
      (editor.item.photos || []).forEach(id => store.removePhoto(id));
      own.forEach(f => store.deleteFile(f));
      store.remove(editor.item.id);
      if (WS[editor.kind] && r.ws) { const back = WS[editor.kind].list; editor = null; closeEditor(true); go(back); }
      else closeEditor();
      toast('Deleted');
      break;
    }
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
    case 'upd-create': case 'upd-replace': {
      if (act === 'upd-replace' && !confirm('Replace your code? Claude will no longer be able to add data until you give it the new code.')) return;
      const meta = (await store.getMeta('claude')) || {};
      await store.setMeta('claude', { ...meta, code: newUpdateCode(), created: Date.now() });
      ui.showCode = true; renderClaudeCard(); toast(act === 'upd-create' ? 'Code created — copy it to Claude' : 'New code created; the old one no longer works');
      break;
    }
    case 'upd-show': ui.showCode = !ui.showCode; renderClaudeCard(); break;
    case 'upd-copy': {
      const meta = await store.getMeta('claude');
      try { await navigator.clipboard.writeText(meta.code); toast('Code copied — paste it to Claude in your chat'); }
      catch (e) { ui.showCode = true; renderClaudeCard(); toast('Copy blocked; select the code and copy it by hand.', true); }
      break;
    }
    case 'upd-check': checkClaudeUpdates(true); break;
    case 'upd-undo': undoClaudeUpdate(); break;
    case 'copyprompt':
      try { await navigator.clipboard.writeText(CLAUDE_PROMPT); toast('Instructions copied — paste them into a Claude chat'); }
      catch (e) { toast('Copying was blocked by the browser.', true); }
      break;
    case 'pasteimport': {
      const txt = app.querySelector('#pasteData').value;
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      let json = null;
      try { json = JSON.parse(txt.slice(a, b + 1)); } catch (e) {}
      if (!json) return toast("That doesn't look like Claude's data reply. Copy the whole code block.", true);
      if (await runImport(json)) app.querySelector('#pasteData').value = '';
      break;
    }
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
    case 'zipall': zipAllApplications(); break;
  }
  // PhD application folders
  const a = r.ws && byId[r.ws];
  if (!a) return;
  const fid = t.dataset.id && files.find(f => f.id === t.dataset.id);
  switch (act) {
    case 'readme': editReadme(a); break;
    case 'newfolder': newFolder(a, t.dataset.parent || ''); break;
    case 'renamefolder': renameFolder(a, t.dataset.folder); break;
    case 'deletefolder': deleteFolder(a, t.dataset.folder); break;
    case 'zip': zipDownload(a, t.dataset.folder || ''); break;
    case 'newnote': newNote(a, t.dataset.folder || ''); break;
    case 'openfile': if (fid) openFile(fid); break;
    case 'dlfile': if (fid) downloadFile(fid); break;
    case 'fileinfo': if (fid) fileInfo(fid); break;
    case 'lk-add': linkForm(a); break;
    case 'lk-edit': linkForm(a, t.dataset.id); break;
    case 'lk-del': delLink(a, t.dataset.id); break;
    case 'lk-copy': copyText(linkHref((a.links || []).find(l => l.id === t.dataset.id)?.url) || (a.links || []).find(l => l.id === t.dataset.id)?.url, 'Link copied'); break;
    case 'lk-das': copyText(dataStatement([...(a.repo ? [{ type: 'github', label: 'GitHub', url: a.repo }] : []), ...(a.links || [])].filter((l, i, all) => all.findIndex(x => x.url === l.url) === i)), 'Data availability statement copied'); break;
    case 'rf-doi': refsByDoi(a); break;
    case 'rf-paste': refsPaste(a); break;
    case 'rf-edit': refForm(a, t.dataset.id); break;
    case 'rf-del': delRef(a, t.dataset.id); break;
    case 'rf-copy': copyText((a.refs || []).map((r, i) => `${i + 1}. ${formatRef(r)}`).join('\n'), `${(a.refs || []).length} references copied`); break;
    case 'rf-bib': saveBlob(new Blob([toBib(a.refs || [])], { type: 'application/x-bibtex' }), `${zipRoot(a)}_references.bib`); break;
    case 'rf-ris': saveBlob(new Blob([toRis(a.refs || [])], { type: 'application/x-research-info-systems' }), `${zipRoot(a)}_references.ris`); break;
    case 'rf-fill': fillRefs(a); break;
    case 'rf-sort': saveRefs(a, [...(a.refs || [])].sort((x, y) => formatRef(x).localeCompare(formatRef(y))), 'Sorted A–Z'); break;
  }
});

app.addEventListener('click', e => {
  const a = e.target.closest('a[data-scroll]'); if (a) ui.scrollTo = a.dataset.scroll;
  const g = e.target.closest('a[data-group]'); if (g) ui.appGroup = g.dataset.group;
  const f = e.target.closest('a[data-aifocus]'); if (f) ui.ai.focus = f.dataset.aifocus;
}, true);

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
  } else if (t.dataset.act === 'ai-file') {
    const f = t.files[0]; t.value = '';
    if (f) aiAttach(f);
  } else if (t.dataset.act === 'rf-import') {
    const f = t.files[0]; t.value = '';
    const a = byId[route().ws];
    if (f && a) importRefFile(a, f);
  } else if (['upfiles', 'upappfolder', 'upsubfolder', 'importfolder'].includes(t.dataset.act)) {
    const list = [...t.files], act = t.dataset.act, folder = t.dataset.folder || '';
    t.value = '';
    if (!list.length) return;
    const r = route(), a = r.ws && byId[r.ws];
    if (act === 'importfolder') return importAppFolder(list, null, null, t.dataset.kind || 'application');
    if (!a) return;
    if (act === 'upappfolder') return importAppFolder(list, a);
    if (act === 'upsubfolder') return importAppFolder(list, { app: a, folder }, 'sub');
    queueUpload(a.id, list.map(f => ({ file: f, folder, name: cleanName(f.name) })));
  } else if (editor && t.closest('#edform')) editor.dirty = true;
});

app.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'aiq') {
    ui.ai.draft = t.value;
    t.style.height = 'auto'; t.style.height = Math.min(200, t.scrollHeight) + 'px';
    return;
  }
  if (t.id === 'rfq') {
    const q = t.value.trim().toLowerCase();
    app.querySelectorAll('#refscard .refs li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
    return;
  }
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

app.addEventListener('submit', e => {
  if (e.target.id === 'edform') { e.preventDefault(); saveEditor(); }
  if (e.target.id === 'aiform') { e.preventDefault(); aiSend(app.querySelector('#aiq').value); }
});
app.addEventListener('keydown', e => {
  if (e.target.id === 'aiq' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && !('ontouchstart' in window)) { e.preventDefault(); aiSend(e.target.value); }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.viewer')) return document.querySelector('.viewer').remove();
  const ov = document.querySelector('.ovl');
  if (e.key === 'Escape' && ov) { if (!ov._dirty || confirm('Discard your changes?')) ov._close(); return; }
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

// Merge records into the log. Existing records (same ID, or same type and title) only get empty
// fields filled in; a record marked _update overwrites the fields it carries; _delete removes it.
// Nothing is saved until you confirm.
function mergePlan(list) {
  const norm = t => String(t || '').trim().toLowerCase();
  const byKey = new Map(items.map(x => [x.kind + '|' + norm(x.title), x]));
  const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const idMap = {}, out = [], del = [];
  let added = 0, completed = 0, updated = 0;
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || !KINDS[raw.kind] || !raw.title) continue;
    const { photos, _update, _delete, ...x } = raw;
    const allowed = new Set(['id', 'kind', 'title', 'createdAt', ...KINDS[x.kind].fields.map(f => f.key)]);
    Object.keys(x).forEach(k => { if (!allowed.has(k)) delete x[k]; });
    const existing = (x.id && byId[x.id]) || byKey.get(x.kind + '|' + norm(x.title));
    if (_delete) { if (existing) del.push(existing); continue; }
    if (existing) {
      idMap[x.id] = existing.id;
      const merged = { ...existing };
      let changed = false;
      for (const [k, v] of Object.entries(x)) {
        if (k === 'id' || isEmpty(v)) continue;
        if (_update ? JSON.stringify(merged[k]) !== JSON.stringify(v) : isEmpty(merged[k])) { merged[k] = v; changed = true; }
      }
      if (changed) { out.push(merged); _update ? updated++ : completed++; }
    } else {
      const id = x.id || newId();
      idMap[x.id] = id;
      const rec = { ...x, id, createdAt: x.createdAt || Date.now() };
      KINDS[x.kind].fields.forEach(f => { if (rec[f.key] === undefined && f.default) rec[f.key] = f.default(); });
      if (KINDS[x.kind].fields.some(f => f.type === 'photos')) rec.photos = [];
      out.push(rec); added++;
    }
  }
  // Links between records may be given as an id or as the exact title (e.g. a professor's application).
  for (const it of out) for (const f of KINDS[it.kind].fields) {
    const v = it[f.key];
    if (f.type !== 'ref' || !v) continue;
    if (idMap[v]) it[f.key] = idMap[v];
    else if (!byId[v]) {
      const hit = byKey.get(f.ref + '|' + norm(v)) || out.find(o => o.kind === f.ref && norm(o.title) === norm(v));
      if (hit) it[f.key] = hit.id;
    }
  }
  return { out, del, added, completed, updated };
}

async function runImport(json) {
  const plan = mergePlan(json.items || json);
  if (!plan.out.length && !plan.del.length) { toast('Nothing new — everything is already in your log.'); return false; }
  const kinds = {};
  plan.out.forEach(x => { kinds[KINDS[x.kind].plural] = (kinds[KINDS[x.kind].plural] || 0) + 1; });
  const what = Object.entries(kinds).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ');
  const msg = `Add ${plan.added} new record${plan.added === 1 ? '' : 's'}, fill in ${plan.completed}, update ${plan.updated}` +
    (plan.del.length ? `, DELETE ${plan.del.length}` : '') + `?\n\n${what}`;
  if (!confirm(msg)) return false;
  if (plan.out.length) await store.bulkSave(plan.out);
  for (const d of plan.del) { (d.photos || []).forEach(id => store.removePhoto(id)); store.remove(d.id); }
  toast(`Done: ${plan.added} added, ${plan.completed + plan.updated} updated${plan.del.length ? `, ${plan.del.length} removed` : ''}`);
  return true;
}

async function importData(file) {
  try { await runImport(JSON.parse(await file.text())); }
  catch (err) { toast('That file could not be read as a Research Log export.', true); }
}

/* ---------------- Updates from Claude (owner-authorised) ----------------
   The owner creates a private code in Settings and gives it to Claude. Claude places updates on
   this website encrypted with that code (AES-256-GCM, key via PBKDF2-SHA256); only an app signed
   in to the owner's account holds the code, so only it can unlock them. Updates can add records
   or change fields — never delete — and the last update can be undone. Replacing the code revokes. */
const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function unlockUpdate(code, f) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(f.salt), iterations: f.iter || 200000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(f.iv) }, key, b64d(f.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
function newUpdateCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(r, b => A[b % 32]).join('').match(/.{6}/g).join('-');
}
let updBusy = false, updChecked = false;
async function checkClaudeUpdates(manual) {
  if (updBusy || !user || (updChecked && !manual)) return;
  updBusy = true;
  try {
    const meta = await store.getMeta('claude');
    if (!meta || !meta.code) { if (manual) toast('Create a code first.', true); return; }
    const res = await fetch('updates/index.json', { cache: 'no-store' });
    if (!res.ok) { if (manual) toast('No updates from Claude yet.'); return; }
    const done = [...(meta.done || [])];
    const pending = ((await res.json()).files || []).filter(id => !done.includes(id));
    const undo = { added: [], previous: [], at: Date.now() };
    let added = 0, changed = 0, failed = 0;
    for (const id of pending) {
      try {
        const f = await (await fetch(`updates/${encodeURIComponent(id)}.json`, { cache: 'no-store' })).json();
        const payload = await unlockUpdate(meta.code, f);
        const plan = mergePlan((payload.items || []).map(({ _delete, ...x }) => x));   // never delete
        plan.out.forEach(r => { if (byId[r.id]) undo.previous.push(byId[r.id]); else undo.added.push(r.id); });
        if (plan.out.length) await store.bulkSave(plan.out);
        added += plan.added; changed += plan.completed + plan.updated;
        done.push(id);
      } catch (e) { failed++; }
    }
    updChecked = true;
    if (done.length !== (meta.done || []).length) {
      const log = [...(meta.log || []), { at: Date.now(), added, changed }].slice(-20);
      await store.setMeta('claude', { ...meta, done, log, undo: (added || changed) ? undo : meta.undo || null });
    }
    if (added || changed) toast(`Claude's update added ${added} and updated ${changed} records`);
    else if (failed) toast(`An update from Claude could not be unlocked with your current code.`, true);
    else if (manual) toast('You are up to date.');
    if (route().view === 'settings') renderClaudeCard();
  } catch (e) { if (manual) toast('Could not check for updates right now.', true); }
  finally { updBusy = false; }
}
async function undoClaudeUpdate() {
  const meta = await store.getMeta('claude');
  const u = meta && meta.undo;
  if (!u) return toast('Nothing to undo.');
  if (!confirm(`Undo Claude's last update? This removes ${u.added.length} added record(s) and restores ${u.previous.length} changed one(s).`)) return;
  u.added.forEach(id => { if (byId[id]) store.remove(id); });
  if (u.previous.length) await store.bulkSave(u.previous);
  await store.setMeta('claude', { ...meta, undo: null });
  toast('Claude\'s last update was undone'); renderClaudeCard();
}
async function renderClaudeCard() {
  const box = app.querySelector('#claudeUpd');
  if (!box) return;
  const meta = await store.getMeta('claude').catch(() => null);
  if (!meta || !meta.code) {
    box.innerHTML = `<div class="btnrow"><button class="btn primary" data-act="upd-create">Create code for Claude</button></div>`;
    return;
  }
  const last = (meta.log || []).slice(-1)[0];
  box.innerHTML = `${ui.showCode ? `<div class="codebox">${esc(meta.code)}</div>` : ''}
    <div class="btnrow">
      <button class="btn primary" data-act="upd-copy">${icon('copy')} Copy code</button>
      <button class="btn" data-act="upd-show">${ui.showCode ? 'Hide code' : 'Show code'}</button>
      <button class="btn" data-act="upd-check">Check now</button>
      ${meta.undo ? `<button class="btn" data-act="upd-undo">Undo last update</button>` : ''}
      <button class="btn danger" data-act="upd-replace">Replace code</button>
    </div>
    <p class="small muted">${last ? `Last update ${new Date(last.at).toLocaleString()}: ${last.added} added, ${last.changed} updated.` : 'No updates received yet.'}
      Claude can add and update records but never delete. <b>Replace code</b> stops Claude immediately.</p>`;
}

function calLink({ date, title, details }) {
  const d1 = date.replace(/-/g, '');
  const n = new Date(date + 'T00:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
  const d2 = n.toISOString().slice(0, 10).replace(/-/g, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${d1}/${d2}&details=${encodeURIComponent(details || '')}`;
}

const CLAUDE_PROMPT = `Please turn my information below into data for my Research Log app.
Reply with ONE JSON code block only, shaped like {"items": [ ... ]}. Use only facts I give you — leave out anything unknown; never invent dates, names or numbers.
Each item needs "kind" and "title", plus any of these fields (dates as YYYY-MM-DD):
- application: university, country, status (Researching | Contacted supervisor | Preparing | Submitted | Interview | Offer | Accepted | Rejected | Declined), deadline, supervisor, supervisorEmail, funding, portal, documents (list from: CV, Statement of purpose, Research proposal, References, Transcripts, Language test, Publications, Portfolio / writing sample — only the ones already ready), notes
- professor: application (exact title of the application, if known), status (Not contacted | Emailed | Follow-up sent | Replied | Meeting / interview | Positive | No position | No reply), institute, email, website, contacted (date first emailed), followUp (date), research, fit, notes
- article (my own research article / manuscript): status (Idea | Drafting | Internal review | Submitted | Under review | Revision | Accepted | Published | Rejected), journal (target journal), progress (0-100), target (target submission date), submitted, authors, repo (GitHub URL), doi, notes
- task: due, priority (Low | Medium | High), notes, done (true/false)
- project: status (Idea | Active | On hold | Done), area (Wet lab | Computational | Both), progress (0-100), start, target, description
- experiment: date, status (Planned | In progress | Completed | Failed | Repeated), objective, materials, procedure, results, conclusion
- protocol: category, version, purpose, materials, steps, notes
- inventory: type, quantity, location, lot, received, expiry, status (In stock | Low | Used up | Expired), notes
- paper: authors, year, journal, doi, status (To read | Reading | Read), notes
- publication: authors, venue, year, type, status (Idea | Drafting | Submitted | Under review | Revision | Accepted | Published), doi
- talk: type (Oral | Poster | Invited talk | Seminar | Workshop), event, location, date, coauthors
- award: issuer, year
All of the above may also have "tags": ["..."].
To change something already in my log, repeat its exact kind and title and add "_update": true with only the fields that change.

My information:
`;

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
