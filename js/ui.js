// ダイアログ・トースト・小さなDOMヘルパー
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
/** action = { label, onClick } を渡すと、トーストにボタンを付ける */
export function toast(msg, ms = 2000, action) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.classList.remove('show'); action.onClick(); };
    el.append(b);
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/**
 * ダイアログを開く。build(dlg, close) で中身を組み立て、close(value) で閉じる。
 * @returns {Promise<any>} close に渡した値（Esc で閉じたら undefined）
 */
export function openDialog(html, build) {
  // 確認ダイアログを重ねられるよう、毎回新しい <dialog> を作る
  const dlg = document.createElement('dialog');
  dlg.innerHTML = html;
  document.body.append(dlg);
  return new Promise((resolve) => {
    let value;
    const close = (v) => { value = v; dlg.close(); };
    dlg.addEventListener('close', () => { dlg.remove(); resolve(value); }, { once: true });
    build?.(dlg, close);
    dlg.showModal();
  });
}

export async function confirmDialog(message, { ok = 'OK', cancel = 'キャンセル', danger = false } = {}) {
  const r = await openDialog(`
    <div style="white-space:pre-wrap">${message}</div>
    <div class="actions">
      <button class="btn" data-v="0">${cancel}</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${ok}</button>
    </div>`, (dlg, close) => {
    dlg.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => close(b.dataset.v === '1')));
  });
  return r === true;
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
