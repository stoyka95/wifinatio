import { useEffect } from 'react';
import { setFormatLocale } from '@/lib/format';
import { getDict } from '@/lib/i18n';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore } from '@/stores/ui';

/** Applies theme class, document language and number locale from settings. */
export const useAppTheme = () => {
  const theme = useSettingsStore((s) => s.settings.theme);
  const language = useSettingsStore((s) => s.settings.language);
  const setResolved = useUiStore((s) => s.setResolvedTheme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      setResolved(resolved);
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, setResolved]);

  useEffect(() => {
    document.documentElement.lang = language;
    setFormatLocale(getDict(language).locale);
  }, [language]);
};

/** Pauses ambient animations while the window is hidden or unfocused. */
export const useIdleClass = () => {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => root.classList.toggle('idle', document.hidden || !document.hasFocus());
    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
};
