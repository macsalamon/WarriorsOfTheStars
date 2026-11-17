import { SPECIAL, type ShotOrder } from '../engine';

/*
 * The state of aiming: which crew member is choosing, which of their guns will fire and at whom, and who has confirmed.
 * A gun is in one of three states for its crew member: off (it will not fire), armed (it will fire, no target yet) and aimed (it
 * will fire at a target). Pressing a gun chip arms it (an aimed gun goes back to armed, to be aimed again); the × switches it off. A target clicked on the
 * board or in the sidebar is given to every armed gun that can reach it.
 */
export type AimKind = 'snap' | 'fire';

export interface AimCrew {
  /** The guns that will fire, by index: the target's id, or null while a gun is armed and has none. */
  guns: Record<number, string | null>;
  /** How many tubes of the pilot's missiles, torpedoes or bombs fire at once (the special weapon is gun number `SPECIAL`). */
  tubes?: number;
  /** Confirmed (holding fire is a confirmed empty choice). */
  done: boolean;
}

export interface AimSession {
  kind: AimKind;
  shipId: string;
  /** The crew members who may fire now, in the order of their icons. */
  crews: string[];
  /** Whose guns are shown. */
  active: string;
  per: Record<string, AimCrew>;
}

/** Starts aiming: each crew member's ready guns are armed. */
export function newAim(kind: AimKind, shipId: string, crews: { id: string; ready: number[] }[], active: string): AimSession {
  const per: Record<string, AimCrew> = {};
  for (const c of crews) per[c.id] = { guns: Object.fromEntries(c.ready.map((g) => [g, null])), done: false };
  return { kind, shipId, crews: crews.map((c) => c.id), active: crews.some((c) => c.id === active) ? active : crews[0]!.id, per };
}

export type GunAim = 'off' | 'armed' | 'aimed';

export function gunAim(a: AimSession, crew: string, gun: number): GunAim {
  const t = a.per[crew]?.guns[gun];
  return t === undefined ? 'off' : t === null ? 'armed' : 'aimed';
}

/** The guns the crew member will fire, with their targets (null: armed, not aimed yet). */
export const selectedGuns = (a: AimSession, crew: string): number[] => Object.keys(a.per[crew]?.guns ?? {}).map(Number).sort((x, y) => x - y);

/**
 * Switches a gun: off to armed, armed to off, aimed back to armed (to aim it again). A confirmed crew member must be reopened first.
 * Switching on a gun another crew member has switched on takes it from them (Rules: Gunners and turrets), unless they have already confirmed.
 */
export function toggleGun(a: AimSession, crew: string, gun: number): AimSession {
  const c = a.per[crew];
  if (!c || c.done) return a;
  const state = gunAim(a, crew, gun);
  if (state === 'off') return switchOn(a, crew, gun);
  // an armed gun stays armed (the × switches it off); an aimed one goes back to armed, to be aimed again
  if (state === 'armed') return a;
  return { ...a, per: { ...a.per, [crew]: { ...c, guns: { ...c.guns, [gun]: null } } } };
}

/** Switches a gun off, from any state. */
export function switchOff(a: AimSession, crew: string, gun: number): AimSession {
  const c = a.per[crew];
  if (!c || c.done || c.guns[gun] === undefined) return a;
  const guns = { ...c.guns };
  delete guns[gun];
  return { ...a, per: { ...a.per, [crew]: { ...c, guns } } };
}

/** Switches a gun on for a crew member, armed with no target. Whoever else had it switched on loses it (they must not have confirmed). */
export function switchOn(a: AimSession, crew: string, gun: number): AimSession {
  const c = a.per[crew];
  if (!c || c.done || lockedBy(a, gun, crew)) return a;
  const per = { ...a.per };
  for (const other of a.crews) {
    if (other === crew || per[other]!.guns[gun] === undefined) continue;
    const rest = { ...per[other]!.guns };
    delete rest[gun];
    per[other] = { ...per[other]!, guns: rest };
  }
  per[crew] = { ...c, guns: { ...c.guns, [gun]: null } };
  return { ...a, per };
}

