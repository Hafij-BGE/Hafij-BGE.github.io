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
  collection, doc, setDoc, deleteDoc, getDoc, onSnapshot, writeBatch,
  terminate, clearIndexedDbPersistence,
} from 'firebase/firestore';

// Remove everything this app stored in the browser (demo data, photos).
export function wipeLocal() {
  try { Object.keys(localStorage).filter(k => k.startsWith('rl.')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
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
      this.user = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
      this.emit('auth', this.user);
      if (u) this.subscribe();
    });
    addEventListener('online', () => this.emit('status', this.lastStatus()));
    addEventListener('offline', () => this.emit('status', 'offline'));
  }
  col(name) { return collection(this.db, 'users', this.user.uid, name); }
  subscribe() {
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
    this.user = { uid: 'local', name: '', email: 'Stored in this browser only' };
    this.items = {};
    try { this.items = JSON.parse(localStorage.getItem('rl.items') || '{}'); } catch (e) {}
    queueMicrotask(() => { this.emit('auth', this.user); this.flush(); });
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
