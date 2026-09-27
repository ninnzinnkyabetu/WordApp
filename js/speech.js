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

/** 読み上げる。終わったら resolve（失敗・非対応でも resolve）。 */
export function speak(text, { rate } = {}) {
  return new Promise((resolve) => {
    if (!supported || !text) return resolve();
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
    speechSynthesis.speak(u);
  });
}

export function stop() { if (supported) speechSynthesis.cancel(); }
