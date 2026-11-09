import { ask, save } from '@tauri-apps/plugin-dialog';
import { api } from './api';

const isTauri = '__TAURI_INTERNALS__' in window;

/** Native confirmation dialog (falls back to the browser one outside Tauri). */
export const confirmAction = async (message: string): Promise<boolean> =>
  isTauri ? ask(message, { title: 'Wifinatio', kind: 'warning' }) : window.confirm(message);

/** Asks where to save and writes the text file. Returns false when cancelled. */
export const saveTextFile = async (defaultName: string, contents: string, extension: 'md' | 'json'): Promise<boolean> => {
  if (!isTauri) {
    const blob = new Blob([contents], { type: extension === 'json' ? 'application/json' : 'text/markdown' });
    const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: defaultName });
    link.click();
    URL.revokeObjectURL(link.href);
    return true;
  }
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: extension === 'json' ? 'JSON' : 'Markdown', extensions: [extension] }],
  });
  if (!path) return false;
  await api.writeTextFile(path, contents);
  return true;
};

export const copyText = async (text: string) => {
  await navigator.clipboard.writeText(text);
};
