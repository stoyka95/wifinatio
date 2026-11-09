import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/glass/status';
import { startBridge } from '@/lib/bridge';
import { useSettingsStore } from '@/stores/settings';
import { useUiStore, type Section } from '@/stores/ui';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { Background } from './Background';
import { LocationNotice } from './LocationNotice';
import { Sidebar } from './Sidebar';
import { Titlebar } from './Titlebar';
import { useAppTheme, useIdleClass } from './useAppTheme';

const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

// Secondary pages load on first visit to keep start-up fast.
const PAGES: Record<Section, ComponentType> = {
  dashboard: DashboardPage,
  ping: named(() => import('@/features/ping/PingPage'), 'PingPage'),
  channels: named(() => import('@/features/channels/ChannelsPage'), 'ChannelsPage'),
  speed: named(() => import('@/features/speed/SpeedPage'), 'SpeedPage'),
  events: named(() => import('@/features/events/EventsPage'), 'EventsPage'),
  dnsTrace: named(() => import('@/features/dnstrace/DnsTracePage'), 'DnsTracePage'),
  network: named(() => import('@/features/network/NetworkPage'), 'NetworkPage'),
  rooms: named(() => import('@/features/rooms/RoomsPage'), 'RoomsPage'),
  diagnosis: named(() => import('@/features/diagnosis/DiagnosisPage'), 'DiagnosisPage'),
  settings: named(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
};

const PageFallback = () => (
  <div className="space-y-4">
    <Skeleton className="h-9 w-64" />
    <Skeleton className="h-48 w-full rounded-[20px]" />
    <Skeleton className="h-64 w-full rounded-[20px]" />
  </div>
);

export const App = () => {
  const section = useUiStore((s) => s.section);
  const loadSettings = useSettingsStore((s) => s.load);
  const [startedAt] = useState(() => Date.now());
  useAppTheme();
  useIdleClass();

  useEffect(() => {
    loadSettings();
    const stop = startBridge();
    return () => {
      stop.then((fn) => fn()).catch(() => undefined);
    };
  }, [loadSettings]);

  const Page = PAGES[section];

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={250}>
        <Background />
        <div className="flex h-full">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Titlebar />
            <main className="min-h-0 flex-1 overflow-y-auto px-7 pb-10" id="main">
              <div className="mx-auto w-full max-w-[1480px]">
                <div className="mb-4 empty:hidden">
                  <LocationNotice startedAt={startedAt} />
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={section}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  >
                    <Suspense fallback={<PageFallback />}>
                      <Page />
                    </Suspense>
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
};
