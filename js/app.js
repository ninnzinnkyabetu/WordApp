import * as store from './store.js';
import * as sync from './sync.js';
import { applyTheme } from './settings.js';
import { $$, toast } from './ui.js';
import * as update from './update.js';
import * as flow from './views/flow.js';
import * as quiz from './views/quiz.js';
import * as pron from './views/pron.js';
import * as list from './views/list.js';
import * as add from './views/add.js';
import * as settingsView from './views/settings.js';

const views = { flow, quiz, pron, list, add, settings: settingsView };
let current = null;

function go(name) {
  if (!views[name]) name = 'flow';
  if (current === name) return;
  if (current) views[current].hide();
  current = name;
  $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  views[name].show();
  window.scrollTo(0, 0);
}

async function main() {
  applyTheme();
  try {
    await store.init();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="empty">データベースを開けませんでした。<br>${e?.message || e}</div>`;
    return;
  }
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  window.addEventListener('nav', (e) => go(e.detail));
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  go(location.hash.slice(1) || 'flow');
  sync.init();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  update.announce();
  update.check();
  // ホーム画面のアプリは閉じずに裏から戻ることが多いので、戻ったときにも確認する
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update.check();
  });
}

window.addEventListener('unhandledrejection', (e) => toast(`エラー: ${e.reason?.message || e.reason}`, 4000));
main();
