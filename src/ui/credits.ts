import { h, type Child } from './dom';

/** A link that opens in a new tab. */
const link = (href: string, text: string): HTMLElement => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

/** A heading and what the person or group made, as a block of the credits. */
const entry = (who: Child, what: Child[], extra?: Child): HTMLElement =>
  h('div', { class: 'creditentry' }, h('div', { class: 'creditwho' }, who), h('p', null, ...what), extra ?? null);

/**
 * The credits page of the menu: everyone whose work is in the game, with what they made. The same people are listed in CREDITS.md at the top of the project,
 * with the licences and the way the pictures were made: change both together.
 */
export function creditsPage(onBack: () => void): HTMLElement {
  return h('div', { class: 'subpage credits', hidden: true },
    h('h2', null, 'Credits'),

    h('div', { class: 'thanks' },
      h('h3', null, 'A special thank you to the Fate of the Galaxy team'),
      h('p', null,
        'Almost everything you see of the ships comes from ', link('https://www.fateofthegalaxy.net/', 'Fate of the Galaxy'),
        ', the Star Wars total conversion for the FreeSpace Open engine, and its team kindly allowed us to use their library of models. The pictures of the ships on the board and in the ship windows, the asteroids, the explosions, hit flashes and laser streaks, and the emblems on the pilot icons are made from their work. Without it this game would look nothing like it does. Thank you!'),
      h('p', { class: 'sub' }, 'Models and textures: Brand-X, Limbert, Dark Visor and bobbtmann (senior 3D artists); zookeeper, Axem, Galemp, Newman, Jacek, greyleader and rhettro (3D artists); Brand-X, swashmebuckle, CountBuggula, Limbert, Dark Visor and bobbtmann (2D artists); zookeeper (model conversion and rigging); chief1983 (project leader). Fate of the Galaxy is a fan project made by volunteers.'),
    ),

    h('h3', null, 'Models and pictures'),
    entry(link('https://sketchfab.com/quiznos323', 'Quiznos323'), [
      'The single turret gun: “Hoth Defense Turret - Star Wars” (CC BY-NC-SA 4.0). ',
      link('https://sketchfab.com/3d-models/hoth-defense-turret-star-wars-c675f652cce94a7b9fb143ac4d83220d', 'On Sketchfab'), '.',
    ]),
    entry(link('https://sketchfab.com/DanielAndersson', 'Daniel'), [
      'The double turret gun and the ground target: “Star Wars: Death Star Surface Parts” (CC BY 4.0). ',
      link('https://sketchfab.com/3d-models/star-wars-death-star-surface-parts-12b06ff468534281a8820e4d7f25bdd4', 'On Sketchfab'), '.',
    ]),
    entry('timblewee', [
      'The R2 unit: “Star Wars - R2D2” (CC BY 4.0). ',
      link('https://skfb.ly/oqYN9', 'On Sketchfab'), '.',
    ]),
    entry('Drawn for this game', ['The crosshair icons of the gunners, and the ring and arrow artwork of the move controls.']),

    h('h3', null, 'Sound'),
    entry(link('https://www.fateofthegalaxy.net/', 'Fate of the Galaxy'), ['The sounds of the weapons, hits, explosions and engines, and of the buttons and signals, are from the mod’s sound library, used with the team’s permission.']),

    h('h3', null, 'Software'),
    entry(link('https://vitejs.dev/', 'Vite'), ['builds and serves the page (MIT licence).']),
    entry(link('https://www.typescriptlang.org/', 'TypeScript'), ['the language the game is written in (Apache 2.0).']),
    entry(link('https://github.com/websockets/ws', 'ws'), ['the WebSocket library behind the network game (MIT).']),
    entry(link('https://threejs.org/', 'three.js'), ['renders the 3D models into the ship pictures (MIT).']),
    entry(link('https://sharp.pixelplumbing.com/', 'sharp'), ['cuts and scales the pictures (Apache 2.0).']),

    h('p', { class: 'sub' }, 'Warriors of the Stars is an unofficial, non-commercial fan project. It is not affiliated with or endorsed by Lucasfilm or Disney; Star Wars and the names of its ships and characters are trademarks of their owners. The licences and the way each picture was made are in CREDITS.md in the project.'),
    h('div', { class: 'row' }, h('button', { onclick: onBack }, 'Back')),
  );
}
