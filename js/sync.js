// Firebase（Google ログイン + Firestore）による端末間同期。
//
// 保存場所: users/{uid}/items/{itemId}
// - 送信: この端末で編集した単語の id を「未送信」として覚えておき、まとめて書き込む
// - 受信: 前回以降にサーバーへ書かれた単語だけを取る（syncedAt はサーバー時刻なので端末の時計ずれに強い）
// - 競合: 同じ単語は updatedAt が新しい方を残す
// Firebase の部品は必要になった時に CDN から読み込む（オフラインでもアプリ本体は動く）。
import * as store from './store.js';
import { firebaseConfig, FIREBASE_VERSION } from './firebase-config.js';

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
const PENDING_KEY = 'wordapp.sync.pending';
const lastPullKey = (uid) => `wordapp.sync.lastPull.${uid}`;
const BATCH = 400;
const MARGIN_MS = 5000; // 取りこぼし防止に少し前から取り直す

let fb = null;       // 読み込んだ Firebase モジュール
let auth = null;
let db = null;
let user = null;
let running = null;  // 実行中の同期（Promise）
let again = false;   // 同期中に次の同期要求が来た
let pushTimer = null;

export const status = { state: 'off', user: null, lastSync: null, error: '', pending: 0 };
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); }
function setStatus(patch) {
  Object.assign(status, patch, { pending: pending.size });
  listeners.forEach((fn) => fn(status));
}

// ---- 未送信 id（端末ごとに localStorage へ保存） ----
const pending = new Set(readJSON(PENDING_KEY, []));
function readJSON(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存できない環境 */ }
}
function persistPending() { writeJSON(PENDING_KEY, [...pending]); }

store.onLocalEdit((list) => {
  list.forEach((i) => pending.add(i.id));
  persistPending();
  setStatus({});
  if (user) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => sync(), 2000);
  }
});

async function load() {
  if (fb) return fb;
  const [app, authMod, fs] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  const a = app.initializeApp(firebaseConfig);
  auth = authMod.getAuth(a);
  db = fs.initializeFirestore(a, { ignoreUndefinedProperties: true });
  fb = { ...authMod, ...fs };
  return fb;
}

/** 起動時に呼ぶ。ログイン済みなら同期を始める。 */
export async function init() {
  try {
    await load();
  } catch {
    setStatus({ state: 'offline', error: 'Firebase を読み込めませんでした（オフライン？）' });
    return;
  }
  fb.onAuthStateChanged(auth, (u) => {
    user = u;
    if (u) {
      setStatus({ state: 'idle', user: { email: u.email, uid: u.uid }, error: '' });
      sync();
    } else {
      setStatus({ state: 'off', user: null });
    }
  });
  const kick = () => { if (user && document.visibilityState === 'visible') sync(); };
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('online', kick);
  window.addEventListener('focus', kick);
}

export async function signIn() {
  await load();
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await fb.signInWithPopup(auth, provider);
}

export async function signOut() {
  if (!auth) return;
  await fb.signOut(auth);
}

/** 同期を実行する。同時に複数回呼ばれても 1 本ずつ順番に動く。 */
export function sync() {
  if (!user) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        setStatus({ state: 'syncing', error: '' });
        await pull();
        await push();
      } while (again);
      setStatus({ state: 'idle', lastSync: Date.now() });
    } catch (e) {
      setStatus({ state: 'error', error: explain(e) });
    } finally {
      running = null;
    }
  })();
  return running;
}

function explain(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return '権限がありません。Firestore のルールのメールアドレスが、ログインしたアカウントと一致しているか確認してください';
  if (code.includes('unavailable') || !navigator.onLine) return 'オフラインのため同期できませんでした。つながったら自動で再開します';
  return e?.message || String(e);
}

function itemsCol() {
  return fb.collection(db, 'users', user.uid, 'items');
}

async function pull() {
  const uid = user.uid;
  const last = readJSON(lastPullKey(uid), null);
  const firstTime = last === null;
  const q = firstTime
    ? fb.query(itemsCol())
    : fb.query(itemsCol(), fb.where('syncedAt', '>', fb.Timestamp.fromMillis(Math.max(0, last - MARGIN_MS))));
  const snap = await fb.getDocs(q);

  let maxSynced = last || 0;
  const take = [];
  const remoteVer = new Map();
  snap.forEach((d) => {
    const { syncedAt, ...data } = d.data();
    const ms = syncedAt?.toMillis?.() || 0;
    if (ms > maxSynced) maxSynced = ms;
    remoteVer.set(d.id, data.updatedAt || 0);
    const local = store.items.get(d.id);
    if (!local || (data.updatedAt || 0) > (local.updatedAt || 0)) {
      take.push({ ...data, id: d.id });
      pending.delete(d.id); // サーバーの方が新しいので、この端末の古い変更は送らない
    }
  });
  if (take.length) await store.save(take, { touch: false, push: false });

  if (firstTime) {
    // この端末で初めての同期: サーバーに無い／この端末の方が新しいものを全部送る
    for (const i of store.items.values()) {
      if (!remoteVer.has(i.id) || (i.updatedAt || 0) > remoteVer.get(i.id)) pending.add(i.id);
    }
  }
  persistPending();
  writeJSON(lastPullKey(uid), maxSynced);
}

async function push() {
  const ids = [...pending];
  for (let k = 0; k < ids.length; k += BATCH) {
    const chunk = ids.slice(k, k + BATCH);
    const batch = fb.writeBatch(db);
    const sent = new Map();
    for (const id of chunk) {
      const it = store.items.get(id);
      if (!it) continue;
      sent.set(id, it.updatedAt);
      batch.set(fb.doc(itemsCol(), id), { ...it, syncedAt: fb.serverTimestamp() });
    }
    await batch.commit();
    // 送信中にさらに編集された単語は未送信のまま残す
    chunk.forEach((id) => { if (store.items.get(id)?.updatedAt === sent.get(id)) pending.delete(id); });
    persistPending();
    setStatus({});
  }
}
