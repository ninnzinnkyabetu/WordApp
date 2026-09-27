// 流し見：単語と意味だけを 1〜2 秒ずつ次々に表示する。
// ✓（一瞬で分かった）→ 7日以上あけて再度 ✓ で ◎（チェック丸）になり、出題から外れる。
import * as store from '../store.js';
import { settings, saveSettings } from '../settings.js';
import { speak, stop as stopSpeak } from '../speech.js';
import { $, toast } from '../ui.js';
import { filterOptions, matchFilter } from './common.js';

const root = $('#view-flow');
let queue = [];     // item id の配列
let pos = 0;
let playing = false;
let visible = false;
let dirty = true;   // 他の画面でデータが変わったら出題リストを作り直す
let tick = 0;       // 自動送りのキャンセル用
let built = false;

store.onChange(() => { dirty = true; });
window.addEventListener('queue-reset', () => { dirty = true; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function eligible(i) {
  return store.isVisible(i) && i.stage < 2 && matchFilter(i, settings.filter);
}

function buildQueue() {
  const list = store.all().filter(eligible);
  switch (settings.order) {
    case 'new': list.sort((a, b) => b.createdAt - a.createdAt); break;
    case 'old': list.sort((a, b) => a.createdAt - b.createdAt); break;
    case 'leastSeen': list.sort((a, b) => a.seenCount - b.seenCount || a.createdAt - b.createdAt); break;
    default:
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
  }
  queue = list.map((i) => i.id);
  pos = 0;
  dirty = false;
}

function current() {
  const id = queue[pos];
  return id ? store.items.get(id) : null;
}

function skeleton() {
  root.innerHTML = `
    <div class="row">
      <select id="flow-filter" class="grow" aria-label="絞り込み"></select>
    </div>
    <div id="flow-body"></div>`;
  $('#flow-filter', root).addEventListener('change', (e) => {
    saveSettings({ filter: e.target.value });
    buildQueue();
    display();
  });
  built = true;
}

function body() {
  $('#flow-body', root).innerHTML = `
    <div class="card flow-card" id="flow-card" style="margin-top:12px">
      <div class="flow-badges" id="flow-badges"></div>
      <div class="flow-progress" id="flow-progress"></div>
      <div class="flow-term" id="flow-term"></div>
      <div class="flow-meaning" id="flow-meaning"></div>
      <div class="flow-bar" id="flow-bar"></div>
    </div>
    <div class="flow-controls">
      <button class="btn big" id="flow-prev" aria-label="前へ">◀</button>
      <button class="btn big primary" id="flow-play">▶ 再生</button>
      <button class="btn big" id="flow-next" aria-label="次へ">▶|</button>
      <button class="btn big" id="flow-speak" aria-label="発音">🔊</button>
    </div>
    <div class="flow-actions">
      <button class="btn big ok" id="flow-check">✓ 一瞬で分かった</button>
      <button class="btn big" id="flow-hide">非表示</button>
    </div>
    <p class="muted small" style="text-align:center;margin-top:12px">
      カードをタップで次へ ／ 左右スワイプで前後 ／ PC: Space 再生・← → 移動・Enter ✓
    </p>`;

  const card = $('#flow-card', root);
  let sx = null;
  card.addEventListener('pointerdown', (e) => { sx = e.clientX; });
  card.addEventListener('pointerup', (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx;
    sx = null;
    if (dx > 50) prev();
    else if (dx < -50 || Math.abs(dx) < 10) next();
  });
  $('#flow-prev', root).onclick = prev;
  $('#flow-next', root).onclick = next;
  $('#flow-play', root).onclick = togglePlay;
  $('#flow-speak', root).onclick = () => { const i = current(); if (i) speak(i.term); };
  $('#flow-check', root).onclick = check;
  $('#flow-hide', root).onclick = hideCurrent;
}

function renderEmpty(msg, withAdd) {
  pause();
  $('#flow-body', root).innerHTML = `
    <div class="empty">
      <p>${msg}</p>
      ${withAdd ? '<button class="btn primary" id="flow-goadd">単語を追加する</button>' : ''}
    </div>`;
  $('#flow-goadd', root)?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('nav', { detail: 'add' })));
}

function refreshFilter() {
  const sel = $('#flow-filter', root);
  sel.innerHTML = filterOptions(settings.filter);
  sel.value = settings.filter;
  if (sel.value !== settings.filter) { saveSettings({ filter: '' }); sel.value = ''; }
}

