// 追加：1件追加 ／ AI が作った単語帳の貼り付け・ファイル読み込み（重複チェック付き）
import { $, $$, toast, openDialog, confirmDialog, readFile } from '../ui.js';
import { escapeHtml, parseInput, splitTags } from '../text.js';
import { classify, summarize, apply } from '../importer.js';

const root = $('#view-add');
let built = false;
let preview = null; // { rows, batchDupes, errors }

const ACTION_LABEL = { add: '追加', skip: 'スキップ', keep: '既存を残す', overwrite: '上書き', append: '意味を併記' };

function aiPrompt(target) {
  return `次の${target || '曲'}の歌詞（本文）から、英語学習者向けの単語・フレーズ帳を作ってください。
- 出力は下記の JSON だけ（説明文やコードブロック外の文章は不要）
- 熟語・句動詞・決まり文句・口語表現はフレーズとして 1 項目にまとめる
- 歌詞特有の崩れた表現（例: have to been）は、正しい形を term に、原文を note に書く
- meaning は短い日本語訳（15文字程度まで）。複数の意味は「 / 」で区切る
- 中学レベルの基本語（the, is, I など）は除く

形式:
{"source":"曲名 / アーティスト","tags":["song"],"items":[{"term":"英語","meaning":"日本語","note":""}]}

対象: ${target || '（ここに曲名・アーティスト）'}`;
}

function skeleton() {
  root.innerHTML = `
    <h2>追加</h2>

    <div class="card stack">
      <h3 style="margin-top:0">1件だけ追加</h3>
      <div class="row">
        <input id="qa-term" class="grow" placeholder="英語（例: have to be）" autocomplete="off" style="flex:1 1 180px">
        <input id="qa-meaning" class="grow" placeholder="意味" autocomplete="off" style="flex:1 1 140px">
        <button class="btn primary" id="qa-add">追加</button>
      </div>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">まとめて追加（AI の単語帳など）</h3>
      <details>
        <summary>AI に頼むときのプロンプト</summary>
        <div class="stack" style="margin-top:8px">
          <input id="ai-target" placeholder="曲名 / アーティスト（例: Let It Be / The Beatles）">
          <pre class="prompt" id="ai-prompt"></pre>
          <button class="btn" id="ai-copy">プロンプトをコピー</button>
          <p class="muted small">AI の回答をコピーして、下の欄にそのまま貼り付けてください（\`\`\`json のコードブロックが付いていても大丈夫です）。</p>
        </div>
      </details>
      <textarea id="im-text" placeholder='JSON または 1行1件「英語 | 日本語 | メモ」
例:
whisper | ささやく
have to be | 〜でなければならない | 歌詞では have to been'></textarea>
      <div class="row">
        <label class="btn">ファイルを選ぶ<input type="file" id="im-file" accept=".json,.txt,.csv,.tsv,text/plain,application/json" hidden></label>
        <span class="muted small" id="im-filename"></span>
      </div>
      <div class="row">
        <label class="field grow" style="flex:1 1 200px"><span>出典（JSON に無い場合に使用）</span><input id="im-source" placeholder="例: Let It Be / The Beatles"></label>
        <label class="field grow" style="flex:1 1 160px"><span>タグ（カンマ区切り）</span><input id="im-tags" placeholder="例: song, beatles"></label>
      </div>
      <button class="btn primary big" id="im-check">重複をチェックする</button>
    </div>

    <div id="im-preview"></div>`;

  const updatePrompt = () => { $('#ai-prompt', root).textContent = aiPrompt($('#ai-target', root).value.trim()); };
  $('#ai-target', root).addEventListener('input', updatePrompt);
  updatePrompt();
  $('#ai-copy', root).onclick = async () => {
    try { await navigator.clipboard.writeText($('#ai-prompt', root).textContent); toast('コピーしました'); }
    catch { toast('コピーできませんでした。長押しで選択してください'); }
  };

  $('#qa-add', root).onclick = quickAdd;
  $('#qa-meaning', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAdd(); });

  $('#im-file', root).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    $('#im-text', root).value = await readFile(f);
    $('#im-filename', root).textContent = f.name;
    if (!$('#im-source', root).value) $('#im-source', root).value = f.name.replace(/\.[^.]+$/, '');
    e.target.value = '';
  });
  $('#im-check', root).onclick = check;
  built = true;
}

