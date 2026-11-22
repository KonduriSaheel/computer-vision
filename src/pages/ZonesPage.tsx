import React, { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AppPage, CVConfigSettings, CameraRecord, ZoneRecord } from '../types/visionguard.ts';

interface ZonesPageProps {
  cameras: CameraRecord[];
  config: CVConfigSettings;
  onUpdateConfig: (next: Partial<CVConfigSettings>) => Promise<void>;
  onNavigate: (page: AppPage) => void;
}

export const ZonesPage: React.FC<ZonesPageProps> = ({
  cameras,
  config,
  onUpdateConfig,
  onNavigate,
}) => {
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [normalMax, setNormalMax] = useState(config.crowd_normal_max);
  const [elevatedMax, setElevatedMax] = useState(config.crowd_elevated_max);
  const [cooldownSec, setCooldownSec] = useState(config.event_cooldown_sec);
  const [saved, setSaved] = useState(false);

  const loadZones = useCallback(async () => {
    try {
      const res = await apiFetch<{ zones: ZoneRecord[] }>('/api/zones');
      setZones(res.zones);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadZones();
  }, [loadZones]);

  const cameraName = (camId: string) => cameras.find((c) => c.id === camId)?.name || camId;

  const handleSaveThresholds = async () => {
    await onUpdateConfig({
      crowd_normal_max: normalMax,
      crowd_elevated_max: elevatedMax,
      event_cooldown_sec: cooldownSec,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100">
            Module 5 · Danger-Zone &amp; Abnormal Activity Detection
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Polygon regions, dwell timers, crowd-density thresholds, and explainable rule-based activity analysis
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate('live')}
          className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white whitespace-nowrap"
        >
          Draw Polygon on Live Monitor
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4 text-xs">
          <h2 className="font-display text-sm font-semibold text-slate-200">Crowd &amp; Cooldown Rules</h2>
          <div>
            <label className="block text-slate-300 mb-1">NORMAL Crowd Upper Bound (default 4)</label>
            <input
              type="number"
              min={1}
              max={50}
              value={normalMax}
              onChange={(e) => setNormalMax(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">ELEVATED Crowd Upper Bound (default 9)</label>
            <input
              type="number"
              min={2}
              max={100}
              value={elevatedMax}
              onChange={(e) => setElevatedMax(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-300 mb-1">Event Deduplication Cooldown (sec)</label>
            <input
              type="number"
              min={2}
              max={300}
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100 font-mono"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveThresholds}
            className="w-full py-2 px-4 rounded bg-blue-600 hover:bg-blue-500 font-semibold text-white"
          >
            {saved ? 'Rules Saved' : 'Save Crowd & Cooldown Rules'}
          </button>

          <div className="pt-3 border-t border-slate-800 space-y-1.5 text-slate-400">
            <div className="font-semibold text-slate-300">Explainable Rule Triggers</div>
            <div>· Restricted-zone entry: bbox center inside RESTRICTED polygon</div>
            <div>· Loitering: dwell duration &ge; configured zone dwell seconds</div>
            <div>· Prolonged stationary presence: &lt; 3.5 px displacement for 20s</div>
            <div>· Rapid movement: velocity &gt; 420 px/s across consecutive frames</div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-200">Configured Polygon Zones ({zones.length})</h2>
          {zones.length === 0 ? (
            <div className="text-xs text-slate-500 py-8 text-center">
              No polygon zones saved yet. Open Live Monitor and click CREATE ZONE to draw a region directly over a video feed.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2.5 px-3">Zone Name</th>
                    <th className="py-2.5 px-3">Camera</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Dwell (s)</th>
                    <th className="py-2.5 px-3 text-right">Crowd Limit</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {zones.map((z) => (
                    <tr key={z.id}>
                      <td className="py-2.5 px-3 font-medium text-slate-100">{z.name}</td>
                      <td className="py-2.5 px-3 text-slate-300">{cameraName(z.camera_id)}</td>
                      <td className="py-2.5 px-3 font-mono">
                        <span
                          className={
                            z.zone_type === 'RESTRICTED'
                              ? 'text-red-400'
                              : z.zone_type === 'MONITORING'
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          }
                        >
                          {z.zone_type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {z.dwell_time_sec}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                        {z.crowd_threshold}
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/zones/${z.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: z.enabled ? 0 : 1 }),
                            });
                            await loadZones();
                          }}
                          className="px-2 py-1 rounded bg-slate-800 text-slate-300"
                        >
                          {z.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/zones/${z.id}`, { method: 'DELETE' });
                            await loadZones();
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 align-middle"
                        >
                          <Trash2 className="w-3.5 h-3.5 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
