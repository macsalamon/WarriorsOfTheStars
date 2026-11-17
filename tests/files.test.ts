import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGame, dogfightOptions, validateScenario, scenarioDef } from '../src/engine';
import { handleFileApi } from '../server/files';
import { makeSave, saveFileName, serialise } from '../src/ui/savegame';

const save = () => makeSave({ meta: { mix: 'two', seed: 3, human: 0 }, game: createGame(dogfightOptions('two', 3)), aiRngState: 1, commands: [], draft: { plans: {}, submitted: [], planShip: null, placements: [] } });

let server: Server;
let base = '';
let saves = '';
let scenarios = '';
const H = { 'x-warriors': '1' };

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'warriors-'));
  saves = join(root, 'saves');
  scenarios = join(root, 'scenarios');
  server = createServer((req, res) => { if (!handleFileApi(req, res, { saves, scenarios })) res.writeHead(404).end(); });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server.close();
  rmSync(join(saves, '..'), { recursive: true, force: true });
});

describe('the folders of the page', () => {
  it('keeps a save and lists it with what it is', async () => {
    const text = serialise(save());
    const put = await fetch(`${base}/api/saves/test-save.json`, { method: 'PUT', headers: H, body: text });
    expect(put.status).toBe(200);
    expect(readFileSync(join(saves, 'test-save.json'), 'utf8')).toBe(text);
    const files = await (await fetch(`${base}/api/files`, { headers: H })).json() as { saves: { name: string; description?: string }[] };
    expect(files.saves.map((s) => s.name)).toContain('test-save.json');
    expect(files.saves.find((s) => s.name === 'test-save.json')!.description).toMatch(/Dogfight Two/);
    expect(await (await fetch(`${base}/api/saves/test-save.json`, { headers: H })).text()).toBe(text);
  });

  it('refuses what is not a save, a name that leaves the folder, and a request without the game’s own header', async () => {
    expect((await fetch(`${base}/api/saves/bad.json`, { method: 'PUT', headers: H, body: '{"hello":1}' })).status).toBe(400);
    expect(existsSync(join(saves, 'bad.json'))).toBe(false);
    expect((await fetch(`${base}/api/saves/..%2Fescape.json`, { method: 'PUT', headers: H, body: serialise(save()) })).status).toBe(404);
    expect((await fetch(`${base}/api/saves/nope.txt`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/saves/sneaky.json`, { method: 'PUT', body: serialise(save()) })).status).toBe(403);
  });

  it('lists a file that cannot be read with the reason, and lists scenarios', async () => {
    writeFileSync(join(saves, 'broken.json'), 'not json');
    writeFileSync(join(scenarios, 'duel.json'), JSON.stringify({ name: 'Duel', sides: [{ ships: [{ typeId: 'x-wing', quality: 'average' }] }, { ships: [{ typeId: 'tie-fighter', quality: 'average' }] }] }));
    writeFileSync(join(scenarios, 'wrong.json'), JSON.stringify({ name: 'Wrong', sides: [{ ships: [{ typeId: 'death-star', quality: 'average' }] }, { ships: [] }] }));
    const files = await (await fetch(`${base}/api/files`, { headers: H })).json() as { saves: { name: string; error?: string }[]; scenarios: { name: string; title?: string; error?: string }[] };
    expect(files.saves.find((s) => s.name === 'broken.json')!.error).toBeTruthy();
    expect(files.scenarios.find((s) => s.name === 'duel.json')!.title).toBe('Duel');
    expect(files.scenarios.find((s) => s.name === 'wrong.json')!.error).toMatch(/doesn’t know/);
  });
});

describe('what a scenario file may hold', () => {
  it('accepts the scenarios of the game itself and refuses the rest', () => {
    for (const id of ['one', 'ground2', 'convoy3', 'asteroid2']) expect(validateScenario(scenarioDef(id))).toBeNull();
    expect(validateScenario(null)).toMatch(/object/);
    expect(validateScenario({ name: '', sides: [] })).toMatch(/name/);
    expect(validateScenario({ name: 'x', sides: [{ ships: [] }] })).toMatch(/two sides/);
    expect(validateScenario({ name: 'x', sides: [{ ships: [] }, { ships: [] }] })).toMatch(/at least one ship/);
    expect(validateScenario({ name: 'x', sides: [{ ships: [{ typeId: 'x-wing', quality: 'great' }] }, { ships: [] }] })).toMatch(/pilot quality/);
    expect(validateScenario({ name: 'x', sides: [{ ships: [{ typeId: 'x-wing', quality: 'average', reserve: 'a' }] }, { ships: [] }] })).toMatch(/reserve/);
  });
});

describe('the name of a saved game', () => {
  it('carries the date and the time, down to the second', () => {
    const name = saveFileName(save(), new Date(2026, 10, 12, 14, 5, 9));
    expect(name).toBe('dogfight-two-turn-0-2026-11-12_140509.json');
  });
});
