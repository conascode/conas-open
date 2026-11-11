// Modal dialogs and toast notifications.
import { h, icon, refreshIcons } from '../utils/dom.js';

export class UI {
  constructor(root) {
    this.root = root;
    this.toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(this.toastHost);
  }

  // Generic modal. buttons: [{ label, value, kind }]. Resolves with the clicked value (or null on Esc).
  modal({ title, body, buttons = [{ label: 'OK', value: true, kind: 'primary' }], width = 460, iconName = null, tone = '' }) {
    return new Promise((resolve) => {
      const close = (v) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(null); }
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'SELECT') {
          const primary = buttons.find((b) => b.kind === 'primary');
          if (primary) { e.preventDefault(); e.stopPropagation(); close(primary.value); }
        }
      };
      const dialog = h('div', { class: `dialog ${tone}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `${width}px` } },
        h('div', { class: 'dialog-head' }, iconName ? icon(iconName) : null, h('h2', {}, title),
          h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(null) }, icon('x'))),
        h('div', { class: 'dialog-body' }, body),
        h('div', { class: 'dialog-foot' }, buttons.map((b) => h('button', {
          class: `btn ${b.kind || ''}`, onclick: () => close(typeof b.value === 'function' ? b.value() : b.value),
        }, b.label))));
      const backdrop = h('div', { class: 'backdrop', onmousedown: (e) => { if (e.target === backdrop) close(null); } }, dialog);
      document.body.append(backdrop);
      document.addEventListener('keydown', onKey, true);
      refreshIcons(dialog);
      setTimeout(() => (dialog.querySelector('input, select, textarea') || dialog.querySelector('.btn.primary'))?.focus(), 0);
    });
  }

  async confirm(title, message, okLabel = 'OK', danger = true) {
    const v = await this.modal({
      title, body: h('p', {}, message), iconName: 'alert-triangle', tone: danger ? 'warn' : '',
      buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger primary' : 'primary' }],
    });
    return v === true;
  }

  async prompt(title, label, value = '') {
    const input = h('input', { class: 'input', value, 'aria-label': label });
    const v = await this.modal({
      title, body: h('label', { class: 'field' }, h('span', {}, label), input),
      buttons: [{ label: 'Cancel', value: null }, { label: 'OK', value: () => input.value.trim(), kind: 'primary' }],
    });
    return v === null || v === undefined || v === '' ? null : v;
  }

  errors(title, lines) {
    return this.modal({
      title, iconName: 'octagon-alert', tone: 'error',
      body: h('ul', { class: 'msg-list error' }, lines.map((l) => h('li', {}, l))),
      buttons: [{ label: 'Close', value: true, kind: 'primary' }], width: 560,
    });
  }

  warnings(title, lines) {
    return this.modal({
      title, iconName: 'alert-triangle', tone: 'warn',
      body: h('ul', { class: 'msg-list warn' }, lines.slice(0, 40).map((l) => h('li', {}, l)), lines.length > 40 ? h('li', {}, `…and ${lines.length - 40} more`) : null),
      buttons: [{ label: 'OK', value: true, kind: 'primary' }], width: 560,
    });
  }

  pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, style: { display: 'none' } });
      input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); });
      document.body.append(input);
      input.click();
    });
  }

  toast(message, kind = 'info') {
    const icons = { info: 'info', success: 'circle-check', warning: 'alert-triangle', error: 'octagon-alert' };
    const t = h('div', { class: `toast ${kind}` }, icon(icons[kind] || 'info'), h('span', {}, message));
    this.toastHost.append(t);
    refreshIcons(t);
    while (this.toastHost.children.length > 4) this.toastHost.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'error' ? 6000 : 2600);
  }
}
