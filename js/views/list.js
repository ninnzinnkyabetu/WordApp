// 一覧・検索・非表示・削除・重複整理
import * as store from '../store.js';
import { $, $$, toast, openDialog, confirmDialog } from '../ui.js';
import { escapeHtml, normalizeKey, meaningParts, normalizeMeaning, splitTags, uniq } from '../text.js';
import { speak } from '../speech.js';
import { findDuplicateGroups } from '../importer.js';
import { stageBadge } from './common.js';

const root = $('#view-list');
const PAGE = 200;

const FILTERS = {
  learning: { label: '学習中', fn: (i) => store.isVisible(i) && i.stage < 2 },
  done: { label: '◎ 済み', fn: (i) => store.isVisible(i) && i.stage === 2 },
  hidden: { label: '非表示', fn: (i) => store.isActive(i) && i.hidden },
  all: { label: 'すべて', fn: (i) => store.isActive(i) },
  trash: { label: 'ゴミ箱', fn: (i) => store.isAlive(i) && !!i.deletedAt },
};

const state = { q: '', filter: 'all', sort: 'new', select: false, selected: new Set(), limit: PAGE };
let built = false;

function skeleton() {
  root.innerHTML = `
    <div class="row between">
      <h2>一覧</h2>
      <button class="btn small" id="ls-dupes">重複チェック</button>
    </div>
    <input type="search" id="ls-q" placeholder="検索（英語・日本語・タグ・出典）" autocomplete="off">
    <div class="row between" style="margin-top:10px">
      <div class="seg" id="ls-filters"></div>
    </div>
    <div class="row between" style="margin-top:10px">
      <select id="ls-sort" style="width:auto">
        <option value="new">新しい順</option>
        <option value="old">古い順</option>
        <option value="az">A→Z</option>
        <option value="seen">よく見た順</option>
      </select>
      <button class="btn" id="ls-selmode">選択</button>
    </div>
    <div class="bulkbar" id="ls-bulk" hidden></div>
    <p class="muted small" id="ls-count" style="margin:8px 0 0"></p>
    <div id="ls-body"></div>`;

  $('#ls-q', root).addEventListener('input', (e) => { state.q = e.target.value; state.limit = PAGE; renderList(); });
  $('#ls-sort', root).addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
  $('#ls-selmode', root).addEventListener('click', () => {
    state.select = !state.select;
    state.selected.clear();
    renderList();
  });
  $('#ls-dupes', root).addEventListener('click', dedupeDialog);
  built = true;
}

function renderFilters() {
  const counts = {};
  const alive = store.all();
  for (const k of Object.keys(FILTERS)) counts[k] = alive.filter(FILTERS[k].fn).length;
  $('#ls-filters', root).innerHTML = Object.entries(FILTERS).map(([k, f]) =>
    `<button class="btn ${state.filter === k ? 'sel' : ''}" data-f="${k}">${f.label} ${counts[k]}</button>`).join('');
  $$('[data-f]', root).forEach((b) => b.addEventListener('click', () => {
    state.filter = b.dataset.f;
    state.selected.clear();
    state.limit = PAGE;
    renderFilters();
    renderList();
  }));
}

