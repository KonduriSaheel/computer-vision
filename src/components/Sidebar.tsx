import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  BarChart3,
  Camera,
  Crosshair,
  Eye,
  LayoutDashboard,
  Plug,
  ScanFace,
  ShieldAlert,
  Sliders,
} from 'lucide-react';
import type { AppPage } from '../types/visionguard.ts';

interface SidebarProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  wsConnected: boolean;
  activeCameraCount: number;
  unacknowledgedAlerts: number;
}

interface NavGroup {
  label: string;
  items: Array<{
    id: AppPage;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onNavigate,
  wsConnected,
  activeCameraCount,
  unacknowledgedAlerts,
}) => {
  const groups: NavGroup[] = [
    {
      label: 'Operations',
      items: [
        { id: 'connection', label: 'Connection Setup', icon: Plug },
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'live', label: 'Live Monitor', icon: Eye },
      ],
    },
    {
      label: 'Module 1 · Acquisition',
      items: [
        { id: 'cameras', label: 'Cameras', icon: Camera, badge: activeCameraCount || undefined },
        { id: 'calibration', label: 'Calibration', icon: Crosshair },
      ],
    },
    {
      label: 'Module 4 · Detection',
      items: [{ id: 'detection', label: 'Detection & Tracks', icon: Sliders }],
    },
    {
      label: 'Module 2 · Identity',
      items: [{ id: 'identities', label: 'Identities', icon: ScanFace }],
    },
    {
      label: 'Module 5 · Spatial & Rules',
      items: [{ id: 'zones', label: 'Danger Zones', icon: ShieldAlert }],
    },
    {
      label: 'Module 3 · Incidents & Audit',
      items: [
        { id: 'incidents', label: 'Incidents', icon: AlertTriangle, badge: unacknowledgedAlerts || undefined },
        { id: 'evidence', label: 'Evidence Vault', icon: Archive },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
      ],
    },
    {
      label: 'Infrastructure',
      items: [{ id: 'health', label: 'System Health', icon: Activity }],
    },
  ];

  return (
    <aside className="w-64 shrink-0 bg-[#0b1120] border-r border-slate-800/90 flex flex-col h-full select-none">
      <div className="px-5 py-4 border-b border-slate-800/90">
        <button
          type="button"
          onClick={() => onNavigate('connection')}
          className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        >
          <div className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            VisionGuard
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
            Situational Awareness Platform
          </div>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-slate-500 tracking-wide">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-slate-100 border border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {typeof item.badge === 'number' && item.badge > 0 && (
                      <span className="font-mono text-[11px] tabular-nums text-slate-200 bg-slate-800 px-1.5 py-0.5 rounded">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800/90 text-xs text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`}
            aria-hidden="true"
          />
          <span>{wsConnected ? 'Live Socket Active' : 'Socket Reconnecting'}</span>
        </span>
        <span className="font-mono text-[11px] tabular-nums text-slate-500">/ws/live</span>
      </div>
    </aside>
  );
};
