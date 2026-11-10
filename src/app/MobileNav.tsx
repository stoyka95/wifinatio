import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Ellipsis, X } from 'lucide-react';
import logo from '@/assets/logo.svg';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { useUiStore, type Section } from '@/stores/ui';
import { MOBILE_PRIMARY, NAV_ITEMS, SETTINGS_ITEM, type NavItem } from './nav';
import { ConnectionPill } from './Sidebar';

const ALL_ITEMS: NavItem[] = [...NAV_ITEMS, SETTINGS_ITEM];
const PRIMARY = ALL_ITEMS.filter((item) => MOBILE_PRIMARY.includes(item.id));
const SECONDARY = ALL_ITEMS.filter((item) => !MOBILE_PRIMARY.includes(item.id));

/** Phone top bar: logo and the live connection, in place of the sidebar header. */
export const MobileTopBar = () => (
  <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 lg:hidden">
    <div className="flex items-center gap-2.5">
      <img src={logo} alt="" className="size-7 shrink-0 drop-shadow-[0_4px_12px_rgba(59,130,246,0.35)]" draggable={false} />
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Wifinatio</span>
    </div>
    <div className="max-w-[55%] min-w-0">
      <ConnectionPill collapsed={false} compact />
    </div>
  </header>
);

const TabButton = ({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (id: Section) => void }) => {
  const t = useT();
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors',
        active ? 'text-fg' : 'text-fg-muted',
      )}
    >
      {active && <span className="accent-gradient absolute top-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full" />}
      <Icon className={cn('size-[20px] shrink-0', active && 'text-blue')} strokeWidth={1.8} aria-hidden />
      <span className="max-w-full truncate px-1">{t.nav[item.id]}</span>
    </button>
  );
};

/** Phone bottom navigation: four main views and a "More" sheet with the rest. */
export const MobileNav = () => {
  const t = useT();
  const section = useUiStore((s) => s.section);
  const go = useUiStore((s) => s.go);
  const [open, setOpen] = useState(false);
  const moreActive = SECONDARY.some((item) => item.id === section);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const select = (id: Section) => {
    setOpen(false);
    go(id);
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              key="sheet"
              role="dialog"
              aria-label={t.nav.more}
              className="glass fixed inset-x-3 bottom-[76px] z-50 rounded-[20px] p-3 lg:hidden"
              style={{ background: 'var(--tint-fallback)' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className="grid grid-cols-3 gap-2">
                {SECONDARY.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === section;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => select(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-20 flex-col items-center justify-center gap-2 rounded-xl px-2 text-[12.5px] font-medium transition-colors',
                        active ? 'glass-strong text-fg' : 'text-fg-muted hover:bg-glass-hover hover:text-fg',
                      )}
                    >
                      <Icon className={cn('size-[22px] shrink-0', active && 'text-blue')} strokeWidth={1.8} aria-hidden />
                      <span className="max-w-full truncate">{t.nav[item.id]}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <nav aria-label="Wifinatio" className="glass-strong relative z-50 flex shrink-0 items-stretch gap-1 border-x-0 border-b-0 px-2 lg:hidden">
        {PRIMARY.map((item) => (
          <TabButton key={item.id} item={item} active={item.id === section && !open} onSelect={select} />
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-current={moreActive && !open ? 'page' : undefined}
          className={cn(
            'relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors',
            open || moreActive ? 'text-fg' : 'text-fg-muted',
          )}
        >
          {moreActive && !open && <span className="accent-gradient absolute top-0 left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full" />}
          {open ? (
            <X className="size-[20px] text-blue" strokeWidth={1.8} aria-hidden />
          ) : (
            <Ellipsis className={cn('size-[20px]', moreActive && 'text-blue')} strokeWidth={1.8} aria-hidden />
          )}
          <span className="max-w-full truncate px-1">{t.nav.more}</span>
        </button>
      </nav>
    </>
  );
};
