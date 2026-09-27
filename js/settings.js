// 端末ごとの設定（localStorage）。使えない環境でも既定値で動く。
const KEY = 'wordapp.settings';

const defaults = {
  interval: 1.5,      // 流し見の表示秒数
  order: 'shuffle',   // shuffle | new | old | leastSeen
  autoSpeak: false,   // 流し見で自動読み上げ
  rate: 1,            // 読み上げ速度
  voiceURI: '',
  filter: '',         // 流し見の絞り込み（"tag:xxx" / "src:xxx"）
  theme: 'auto',      // auto | light | dark
};

function load() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
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
