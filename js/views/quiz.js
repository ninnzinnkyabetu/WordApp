// 4択クイズ：英単語を見て、意味を4つの中から選ぶ。
// 結果は ✓/◎ とは別に quizCorrect / quizWrong / quizLastAt として記録する
// （選択肢を見れば分かる＝「一瞬で分かった」より甘いので、◎ 判定には使わない）。
// 見た回数と同じく端末内だけの記録で、クラウドへは送らない。
import * as store from '../store.js';
import { settings, saveSettings } from '../settings.js';
import { speak, stop as stopSpeak } from '../speech.js';
import { $, $$ } from '../ui.js';
import { escapeHtml, meaningParts, normalizeMeaning } from '../text.js';
import { filterOptions, matchFilter } from './common.js';
import * as fx from './quiz-fx.js';

const root = $('#view-quiz');
const CHOICES = 4;
const AUTO_NEXT_MS = 400;
const MILESTONE_NEXT_MS = 700;   // 節目の文字は次の問題の上でも消えていくので少しだけ長く
// 不正解（時間切れ含む）は自動で進めず、正解を確かめてから「次へ」で進む

let visible = false;
let phase = 'setup';  // setup | question | result
let queue = [];       // 出題する item id
let pos = 0;
let retry = false;    // 間違えた語のやり直し中（記録しない）
let q = null;         // { item, options: item[], answered: index|null }
let results = [];     // { id, ok }
let timer = 0;
let streak = 0;       // 連続正解数
let best = 0;         // この回の最高連続

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const hasMeaning = (i) => !!normalizeMeaning(i.meaning);
const go = (name) => window.dispatchEvent(new CustomEvent('nav', { detail: name }));

function eligible(i) {
  return store.isVisible(i) && hasMeaning(i)
    && (settings.quizIncludeDone || i.stage < 2)
    && matchFilter(i, settings.quizFilter);
}

/** 苦手（間違いが多い）→ 久しぶり の順。同点はランダム。 */
function weakness(i) { return (i.quizWrong || 0) - (i.quizCorrect || 0); }

function buildQueue() {
  const list = shuffle(store.all().filter(eligible));
  if (settings.quizOrder === 'weak') {
    list.sort((a, b) => weakness(b) - weakness(a) || (a.quizLastAt || 0) - (b.quizLastAt || 0));
  }
  const n = settings.quizCount > 0 ? settings.quizCount : list.length;
  return shuffle(list.slice(0, n)).map((i) => i.id);
}

/** 意味がかぶる（同じ・一部が同じ）なら true。紛らわしすぎる誤答を避ける。 */
function overlaps(a, b) {
  if (a.key === b.key || normalizeMeaning(a.meaning) === normalizeMeaning(b.meaning)) return true;
  const pa = meaningParts(a.meaning);
  return meaningParts(b.meaning).some((p) => pa.includes(p));
}

/** 誤答を選ぶ。同じ種類（単語/フレーズ）を優先し、同じタグ・出典の語を少し混ぜる。 */
function distractors(item) {
  const near = [], same = [], other = [];
  const labels = new Set([...item.tags, ...item.sources]);
  for (const c of shuffle(store.active())) {
    if (c.id === item.id || !hasMeaning(c)) continue;
    if (c.kind !== item.kind) other.push(c);
    else if ([...c.tags, ...c.sources].some((t) => labels.has(t))) near.push(c);
    else same.push(c);
  }
  const picked = [];
  for (const c of [...near.slice(0, 2), ...same, ...near.slice(2), ...other]) {
    if (picked.length >= CHOICES - 1) break;
    if (overlaps(c, item) || picked.some((p) => overlaps(c, p))) continue;
    picked.push(c);
  }
  return picked;
}

function current() { return store.items.get(queue[pos]); }

