// 端末ごとの設定（localStorage）。使えない環境でも既定値で動く。
const KEY = 'wordapp.settings';

const defaults = {
  interval: 1.5,      // 流し見の表示秒数
  order: 'shuffle',   // shuffle | new | old | leastSeen
  autoSpeak: true,    // 流し見で単語が出たら自動で発音
  rate: 1,            // 読み上げ速度
  voiceURI: '',
  filter: '',         // 流し見の絞り込み（"tag:xxx" / "src:xxx"）
  theme: 'auto',      // auto | light | dark
  quizCount: 10,      // クイズの問題数（0 = すべて）
  quizOrder: 'weak',  // weak（苦手・久しぶり優先） | shuffle
  quizFilter: '',     // クイズの出題範囲
  quizIncludeDone: false, // ◎ 済みも出題する
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // 自動発音を既定 ON にした（v2）。以前の既定 OFF のまま保存された端末も一度だけ ON にする
    if ((saved.v || 1) < 2) { delete saved.autoSpeak; saved.v = 2; }
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
