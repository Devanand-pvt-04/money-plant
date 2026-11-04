import * as Crypto from 'expo-crypto';
import { iconForName, iconInSet } from '@money-plant/categoriser';
import { aiEnabled } from './ai-settings';
import { flatten, listCategories, setCategoryIcon } from './categories';
import { ICON_SET } from './icon-set';
import { kvGet, kvSet } from './kv';
import { supabase } from './supabase';

const WANTED_KEY = 'ai.icon-jobs';

/** A category waiting for an AI icon suggestion, and its job once queued. */
interface Wanted {
  categoryId: string;
  name: string;
  jobId: string | null;
}

async function readWanted(): Promise<Wanted[]> {
  try {
    return JSON.parse((await kvGet(WANTED_KEY)) ?? '[]') as Wanted[];
  } catch {
    return [];
  }
}

const writeWanted = (wanted: readonly Wanted[]) => kvSet(WANTED_KEY, JSON.stringify(wanted));

/**
 * CAT-1, decision 0012: a new category whose name matches no icon asks the AI
 * for a few words to match instead. The job is queued on the next AI run.
 */
export async function wantIcon(categoryId: string, name: string): Promise<void> {
  if (iconForName(name) || iconInSet(name, ICON_SET) || !(await aiEnabled())) return;
  const wanted = await readWanted();
  if (wanted.some((w) => w.categoryId === categoryId)) return;
  await writeWanted([...wanted, { categoryId, name: name.trim(), jobId: null }]);
}

/** The first suggested word that names an icon in the app's font. */
export function iconFromWords(words: readonly string[]): string | null {
  for (const word of words) {
    const icon = iconInSet(word, ICON_SET);
    if (icon) return icon;
  }
  return null;
}

/**
 * Queues icon jobs for categories still waiting and applies finished ones.
 * A suggestion is applied only while the category keeps its name and has no
 * icon the user picked, so it never overrides the user.
 */
export async function refreshIconJobs(): Promise<void> {
  const wanted = await readWanted();
  if (wanted.length === 0) return;
  const categories = new Map(flatten(await listCategories()).map((c) => [c.id, c]));
  const still: Wanted[] = [];
  for (const want of wanted) {
    const category = categories.get(want.categoryId);
    if (!category || category.icon || category.name !== want.name) continue;
    if (!want.jobId) {
      const id = Crypto.randomUUID();
      const { error } = await supabase.from('ai_jobs').insert({ id, kind: 'icon', payload: { name: want.name } });
      still.push({ ...want, jobId: error ? null : id });
      continue;
    }
    const { data, error } = await supabase.from('ai_jobs').select('status, result').eq('id', want.jobId).maybeSingle();
    if (error || !data || data.status === 'queued' || data.status === 'running') {
      still.push(want);
      continue;
    }
    const words = (data.result as { words?: string[] } | null)?.words ?? [];
    const icon = data.status === 'done' ? iconFromWords(words) : null;
    if (icon) await setCategoryIcon(want.categoryId, icon);
  }
  await writeWanted(still);
}
