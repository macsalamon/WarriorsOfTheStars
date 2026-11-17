import * as THREE from 'three';

/*
 * How each ship's model has to be handled to get the pictures the game needs.
 *   file     the model in Models/ (without .glb); `cardFile` is another one for the ship-card picture; the ships of the game are in Models/converted/, made by tools/fotg-to-glb.mjs
 *   orient   turns to apply to the model so that its nose points along +Z and its top along +Y, as [axis, degrees] in order
 *            (the pictures are taken with the nose up the screen); `cardOrient` does the same for the ship-card picture
 *   prepare  paint, recolour, pose: called with the pose wanted, 'board' (the six turning pictures) or 'card' (the ship card)
 *   front    camera for the card picture: elevation and how far the ship is turned from facing the camera, in degrees
 *   centreNodes  nodes whose box gives the turning centre, when the whole model's box would put it in the wrong place
 *   exposure a lower number darkens that ship's lighting
 *   fixed    names of nodes that do not turn with the model in the six board pictures (the base of a turret gun: only the gun turns)
 */

/*
 * The ships of the game, from the models of Fate of the Galaxy (converted by tools/fotg-to-glb.mjs into Models/converted/, one file for each ship, with the markings
 * of tools/paint.mjs). The converter puts every ship in the orientation the renderer wants; only the B-wing is turned on purpose.
 */
const SURFACE = 'star_wars_death_star_surface_parts';

export const SHIPS = {
  'x-wing': { file: 'converted/x-wing' },
  'a-wing': { file: 'converted/a-wing' },
  'y-wing': { file: 'converted/y-wing' },
  'y-wing-2seat': { file: 'converted/y-wing-2seat' },
  // it flies with its cross on its side (the long spine across the way it is going, the cockpit at the right-hand end); the card shows it upright
  // (the whole cross lies on its side while the cockpit pod stays upright: the pod is turned back in the model for the board; the card is the plain model)
  'b-wing': { file: 'converted/b-wing-side', cardFile: 'converted/b-wing', orient: [['z', 90]], cardOrient: [] },
  'tie-fighter': { file: 'converted/tie-fighter' },
  'tie-interceptor': { file: 'converted/tie-interceptor' },
  // the prototype interceptor of the board game is FotG's TIE Advanced
  'tie-interceptor-prototype': { file: 'converted/tie-interceptor-prototype' },
  'tie-bomber': { file: 'converted/tie-bomber' },
  'imperial-shuttle': { file: 'converted/imperial-shuttle' },
  'stock-freighter': { file: 'converted/stock-freighter' },
  'millennium-falcon': { file: 'converted/millennium-falcon' },
  'slave-i': { file: 'converted/slave-i' },
  'pirate-pinnace': { file: 'converted/pirate-pinnace' },
  // the Star Destroyer (Rules: Star Destroyers); the board draws one picture of it, turned to its facing
  // low light from the left, so that the superstructure throws shadows on the body; the camera is lower than for the fighters (?elev=50)
  'star-destroyer': { file: 'converted/star-destroyer', shadows: true, light: { up: 0.55, right: -1.5, toward: 0.3 }, exposure: 1.0, ambient: 0.45 },
  // the R2 unit's icon (public/assets/crew/r2.png): "Star Wars - R2D2" by timblewee (CC BY 4.0); only the picture from the front is used (?m=r2d2)
  'r2d2': { file: 'star_wars_-_r2d2', prepare: (root) => droidOnly(root) },
  // the Nebulon-B frigate: lit and seen like the Star Destroyer (?m=nebulon-b&elev=50)
  'nebulon-b': { file: 'converted/nebulon-b', shadows: true, light: { up: 0.55, right: -1.5, toward: 0.3 }, exposure: 1.0, ambient: 0.45 },
  // the Mon Calamari cruiser: lit and seen like the others (?m=mon-calamari&elev=50)
  'mon-calamari': { file: 'converted/mon-calamari', shadows: true, light: { up: 0.55, right: -1.5, toward: 0.3 }, exposure: 1.0, ambient: 0.45 },
  // the asteroids of the field (Rules: Asteroid fields): rocks have no nose, the six pictures of each are six views of it
  'ast-1': { file: 'converted/ast-1' },
  'ast-2': { file: 'converted/ast-2' },
  'ast-3': { file: 'converted/ast-3' },
  'ast-4': { file: 'converted/ast-4' },
  'ast-5': { file: 'converted/ast-5' },
  'ast-6': { file: 'converted/ast-6' },
  'ast-7': { file: 'converted/ast-7' },
  'ast-8': { file: 'converted/ast-8' },
  'ast-9': { file: 'converted/ast-9' },
  // the turret guns: the barrels point up the screen at facing 0; the base stands still and the gun turns on it
  // single: "Hoth Defense Turret - Star Wars" by Quiznos323 (Sketchfab, CC BY-NC-SA 4.0); its barrel points along +Z already
  'turret-single': { file: 'hoth_defense_turret_-_star_wars', fixed: ['Base'], centreNodes: ['Base'] },
  // double: the cannon tower of "Star Wars: Death Star Surface Parts" by Daniel (Sketchfab, CC BY 4.0), one tile of the model with its plinth; the twin
  // cannon points along +X in the model. The head turns, the tower and its plinth stand still
  'turret-double': { file: SURFACE, exposure: 1.3, orient: [['y', -90]], fixed: ['CannonTowerBase_0'], centreNodes: ['CannonTowerBase_0'], prepare: (root) => only(root, ['CannonTower']) },
  // the same with one of the two cannons shot away (Rules: Ground attack): a double turret that has become a single one
  'turret-double-reduced': { file: SURFACE, exposure: 1.3, orient: [['y', -90]], fixed: ['CannonTowerBase_0'], centreNodes: ['CannonTowerBase_0'], prepare: (root) => { only(root, ['CannonTower']); dropCannon(root); } },
  // the ground target (Rules: Ground attack): the round arena-like building of the same model; it does not turn, the six pictures are one view
  'ground-target': { file: SURFACE, centreNodes: ['Cube000'], prepare: (root) => only(root, ['Cube000']) },
};