async function quickAdd() {
  const term = $('#qa-term', root).value.trim();
  const meaning = $('#qa-meaning', root).value.trim();
  if (!term || !meaning) { toast('英語と意味を入力してください'); return; }
  const { rows } = classify([{ term, meaning, note: '', tags: [], sources: [] }]);
  const row = rows[0];
  if (row.kind === 'exact') {
    toast(`「${term}」は同じ意味で登録済みです`);
    return;
  }
  if (row.kind === 'conflict') {
    const act = await openDialog(`
      <h2>同じ英語が登録済みです</h2>
      <div class="pv-row" style="border-radius:10px">
        <div class="cmp">
          <span class="k">登録済み</span><span>${escapeHtml(row.existing.term)} — ${escapeHtml(row.existing.meaning)}</span>
          <span class="k">今回</span><span>${escapeHtml(term)} — ${escapeHtml(meaning)}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn" data-a="">キャンセル</button>
        <button class="btn" data-a="overwrite">上書き</button>
        <button class="btn primary" data-a="append">意味を併記</button>
      </div>`, (dlg, close) => {
      $$('[data-a]', dlg).forEach((b) => b.addEventListener('click', () => close(b.dataset.a)));
    });
    if (!act) return;
    row.action = act;
  }
  await apply(rows);
  toast(row.kind === 'new' ? `「${term}」を追加しました` : `「${term}」を更新しました`);
  $('#qa-term', root).value = '';
  $('#qa-meaning', root).value = '';
  $('#qa-term', root).focus();
}

