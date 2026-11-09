import { create } from 'zustand';
import { api } from '@/lib/api';
import type { Settings } from '@/lib/types';

export const DEFAULT_SETTINGS: Settings = {
  pingIntervalMs: 1000,
  customTargets: [],
  spikeThresholdMs: 50,
  weakSignalDbm: -70,
  language: 'cs',
  theme: 'dark',
  runInTray: false,
  notifications: true,
  autoScanMinutes: 0,
};

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    try {
      set({ settings: await api.getSettings(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  update: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    set({ settings: await api.saveSettings(next) });
  },
}));
