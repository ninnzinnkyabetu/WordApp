// クイズの連続正解の演出（バッジ・大きな文字・紙吹雪・効果音）。
// 連続数が増えるほど段階的に派手にする。「動きを減らす」設定の端末では紙吹雪と動きを出さない。
import { settings } from '../settings.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 連続数 → 段階（0〜4）。色や光り方を変える */
export function tier(n) {
  return n >= 20 ? 4 : n >= 10 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0;
}

/** 節目なら大きく出す文字を返す */
export function milestone(n) {
  return {
    3: '3連続！',
    5: '5連続！いい調子',
    10: '10連続！すごい！',
    15: '15連続！止まらない！',
    20: '20連続！神がかってる！',
  }[n] || (n > 20 && n % 10 === 0 ? `${n}連続！伝説級！` : '');
}

/** 節目の演出。紙吹雪は 5 連続から、段階が上がるほど量を増やす */
export function celebrate(n) {
  const text = milestone(n);
  if (!text) return false;
  burst(text, `t${tier(n)}`);
  if (n >= 5) confetti(n >= 20 ? 90 : n >= 10 ? 60 : 28);
  return true;
}

/** 全問正解（5 問以上）の結果画面 */
export function perfect() {
  burst('全問正解！', 't4');
  confetti(90);
}

/** 連続が途切れたときの表示（3 連続以上のときだけ） */
export function broken(n) {
  if (n >= 3) burst(`${n}連続でストップ`, 'stop');
}

function burst(text, cls) {
  document.querySelector('.quiz-burst')?.remove();
  const el = document.createElement('div');
  el.className = `quiz-burst ${cls}`;
  el.textContent = text;
  el.setAttribute('aria-live', 'polite');
  document.body.append(el);
  setTimeout(() => el.remove(), 1400);
}

const COLORS = ['#1f6feb', '#3fb950', '#e3a008', '#f85149', '#a371f7', '#ff7eb6'];

function confetti(count) {
  if (reduceMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const dx = (Math.random() - 0.5) * 60;           // 横に流れる量（vw）
    p.style.left = `${20 + Math.random() * 60}vw`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty('--dx', `${dx}vw`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 1440}deg`);
    p.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    if (i % 3 === 0) p.style.borderRadius = '50%';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3000);
}

// ---------- 効果音（Web Audio。ファイル不要） ----------
let ctx;
function audio() {
  if (!settings.quizSound) return null;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

function tone(ac, freq, start, dur, type = 'sine', vol = 0.18) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ac.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.02);
}

/** 正解音。連続数が増えるほど音程が上がる（12 連続で 1 オクターブ上まで） */
export function soundCorrect(n) {
  const ac = audio();
  if (!ac) return;
  const base = 660 * 2 ** (Math.min(n - 1, 12) / 12);
  tone(ac, base, 0, 0.12);
  tone(ac, base * 1.5, 0.08, 0.18);
  if (milestone(n)) tone(ac, base * 2, 0.18, 0.3, 'triangle', 0.14);
}

export function soundWrong() {
  const ac = audio();
  if (!ac) return;
  tone(ac, 220, 0, 0.18, 'triangle', 0.15);
  tone(ac, 185, 0.12, 0.25, 'triangle', 0.15);
}