// ---------- 開始画面 ----------
function renderSetup() {
  phase = 'setup';
  const enough = store.active().filter(hasMeaning).length >= CHOICES;
  const count = store.all().filter(eligible).length;
  const seg = (name, value, label) =>
    `<button class="btn ${settings[name] === value ? 'sel' : ''}" data-set="${name}" data-v="${value}">${label}</button>`;
  root.innerHTML = `
    <h2>4択クイズ</h2>
    <div class="card stack">
      <label class="field"><span>出題範囲</span>
        <select id="qz-filter">${filterOptions(settings.quizFilter)}</select></label>
      <div><span class="muted small">問題数</span>
        <div class="seg">${seg('quizCount', 10, '10問')}${seg('quizCount', 20, '20問')}${seg('quizCount', 0, 'すべて')}</div></div>
      <div><span class="muted small">出す順</span>
        <div class="seg">${seg('quizOrder', 'weak', '苦手・久しぶり優先')}${seg('quizOrder', 'shuffle', 'ランダム')}</div></div>
      <div><span class="muted small">制限時間（1問）</span>
        <div class="seg">${seg('quizLimit', 0, 'なし')}${seg('quizLimit', 3, '3秒')}${seg('quizLimit', 5, '5秒')}${seg('quizLimit', 8, '8秒')}</div></div>
      <label class="row small"><input type="checkbox" id="qz-done" ${settings.quizIncludeDone ? 'checked' : ''}> ◎ 済みの単語も出す</label>
      <label class="row small"><input type="checkbox" id="qz-sound" ${settings.quizSound ? 'checked' : ''}> 効果音</label>
      <p class="muted small" style="margin:0">対象 ${count} 語</p>
      <button class="btn big primary" id="qz-start" style="width:100%" ${enough && count ? '' : 'disabled'}>スタート</button>
      ${enough ? '' : '<p class="muted small" style="margin:0">クイズには意味のある単語が4語以上必要です。</p>'}
    </div>
    ${enough ? '' : '<p style="text-align:center"><button class="btn" id="qz-goadd">単語を追加する</button></p>'}`;

  const sel = $('#qz-filter', root);
  if (sel.value !== settings.quizFilter) saveSettings({ quizFilter: '' });
  sel.addEventListener('change', (e) => { saveSettings({ quizFilter: e.target.value }); renderSetup(); });
  $$('[data-set]', root).forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.set === 'quizOrder' ? b.dataset.v : Number(b.dataset.v);
    saveSettings({ [b.dataset.set]: v });
    renderSetup();
  }));
  $('#qz-done', root).addEventListener('change', (e) => { saveSettings({ quizIncludeDone: e.target.checked }); renderSetup(); });
  $('#qz-sound', root).addEventListener('change', (e) => saveSettings({ quizSound: e.target.checked }));
  $('#qz-start', root).addEventListener('click', () => start(buildQueue(), false));
  $('#qz-goadd', root)?.addEventListener('click', () => go('add'));
}

function start(ids, isRetry) {
  queue = ids;
  pos = 0;
  retry = isRetry;
  results = [];
  streak = 0;
  best = 0;
  phase = 'question';
  renderQuestion();
}

// ---------- 問題 ----------
function renderQuestion() {
  clearTimeout(timer);
  // 途中で削除・非表示にされた語は飛ばす
  while (pos < queue.length && !(current() && store.isActive(current()) && hasMeaning(current()))) queue.splice(pos, 1);
  if (pos >= queue.length) { renderResult(); return; }

  const item = current();
  const options = shuffle([item, ...distractors(item)]);
  q = { item, options, answered: null };

  root.innerHTML = `
    <div class="row between">
      <button class="btn small" id="qz-quit">やめる</button>
      <span class="quiz-streak" id="qz-streak"></span>
      <span class="muted small">${retry ? 'やり直し ' : ''}${pos + 1} / ${queue.length}</span>
    </div>
    <div class="card quiz-card" id="qz-card" style="margin-top:12px">
      <div class="flow-term ${item.kind === 'phrase' ? 'phrase' : ''}">${escapeHtml(item.term)}</div>
      <button class="btn icon" id="qz-speak" aria-label="発音" style="margin-top:8px">🔊</button>
      ${settings.quizLimit > 0 ? '<div class="quiz-limit" id="qz-limit"></div>' : ''}
    </div>
    <div class="quiz-opts">
      ${options.map((o, n) => `
        <button class="btn quiz-opt" data-n="${n}"><span class="quiz-no">${n + 1}</span><span>${escapeHtml(o.meaning)}</span></button>`).join('')}
    </div>
    <div id="qz-after"></div>`;

  $('#qz-quit', root).addEventListener('click', () => (results.length ? renderResult() : renderSetup()));
  $('#qz-speak', root).addEventListener('click', () => speak(item.term));
  $$('.quiz-opt', root).forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.n))));
  renderStreak(false);
  if (settings.autoSpeak) speak(item.term);
  startLimit();
}

/** 制限時間。バーを縮めていき、0 になったら時間切れ（不正解扱い） */
function startLimit() {
  const bar = $('#qz-limit', root);
  if (!bar) return;
  const ms = settings.quizLimit * 1000;
  bar.style.animationDuration = `${ms}ms`;
  timer = setTimeout(() => answer(-1), ms);
}

/** 連続数のバッジとカードの光り方。bump = 増えた瞬間に弾ませる */
function renderStreak(bump) {
  const el = $('#qz-streak', root);
  const t = fx.tier(streak);
  $('#qz-card', root)?.classList.remove('t1', 't2', 't3', 't4');
  if (t) $('#qz-card', root)?.classList.add(`t${t}`);
  if (!el) return;
  el.className = `quiz-streak t${t}`;
  el.textContent = streak >= 2 ? `🔥 ${streak}連続` : '';
  if (bump && streak >= 2) { void el.offsetWidth; el.classList.add('bump'); }
}

