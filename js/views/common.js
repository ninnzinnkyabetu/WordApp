// 画面間で共通の部品
import * as store from '../store.js';
import { escapeHtml } from '../text.js';

/** 絞り込み用 <option> 群（すべて / タグ / 出典） */
export function filterOptions(selected = '') {
  const tags = new Map();
  const srcs = new Map();
  for (const i of store.active()) {
    i.tags.forEach((t) => tags.set(t, (tags.get(t) || 0) + 1));
    i.sources.forEach((s) => srcs.set(s, (srcs.get(s) || 0) + 1));
  }
  const opt = (v, label) => `<option value="${escapeHtml(v)}"${v === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const sortKeys = (m) => [...m.keys()].sort((a, b) => a.localeCompare(b, 'ja'));
  let html = opt('', 'すべての単語');
  if (tags.size) html += `<optgroup label="タグ">${sortKeys(tags).map((t) => opt(`tag:${t}`, `#${t}（${tags.get(t)}）`)).join('')}</optgroup>`;
  if (srcs.size) html += `<optgroup label="出典">${sortKeys(srcs).map((s) => opt(`src:${s}`, `${s}（${srcs.get(s)}）`)).join('')}</optgroup>`;
  return html;
}

export function matchFilter(item, filter) {
  if (!filter) return true;
  if (filter.startsWith('tag:')) return item.tags.includes(filter.slice(4));
  if (filter.startsWith('src:')) return item.sources.includes(filter.slice(4));
  return true;
}

export function stageBadge(i) {
  if (i.stage === 2) return '<span class="badge ok">◎</span>';
  if (i.stage === 1) return '<span class="badge ok">✓</span>';
  return '';
}