/** Takes away one of the two cannons of the cannon tower: the triangles of the cannon parts on one side of their middle (the twin cannon is one mesh). */
function dropCannon(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !/^CannonTowerCannon(Base|End)_0$/.test(o.name) || !o.geometry.index) return;
    const geometry = o.geometry;
    const position = geometry.attributes.position;
    const mid = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).z;
    const v = new THREE.Vector3();
    const worldZ = (i) => v.fromBufferAttribute(position, i).applyMatrix4(o.matrixWorld).z;
    const index = geometry.index.array;
    const kept = [];
    for (let t = 0; t < index.length; t += 3) {
      const z = (worldZ(index[t]) + worldZ(index[t + 1]) + worldZ(index[t + 2])) / 3;
      if (z >= mid) kept.push(index[t], index[t + 1], index[t + 2]);
    }
    o.geometry = geometry.clone();
    o.geometry.setIndex(kept);
  });
}

/** The turns of a ship's `orient` list as one rotation. */
export function orientation(list = []) {
  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const q = new THREE.Quaternion();
  for (const [axis, deg] of list) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axes[axis]), (deg * Math.PI) / 180));
  return q;
}

/** Shows only the named parts of the Death Star surface model (it holds eighteen pieces side by side). */
function only(root, names) {
  const top = root.getObjectByName('Root') ?? root;
  for (const child of [...top.children]) if (!names.includes(child.name)) top.remove(child);
}

/** The R2D2 model comes with a floor, walls and a few pieces lying far from the droid: only the parts of the droid itself are kept (measured from the file). */
const DROID_PARTS = ['Cube.011_1', 'Cylinder.001_3', 'Cylinder.002_4', 'Cylinder.003_5', 'Main Body_6', 'Plane.003_13', 'Wire Terminals_14', 'Head_17', 'Legs_24', 'Foot Motor Block.001_26'];
function droidOnly(root) {
  const top = root.getObjectByName('GLTF_SceneRootNode') ?? root;
  // the loader changes the names (spaces to underscores, dots dropped): compare the letters and figures only
  const plain = (n) => n.replace(/[^A-Za-z0-9]/g, '');
  const keep = DROID_PARTS.map(plain);
  for (const child of [...top.children]) if (!keep.includes(plain(child.name))) top.remove(child);
}
