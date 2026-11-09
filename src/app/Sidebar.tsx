import { motion } from 'framer-motion';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import logo from '@/assets/logo.svg';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { fmtDbm } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rateRssi } from '@/lib/rating';
import { LevelDot } from '@/components/glass/status';
import { useLiveStore } from '@/stores/live';
import { useUiStore } from '@/stores/ui';
import { NAV_ITEMS, SETTINGS_ITEM, type NavItem } from './nav';

const NavButton = ({ item, collapsed }: { item: NavItem; collapsed: boolean }) => {
  const t = useT();
  const active = useUiStore((s) => s.section === item.id);
  const go = useUiStore((s) => s.go);
  const Icon = item.icon;
  const label = t.nav[item.id];
  const button = (
    <button
      type="button"
      onClick={() => go(item.id)}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        'group relative flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[13.5px] font-medium transition-colors duration-150',
        active ? 'text-fg' : 'text-fg-muted hover:bg-glass-hover hover:text-fg',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active"
          className="glass-strong absolute inset-0 rounded-xl"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      {active && <span className="accent-gradient absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full" />}
      <Icon className={cn('relative size-[18px] shrink-0', active && 'text-blue')} strokeWidth={1.8} aria-hidden />
      {!collapsed && <span className="relative truncate">{label}</span>}
    </button>
  );
  return collapsed ? (
    <Tooltip content={label} side="right">
      {button}
    </Tooltip>
  ) : (
    button
  );
};

/** Compact live status at the bottom of the sidebar. */
const ConnectionPill = ({ collapsed }: { collapsed: boolean }) => {
  const t = useT();
  const wifi = useLiveStore((s) => s.wifi);
  const conn = wifi?.connection;
  const rssi = conn?.rssi ?? null;
  const level = rssi !== null ? rateRssi(rssi) : wifi?.state === 'connected' ? 'good' : 'poor';
  const title = conn ? conn.ssid : wifi ? t.wifiState[wifi.state] : t.common.loading;
  if (collapsed) {
    return (
      <Tooltip content={`${title}${rssi !== null ? `, ${fmtDbm(rssi)}` : ''}`} side="right">
        <div tabIndex={0} className="flex h-10 items-center justify-center">
          <LevelDot level={wifi ? level : null} className="size-2.5" />
        </div>
      </Tooltip>
    );
  }
  return (
    <div className="glass-strong flex items-center gap-3 rounded-xl px-3 py-2.5">
      <LevelDot level={wifi ? level : null} className="size-2.5" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-fg">{title}</p>
        <p className="num text-[12px] text-fg-muted">{rssi !== null ? fmtDbm(rssi) : ' '}</p>
      </div>
    </div>
  );
};

export const Sidebar = () => {
  const t = useT();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <motion.nav
      aria-label="Wifinatio"
      initial={false}
      animate={{ width: collapsed ? 72 : 236 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-20 flex h-full shrink-0 flex-col px-3 pb-3"
    >
      <div data-tauri-drag-region className={cn('flex h-14 items-center gap-2.5 px-1.5', collapsed && 'justify-center px-0')}>
        <img src={logo} alt="" className="size-8 shrink-0 drop-shadow-[0_4px_12px_rgba(59,130,246,0.35)]" draggable={false} />
        {!collapsed && <span className="text-[17px] font-semibold tracking-[-0.02em] text-fg">Wifinatio</span>}
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <NavButton key={item.id} item={item} collapsed={collapsed} />
        ))}
      </div>

      <div className="flex flex-col gap-2 pt-3">
        <ConnectionPill collapsed={collapsed} />
        <NavButton item={SETTINGS_ITEM} collapsed={collapsed} />
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t.nav.expand : t.nav.collapse}
          className={cn('flex h-9 items-center gap-3 rounded-xl px-3 text-[12.5px] text-fg-faint transition-colors hover:text-fg', collapsed && 'justify-center px-0')}
        >
          {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
          {!collapsed && t.nav.collapse}
        </button>
      </div>
    </motion.nav>
  );
};
