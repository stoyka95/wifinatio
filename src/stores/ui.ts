import { create } from 'zustand';

export type Section =
  | 'dashboard'
  | 'ping'
  | 'channels'
  | 'speed'
  | 'events'
  | 'dnsTrace'
  | 'network'
  | 'rooms'
  | 'diagnosis'
  | 'settings';

const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem('wifinatio.sidebarCollapsed') === '1';
  } catch {
    return false;
  }
};

interface UiState {
  section: Section;
  sidebarCollapsed: boolean;
  /** The theme actually applied (system resolved to dark/light). */
  resolvedTheme: 'dark' | 'light';
  go: (section: Section) => void;
  toggleSidebar: () => void;
  setResolvedTheme: (theme: 'dark' | 'light') => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  section: 'dashboard',
  sidebarCollapsed: readCollapsed(),
  resolvedTheme: 'dark',
  go: (section) => set({ section }),
  setResolvedTheme: (resolvedTheme) => set({ resolvedTheme }),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    try {
      localStorage.setItem('wifinatio.sidebarCollapsed', next ? '1' : '0');
    } catch {
      /* storage unavailable: keep in memory only */
    }
    set({ sidebarCollapsed: next });
  },
}));
