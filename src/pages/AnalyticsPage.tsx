import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch } from '../lib/api.ts';

interface AnalyticsData {
  summary: {
    total_events: number;
    alerts_today: number;
    critical_events: number;
    evidence_count: number;
    active_cameras: number;
  };
  eventsByType: Array<{ name: string; value: number }>;
  eventsBySeverity: Array<{ name: string; value: number }>;
  eventsOverTime: Array<{ bucket: string; count: number }>;
  telemetrySeries: Array<{
    time: string;
    capture_fps: number;
    processing_fps: number;
    inference_fps: number;
    latency_ms: number;
    people_count: number;
    object_count: number;
    active_tracks: number;
  }>;
  zoneViolations: Array<{ camera: string; count: number }>;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#3b82f6',
};

export const AnalyticsPage: React.FC = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch<AnalyticsData>('/api/analytics');
        setData(res);
      } catch {
        // ignore
      }
    };
    load();
    const t = window.setInterval(load, 8000);
    return () => window.clearInterval(t);
  }, []);

  if (!data) {
    return <div className="p-6 text-xs text-slate-400">Loading database analytics...</div>;
  }

  const EmptyBlock = ({ label }: { label: string }) => (
    <div className="h-56 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-800 rounded">
      {label}
    </div>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">Module 3 · Incident &amp; Pipeline Analytics</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          All charts are generated strictly from recorded SQLite events and live telemetry snapshots
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5">
        {[
          { label: 'Total Events', val: data.summary.total_events },
          { label: 'Alerts Today', val: data.summary.alerts_today },
          { label: 'Open High/Critical', val: data.summary.critical_events },
          { label: 'Evidence Files', val: data.summary.evidence_count },
          { label: 'Active Cameras', val: data.summary.active_cameras },
        ].map((c) => (
          <div key={c.label} className="bg-[#0f172a] border border-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400">{c.label}</div>
            <div className="font-mono text-xl font-semibold tabular-nums text-slate-100 mt-1">{c.val}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Events Over Time */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">Events Over Time</h2>
          {data.eventsOverTime.length === 0 ? (
            <EmptyBlock label="No event records in database yet." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.eventsOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Events by Type */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">Events by Type</h2>
          {data.eventsByType.length === 0 ? (
            <EmptyBlock label="No event type distribution available." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.eventsByType}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Events by Severity */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">Events by Severity &amp; Zone Violations</h2>
          {data.eventsBySeverity.length === 0 ? (
            <EmptyBlock label="No severity metrics recorded." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.eventsBySeverity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {data.eventsBySeverity.map((entry) => (
                      <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || '#64748b'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* FPS & Latency */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">FPS &amp; End-to-End Latency</h2>
          {data.telemetrySeries.length === 0 ? (
            <EmptyBlock label="No telemetry snapshots recorded yet. Run Live Monitor to record FPS & latency." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.telemetrySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Line type="monotone" dataKey="processing_fps" name="Proc FPS" stroke="#10b981" dot={false} />
                  <Line type="monotone" dataKey="inference_fps" name="Inf FPS" stroke="#3b82f6" dot={false} />
                  <Line type="monotone" dataKey="latency_ms" name="Latency (ms)" stroke="#f59e0b" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* People & Object Counts */}
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">People &amp; Object Counts Over Time</h2>
          {data.telemetrySeries.length === 0 ? (
            <EmptyBlock label="No occupancy telemetry recorded yet." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.telemetrySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
                  <Area type="monotone" dataKey="people_count" name="People" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                  <Area type="monotone" dataKey="object_count" name="Total Objects" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.15} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
