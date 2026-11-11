// Small form-control builders shared by tool options, inspector and dialogs.
import { h } from '../utils/dom.js';

export function selectControl(label, value, options, onChange, attrs = {}) {
  const sel = h('select', { class: 'input', ...attrs, onchange: (e) => onChange(e.target.value) },
    options.map((o) => {
      const [v, text] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: v === value }, text);
    }));
  return label ? h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), sel) : sel;
}

export function rangeControl(label, value, min, max, step, onChange, fmt = (v) => v) {
  const out = h('span', { class: 'ctl-value' }, fmt(value));
  const input = h('input', {
    type: 'range', class: 'range', min, max, step, value,
    oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); onChange(v); },
  });
  return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), input, out);
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    const [v, text] = Array.isArray(o) ? o : [o, o];
    const b = h('button', {
      class: `seg${v === value ? ' active' : ''}`, type: 'button', role: 'radio', 'aria-checked': v === value ? 'true' : 'false',
      onclick: () => {
        for (const c of wrap.children) { c.classList.remove('active'); c.setAttribute('aria-checked', 'false'); }
        b.classList.add('active'); b.setAttribute('aria-checked', 'true');
        onChange(v);
      },
    }, text);
    wrap.append(b);
  }
  return wrap;
}

export function numberControl(label, value, onChange, attrs = {}) {
  const input = h('input', { type: 'number', class: 'input num', value, ...attrs, onchange: (e) => onChange(Number(e.target.value)) });
  return h('label', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), input);
}

export function checkboxControl(label, checked, onChange) {
  return h('label', { class: 'ctl check' },
    h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }),
    h('span', {}, label));
}

export function hint(text) {
  return h('span', { class: 'tool-hint' }, text);
}