/**
 * Gives a target to every armed gun of the crew member that can reach it. When no armed gun can, the guns that reach it are aimed again
 * (changing one's mind). Returns the session unchanged when no gun could.
 */
export function aimAt(a: AimSession, crew: string, target: string, reaches: (gun: number) => boolean): AimSession {
  const c = a.per[crew];
  if (!c || c.done) return a;
  const reaching = selectedGuns(a, crew).filter(reaches);
  const armed = reaching.filter((g) => c.guns[g] === null);
  const chosen = armed.length > 0 ? armed : reaching.filter((g) => c.guns[g] !== target);
  if (chosen.length === 0) return a;
  const guns = { ...c.guns };
  for (const gun of chosen) guns[gun] = target;
  return { ...a, per: { ...a.per, [crew]: { ...c, guns } } };
}

/** How many tubes of the special weapon fire. */
export function setTubes(a: AimSession, crew: string, tubes: number): AimSession {
  const c = a.per[crew];
  return c && !c.done ? { ...a, per: { ...a.per, [crew]: { ...c, tubes } } } : a;
}

/** Another crew member who has switched this gun on: a gun fires once, for one of them (Rules: Gunners and turrets). */
export function heldBy(a: AimSession, gun: number, except: string): string | null {
  return a.crews.find((c) => c !== except && a.per[c]!.guns[gun] !== undefined) ?? null;
}

/** The crew member who has confirmed a shot with this gun: it cannot be taken from them until they change their choice. */
export function lockedBy(a: AimSession, gun: number, except: string): string | null {
  return a.crews.find((c) => c !== except && a.per[c]!.done && a.per[c]!.guns[gun] !== undefined) ?? null;
}

export const armedLeft = (a: AimSession, crew: string): number => selectedGuns(a, crew).filter((g) => a.per[crew]!.guns[g] === null).length;

/** The shots of one crew member's aimed guns. The pilot's carry no crew name (the engine's default). */
export function shotsOf(a: AimSession, crew: string): ShotOrder[] {
  return selectedGuns(a, crew).flatMap((gun): ShotOrder[] => {
    const target = a.per[crew]!.guns[gun];
    if (!target) return [];
    if (gun === SPECIAL) return [{ gun, target, tubes: a.per[crew]!.tubes ?? 1 }];
    return [{ gun, target, ...(crew === 'pilot' ? {} : { crew }) }];
  });
}

/** Every confirmed crew member's shots. */
export const allShots = (a: AimSession): ShotOrder[] => a.crews.flatMap((c) => (a.per[c]!.done ? shotsOf(a, c) : []));

/** A crew member can confirm when every gun they switched on has a target (guns that need none are switched off). */
export const canConfirm = (a: AimSession, crew: string): boolean => !a.per[crew]!.done && armedLeft(a, crew) === 0;

export function confirm(a: AimSession, crew: string): AimSession {
  if (!canConfirm(a, crew)) return a;
  const per = { ...a.per, [crew]: { ...a.per[crew]!, done: true } };
  return { ...a, per, active: nextOpen({ ...a, per }, crew) };
}

/** Holding fire: nothing from this crew member. */
export function hold(a: AimSession, crew: string): AimSession {
  const per = { ...a.per, [crew]: { guns: {}, done: true } };
  return { ...a, per, active: nextOpen({ ...a, per }, crew) };
}

/** Takes the confirmation back, to change the choice. */
export function reopen(a: AimSession, crew: string): AimSession {
  const c = a.per[crew];
  return c ? { ...a, per: { ...a.per, [crew]: { ...c, done: false } }, active: crew } : a;
}

export const selectCrew = (a: AimSession, crew: string): AimSession => (a.crews.includes(crew) ? { ...a, active: crew } : a);

export const allDone = (a: AimSession): boolean => a.crews.every((c) => a.per[c]!.done);

/** The next crew member who has not confirmed, after `from`; `from` itself when all have. */
function nextOpen(a: AimSession, from: string): string {
  const at = a.crews.indexOf(from);
  for (let i = 1; i <= a.crews.length; i++) {
    const c = a.crews[(at + i) % a.crews.length]!;
    if (!a.per[c]!.done) return c;
  }
  return from;
}
