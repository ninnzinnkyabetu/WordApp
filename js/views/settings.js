// 設定：流し見・読み上げ・表示・バックアップ
import * as store from '../store.js';
import { settings, saveSettings, applyTheme } from '../settings.js';
import { englishVoices, speak, supported } from '../speech.js';
import { $, toast, download, readFile, confirmDialog } from '../ui.js';
import { escapeHtml } from '../text.js';
import * as sync from '../sync.js';
import * as update from '../update.js';

const root = $('#view-settings');

function stats() {
  const alive = store.all().filter(store.isActive);
  const c = (fn) => alive.filter(fn).length;
  return {
    total: alive.length,
    s0: c((i) => !i.hidden && i.stage === 0),
    s1: c((i) => !i.hidden && i.stage === 1),
    s2: c((i) => !i.hidden && i.stage === 2),
    hidden: c((i) => i.hidden),
    phrase: c((i) => i.kind === 'phrase'),
  };
}

function statsHtml(s) {
  return `登録 <strong>${s.total}</strong> 語（うちフレーズ ${s.phrase}）<br>
    未チェック ${s.s0} ／ ✓ ${s.s1} ／ ◎ ${s.s2} ／ 非表示 ${s.hidden}`;
}

function render() {
  const s = stats();
  const voices = englishVoices();
  root.innerHTML = `
    <h2>設定</h2>

    <div class="card stack">
      <h3 style="margin-top:0">流し見</h3>
      <label class="field"><span>1語の表示時間：<strong id="st-int-v">${settings.interval}</strong> 秒</span>
        <input type="range" id="st-int" min="0.5" max="5" step="0.25" value="${settings.interval}" style="width:100%">
      </label>
      <label class="field"><span>出す順番</span>
        <select id="st-order">
          <option value="shuffle">シャッフル</option>
          <option value="new">新しく登録した順</option>
          <option value="old">古い順</option>
          <option value="leastSeen">見た回数が少ない順</option>
        </select>
      </label>
      <label class="row"><input type="checkbox" id="st-auto" ${settings.autoSpeak ? 'checked' : ''}> 流し見で自動的に発音する</label>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">発音</h3>
      ${supported ? '' : '<p class="badge danger">このブラウザは読み上げに対応していません</p>'}
      <label class="field"><span>声</span>
        <select id="st-voice">
          <option value="">自動（英語・米国）</option>
          ${voices.map((v) => `<option value="${escapeHtml(v.voiceURI)}">${escapeHtml(v.name)}（${escapeHtml(v.lang)}）</option>`).join('')}
        </select>
      </label>
      <label class="field"><span>速さ：<strong id="st-rate-v">${settings.rate}</strong></span>
        <input type="range" id="st-rate" min="0.5" max="1.5" step="0.1" value="${settings.rate}" style="width:100%">
      </label>
      <button class="btn" id="st-test">🔊 試しに再生（have to be）</button>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">表示</h3>
      <label class="field"><span>テーマ</span>
        <select id="st-theme">
          <option value="auto">端末に合わせる</option>
          <option value="light">ライト</option>
          <option value="dark">ダーク</option>
        </select>
      </label>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">データ</h3>
      <p class="small" id="st-stats">${statsHtml(s)}</p>
      <div class="row">
        <button class="btn" id="st-export">バックアップを保存（JSON）</button>
        <label class="btn">バックアップから復元<input type="file" id="st-restore" accept=".json,application/json" hidden></label>
      </div>
      <p class="muted small">復元では、今のデータと合わせ、同じ単語は新しく更新された方が残ります。</p>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">同期（スマホ・PC）</h3>
      <div id="st-sync"></div>
    </div>

    <div class="card stack" style="margin-top:16px">
      <h3 style="margin-top:0">バージョン</h3>
      <p class="small">いま動いている版：<strong>v${escapeHtml(update.VERSION)}</strong></p>
      <div class="row">
        <button class="btn" id="st-update-check">更新を確認</button>
        <button class="btn" id="st-update-reload">再読み込み</button>
      </div>
    </div>`;
  renderSync();

  $('#st-order', root).value = settings.order;
  $('#st-voice', root).value = settings.voiceURI;
  $('#st-theme', root).value = settings.theme;

  $('#st-int', root).oninput = (e) => { saveSettings({ interval: Number(e.target.value) }); $('#st-int-v', root).textContent = settings.interval; };
  $('#st-order', root).onchange = (e) => { saveSettings({ order: e.target.value }); window.dispatchEvent(new Event('queue-reset')); };
  $('#st-auto', root).onchange = (e) => saveSettings({ autoSpeak: e.target.checked });
  $('#st-voice', root).onchange = (e) => saveSettings({ voiceURI: e.target.value });
  $('#st-rate', root).oninput = (e) => { saveSettings({ rate: Number(e.target.value) }); $('#st-rate-v', root).textContent = settings.rate; };
  $('#st-test', root).onclick = () => speak('have to be');
  $('#st-theme', root).onchange = (e) => { saveSettings({ theme: e.target.value }); applyTheme(); };

  $('#st-update-check', root).onclick = () => update.check(false);
  $('#st-update-reload', root).onclick = () => update.reload();

  $('#st-export', root).onclick = () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    download(`wordapp-backup-${stamp}.json`, JSON.stringify(store.exportData(), null, 1));
  };
  $('#st-restore', root).onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await readFile(f));
      const n = Array.isArray(data?.items) ? data.items.length : 0;
      if (!await confirmDialog(`「${escapeHtml(f.name)}」（${n} 件）を復元しますか？\n今のデータと合わせ、同じ単語は新しく更新された方を残します。`, { ok: '復元する' })) return;
      const changed = await store.restore(data);
      toast(`${changed} 件を復元しました`);
      render();
    } catch (err) {
      toast(`復元できませんでした: ${err.message}`, 4000);
    }
  };
}

