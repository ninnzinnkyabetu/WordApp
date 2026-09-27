// 発音チェック：まだ発音を確認していない語を順に読み上げる。
// 動画の「発音が分からないまま回しても意味がない。最初に必ず一通り聞く」に対応。
import * as store from '../store.js';
import { speak, supported } from '../speech.js';
import { $, toast, confirmDialog } from '../ui.js';
import { escapeHtml } from '../text.js';

const root = $('#view-pron');
let queue = [];
let pos = 0;

function pending() {
  return store.all()
    .filter((i) => store.isVisible(i) && !i.pronChecked)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function render() {
  queue = queue.filter((id) => { const i = store.items.get(id); return i && store.isVisible(i) && !i.pronChecked; });
  if (pos >= queue.length) pos = 0;
  const item = store.items.get(queue[pos]);

  const warn = supported ? '' : '<p class="badge danger">このブラウザは読み上げに対応していません</p>';
  if (!item) {
    root.innerHTML = `<h2>発音チェック</h2>${warn}<div class="empty"><p>未確認の単語はありません 🎉</p></div>`;
    return;
  }
  root.innerHTML = `
    <div class="row between"><h2>発音チェック</h2><span class="muted small">残り ${queue.length} 語</span></div>
    ${warn}
    <p class="muted small">流し見の前に、発音を一通り聞いておきましょう。</p>
    <div class="card flow-card" id="pron-card" style="min-height:34vh">
      <div class="flow-term ${item.kind === 'phrase' ? 'phrase' : ''}">${escapeHtml(item.term)}</div>
      <div class="flow-meaning">${escapeHtml(item.meaning)}</div>
    </div>
    <div class="flow-controls" style="grid-template-columns:1fr 1fr">
      <button class="btn big" id="pron-play">🔊 もう一度</button>
      <button class="btn big" id="pron-slow">🐢 ゆっくり</button>
    </div>
    <div class="flow-actions" style="grid-template-columns:2fr 1fr">
      <button class="btn big ok" id="pron-ok">✓ 確認した・次へ</button>
      <button class="btn big" id="pron-skip">あとで</button>
    </div>
    <p style="text-align:center;margin-top:16px"><button class="btn small" id="pron-all">残り ${queue.length} 語をすべて確認済みにする</button></p>`;

  $('#pron-card', root).onclick = () => speak(item.term);
  $('#pron-play', root).onclick = () => speak(item.term);
  $('#pron-slow', root).onclick = () => speak(item.term, { rate: 0.6 });
  $('#pron-ok', root).onclick = async () => {
    item.pronChecked = true;
    await store.save(item, { silent: true });
    render();
    autoPlay();
  };
  $('#pron-skip', root).onclick = () => { pos = (pos + 1) % queue.length; render(); autoPlay(); };
  $('#pron-all', root).onclick = async () => {
    if (!await confirmDialog(`残り ${queue.length} 語をすべて「発音確認済み」にしますか？`)) return;
    const list = queue.map((id) => store.items.get(id));
    list.forEach((i) => { i.pronChecked = true; });
    await store.save(list, { silent: true });
    toast(`${list.length} 語を確認済みにしました`);
    render();
  };
}

function autoPlay() {
  const item = store.items.get(queue[pos]);
  if (item) speak(item.term);
}

export function show() {
  queue = pending().map((i) => i.id);
  pos = 0;
  render();
  autoPlay();
}

export function hide() {}
