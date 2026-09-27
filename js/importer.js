// 取り込み時の重複チェックと反映。
import { normalizeKey, normalizeMeaning, meaningParts, uniq } from './text.js';
import * as store from './store.js';

/**
 * 取り込むエントリを既存データと照らし合わせて分類する。
 *  new      … 登録されていない語 → 追加
 *  exact    … 同じ語・同じ意味が登録済み → スキップ（出典・タグだけ追記）
 *  conflict … 同じ語で意味が違う → keep / overwrite / append を選ぶ
 * 取り込みデータ内の重複は、意味をまとめて1件にする。
 */
export function classify(entries) {
  const byKey = store.activeByKey();
  const merged = new Map();
  let batchDupes = 0;

  for (const e of entries) {
    const key = normalizeKey(e.term);
    if (!key) continue;
    const prev = merged.get(key);
    if (prev) {
      batchDupes++;
      if (!meaningParts(prev.meaning).includes(normalizeMeaning(e.meaning))) {
        prev.meaning = `${prev.meaning} / ${e.meaning}`;
      }
      prev.tags = uniq([...prev.tags, ...e.tags]);
      prev.sources = uniq([...prev.sources, ...e.sources]);
      if (!prev.note && e.note) prev.note = e.note;
    } else {
      merged.set(key, { ...e, key });
    }
  }

  const rows = [];
  for (const e of merged.values()) {
    const existing = byKey.get(e.key)?.[0];
    if (!existing) {
      rows.push({ entry: e, kind: 'new', action: 'add' });
      continue;
    }
    const exParts = meaningParts(existing.meaning);
    const newParts = meaningParts(e.meaning);
    const same = newParts.length > 0 && newParts.every((p) => exParts.includes(p));
    rows.push({ entry: e, existing, kind: same ? 'exact' : 'conflict', action: same ? 'skip' : 'keep' });
  }
  return { rows, batchDupes };
}

export function summarize(rows) {
  const c = { add: 0, skip: 0, keep: 0, overwrite: 0, append: 0 };
  rows.forEach((r) => { c[r.action]++; });
  return c;
}

export async function apply(rows) {
  const changed = [];
  for (const { entry: e, existing: ex, action } of rows) {
    if (action === 'add') {
      changed.push(store.createItem(e));
      continue;
    }
    // 既存語には出典とタグを追記する（どの選択でも非破壊）
    ex.tags = uniq([...ex.tags, ...e.tags]);
    ex.sources = uniq([...ex.sources, ...e.sources]);
    if (action === 'overwrite') {
      ex.meaning = e.meaning;
      if (e.note) ex.note = e.note;
    } else if (action === 'append') {
      const exParts = meaningParts(ex.meaning);
      const add = e.meaning.split(/\s*[\/／;；]\s*/).filter((p) => p && !exParts.includes(normalizeMeaning(p)));
      if (add.length) ex.meaning = `${ex.meaning} / ${add.join(' / ')}`;
      if (e.note && !ex.note) ex.note = e.note;
    }
    changed.push(ex);
  }
  await store.save(changed);
  return changed.length;
}

/** 登録済みデータの中の重複グループ（2件以上あるもの） */
export function findDuplicateGroups() {
  return [...store.activeByKey().values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => a.createdAt - b.createdAt));
}