/** 現在位置のカードを表示。無効になった語は飛ばし、最後まで行ったら次の周へ。 */
function display() {
  while (pos < queue.length && !(current() && eligible(current()))) queue.splice(pos, 1);
  if (pos >= queue.length) {
    const lapSize = queue.length;
    buildQueue();
    if (lapSize && queue.length) toast(`1周完了！（${lapSize}語）次の周へ`);
  }
  const item = current();
  if (!item) {
    const hasAny = store.active().length > 0;
    renderEmpty(hasAny
      ? '出題できる単語がありません。<br>（すべて ◎ か非表示、または絞り込み条件に合う単語がありません）'
      : 'まだ単語がありません。<br>「追加」から AI が作った単語帳を貼り付けて登録しましょう。', !hasAny);
    return;
  }
  if (!$('#flow-card', root)) body();

  const termEl = $('#flow-term', root);
  termEl.textContent = item.term;
  termEl.classList.toggle('phrase', item.kind === 'phrase');
  $('#flow-meaning', root).textContent = item.meaning;
  $('#flow-progress', root).textContent = `${pos + 1} / ${queue.length}`;
  const badges = [];
  if (item.stage === 1) {
    badges.push(Date.now() - item.checkedAt >= store.WEEK_MS
      ? '<span class="badge warn">✓ → ◎ 判定できます</span>'
      : '<span class="badge ok">✓</span>');
  }
  if (item.kind === 'phrase') badges.push('<span class="badge">フレーズ</span>');
  $('#flow-badges', root).innerHTML = badges.join('');

  item.seenCount = (item.seenCount || 0) + 1;
  store.save(item, { silent: true, touch: false });

  schedule();
}

async function schedule() {
  const my = ++tick;
  const bar = $('#flow-bar', root);
  const ms = settings.interval * 1000;
  if (bar) {
    bar.classList.remove('run');
    bar.style.width = '0';
    if (playing) {
      void bar.offsetWidth; // アニメーションをリセット
      bar.style.transitionDuration = `${ms}ms`;
      bar.classList.add('run');
      bar.style.width = '100%';
    }
  }
  const waits = [];
  if (settings.autoSpeak) waits.push(speak(current()?.term));
  if (!playing) return;
  waits.push(sleep(ms));
  await Promise.all(waits);
  if (my !== tick || !playing || !visible) return;
  pos++;
  display();
}

function next() { if (!queue.length) return; pos++; display(); }
function prev() { if (!queue.length) return; pos = Math.max(0, pos - 1); display(); }

function setPlaying(v) {
  playing = v;
  const b = $('#flow-play', root);
  if (b) b.textContent = playing ? '⏸ 停止' : '▶ 再生';
}
function pause() { setPlaying(false); tick++; stopSpeak(); const bar = $('#flow-bar', root); if (bar) { bar.classList.remove('run'); bar.style.width = '0'; } }
function togglePlay() {
  if (playing) { pause(); return; }
  setPlaying(true);
  schedule();
}

function check() {
  const item = current();
  if (!item) return;
  const now = Date.now();
  if (item.stage === 0) {
    item.stage = 1;
    item.checkedAt = now;
    toast('✓ チェック（1週間後にもう一度 ✓ で ◎）');
    store.save(item, { silent: true });
    next();
  } else if (item.stage === 1) {
    const rest = store.WEEK_MS - (now - item.checkedAt);
    if (rest <= 0) {
      item.stage = 2;
      toast('◎ チェック丸！この語は出題から外します');
      store.save(item, { silent: true });
      queue.splice(pos, 1);
      display();
    } else {
      toast(`◎ にできるのは あと${Math.ceil(rest / 86400000)}日後 です`);
      next();
    }
  }
}

function hideCurrent() {
  const item = current();
  if (!item) return;
  item.hidden = true;
  store.save(item, { silent: true });
  toast(`「${item.term}」を非表示にしました（一覧から戻せます）`);
  queue.splice(pos, 1);
  display();
}

document.addEventListener('keydown', (e) => {
  if (!visible || document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'Enter') check();
  else if (e.key.toLowerCase() === 's') { const i = current(); if (i) speak(i.term); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

export function show() {
  visible = true;
  if (!built) skeleton();
  refreshFilter();
  if (dirty) buildQueue();
  if (!$('#flow-card', root)) $('#flow-body', root).innerHTML = '';
  display();
}

export function hide() {
  visible = false;
  pause();
}
