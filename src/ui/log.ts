import { SHIPS, describeDamageCode, parseDamageCode, type GameEvent, type HurtRecord, type Seg } from '../engine';
import { h, type Child } from './dom';

const seg = (s: Seg): HTMLElement => h('span', { class: s.tone ? `t-${s.tone}` : '' }, s.t);

/** A damage code of the Hazard and Fire Tables, with what it means as a tooltip. Anything else is plain text. */
function codeSpan(token: string): Child {
  try {
    if (parseDamageCode(token)) return h('span', { class: 'dcode', title: `${token}: ${describeDamageCode(token)}` }, token);
  } catch {
    /* not a code (KILL, a word) */
  }
  return token;
}

/** A hazard or damage line of the short log: the damage codes after the arrow explain themselves when hovered. */
function withCodeTips(s: Seg): HTMLElement {
  const arrow = s.t.indexOf(' → ');
  if (arrow < 0) return seg(s);
  const out: Child[] = [s.t.slice(0, arrow + 3)];
  for (const part of s.t.slice(arrow + 3).split(/([A-Za-z0-9+?\-]+)/)) out.push(/^[A-Za-z0-9+?\-]+$/.test(part) ? codeSpan(part) : part);
  return h('span', { class: s.tone ? `t-${s.tone}` : '' }, ...out);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = new RegExp(`(${Object.values(SHIPS).map((t) => escapeRe(t.name)).sort((a, b) => b.length - a.length).join('|')}) #(\\d+) \\(player ([12])\\)`, 'g');

/** The full text of an event, with ship names in their side's colour and "(player 1)" shortened to "(p1)". */
function colourNames(text: string): Child[] {
  const out: Child[] = [];
  let last = 0;
  for (const m of text.matchAll(NAME_RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push(h('span', { class: `t-p${Number(m[3]) - 1}` }, `${m[1]} #${m[2]} (p${m[3]})`));
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lineClass(e: GameEvent): string {
  switch (e.kind) {
    case 'fire': return e.shot?.hit ? 'hit' : 'miss';
    case 'destroyed':
    case 'gameOver': return 'kill';
    case 'turn': return 'turnline';
    case 'damage':
    case 'damageRoll': return 'dmg';
    case 'hazard':
    case 'hazardRoll': return 'haz';
    default: return '';
  }
}

/** "a, b and c", the items being already-built pieces of a line. */
const list = (items: Child[][]): Child[] => items.flatMap((item, i) => [i === 0 ? '' : i === items.length - 1 ? ' and ' : ', ', ...item]);

/** Several pieces of damage to one ship, told as one sentence: "suffers +6 penalty and loses overturn", the damage itself in orange. */
function sentence(pieces: HurtRecord[]): Child[] {
  const merged = new Map<string, HurtRecord>();
  for (const p of pieces) {
    const old = merged.get(p.key);
    merged.set(p.key, old && p.count !== undefined && old.count !== undefined ? { ...p, count: old.count + p.count } : p);
  }
  const byVerb = new Map<string, Child[][]>();
  for (const p of merged.values()) {
    const noun = p.count === undefined ? p.noun : `${p.count} ${p.noun}${p.count > 1 && !p.noun.endsWith('damage') ? 's' : ''}`;
    byVerb.set(p.verb, [...(byVerb.get(p.verb) ?? []), [h('span', { class: 't-warn' }, noun)]]);
  }
  const groups = [...byVerb].map(([verb, nouns]): Child[] => [`${verb} `, ...list(nouns)]);
  return [seg(pieces[0]!.name), ' ', ...list(groups)];
}

/** The log as lines of the page: short and coloured, or, with `full`, the engine's complete sentences. */
export function logLines(events: GameEvent[], full: boolean, showHex = false): HTMLElement[] {
  const lines: HTMLElement[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (full) {
      lines.push(h('div', { class: lineClass(e) }, ...colourNames(e.text)));
      continue;
    }
    // the asteroids bumping into each other are told in the full text only; what they do to ships is always in the log
    if (e.kind === 'asteroid' && e.detail) continue;
    if (e.hurt) {
      const pieces = [e.hurt];
      while (events[i + 1]?.hurt && events[i + 1]!.hurt!.shipId === e.hurt.shipId) pieces.push(events[++i]!.hurt!);
      lines.push(h('div', { class: 'dmg' }, ...sentence(pieces)));
    } else if (e.brief) {
      lines.push(h('div', { class: lineClass(e) + (e.detail ? ' detail' : '') }, ...e.brief.filter((s) => showHex || !s.hex).map((s) => (e.kind === 'hazardRoll' || e.kind === 'damageRoll' ? withCodeTips(s) : seg(s)))));
    } else {
      lines.push(h('div', { class: lineClass(e) }, ...colourNames(e.text)));
    }
  }
  return lines;
}
