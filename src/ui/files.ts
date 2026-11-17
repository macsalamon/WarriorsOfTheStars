import { CUSTOM_PREFIX, registerCustomScenarios, validateScenario, type ScenarioDef } from '../engine';
/**
 * The page's way to the saves and scenarios folders of the project, through the host program or the dev server (see server/files.ts). It only
 * works on the host's own computer; anywhere else every call says so and the page falls back to downloads and the file picker.
 */
export interface SaveListing {
  name: string;
  size: number;
  modified: number;
  savedAt?: string;
  description?: string;
  human?: 0 | 1;
  error?: string;
}

export interface ScenarioListing {
  name: string;
  title?: string;
  error?: string;
}

const HEADERS = { 'x-warriors': '1' };

/** What is in both folders, or null when this page has no way to them. */
export async function listFiles(): Promise<{ saves: SaveListing[]; scenarios: ScenarioListing[] } | null> {
  try {
    const r = await fetch('/api/files', { headers: HEADERS });
    return r.ok ? ((await r.json()) as { saves: SaveListing[]; scenarios: ScenarioListing[] }) : null;
  } catch {
    return null;
  }
}

/** The text of one file. */
export async function readFile(kind: 'saves' | 'scenarios', name: string): Promise<string> {
  const r = await fetch(`/api/${kind}/${encodeURIComponent(name)}`, { headers: HEADERS });
  if (!r.ok) throw new Error('The file couldn’t be read.');
  return r.text();
}

/** Keeps a file in the folder; false when the page can't (not on the host's computer, or the file isn't valid). */
export async function writeFile(kind: 'saves' | 'scenarios', name: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/${kind}/${encodeURIComponent(name)}`, { method: 'PUT', headers: HEADERS, body: text });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Reads the scenarios folder and makes the scenarios in it playable (their ids start with `custom-`). A file that isn't a scenario this game can
 * play is left out. Returns the ones that were added, for the menu.
 */
export async function loadCustomScenarios(): Promise<{ id: string; def: ScenarioDef }[]> {
  const files = await listFiles();
  const found: { id: string; def: ScenarioDef }[] = [];
  for (const f of files?.scenarios ?? []) {
    if (f.error) continue;
    try {
      const def = JSON.parse(await readFile('scenarios', f.name)) as ScenarioDef;
      if (validateScenario(def)) continue;
      found.push({ id: `${CUSTOM_PREFIX}${f.name.replace(/\.json$/, '')}`, def });
    } catch {
      /* a file that can't be read is left out */
    }
  }
  registerCustomScenarios(Object.fromEntries(found.map((x) => [x.id, x.def])));
  return found;
}