function matches(i, q) {
  if (!q) return true;
  const hay = [i.term, i.meaning, i.note, ...i.tags, ...i.sources].join('\n').normalize('NFKC').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function filtered() {
  const q = state.q.normalize('NFKC').toLowerCase().trim();
  const list = store.all().filter((i) => FILTERS[state.filter].fn(i) && matches(i, q));
  const cmp = {
    new: (a, b) => b.createdAt - a.createdAt,
    old: (a, b) => a.createdAt - b.createdAt,
    az: (a, b) => a.key.localeCompare(b.key),
    seen: (a, b) => b.seenCount - a.seenCount,
  }[state.sort];
  return list.sort(cmp);
}

function renderList() {
  const list = filtered();
  const shown = list.slice(0, state.limit);
  $('#ls-selmode', root).textContent = state.select ? '選択をやめる' : '選択';
  $('#ls-selmode', root).classList.toggle('sel', state.select);
  $('#ls-count', root).textContent = `${list.length} 件${list.length > shown.length ? `（${shown.length} 件を表示）` : ''}`;
  renderBulk(list);

  if (!list.length) {
    $('#ls-body', root).innerHTML = `<div class="empty">${state.q ? '見つかりませんでした' : '該当する単語はありません'}</div>`;
    return;
  }
  $('#ls-body', root).innerHTML = `
    <div class="list-wrap"><ul class="list">
      ${shown.map((i) => `
        <li data-id="${i.id}">
          ${state.select ? `<input type="checkbox" ${state.selected.has(i.id) ? 'checked' : ''} aria-label="選択">` : ''}
          <div class="grow">
            <div class="t">${escapeHtml(i.term)}</div>
            <div class="m">${escapeHtml(i.meaning)}</div>
          </div>
          <div class="badges">
            ${stageBadge(i)}
            ${i.hidden ? '<span class="badge">非表示</span>' : ''}
            ${i.kind === 'phrase' ? '<span class="badge">句</span>' : ''}
          </div>
        </li>`).join('')}
    </ul></div>
    ${list.length > shown.length ? '<p style="text-align:center"><button class="btn" id="ls-more">もっと表示</button></p>' : ''}`;

  $('#ls-more', root)?.addEventListener('click', () => { state.limit += PAGE; renderList(); });
  $$('.list li', root).forEach((li) => li.addEventListener('click', (e) => {
    const id = li.dataset.id;
    if (state.select) {
      const cb = $('input', li);
      if (e.target !== cb) cb.checked = !cb.checked;
      cb.checked ? state.selected.add(id) : state.selected.delete(id);
      renderBulk(list);
    } else {
      editDialog(store.items.get(id));
    }
  }));
}

function renderBulk(list) {
  const bar = $('#ls-bulk', root);
  bar.hidden = !state.select;
  if (!state.select) return;
  const n = state.selected.size;
  const allSel = list.length > 0 && list.every((i) => state.selected.has(i.id));
  const btn = (act, label, cls = '') => `<button class="btn ${cls}" data-act="${act}" ${n ? '' : 'disabled'}>${label}</button>`;
  const actions = state.filter === 'trash'
    ? btn('restore', '復元') + btn('purge', '完全に削除', 'danger')
    : (state.filter === 'hidden' ? btn('unhide', '表示に戻す') : btn('hide', '非表示')) + btn('trash', 'ゴミ箱へ', 'danger');
  bar.innerHTML = `
    <div class="row">
      <button class="btn" data-act="all">${allSel ? '全解除' : `全選択（${list.length}）`}</button>
      <span class="muted small grow">${n} 件選択中</span>
    </div>
    <div class="row" style="margin-top:6px">${actions}</div>`;
  $$('[data-act]', bar).forEach((b) => b.addEventListener('click', () => bulk(b.dataset.act, list)));
}

async function bulk(act, list) {
  if (act === 'all') {
    const allSel = list.every((i) => state.selected.has(i.id));
    state.selected = allSel ? new Set() : new Set(list.map((i) => i.id));
    renderList();
    return;
  }
  const sel = [...state.selected].map((id) => store.items.get(id)).filter(Boolean);
  if (!sel.length) return;
  const n = sel.length;
  const now = Date.now();
  if (act === 'hide') sel.forEach((i) => { i.hidden = true; });
  else if (act === 'unhide') sel.forEach((i) => { i.hidden = false; });
  else if (act === 'trash') {
    if (!await confirmDialog(`${n} 件をゴミ箱へ移動しますか？\n（ゴミ箱から復元できます）`, { ok: 'ゴミ箱へ', danger: true })) return;
    sel.forEach((i) => { i.deletedAt = now; });
  } else if (act === 'restore') sel.forEach((i) => { i.deletedAt = null; });
  else if (act === 'purge') {
    if (!await confirmDialog(`${n} 件を完全に削除しますか？\nこの操作は元に戻せません。`, { ok: '完全に削除', danger: true })) return;
    sel.forEach(store.purge);
  }
  await store.save(sel);
  const label = { hide: '非表示にしました', unhide: '表示に戻しました', trash: 'ゴミ箱へ移動しました', restore: '復元しました', purge: '完全に削除しました' }[act];
  toast(`${n} 件を${label}`);
  state.selected.clear();
  renderFilters();
  renderList();
}

// ---------- 編集 ----------
async function editDialog(item) {
  const trashed = !!item.deletedAt;
  await openDialog(`
    <h2>単語を編集</h2>
    <div class="stack">
      <label class="field"><span>英語（単語・フレーズ）</span><input id="ed-term" value="${escapeHtml(item.term)}"></label>
      <label class="field"><span>意味</span><input id="ed-meaning" value="${escapeHtml(item.meaning)}"></label>
      <label class="field"><span>メモ</span><input id="ed-note" value="${escapeHtml(item.note)}"></label>
      <label class="field"><span>タグ（カンマ区切り）</span><input id="ed-tags" value="${escapeHtml(item.tags.join(', '))}"></label>
      <label class="field"><span>出典（カンマ区切り）</span><input id="ed-srcs" value="${escapeHtml(item.sources.join(', '))}"></label>
      <div class="row">
        <label class="field grow"><span>覚えた段階</span>
          <select id="ed-stage">
            <option value="0">未チェック</option>
            <option value="1">✓ チェック</option>
            <option value="2">◎ チェック丸（出題しない）</option>
          </select>
        </label>
        <label class="row" style="margin-top:20px"><input type="checkbox" id="ed-pron" ${item.pronChecked ? 'checked' : ''}> 発音確認済み</label>
      </div>
      <p class="muted small">見た回数 ${item.seenCount} 回 ／ 登録 ${new Date(item.createdAt).toLocaleDateString()}${item.checkedAt ? ` ／ ✓ ${new Date(item.checkedAt).toLocaleDateString()}` : ''}</p>
    </div>
    <div class="actions" style="justify-content:space-between">
      <div class="row">
        <button class="btn" id="ed-speak">🔊</button>
        ${trashed ? '<button class="btn" id="ed-restore">復元</button>'
    : `<button class="btn" id="ed-hide">${item.hidden ? '表示に戻す' : '非表示'}</button>
           <button class="btn danger" id="ed-trash">ゴミ箱へ</button>`}
      </div>
      <div class="row">
        <button class="btn" id="ed-cancel">キャンセル</button>
        <button class="btn primary" id="ed-save">保存</button>
      </div>
    </div>`, (dlg, close) => {
    $('#ed-stage', dlg).value = String(item.stage);
    $('#ed-speak', dlg).onclick = () => speak($('#ed-term', dlg).value);
    $('#ed-cancel', dlg).onclick = () => close();
    $('#ed-hide', dlg)?.addEventListener('click', async () => {
      item.hidden = !item.hidden;
      await store.save(item);
      toast(item.hidden ? '非表示にしました' : '表示に戻しました');
      close();
    });
    $('#ed-trash', dlg)?.addEventListener('click', async () => {
      item.deletedAt = Date.now();
      await store.save(item);
      toast('ゴミ箱へ移動しました');
      close();
    });
    $('#ed-restore', dlg)?.addEventListener('click', async () => {
      item.deletedAt = null;
      await store.save(item);
      toast('復元しました');
      close();
    });
    $('#ed-save', dlg).onclick = async () => {
      const term = $('#ed-term', dlg).value.trim();
      const meaning = $('#ed-meaning', dlg).value.trim();
      if (!term || !meaning) { toast('英語と意味は必須です'); return; }
      const key = normalizeKey(term);
      if (key !== item.key) {
        const dup = store.activeByKey().get(key)?.find((x) => x.id !== item.id);
        if (dup && !await confirmDialog(`「${escapeHtml(dup.term)}」（${escapeHtml(dup.meaning)}）がすでに登録されています。\nこのまま保存すると重複になります。保存しますか？`, { ok: '保存する' })) return;
      }
      store.setTerm(item, term);
      item.meaning = meaning;
      item.note = $('#ed-note', dlg).value.trim();
      item.tags = splitTags($('#ed-tags', dlg).value);
      item.sources = splitTags($('#ed-srcs', dlg).value);
      const stage = Number($('#ed-stage', dlg).value);
      if (stage !== item.stage) {
        item.stage = stage;
        item.checkedAt = stage === 0 ? null : (item.checkedAt || Date.now());
      }
      item.pronChecked = $('#ed-pron', dlg).checked;
      await store.save(item);
      toast('保存しました');
      close();
    };
  });
  renderFilters();
  renderList();
}

// ---------- 重複整理 ----------
async function dedupeDialog() {
  const groups = findDuplicateGroups();
  if (!groups.length) { toast('重複している単語はありません'); return; }
  const total = groups.reduce((n, g) => n + g.length - 1, 0);
  const best = (g) => [...g].sort((a, b) => b.stage - a.stage || a.createdAt - b.createdAt)[0].id;

  const ok = await openDialog(`
    <h2>重複チェック</h2>
    <p class="muted small">同じ英語が ${groups.length} 組あります。残す方を選んでください。残さない方はゴミ箱へ移動します。</p>
    <label class="row small"><input type="checkbox" id="dd-merge" checked> 意味・タグ・出典を残す方にまとめる</label>
    <div class="list-wrap" style="max-height:50vh;overflow:auto">
      ${groups.map((g, gi) => `
        <div class="pv-row">
          <div class="t"><strong>${escapeHtml(g[0].term)}</strong></div>
          ${g.map((i) => `
            <label class="row small" style="margin-top:4px;flex-wrap:nowrap">
              <input type="radio" name="dd-${gi}" value="${i.id}" ${i.id === best(g) ? 'checked' : ''}>
              <span class="grow">${escapeHtml(i.term)} — ${escapeHtml(i.meaning)}</span>
              ${stageBadge(i)}${i.hidden ? '<span class="badge">非表示</span>' : ''}
            </label>`).join('')}
        </div>`).join('')}
    </div>
    <div class="actions">
      <button class="btn" id="dd-cancel">キャンセル</button>
      <button class="btn danger" id="dd-ok">整理する（${total} 件をゴミ箱へ）</button>
    </div>`, (dlg, close) => {
    $('#dd-cancel', dlg).onclick = () => close(null);
    $('#dd-ok', dlg).onclick = () => {
      const keep = groups.map((g, gi) => $(`input[name="dd-${gi}"]:checked`, dlg).value);
      close({ keep, merge: $('#dd-merge', dlg).checked });
    };
  });
  if (!ok) return;
  if (!await confirmDialog(`${total} 件をゴミ箱へ移動して重複を整理します。よろしいですか？`, { ok: '整理する', danger: true })) return;

  const changed = [];
  const now = Date.now();
  groups.forEach((g, gi) => {
    const kept = store.items.get(ok.keep[gi]);
    for (const i of g) {
      if (i.id === kept.id) continue;
      if (ok.merge) {
        const parts = meaningParts(kept.meaning);
        i.meaning.split(/\s*[\/／;；]\s*/).forEach((p) => {
          if (p && !parts.includes(normalizeMeaning(p))) { kept.meaning += ` / ${p}`; parts.push(normalizeMeaning(p)); }
        });
        kept.tags = uniq([...kept.tags, ...i.tags]);
        kept.sources = uniq([...kept.sources, ...i.sources]);
        kept.seenCount += i.seenCount;
        kept.pronChecked ||= i.pronChecked;
        if (!kept.note && i.note) kept.note = i.note;
      }
      i.deletedAt = now;
      changed.push(i);
    }
    changed.push(kept);
  });
  await store.save(changed);
  toast(`重複を整理しました（${total} 件をゴミ箱へ）`);
  renderFilters();
  renderList();
}

// 同期で別の端末の変更が届いたら、表示中の一覧を更新する
store.onChange(() => {
  if (built && !root.hidden && !document.querySelector('dialog[open]')) { renderFilters(); renderList(); }
});

export function show() {
  if (!built) skeleton();
  renderFilters();
  renderList();
}

export function hide() {}