/** n = 選んだ番号。-1 は時間切れ */
function answer(n) {
  if (!q || q.answered !== null || (n !== -1 && !q.options[n])) return;
  clearTimeout(timer);
  q.answered = n;
  const { item } = q;
  const ok = q.options[n] === item;
  const limitBar = $('#qz-limit', root);
  if (limitBar) limitBar.style.animationPlayState = 'paused';
  results.push({ id: item.id, ok });

  if (!retry) {
    if (ok) item.quizCorrect = (item.quizCorrect || 0) + 1;
    else item.quizWrong = (item.quizWrong || 0) + 1;
    item.quizLastAt = Date.now();
    store.save(item, { silent: true, touch: false });
  }

  $$('.quiz-opt', root).forEach((b, i) => {
    b.disabled = true;
    if (q.options[i] === item) b.classList.add('correct');
    else if (i === n) b.classList.add('wrong');
  });

  if (ok) {
    streak++;
    best = Math.max(best, streak);
    fx.soundCorrect(streak);
    renderStreak(true);
    timer = setTimeout(next, fx.celebrate(streak) ? MILESTONE_NEXT_MS : AUTO_NEXT_MS);
    return;
  }
  fx.soundWrong();
  fx.broken(streak);
  streak = 0;
  renderStreak(false);
  $('#qz-after', root).innerHTML = `
    ${n === -1 ? '<p class="quiz-timeup">⏱ 時間切れ</p>' : ''}
    ${item.note ? `<p class="muted small">${escapeHtml(item.note)}</p>` : ''}
    <button class="btn big primary quiz-next" id="qz-next">次へ</button>`;
  $('#qz-next', root).addEventListener('click', next);
}

function next() {
  if (phase !== 'question' || !q || q.answered === null) return;
  pos++;
  renderQuestion();
}

// ---------- 結果 ----------
function renderResult() {
  clearTimeout(timer);
  stopSpeak();
  phase = 'result';
  q = null;
  if (results.length && results.every((r) => r.ok) && results.length >= 5) fx.perfect();
  const correct = results.filter((r) => r.ok).length;
  const wrong = results.filter((r) => !r.ok).map((r) => store.items.get(r.id)).filter(Boolean);
  root.innerHTML = `
    <h2>結果${retry ? '（やり直し）' : ''}</h2>
    <div class="card" style="text-align:center">
      <div class="quiz-score">${correct} / ${results.length}</div>
      <p class="muted small" style="margin:4px 0 0">${results.length && correct === results.length ? '全問正解！' : '正解'}</p>
      ${best >= 3 ? `<p style="margin:8px 0 0"><span class="quiz-streak t${fx.tier(best)}">🔥 最高 ${best}連続</span></p>` : ''}
    </div>
    ${wrong.length ? `
      <h3>間違えた単語</h3>
      <div class="list-wrap"><ul class="list">
        ${wrong.map((i) => `<li data-id="${i.id}"><div class="grow"><div class="t">${escapeHtml(i.term)}</div><div class="m">${escapeHtml(i.meaning)}</div></div><span class="badge">🔊</span></li>`).join('')}
      </ul></div>` : ''}
    <div class="stack" style="margin-top:16px">
      ${wrong.length ? '<button class="btn big primary" id="qz-retry" style="width:100%">間違えた単語だけもう一度</button>' : ''}
      <button class="btn big ${wrong.length ? '' : 'primary'}" id="qz-again" style="width:100%">新しく始める</button>
    </div>
    ${wrong.length ? '<p class="muted small" style="text-align:center">やり直しの結果は記録しません</p>' : ''}`;

  $$('.list li', root).forEach((li) => li.addEventListener('click', () => speak(store.items.get(li.dataset.id)?.term)));
  $('#qz-retry', root)?.addEventListener('click', () => start(shuffle(wrong.map((i) => i.id)), true));
  $('#qz-again', root).addEventListener('click', renderSetup);
}

document.addEventListener('keydown', (e) => {
  if (!visible || phase !== 'question' || document.querySelector('dialog[open]')
    || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (/^[1-9]$/.test(e.key)) answer(Number(e.key) - 1);
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
  else if (e.key.toLowerCase() === 's' && q) speak(q.item.term);
});

export function show() {
  visible = true;
  if (phase === 'setup') renderSetup();
  else if (phase === 'question') resume();
}

/** 画面を離れて戻ったとき。回答後なら次へ、回答前なら制限時間をやり直す */
function resume() {
  if (!q) return;
  if (q.answered !== null) next();
  else renderQuestion();
}

// アプリを裏に回している間に時間切れにならないよう止める
document.addEventListener('visibilitychange', () => {
  if (!visible || phase !== 'question') return;
  if (document.hidden) { clearTimeout(timer); stopSpeak(); } else resume();
});

export function hide() {
  visible = false;
  clearTimeout(timer);
  stopSpeak();
}
