// 文字列の正規化と、取り込みテキストの解析。

/** 重複判定用のキー。大文字小文字・空白・引用符の違い・末尾の句読点を無視する。 */
export function normalizeKey(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’‚‛´`]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.!?,;:。、]+$/u, '');
}

/** 意味の比較用。空白と区切り記号の揺れを無視する。 */
export function normalizeMeaning(s) {
  return String(s ?? '').normalize('NFKC').replace(/\s+/g, '').replace(/[。．.]+$/u, '').toLowerCase();
}

// 意味の区切り。「/」「;」が大きな区切りで、その中の「、」「,」が小さな区切り（1,000 のような数字の桁区切りは除く）
const PART_SEP = /\s*[\/／;；]\s*/;
const SUB_SEP = /\s*(?:[、，]|,(?!\d))\s*/;

/** 「A / B、C」のような意味を部分ごとに分ける */
export function meaningParts(s) {
  return String(s ?? '').split(PART_SEP).flatMap((p) => p.split(SUB_SEP)).map(normalizeMeaning).filter(Boolean);
}

/**
 * 意味の中で同じものが繰り返されていたら、2回目以降を取り除く。
 * 例）「主に / ほとんど / だいたい / 主に / ほとんど」→「主に / ほとんど / だいたい」
 * 重複が無ければ元の文字列をそのまま返す（区切りの書き方を勝手に変えない）。
 */
export function dedupeMeaning(s) {
  const src = String(s ?? '');
  const seen = new Set();
  let removed = false;
  const out = [];
  for (const part of src.split(PART_SEP)) {
    const subs = part.split(SUB_SEP);
    const kept = subs.filter((x) => {
      const k = normalizeMeaning(x);
      if (!k) return false;
      if (seen.has(k)) { removed = true; return false; }
      seen.add(k);
      return true;
    });
    if (!kept.length) continue;
    out.push(kept.length === subs.length ? part.trim() : kept.join('、'));
  }
  return removed ? out.join(' / ') : src;
}

/** 意味 a に b を付け足す（すでにある部分は付け足さない） */
export function mergeMeaning(a, b) {
  if (!String(a ?? '').trim()) return String(b ?? '').trim();
  if (!String(b ?? '').trim()) return String(a).trim();
  const merged = dedupeMeaning(`${a} / ${b}`);
  // b がすべて a に含まれていたら a のまま
  return meaningParts(b).every((p) => meaningParts(a).includes(p)) ? String(a).trim() : merged;
}

export const isPhrase = (term) => /\s/.test(term.trim());

export function uniq(arr) {
  return [...new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))];
}

export function splitTags(s) {
  return uniq(String(s ?? '').split(/[,、，]/));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const TERM_KEYS = ['term', 'word', 'phrase', 'english', 'en'];
const MEANING_KEYS = ['meaning', 'japanese', 'ja', 'translation', 'jp', 'definition'];

function pick(obj, keys) {
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k].trim()) return obj[k];
  return '';
}

/**
 * 取り込みテキストを解析して {term, meaning, note, tags, sources}[] にする。
 * 対応形式:
 *  - JSON: {source, tags, items:[...]} / その配列 / items 配列そのもの
 *  - 行形式: 「英語 | 日本語 | メモ(任意)」またはタブ区切り。# で始まる行は無視
 * AI の出力にありがちな ```json コードブロックは中身だけ取り出す。
 * @param {string} text
 * @param {{source?: string, tags?: string[]}} defaults
 */
export function parseInput(text, defaults = {}) {
  const errors = [];
  const entries = [];
  let body = String(text ?? '').trim();
  const fence = body.match(/```(?:json|txt|text)?\s*\n([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  if (!body) return { entries, errors: ['入力が空です'] };

  const defSources = defaults.source ? [defaults.source] : [];
  const defTags = defaults.tags || [];

  if (/^[\[{]/.test(body)) {
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      return { entries, errors: [`JSON の読み込みに失敗しました: ${e.message}`] };
    }
    if (data && data.app === 'wordapp') {
      return { entries, errors: ['これはバックアップファイルです。「設定 → バックアップから復元」で読み込んでください'] };
    }
    const groups = Array.isArray(data)
      ? (data.length && data.every((d) => d && Array.isArray(d.items)) ? data : [{ items: data }])
      : [data];
    for (const g of groups) {
      if (!g || !Array.isArray(g.items)) { errors.push('items 配列が見つかりません'); continue; }
      const gSources = g.source ? [String(g.source)] : defSources;
      const gTags = Array.isArray(g.tags) ? g.tags : (typeof g.tags === 'string' ? splitTags(g.tags) : defTags);
      g.items.forEach((it, idx) => {
        if (typeof it === 'string') it = { term: it };
        const term = pick(it || {}, TERM_KEYS).trim();
        const meaning = pick(it || {}, MEANING_KEYS).trim();
        if (!term || !meaning) { errors.push(`${idx + 1}件目: 英語か意味が空です`); return; }
        const tags = Array.isArray(it.tags) ? it.tags : (typeof it.tags === 'string' ? splitTags(it.tags) : []);
        entries.push({
          term, meaning,
          note: typeof it.note === 'string' ? it.note.trim() : '',
          tags: uniq([...gTags, ...tags]),
          sources: uniq(it.source ? [it.source] : gSources),
        });
      });
    }
  } else {
    body.split(/\r?\n/).forEach((line, idx) => {
      const l = line.trim();
      if (!l || l.startsWith('#')) return;
      const cols = (l.includes('\t') ? l.split('\t') : l.split(/\s*[|｜]\s*/)).map((c) => c.trim());
      if (cols.length < 2 || !cols[0] || !cols[1]) { errors.push(`${idx + 1}行目: 「英語 | 日本語」の形になっていません`); return; }
      entries.push({ term: cols[0], meaning: cols[1], note: cols[2] || '', tags: uniq(defTags), sources: uniq(defSources) });
    });
  }
  return { entries, errors };
}
