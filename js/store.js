// 単語データの保存（IndexedDB）とメモリ上のキャッシュ。
// 個人利用で数千〜数万件想定なので、起動時に全件読み込んで Map で持つ。
import { normalizeKey, isPhrase, uniq } from './text.js';

const DB_NAME = 'wordapp';
const STORE = 'items';
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** @type {Map<string, any>} */
export const items = new Map();
const listeners = new Set();
let db;

export function onChange(fn) { listeners.add(fn); }
function emit() { listeners.forEach((fn) => fn()); }

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('key', 'key');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function init() {
  db = await openDB();
  const all = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  all.forEach((i) => items.set(i.id, i));
  try { await navigator.storage?.persist?.(); } catch { /* 任意 */ }
}

function write(list) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const s = tx.objectStore(STORE);
    list.forEach((i) => s.put(i));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const savedListeners = new Set();
/** 同期に送るべき変更が保存されたときに呼ばれる */
export function onLocalEdit(fn) { savedListeners.add(fn); }

/**
 * 変更を保存する。
 *  touch … updatedAt を今の時刻にする（内容の変更）。見た回数だけの更新は false
 *  push  … クラウドへ送る対象にする。既定は touch と同じ。同期で受け取ったデータは false
 */
export async function save(list, { silent = false, touch = true, push = touch } = {}) {
  if (!Array.isArray(list)) list = [list];
  if (!list.length) return;
  const now = Date.now();
  for (const i of list) {
    if (touch) i.updatedAt = now;
    items.set(i.id, i);
  }
  await write(list);
  if (push) savedListeners.forEach((fn) => fn(list));
  if (!silent) emit();
}

export function createItem({ term, meaning, note = '', tags = [], sources = [] }) {
  const now = Date.now();
  term = term.trim();
  return {
    id: crypto.randomUUID(),
    term,
    key: normalizeKey(term),
    meaning: meaning.trim(),
    note: note.trim(),
    kind: isPhrase(term) ? 'phrase' : 'word',
    tags: uniq(tags),
    sources: uniq(sources),
    stage: 0,
    checkedAt: null,
    seenCount: 0,
    pronChecked: false,
    quizCorrect: 0,
    quizWrong: 0,
    quizLastAt: null,
    hidden: false,
    deletedAt: null,
    purged: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** term を変えたときに key / kind を付け直す */
export function setTerm(item, term) {
  item.term = term.trim();
  item.key = normalizeKey(item.term);
  item.kind = isPhrase(item.term) ? 'phrase' : 'word';
}

// ---- 状態の判定 ----
export const isAlive = (i) => !i.purged;                 // 完全削除されていない
export const isActive = (i) => !i.purged && !i.deletedAt; // ゴミ箱に入っていない
export const isVisible = (i) => isActive(i) && !i.hidden;  // 非表示でもない

export function all() { return [...items.values()]; }
export function active() { return all().filter(isActive); }

/** key -> ゴミ箱以外のアイテム配列 */
export function activeByKey() {
  const m = new Map();
  for (const i of items.values()) {
    if (!isActive(i)) continue;
    if (!m.has(i.key)) m.set(i.key, []);
    m.get(i.key).push(i);
  }
  return m;
}

/** 完全削除。同期のために中身を消した「墓標」だけ残す。 */
export function purge(item) {
  Object.assign(item, {
    purged: true, term: '', meaning: '', note: '', tags: [], sources: [],
    deletedAt: item.deletedAt || Date.now(),
  });
}

// ---- バックアップ ----
export function exportData() {
  return {
    app: 'wordapp',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: all(),
  };
}

/** バックアップを取り込む。同じ id は updatedAt が新しい方を採用。 */
export async function restore(data) {
  if (!data || data.app !== 'wordapp' || !Array.isArray(data.items)) {
    throw new Error('このアプリのバックアップ形式ではありません');
  }
  const changed = [];
  for (const it of data.items) {
    if (!it || typeof it.id !== 'string') continue;
    const cur = items.get(it.id);
    if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) changed.push(it);
  }
  await save(changed, { touch: false, push: true });
  return changed.length;
}
