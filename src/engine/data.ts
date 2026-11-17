import shipsFile from '../../data/ships.json';
import tablesFile from '../../data/tables.json';

export interface DifficultyNumbers {
  stabilizer: number;
  halfLoop: number;
  slip: number;
  roll: number;
  jink: number;
  bank: number;
  overturn: number;
  overspeed: number;
  accelerate: number;
  overaccelerate: number;
  decelerate: number;
  overdecelerate: number;
  damageControl: number;
  pinpointFire: number;
  snapFire: number;
  targeting: number;
  angleDeflectors: number | null;
}

export interface ShipType {
  name: string;
  side: 'rebel' | 'empire' | 'neutral';
  pilotGuns: string[];
  gunnerWeapons: string[];
  otherWeapons: string[];
  /** [Standard, Advanced] */
  body: [number, number];
  speedMax: number;
  /** One "std/adv" string per speed 1..speedMax+2; parentheses mean overspeed only. */
  turn: string[];
  difficulty: DifficultyNumbers;
  shields: number | null;
  /** Where the shield markers start with the advanced arcs, for the ships with a body rating of 10 or more (Rules: Advanced arcs). */
  shieldsAdvancedArcs?: Record<'front' | 'rear' | 'left' | 'right', number>;
  auxPower: number | null;
  r2: boolean;
  verify?: boolean;
}

export type FireQuarter = 'front' | 'rear' | 'portStarboard';
/** A box of the Deflector Shields section: where a shield marker is angled (left and right only with the advanced arcs, see Rules: Advanced arcs). */
export type ShieldBox = 'front' | 'rear' | 'left' | 'right';

export interface GunneryValuesRow {
  std: boolean;
  toHit: (number | null)[];
  verify?: boolean;
}

export interface GunneryPowerRow {
  power: number[];
  ion: number;
}

export interface HazardRow {
  top: string[];
  bottom: string[];
}

export interface Tables {
  pilotSkill: {
    quality: Record<'trainee' | 'poor' | 'average' | 'veteran' | 'hotshot', number>;
    table: string[];
  };
  gunneryValues: {
    ionModifier: number;
    rows: Record<string, GunneryValuesRow>;
  };
  gunneryPower: {
    rows: Record<string, GunneryPowerRow>;
    specialWeapons: Record<string, string>;
  };
  hazard: {
    columns: number[];
    rows: Record<string, HazardRow>;
  };
  fire: {
    columns: number[];
  } & Record<FireQuarter, string[][]>;
  /** The Star Destroyer Attack Table (Rules: Star Destroyers). */
  destroyerAttack: {
    rows: Record<string, { left?: DestroyerBox; right?: DestroyerBox }>;
  };
}

export interface DestroyerBox {
  count: number;
  code: string;
  ion?: boolean;
  hit: number[];
  power: number[];
}

export const SHIPS = shipsFile.ships as unknown as Record<string, ShipType>;
export const TABLES = tablesFile as unknown as Tables;

export function getShip(id: string): ShipType {
  const ship = SHIPS[id];
  if (!ship) throw new Error(`Unknown ship type: ${id}`);
  return ship;
}
