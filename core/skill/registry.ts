import type { Skill } from '../types';
import { BUILTIN_SKILLS } from './builtin';

const STORAGE_KEY = 'deepseek_pp_skills';

export async function getAllSkills(): Promise<Skill[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const storedSkills = data[STORAGE_KEY];
  const custom: Skill[] = (Array.isArray(storedSkills) ? storedSkills : []).filter(
    (s: Skill) => s.source === 'custom',
  );
  return [...BUILTIN_SKILLS, ...custom];
}

export async function saveSkill(skill: Skill, previousName?: string): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const storedSkills = stored[STORAGE_KEY];
  const custom: Skill[] = (Array.isArray(storedSkills) ? storedSkills : []).filter(
    (s: Skill) => s.source === 'custom',
  );
  const namesToReplace = new Set<string>([skill.name]);
  if (previousName) namesToReplace.add(previousName);

  const previousIndex = previousName ? custom.findIndex((s) => s.name === previousName) : -1;
  const currentIndex = custom.findIndex((s) => s.name === skill.name);
  const insertIndex = previousIndex >= 0 ? previousIndex : currentIndex;
  const next = custom.filter((s) => !namesToReplace.has(s.name));
  const savedSkill = { ...skill, source: 'custom' as const };

  if (insertIndex >= 0) {
    next.splice(Math.min(insertIndex, next.length), 0, savedSkill);
  } else {
    next.push(savedSkill);
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
}

export async function deleteSkill(name: string): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY) as Record<string, unknown>;
  const storedSkills = stored[STORAGE_KEY];
  const custom: Skill[] = (Array.isArray(storedSkills) ? storedSkills : []).filter(
    (s: Skill) => s.name !== name,
  );
  await chrome.storage.local.set({ [STORAGE_KEY]: custom });
}

export async function replaceAllCustomSkills(skills: Skill[]): Promise<void> {
  const custom = skills.map((s) => ({ ...s, source: 'custom' as const }));
  await chrome.storage.local.set({ [STORAGE_KEY]: custom });
}
