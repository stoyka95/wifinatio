import {
  Activity,
  Gauge,
  History,
  House,
  LayoutDashboard,
  Network,
  Radar,
  Route,
  Settings,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import type { Section } from '@/stores/ui';

export interface NavItem {
  id: Section;
  icon: LucideIcon;
}

/** Sidebar order: live views first, tools next, settings last. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'ping', icon: Activity },
  { id: 'channels', icon: Radar },
  { id: 'speed', icon: Gauge },
  { id: 'events', icon: History },
  { id: 'dnsTrace', icon: Route },
  { id: 'network', icon: Network },
  { id: 'rooms', icon: House },
  { id: 'diagnosis', icon: Stethoscope },
];

export const SETTINGS_ITEM: NavItem = { id: 'settings', icon: Settings };

/** Phone bottom bar: the most used views; the rest sit behind "More". */
export const MOBILE_PRIMARY: Section[] = ['dashboard', 'ping', 'speed', 'diagnosis'];
