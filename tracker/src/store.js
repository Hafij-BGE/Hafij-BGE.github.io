// Two interchangeable stores with the same interface:
//   CloudStore — Firebase Auth (Google) + Firestore, live sync, offline cache
//   LocalStore — this browser only; used until a Firebase config is provided
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot, writeBatch,
  terminate, clearIndexedDbPersistence, Bytes,
} from 'firebase/firestore';

// Files (PDFs, Word files, images…) are kept in the owner's own Firestore database, split into
// pieces small enough for one database record each (the free plan has no file storage).
// users/{uid}/files/{id}            — name, folder, size, type, application
// users/{uid}/files/{id}/chunks/{n} — the file's bytes, in order
export const CHUNK = 900 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;
const chunkId = i => String(i).padStart(4, '0');

// Remove everything this app stored in the browser (demo data, photos).
// keepSetup = true keeps this device's sync setup (used after moving demo data into the account).
export function wipeLocal(keepSetup) {
  try {
    Object.keys(localStorage)
      .filter(k => k.startsWith('rl.') && !(keepSetup && k === 'rl.setup'))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// The Firebase setup is pasted by the owner on each device and kept only in that device's browser.
// It is never part of the published website.
const SETUP_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
export function parseSetup(text) {
  const out = {};
  const re = /["']?(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId)["']?\s*:\s*["']([^"']+)["']/g;
  let m; while ((m = re.exec(String(text || '')))) out[m[1]] = m[2].trim();
  const ok = /^AIza[0-9A-Za-z_-]{30,}$/.test(out.apiKey || '')
    && /^[a-z0-9-]{4,}$/.test(out.projectId || '')
    && /^1:\d+:web:[0-9a-f]+$/.test(out.appId || '')
    && /\.(firebaseapp\.com|web\.app)$/.test(out.authDomain || '');
  return ok ? Object.fromEntries(SETUP_KEYS.filter(k => out[k]).map(k => [k, out[k]])) : null;
}
export function loadSetup() {
  try { return parseSetup(localStorage.getItem('rl.setup') || ''); } catch (e) { return null; }
}
export function saveSetup(cfg) {
  try { localStorage.setItem('rl.setup', JSON.stringify(cfg)); return true; } catch (e) { return false; }
}

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const clean = obj => JSON.parse(JSON.stringify(obj)); // drops undefined

class Emitter {
  constructor() { this.l = {}; }
  on(ev, fn) { (this.l[ev] ||= []).push(fn); }
  emit(ev, data) { (this.l[ev] || []).forEach(fn => fn(data)); }
}

/* ------------------------------------------------------------------ */
export class CloudStore extends Emitter {
  constructor(config) {
    super();
    this.mode = 'cloud';
    this.app = initializeApp(config);
    this.auth = getAuth(this.app);
    this.db = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
    this.user = null;
    this.unsub = null;
    getRedirectResult(this.auth).catch(e => this.emit('error', friendly(e)));
    onAuthStateChanged(this.auth, u => {
      if (this.unsub) { this.unsub(); this.unsub = null; }
      if (this.unsubFiles) { this.unsubFiles(); this.unsubFiles = null; }
      this.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
      this.emit('auth', this.user);
      if (u) this.subscribe();
    });
    addEventListener('online', () => this.emit('status', this.lastStatus()));
    addEventListener('offline', () => this.emit('status', 'offline'));
  }
  col(name) { return collection(this.db, 'users', this.user.uid, name); }
  subscribe() {
    this.unsubFiles = onSnapshot(this.col('files'), snap => {
      this.emit('files', snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, e => { if (!(e && e.code === 'permission-denied')) this.emit('error', friendly(e)); });
    this.unsub = onSnapshot(this.col('items'), { includeMetadataChanges: true }, snap => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.pending = snap.metadata.hasPendingWrites;
      this.fromCache = snap.metadata.fromCache;
      this.emit('items', items);
      this.emit('status', this.lastStatus());
    }, e => {
      if (e && e.code === 'permission-denied') this.emit('denied');
      else this.emit('error', friendly(e));
    });
  }
  lastStatus() {
    if (!navigator.onLine) return 'offline';
    if (this.pending) return 'saving';
    return this.fromCache ? 'connecting' : 'synced';
  }
  async signIn() {
    const p = new GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    try { await signInWithPopup(this.auth, p); }
    catch (e) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
        await signInWithRedirect(this.auth, p);
      } else if (e.code !== 'auth/popup-closed-by-user') throw new Error(friendly(e));
    }
  }
  // Signing out also erases this device's offline copy, so nothing is left behind on a shared computer.
  async signOut() {
    if (this.unsub) { this.unsub(); this.unsub = null; }
    if (this.unsubFiles) { this.unsubFiles(); this.unsubFiles = null; }
    try { await signOut(this.auth); } catch (e) {}
    try { await terminate(this.db); await clearIndexedDbPersistence(this.db); } catch (e) {}
    wipeLocal();
    location.replace(location.pathname);
  }
  // Writes return immediately; Firestore applies them locally and syncs in the background.
  save(item) {
    const id = item.id || newId();
    const { id: _, ...data } = item;
    setDoc(doc(this.col('items'), id), clean({ ...data, updatedAt: Date.now() }))
      .catch(e => this.emit('error', friendly(e)));
    return id;
  }
  remove(id) { deleteDoc(doc(this.col('items'), id)).catch(e => this.emit('error', friendly(e))); }
  savePhoto(data, itemId) {
    const id = newId();
    setDoc(doc(this.col('photos'), id), { data, itemId, createdAt: Date.now() })
      .catch(e => this.emit('error', friendly(e)));
    return id;
  }
  async getPhoto(id) {
    const s = await getDoc(doc(this.col('photos'), id));
    return s.exists() ? s.data().data : null;
  }
  removePhoto(id) { deleteDoc(doc(this.col('photos'), id)).catch(() => {}); }
  // Small private settings documents in the owner's account (e.g. the Claude updates code).
  async getMeta(name) {
    const snap = await getDoc(doc(this.db, 'users', this.user.uid, 'meta', name));
    return snap.exists() ? snap.data() : null;
  }
  setMeta(name, data) { return setDoc(doc(this.db, 'users', this.user.uid, 'meta', name), clean(data)); }
  /* ---- notepad ink: compressed, split into pieces if very large ---- */
  inkRef(id, part) { return part == null ? doc(this.db, 'users', this.user.uid, 'inks', id) : doc(this.db, 'users', this.user.uid, 'inks', id, 'parts', chunkId(part)); }
  async getInk(id) {
    const snap = await getDoc(this.inkRef(id));
    if (!snap.exists()) return null;
    const m = snap.data();
    if (!m.parts) return m.data ? m.data.toUint8Array() : null;
    const ps = await getDocs(collection(this.db, 'users', this.user.uid, 'inks', id, 'parts'));
    const parts = ps.docs.map(d => d.data()).filter(c => c.i < m.parts).sort((a, b) => a.i - b.i);
    if (parts.length !== m.parts) throw new Error('This note is still syncing from another device. Try again in a moment.');
    const out = new Uint8Array(parts.reduce((n, c) => n + c.data.toUint8Array().length, 0));
    let o = 0; parts.forEach(c => { const u = c.data.toUint8Array(); out.set(u, o); o += u.length; });
    return out;
  }
  async setInk(id, u8, oldParts = 0) {
    if (u8.length <= CHUNK) {
      await setDoc(this.inkRef(id), { data: Bytes.fromUint8Array(u8), parts: 0, size: u8.length, updatedAt: Date.now() });
      for (let i = 0; i < oldParts; i++) deleteDoc(this.inkRef(id, i)).catch(() => {});
      return 0;
    }
    const n = Math.ceil(u8.length / CHUNK);
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push(setDoc(this.inkRef(id, i), { i, data: Bytes.fromUint8Array(u8.subarray(i * CHUNK, (i + 1) * CHUNK)) }));
    jobs.push(setDoc(this.inkRef(id), { parts: n, size: u8.length, updatedAt: Date.now() }));
    for (let i = n; i < oldParts; i++) jobs.push(deleteDoc(this.inkRef(id, i)));
    await Promise.all(jobs);
    return n;
  }
  async deleteInk(id, parts = 0) {
    const jobs = [deleteDoc(this.inkRef(id))];
    for (let i = 0; i < parts; i++) jobs.push(deleteDoc(this.inkRef(id, i)));
    return Promise.all(jobs).catch(() => {});
  }

  /* ---- read-only links and the public website feed (outside the private area) ---- */
  setShare(id, data) { return setDoc(doc(this.db, 'shares', id), { ...data, owner: this.user.uid, updatedAt: Date.now() }); }
  deleteShare(id) { return deleteDoc(doc(this.db, 'shares', id)); }
  setSite(data) { return setDoc(doc(this.db, 'public', 'site'), { ...data, updatedAt: Date.now() }); }

  /* ---- files ---- */
  chunkRef(id, i) { return doc(this.db, 'users', this.user.uid, 'files', id, 'chunks', chunkId(i)); }
  // Writes the pieces first and the file's entry last, so other devices only list it once it is whole.
  // Returns at once with the new id; `done` settles when the upload has reached the server
  // (while offline it waits, and the upload continues by itself when the connection is back).
  async putFile(blob, meta, onProgress, id = newId(), oldChunks = 0) {
    if (blob.size > MAX_FILE) throw new Error(`“${meta.name}” is larger than ${MAX_FILE / 1048576} MB.`);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const n = Math.ceil(bytes.length / CHUNK);
    let sent = 0;
    const tick = p => p.then(() => { sent++; onProgress && onProgress(sent, n + 1); });
    const jobs = [];
    for (let i = 0; i < n; i++) {
      jobs.push(tick(setDoc(this.chunkRef(id, i), { i, data: Bytes.fromUint8Array(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) })));
    }
    for (let i = n; i < oldChunks; i++) jobs.push(deleteDoc(this.chunkRef(id, i)));
    const rec = clean({ ...meta, size: bytes.length, chunks: n, type: meta.type || blob.type || '', updatedAt: Date.now(), createdAt: meta.createdAt || Date.now() });
    jobs.push(tick(setDoc(doc(this.col('files'), id), rec)));
    const done = Promise.all(jobs).catch(e => { this.emit('error', friendly(e)); throw e; });
    return { id, done };
  }
  async replaceFile(f, blob, onProgress) {
    const { id, ...meta } = f;
    return this.putFile(blob, meta, onProgress, id, f.chunks || 0);
  }
  async readFile(f) {
    const snap = await getDocs(collection(this.db, 'users', this.user.uid, 'files', f.id, 'chunks'));
    const parts = snap.docs.map(d => d.data()).filter(c => c.i < f.chunks).sort((a, b) => a.i - b.i);
    const notYet = () => new Error(navigator.onLine ? 'This file is still uploading from another device. Try again in a minute.'
      : 'This file is not saved on this device yet. Open it once while online to keep it for offline use.');
    if (parts.length !== f.chunks) throw notYet();
    const blob = new Blob(parts.map(c => c.data.toUint8Array()), { type: f.type || 'application/octet-stream' });
    if (blob.size !== f.size) throw notYet();
    return blob;
  }
  updateFile(id, patch) {
    return setDoc(doc(this.col('files'), id), clean({ ...patch, updatedAt: Date.now() }), { merge: true })
      .catch(e => this.emit('error', friendly(e)));
  }
  deleteFile(f) {
    const jobs = [deleteDoc(doc(this.col('files'), f.id))];
    for (let i = 0; i < (f.chunks || 0); i++) jobs.push(deleteDoc(this.chunkRef(f.id, i)));
    return Promise.all(jobs).catch(e => this.emit('error', friendly(e)));
  }
  async bulkSave(items) {
    for (let i = 0; i < items.length; i += 400) {
      const b = writeBatch(this.db);
      items.slice(i, i + 400).forEach(it => {
        const { id, ...data } = it;
        b.set(doc(this.col('items'), id || newId()), clean({ ...data, updatedAt: Date.now() }));
      });
      b.commit().catch(e => this.emit('error', friendly(e)));
    }
  }
}

/* ------------------------------------------------------------------ */
export class LocalStore extends Emitter {
  constructor() {
    super();
    this.mode = 'local';
    // Keep several tabs on this device in step (cloud mode does this through Firestore).
    addEventListener('storage', e => {
      if (e.key !== 'rl.items') return;
      try { this.items = JSON.parse(e.newValue || '{}'); } catch (err) { return; }
      this.emit('items', Object.entries(this.items).map(([id, v]) => ({ id, ...v })));
    });
    this.user = { uid: 'local', name: '', email: 'Stored in this browser only' };
    this.items = {};
    try { this.items = JSON.parse(localStorage.getItem('rl.items') || '{}'); } catch (e) {}
    queueMicrotask(() => { this.emit('auth', this.user); this.emit('files', []); this.flush(); });
  }
  flush() {
    try { localStorage.setItem('rl.items', JSON.stringify(this.items)); }
    catch (e) { this.emit('error', 'This browser is out of local storage space. Set up sync to keep more data.'); }
    this.emit('items', Object.entries(this.items).map(([id, v]) => ({ id, ...v })));
    this.emit('status', 'local');
  }
  signIn() {} signOut() {}
  save(item) {
    const id = item.id || newId();
    const { id: _, ...data } = item;
    this.items[id] = clean({ ...data, updatedAt: Date.now() });
    this.flush();
    return id;
  }
  remove(id) { delete this.items[id]; this.flush(); }
  savePhoto(data) {
    const id = newId();
    try { localStorage.setItem('rl.photo.' + id, data); }
    catch (e) { this.emit('error', 'Photo too large for local-only mode. Set up sync to store photos.'); return null; }
    return id;
  }
  async getPhoto(id) { try { return localStorage.getItem('rl.photo.' + id); } catch (e) { return null; } }
  removePhoto(id) { try { localStorage.removeItem('rl.photo.' + id); } catch (e) {} }
  async getMeta(name) { try { return JSON.parse(localStorage.getItem('rl.meta.' + name) || 'null'); } catch (e) { return null; } }
  async setMeta(name, data) { try { localStorage.setItem('rl.meta.' + name, JSON.stringify(data)); } catch (e) {} }
  async setShare() { throw new Error('Sign in with Google to share.'); }
  async deleteShare() {} async setSite() { throw new Error('Sign in with Google to update the website.'); }
  async getInk(id) { try { const v = localStorage.getItem('rl.ink.' + id); return v ? Uint8Array.from(atob(v), c => c.charCodeAt(0)) : null; } catch (e) { return null; } }
  async setInk(id, u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); try { localStorage.setItem('rl.ink.' + id, btoa(s)); } catch (e) { throw new Error('This browser is out of space for notes. Sign in with Google to keep more.'); } return 0; }
  async deleteInk(id) { try { localStorage.removeItem('rl.ink.' + id); } catch (e) {} }
  // Files need Google sync; this browser alone has too little room for them.
  async putFile() { throw new Error('Sign in with Google to store files.'); }
  async replaceFile() { throw new Error('Sign in with Google to store files.'); }
  async readFile() { throw new Error('Sign in with Google to open files.'); }
  updateFile() {} deleteFile() {}
  async bulkSave(items) {
    items.forEach(it => { const { id, ...d } = it; this.items[id || newId()] = clean({ ...d, updatedAt: Date.now() }); });
    this.flush();
  }
}

function friendly(e) {
  const code = e && e.code || '';
  if (code.includes('unauthorized-domain')) return 'This website is not yet authorised in Firebase (Authentication → Settings → Authorized domains).';
  if (code.includes('permission-denied')) return 'Firebase refused access — check the Firestore rules.';
  if (code.includes('network-request-failed')) return 'No connection. Your changes are kept and will sync later.';
  return (e && e.message) || String(e);
}
