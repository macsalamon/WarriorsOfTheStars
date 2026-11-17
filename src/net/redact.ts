import { auxSpent, emptyPlan, other, typeOf, type Command, type GameState, type PlayerId } from '../engine';

/**
 * The game as one player may see it. Two things are secret in this game, and only until they are revealed:
 * what the other side bought (until both have, 35), where the other side's ships are set up (until both have placed, see Rules: Scenarios) and the other side's plans (until both have
 * planned, see Rules: Planning). The host's dice are never sent: whoever knew them could work out every roll to come.
 * A copy is returned; the real game is left alone.
 */
export function viewFor(game: GameState, player: PlayerId): GameState {
  // the log is long and never secret: copy the rest and share the log's entries, which nobody changes afterwards
  const log = game.log;
  game.log = [];
  const view = structuredClone(game);
  game.log = log;
  view.log = log.slice();
  view.rngState = 0;
  // the other side's turret orders are secret until both have planned (Rules: Ground attack): only whether they have been given shows
  if (view.turretOrders && game.phase === 'planning') view.turretOrders[other(player)] = game.turretOrders![other(player)] ? [] : null;
  // the edge the attackers chose is secret from the defender until both have placed their ships (Rules: Ground attack)
  if (view.groundAttack && game.phase === 'setup' && player !== view.groundAttack.attacker) {
    delete view.groundAttack.edge;
    view.zones[view.groundAttack.attacker] = [];
  }
  // what the other side bought stays secret until both have (35)
  if (view.purchase && game.phase === 'forces') view.purchase.chosen[other(player)] = null;
  // where the other side's Star Destroyers are set up is secret, like its ships
  if (game.phase === 'setup') {
    for (const d of view.destroyers ?? []) {
      if (d.owner === player) continue;
      d.pos = null;
      d.facing = 0;
    }
  }
  for (const ship of view.ships) {
    if (ship.owner === player) continue;
    if (game.phase === 'setup') {
      ship.pos = null;
      ship.facing = 0;
    }
    if (game.phase === 'planning') {
      // auxiliary power is spent as a plan is handed in: the other side must not see that a plan used some
      if (ship.aux !== undefined && !typeOf(ship).r2) ship.aux += auxSpent(ship.plan);
      ship.plan = emptyPlan();
      for (const g of ship.gunners ?? []) g.plan = emptyPlan();
      ship.tracking = null;
    }
  }
  return view;
}

/** A command as another player may see it: their secret orders are left out, everything else is public. */
export function publicCommand(cmd: Command, viewer: PlayerId): Command {
  if (cmd.player === viewer) return cmd;
  if (cmd.type === 'buy') return { ...cmd, ships: [] };
  if (cmd.type === 'buyBoth') return { ...cmd, ships: [[], []] };
  if (cmd.type === 'place') return { ...cmd, placements: [] };
  if (cmd.type === 'plan') return { ...cmd, plans: {}, crewPlans: {} };
  if (cmd.type === 'turrets') return { ...cmd, orders: [] };
  if (cmd.type === 'edge') return { ...cmd, edge: 'top' };
  return cmd;
}
