/** Damage codes shared by the Hazard Table and the Fire Table (Rules: Hazards; Fire). */
export type DamageEffect =
  | { kind: 'actionPenalty'; amount: 3 | 6 }
  | { kind: 'body'; points: number }
  | { kind: 'engine' }
  | { kind: 'gun' }
  | { kind: 'lateral' }
  | { kind: 'lose' }
  | { kind: 'power'; count: number }
  | { kind: 'roll' }
  | { kind: 'speedChange'; amount: 1 | 2 }
  | { kind: 'skillReduction' }
  | { kind: 'stabilizer' }
  | { kind: 'turnIncrease'; amount: number };

/** Parse a printed damage code. "-" (no effect) returns null. */
export function parseDamageCode(code: string): DamageEffect | null {
  if (code === '-' || code === '') return null;
  let m: RegExpExecArray | null;
  if ((m = /^A\+([36])$/.exec(code))) return { kind: 'actionPenalty', amount: Number(m[1]) as 3 | 6 };
  if (code === 'Body') return { kind: 'body', points: 1 };
  if ((m = /^(\d+)Bdy$/.exec(code))) return { kind: 'body', points: Number(m[1]) };
  if (code === 'E') return { kind: 'engine' };
  if (code === 'G') return { kind: 'gun' };
  if (code === 'L') return { kind: 'lateral' };
  if (code === 'LOSE') return { kind: 'lose' };
  if (code === 'P') return { kind: 'power', count: 1 };
  if ((m = /^(\d)P$/.exec(code))) return { kind: 'power', count: Number(m[1]) };
  if (code === 'Roll') return { kind: 'roll' };
  if (code === 'SPD?') return { kind: 'speedChange', amount: 1 };
  if (code === 'SPD2?') return { kind: 'speedChange', amount: 2 };
  if (code === 'Sk-1') return { kind: 'skillReduction' };
  if (code === 'Stb') return { kind: 'stabilizer' };
  if ((m = /^T\+([123])$/.exec(code))) return { kind: 'turnIncrease', amount: Number(m[1]) };
  throw new Error(`Unknown damage code: ${code}`);
}

/** A plain-language reading of a printed damage code, for the log (Rules: Damage). */
export function describeDamageCode(code: string): string {
  const effect = parseDamageCode(code);
  if (!effect) return 'no effect';
  switch (effect.kind) {
    case 'actionPenalty': return `action penalty: +${effect.amount} difficulty on next game-turn's hazard roll`;
    case 'body': return `${effect.points} body point${effect.points > 1 ? 's' : ''} lost`;
    case 'engine': return 'engine damage: maximum speed drops by 1';
    case 'gun': return 'gun damage: one gun loses a barrel (a single gun is destroyed)';
    case 'lateral': return 'lateral control damage: turn number +1 from now on';
    case 'lose': return 'lose one planned action of the same hazard letter';
    case 'power': return `power loss: ${effect.count} shield marker${effect.count > 1 ? 's' : ''} lost (body damage when none are left)`;
    case 'roll': return 'forced roll: the ship must roll next game-turn';
    case 'speedChange': return `random speed change of ${effect.amount}`;
    case 'skillReduction': return 'pilot hurt: piloting and gunnery lose 1D';
    case 'stabilizer': return 'stabilizer damage: extra difficulty every turn until repaired';
    case 'turnIncrease': return `turn number +${effect.amount} this game-turn only`;
  }
}

/** Ion cannons never inflict body damage (Rules: Fire). */
export function isBodyCode(code: string): boolean {
  return parseDamageCode(code)?.kind === 'body';
}
