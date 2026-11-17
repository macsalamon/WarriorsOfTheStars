import { h } from './dom';
import { sound, type SoundSettings } from './sound';
import { toggleButton } from './toggle';

type VolumeKey = Exclude<keyof SoundSettings, 'muted'>;

/** The sound settings of the menu: on or off, and a volume for everything and for each group. Letting go of a slider plays a sample. */
export function soundPanel(): HTMLElement {
  const slider = (label: string, key: VolumeKey, sample: string | null): HTMLElement =>
    h('label', { class: 'volrow' },
      h('span', null, label),
      h('input', {
        type: 'range', min: '0', max: '100', value: String(Math.round(sound.settings[key] * 100)),
        oninput: (e: Event) => sound.set({ [key]: Number((e.target as HTMLInputElement).value) / 100 }),
        onchange: () => { if (sample) sound.play(sample); },
      }),
    );
  return h('div', { class: 'soundpanel' },
    toggleButton('Sound', !sound.settings.muted, (on) => sound.set({ muted: !on }), 'Switch all sound on or off'),
    slider('Volume', 'master', 'ui.commit'),
    slider('Weapons and explosions', 'effects', 'hit.hull'),
    slider('Engines', 'engines', null),
    slider('Buttons and signals', 'interface', 'ui.click'),
  );
}
