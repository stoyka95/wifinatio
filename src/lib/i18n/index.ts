import { useSettingsStore } from '@/stores/settings';
import { isAndroid } from '../platform';
import { applyPatch, csAndroid, enAndroid } from './android';
import { cs, type Dict } from './cs';
import { en } from './en';
import type { Language } from '../types';

const dictionaries: Record<Language, Dict> = isAndroid
  ? { cs: applyPatch(cs, csAndroid), en: applyPatch(en, enAndroid) }
  : { cs, en };

export const getDict = (language: Language): Dict => dictionaries[language] ?? cs;

/** Current dictionary; re-renders when the language setting changes. */
export const useT = (): Dict => getDict(useSettingsStore((s) => s.settings.language));

/** Maps a backend error string to a localized message. */
export const errorMessage = (t: Dict, error: unknown): string => {
  const code = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return t.errors[code] ?? t.errors.generic;
};

export type { Dict };
