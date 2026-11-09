import { MapPin } from 'lucide-react';
import { Banner } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { api, LOCATION_SETTINGS_URI } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useTicker } from '@/hooks/useLiveAnalysis';
import { useLiveStore } from '@/stores/live';

const PENDING_AFTER_MS = 3000;

/**
 * Windows 11 hides Wi-Fi details from apps without location permission. Shows
 * either the "denied" state with a shortcut to Settings, or a hint that Windows
 * may be waiting on its consent prompt.
 */
export const LocationNotice = ({ startedAt, forceDenied = false }: { startedAt: number; forceDenied?: boolean }) => {
  const t = useT();
  const now = useTicker(1000);
  const wifi = useLiveStore((s) => s.wifi);
  const denied = forceDenied || wifi?.locationDenied;
  const detailsMissing = !wifi || (wifi.state === 'connected' && !wifi.connection);
  const pending = detailsMissing && now - startedAt > PENDING_AFTER_MS;

  if (denied) {
    return (
      <Banner
        severity="warn"
        title={t.location.deniedTitle}
        action={
          <Button size="sm" onClick={() => api.openSettingsPage(LOCATION_SETTINGS_URI)}>
            <MapPin aria-hidden />
            {t.location.openSettings}
          </Button>
        }
      >
        {t.location.deniedBody}
      </Banner>
    );
  }
  if (pending) {
    return (
      <Banner severity="info" title={t.location.pendingTitle}>
        {t.location.pendingBody}
      </Banner>
    );
  }
  return null;
};
