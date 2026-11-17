import { h } from './dom';

/** A button that stays pressed while its option is on, with a small light to show the state. */
export function toggleButton(label: string, initial: boolean, onChange: (on: boolean) => void, title?: string): HTMLButtonElement {
  let on = initial;
  const button = h('button', { class: 'toggle' + (on ? ' on' : ''), title, 'aria-pressed': String(on) }, h('span', { class: 'led' }), label);
  button.addEventListener('click', () => {
    on = !on;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
    onChange(on);
  });
  return button;
}
