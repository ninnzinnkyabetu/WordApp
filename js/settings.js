// 端末ごとの設定（localStorage）。使えない環境でも既定値で動く。
const KEY = 'wordapp.settings';

const defaults = {
  interval: 1.5,      // 流し見の表示秒数
  order: 'shuffle',   // shuffle | new | old | leastSeen
  autoSpeak: true,    // 流し見で単語が出たら自動で発音
  rate: 1,            // 読み上げ速度
  voiceURI: '',
  flowScope: { src: '', tags: [], all: false }, // 流し見の絞り込み（出典 1 つ・タグ複数）
  theme: 'auto',      // auto | light | dark
  quizCount: 10,      // クイズの問題数（0 = すべて）
  quizOrder: 'weak',  // weak（苦手・久しぶり優先） | shuffle
  quizScope: { src: '', tags: [], all: false }, // クイズの出題範囲
  quizIncludeDone: false, // ◎ 済みも出題する
  quizSound: true,    // クイズの効果音
  quizLimit: 3,       // クイズ 1 問の制限時間（秒、0 = なし）
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // 自動発音を既定 ON にした（v2）。以前の既定 OFF のまま保存された端末も一度だけ ON にする
    if ((saved.v || 1) < 2) { delete saved.autoSpeak; saved.v = 2; }
    // クイズの制限時間の既定を 5 秒 → 3 秒にした（v3）。前の既定の 5 秒のままの端末も 3 秒にする
    if (saved.v < 3) { if (saved.quizLimit === 5) delete saved.quizLimit; saved.v = 3; }
    // 絞り込みを「タグ 1 つ or 出典 1 つ」の文字列から、タグ複数を選べる形にした（v4）
    if (saved.v < 4) {
      const conv = (f = '') => ({ src: f.startsWith('src:') ? f.slice(4) : '', tags: f.startsWith('tag:') ? [f.slice(4)] : [], all: false });
      if (saved.filter) saved.flowScope = conv(saved.filter);
      if (saved.quizFilter) saved.quizScope = conv(saved.quizFilter);
      delete saved.filter; delete saved.quizFilter; saved.v = 4;
    }
    return { ...defaults, ...saved };
  }
  catch { return { ...defaults }; }
}

export const settings = load();

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 保存できなくても動作は続ける */ }
}

export function applyTheme() {
  const t = settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
