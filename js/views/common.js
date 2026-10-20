// 画面間で共通の部品
import * as store from '../store.js';
import { $, $$ } from '../ui.js';
import { escapeHtml } from '../text.js';

/** 絞り込み条件：出典は 1 つ、タグは複数（all = true なら「すべてを含む」、false なら「いずれかを含む」） */
export const emptyScope = () => ({ src: '', tags: [], all: false });

export function matchScope(item, s) {
  if (s.src && !item.sources.includes(s.src)) return false;
  if (!s.tags.length) return true;
  return s.all ? s.tags.every((t) => item.tags.includes(t)) : s.tags.some((t) => item.tags.includes(t));
}

const tagboxOpen = {};

/**
 * 出典の選択欄とタグの複数選択（折りたたみ）を el に作る。
 * get() で今の条件を読み、変更時は set(新しい条件) を呼ぶ。extra は出典欄の右に並べる HTML。
 * 返り値の refresh() で候補と件数を作り直す（消えたタグ・出典は条件から外して save する）。
 */
export function scopePicker(el, { key, get, set, save = set, extra = '' }) {
  el.innerHTML = `
    <div class="row" style="flex-wrap:nowrap">
      <select class="grow" data-sp="src" style="min-width:0" aria-label="出典で絞り込み"></select>${extra}
    </div>
    <details data-sp="box" style="margin-top:10px" ${tagboxOpen[key] ? 'open' : ''}>
      <summary data-sp="sum"></summary>
      <div class="row" style="margin-top:8px">
        <div class="seg grow">
          <button class="btn" data-mode="any">いずれかを含む</button>
          <button class="btn" data-mode="all">すべてを含む</button>
        </div>
        <button class="btn small" data-sp="clear">解除</button>
      </div>
      <div class="seg" data-sp="tags" style="margin-top:8px"></div>
    </details>`;
  const part = (n) => $(`[data-sp="${n}"]`, el);
  const change = (patch) => { set({ ...get(), ...patch }); refresh(); };

  part('box').addEventListener('toggle', () => { tagboxOpen[key] = part('box').open; });
  part('src').addEventListener('change', (e) => change({ src: e.target.value }));
  part('tags').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag]')?.dataset.tag;
    if (t === undefined) return;
    const tags = get().tags;
    change({ tags: tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t] });
  });
  $$('[data-mode]', el).forEach((b) => b.addEventListener('click', () => change({ all: b.dataset.mode === 'all' })));
  part('clear').addEventListener('click', () => change({ tags: [] }));

  function refresh() {
    const tags = new Map();
    const srcs = new Map();
    for (const i of store.active()) {
      i.tags.forEach((t) => tags.set(t, (tags.get(t) || 0) + 1));
      i.sources.forEach((s) => srcs.set(s, (srcs.get(s) || 0) + 1));
    }
    const sortKeys = (m) => [...m.keys()].sort((a, b) => a.localeCompare(b, 'ja'));

    let s = get();
    const pruned = { ...s, src: srcs.has(s.src) ? s.src : '', tags: s.tags.filter((t) => tags.has(t)) };
    if (pruned.src !== s.src || pruned.tags.length !== s.tags.length) { save(pruned); s = pruned; }

    part('src').innerHTML = `<option value="">すべての出典</option>${sortKeys(srcs).map((x) =>
      `<option value="${escapeHtml(x)}"${x === s.src ? ' selected' : ''}>${escapeHtml(x)}（${srcs.get(x)}）</option>`).join('')}`;
    part('box').hidden = !tags.size;
    part('sum').textContent = s.tags.length
      ? `タグ：${s.tags.map((t) => `#${t}`).join(s.all ? ' かつ ' : ' または ')}`
      : 'タグで絞り込む';
    part('tags').innerHTML = sortKeys(tags).map((t) =>
      `<button class="btn ${s.tags.includes(t) ? 'sel' : ''}" data-tag="${escapeHtml(t)}">#${escapeHtml(t)} ${tags.get(t)}</button>`).join('');
    $$('[data-mode]', el).forEach((b) => b.classList.toggle('sel', (b.dataset.mode === 'all') === s.all));
    part('clear').disabled = !s.tags.length;
  }

  refresh();
  return { refresh };
}

export function stageBadge(i) {
  if (i.stage === 2) return '<span class="badge ok">◎</span>';
  if (i.stage === 1) return '<span class="badge ok">✓</span>';
  return '';
}