function check() {
  const { entries, errors } = parseInput($('#im-text', root).value, {
    source: $('#im-source', root).value.trim(),
    tags: splitTags($('#im-tags', root).value),
  });
  if (!entries.length) {
    preview = null;
    $('#im-preview', root).innerHTML = `<div class="card" style="margin-top:16px"><p class="badge danger">取り込める単語がありません</p>${errorList(errors)}</div>`;
    return;
  }
  preview = { ...classify(entries), errors };
  renderPreview();
  $('#im-preview', root).scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function errorList(errors) {
  if (!errors.length) return '';
  return `<details style="margin-top:8px"><summary class="small">読み込めなかった行 ${errors.length} 件</summary>
    <ul class="small muted">${errors.slice(0, 50).map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></details>`;
}

function rowHtml(r, idx) {
  const e = r.entry;
  if (r.kind === 'new') {
    return `<div class="pv-row"><strong>${escapeHtml(e.term)}</strong> — ${escapeHtml(e.meaning)}
      ${e.note ? `<div class="muted small">${escapeHtml(e.note)}</div>` : ''}</div>`;
  }
  const ex = r.existing;
  const state = `${ex.hidden ? '（非表示中）' : ''}${ex.stage === 2 ? '（◎済み）' : ''}`;
  const opts = r.kind === 'exact' ? ['skip'] : ['keep', 'overwrite', 'append'];
  return `<div class="pv-row">
    <strong>${escapeHtml(e.term)}</strong>
    <div class="cmp">
      <span class="k">登録済み</span><span>${escapeHtml(ex.meaning)} <span class="muted small">${state}</span></span>
      <span class="k">今回</span><span>${escapeHtml(e.meaning)}</span>
    </div>
    ${opts.length > 1 ? `<div class="seg">${opts.map((o) =>
    `<button class="btn ${r.action === o ? 'sel' : ''}" data-row="${idx}" data-act="${o}">${ACTION_LABEL[o]}</button>`).join('')}</div>` : ''}
  </div>`;
}

function renderPreview() {
  const { rows, batchDupes, errors } = preview;
  const idx = rows.map((r, i) => [r, i]);
  const news = idx.filter(([r]) => r.kind === 'new');
  const exact = idx.filter(([r]) => r.kind === 'exact');
  const conf = idx.filter(([r]) => r.kind === 'conflict');
  const c = summarize(rows);

  $('#im-preview', root).innerHTML = `
    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">重複チェックの結果</h3>
      <div class="pv-summary">
        <span class="badge ok">新規 ${news.length}</span>
        <span class="badge">登録済み（同じ意味）${exact.length}</span>
        <span class="badge warn">登録済み（意味が違う）${conf.length}</span>
        ${batchDupes ? `<span class="badge">貼り付け内の重複 ${batchDupes}（1件にまとめました）</span>` : ''}
      </div>
      ${errorList(errors)}

      ${conf.length ? `
        <h3>意味が違う重複 ${conf.length} 件</h3>
        <div class="row small"><span class="muted">まとめて:</span>
          <button class="btn" data-all="keep">すべて既存を残す</button>
          <button class="btn" data-all="overwrite">すべて上書き</button>
          <button class="btn" data-all="append">すべて併記</button>
        </div>
        <div class="list-wrap">${conf.map(([r, i]) => rowHtml(r, i)).join('')}</div>` : ''}

      ${exact.length ? `
        <details><summary>同じ意味で登録済み（スキップ）${exact.length} 件</summary>
          <p class="muted small">出典とタグだけ既存の単語に追記します。</p>
          <div class="list-wrap">${exact.map(([r, i]) => rowHtml(r, i)).join('')}</div>
        </details>` : ''}

      ${news.length ? `
        <details ${news.length <= 30 ? 'open' : ''}><summary>新しく追加 ${news.length} 件</summary>
          <div class="list-wrap">${news.map(([r, i]) => rowHtml(r, i)).join('')}</div>
        </details>` : ''}

      <div class="row" style="justify-content:flex-end">
        <button class="btn" id="pv-cancel">やめる</button>
        <button class="btn primary big" id="pv-apply">登録する（追加 ${c.add} 件）</button>
      </div>
    </div>`;

  $$('[data-row]', root).forEach((b) => b.addEventListener('click', () => {
    rows[Number(b.dataset.row)].action = b.dataset.act;
    renderPreview();
  }));
  $$('[data-all]', root).forEach((b) => b.addEventListener('click', () => {
    rows.forEach((r) => { if (r.kind === 'conflict') r.action = b.dataset.all; });
    renderPreview();
  }));
  $('#pv-cancel', root).onclick = () => { preview = null; $('#im-preview', root).innerHTML = ''; };
  $('#pv-apply', root).onclick = commit;
}

async function commit() {
  const { rows } = preview;
  const c = summarize(rows);
  const lines = [
    `追加：${c.add} 件`,
    `スキップ（登録済み・同じ意味）：${c.skip} 件`,
    c.keep ? `既存を残す：${c.keep} 件` : '',
    c.overwrite ? `上書き：${c.overwrite} 件` : '',
    c.append ? `意味を併記：${c.append} 件` : '',
  ].filter(Boolean).join('\n');
  if (!await confirmDialog(`次の内容で登録します。よろしいですか？\n\n${lines}`, { ok: '登録する' })) return;
  await apply(rows);
  toast(`${c.add} 件を追加しました${c.overwrite + c.append ? `（${c.overwrite + c.append} 件を更新）` : ''}`);
  preview = null;
  $('#im-preview', root).innerHTML = '';
  $('#im-text', root).value = '';
  $('#im-filename', root).textContent = '';
}

export function show() {
  if (!built) skeleton();
  // 他の画面で変更があったかもしれないので、表示中のプレビューは分類し直す
  if (preview) {
    const prevActions = new Map(preview.rows.map((r) => [r.entry.key, r.action]));
    const re = classify(preview.rows.map((r) => r.entry));
    re.rows.forEach((r) => { const a = prevActions.get(r.entry.key); if (a && r.kind === 'conflict' && a !== 'add' && a !== 'skip') r.action = a; });
    preview = { ...re, batchDupes: preview.batchDupes, errors: preview.errors };
    renderPreview();
  }
}

export function hide() {}
