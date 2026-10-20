// バージョン表示と更新チェック。
// 起動時に今動いている版を表示し、サーバー上の js/version.js と比べて新しい版があれば知らせる。
import { toast } from './ui.js';

export const VERSION = self.APP_VERSION || '不明';
const SEEN_KEY = 'wordapp-version';

/** 起動時に一度だけ呼ぶ：今の版（更新直後なら前の版も）を表示する */
export function announce() {
  let prev = null;
  try {
    prev = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, VERSION);
  } catch {}
  if (prev && prev !== VERSION) toast(`更新しました：v${prev} → v${VERSION}`, 4000);
  else toast(`v${VERSION}`, 1500);
}

/** サーバー上の最新の版。取れなければ null（オフラインなど） */
export async function latestVersion() {
  try {
    const res = await fetch('js/version.js', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] || null;
  } catch {
    return null;
  }
}

/** 新しい版を読み込み直す（SW の更新も確認してから） */
export async function reload() {
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch {}
  location.reload();
}

/**
 * サーバーと比べる。新しい版があれば再読み込みボタン付きで知らせる。
 * @param {boolean} quiet true なら最新のときやオフラインのときは何も表示しない
 * @returns {Promise<string|null>} サーバー上の版
 */
export async function check(quiet = true) {
  const latest = await latestVersion();
  if (latest && latest !== VERSION) {
    toast(`新しい版があります（v${latest}）`, 30000, { label: '再読み込み', onClick: reload });
  } else if (!quiet) {
    toast(latest ? `最新版です（v${VERSION}）` : '確認できませんでした（オフライン？）', 2500);
  }
  return latest;
}
