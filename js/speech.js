// 発音（ブラウザ標準の音声合成）
import { settings } from './settings.js';

export const supported = 'speechSynthesis' in window;
let voices = [];

function loadVoices() {
  if (!supported) return;
  voices = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
}
if (supported) {
  loadVoices();
  speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function englishVoices() { loadVoices(); return voices; }

let seq = 0; // 連打したとき、古い読み上げ予約を捨てる

/** 読み上げる。終わったら resolve（失敗・非対応でも resolve）。 */
export function speak(text, { rate } = {}) {
  return new Promise((resolve) => {
    if (!supported || !text) return resolve();
    const my = ++seq;
    // Android の Chrome は、読み上げ中に cancel() して直後に speak() すると無視されることがあるので、少し待つ
    const busy = speechSynthesis.speaking || speechSynthesis.pending;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    const v = voices.find((x) => x.voiceURI === settings.voiceURI)
      || voices.find((x) => x.lang === 'en-US') || voices[0];
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = rate ?? settings.rate;
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(done, 8000);
    u.onend = done;
    u.onerror = done;
    const go = () => { if (my === seq) speechSynthesis.speak(u); else done(); };
    if (busy) setTimeout(go, 100); else go();
  });
}

export function stop() { if (supported) { seq++; speechSynthesis.cancel(); } }
