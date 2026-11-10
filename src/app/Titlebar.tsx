import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { isMobile } from '@/lib/platform';

const isTauri = '__TAURI_INTERNALS__' in window;

/** Frameless window chrome: drag region plus Fluent-style caption buttons. */
export const Titlebar = () => {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri || isMobile) return;
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => undefined);
    const unlisten = win.onResized(() => win.isMaximized().then(setMaximized).catch(() => undefined));
    return () => {
      unlisten.then((u) => u()).catch(() => undefined);
    };
  }, []);

  if (isMobile) return null;

  const caption = 'flex h-full w-[46px] items-center justify-center text-fg-muted transition-colors duration-100 [&_svg]:size-[14px]';

  return (
    <div data-tauri-drag-region className="relative z-30 flex h-10 shrink-0 items-center justify-end select-none">
      {isTauri && (
        <div className="flex h-full">
          <button type="button" aria-label={t.window.minimize} className={cn(caption, 'hover:bg-glass-hover hover:text-fg')} onClick={() => getCurrentWindow().minimize()}>
            <Minus aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t.window.maximize}
            className={cn(caption, 'hover:bg-glass-hover hover:text-fg')}
            onClick={() => getCurrentWindow().toggleMaximize()}
          >
            {maximized ? <Copy className="-scale-x-100" aria-hidden /> : <Square aria-hidden />}
          </button>
          <button type="button" aria-label={t.window.close} className={cn(caption, 'hover:bg-[#c42b1c] hover:text-white')} onClick={() => api.requestClose()}>
            <X aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
};