const SYNC_STATE = { off: '未ログイン', idle: '同期済み', syncing: '同期中…', error: 'エラー', offline: '利用できません' };

function renderSync() {
  const el = $('#st-sync', root);
  if (!el) return;
  const s = sync.status;
  const when = s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : '—';
  el.innerHTML = s.user
    ? `
      <p class="small">ログイン中：<strong>${escapeHtml(s.user.email)}</strong><br>
        状態：${SYNC_STATE[s.state] || s.state} ／ 最終同期 ${when} ／ 未送信 ${s.pending} 件</p>
      ${s.error ? `<p class="small" style="color:var(--danger)">${escapeHtml(s.error)}</p>` : ''}
      <div class="row">
        <button class="btn primary" id="st-sync-now" ${s.state === 'syncing' ? 'disabled' : ''}>今すぐ同期</button>
        <button class="btn" id="st-signout">ログアウト</button>
      </div>`
    : `
      <p class="small muted">Google でログインすると、同じアカウントでログインした端末どうしで単語が自動で同期されます。${s.pending ? `（未送信 ${s.pending} 件）` : ''}</p>
      ${s.error ? `<p class="small" style="color:var(--danger)">${escapeHtml(s.error)}</p>` : ''}
      <button class="btn primary" id="st-signin" ${s.state === 'offline' ? 'disabled' : ''}>Google でログイン</button>`;

  $('#st-sync-now', el)?.addEventListener('click', () => sync.sync());
  $('#st-signout', el)?.addEventListener('click', async () => {
    if (!await confirmDialog('ログアウトしますか？\nこの端末の単語は残ります。')) return;
    await sync.signOut();
  });
  $('#st-signin', el)?.addEventListener('click', async () => {
    try { await sync.signIn(); }
    catch (e) {
      if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
      toast(`ログインできませんでした: ${e?.code || e?.message || e}`, 5000);
    }
  });
}

sync.onStatus(() => {
  renderSync();
  if (!root.hidden && sync.status.state === 'idle') {
    // 受信で件数が変わった可能性があるので、データ欄の数字も更新する
    const s = stats();
    const p = root.querySelector('#st-stats');
    if (p) p.innerHTML = statsHtml(s);
  }
});

export function show() { render(); }
export function hide() {}
