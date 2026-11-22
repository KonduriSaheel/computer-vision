import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Search } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AppPage, EvidenceRecord, IncidentEventRecord } from '../types/visionguard.ts';

interface IncidentsPageProps {
  onNavigate: (page: AppPage) => void;
  onRefreshCount: () => void;
}

export const IncidentsPage: React.FC<IncidentsPageProps> = ({ onNavigate, onRefreshCount }) => {
  const [incidents, setIncidents] = useState<IncidentEventRecord[]>([]);
  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<IncidentEventRecord | null>(null);

  const loadIncidents = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (severity !== 'ALL') qs.set('severity', severity);
      if (status !== 'ALL') qs.set('status', status);
      if (search.trim()) qs.set('q', search.trim());
      const res = await apiFetch<{ incidents: IncidentEventRecord[] }>(`/api/incidents?${qs.toString()}`);
      setIncidents(res.incidents);
    } catch {
      // ignore
    }
  }, [severity, status, search]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents]);

  const updateStatus = async (id: string, nextStatus: 'ACKNOWLEDGED' | 'RESOLVED') => {
    await apiFetch(`/api/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadIncidents();
    onRefreshCount();
    if (selected?.id === id) {
      setSelected((prev) => (prev ? { ...prev, status: nextStatus } : null));
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Module 3 · Incidents &amp; Event Log
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Searchable and filterable incident records with explainable triggers, acknowledgement workflow, and evidence links
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 bg-[#0f172a] border border-slate-800 rounded-lg p-3.5 text-xs">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Event ID, description, camera, or reason..."
            className="w-full bg-slate-950 border border-slate-800 rounded pl-9 pr-3 py-1.5 text-slate-100"
          />
        </div>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-slate-200"
        >
          <option value="ALL">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-slate-200"
        >
          <option value="ALL">All Statuses</option>
          <option value="NEW">NEW</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="RESOLVED">RESOLVED</option>
        </select>
      </div>

      {incidents.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-8 text-center text-xs text-slate-500">
          No incidents match the current filter criteria.
        </div>
      ) : (
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-3">Event</th>
                <th className="py-3 px-3">Severity</th>
                <th className="py-3 px-3">Camera</th>
                <th className="py-3 px-3 text-right">Track</th>
                <th className="py-3 px-3">Timestamp</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {incidents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-800/30">
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-400">{ev.id.slice(0, 16)}</td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-100">{ev.event_type}</div>
                    <div className="text-[11px] text-slate-400 truncate max-w-[260px]">{ev.description}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono font-semibold">
                    <span
                      className={
                        ev.severity === 'CRITICAL' || ev.severity === 'HIGH'
                          ? 'text-red-400'
                          : ev.severity === 'MEDIUM'
                            ? 'text-amber-400'
                            : 'text-slate-300'
                      }
                    >
                      {ev.severity}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{ev.camera_name || ev.camera_id || '-'}</td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                    {ev.track_id !== null ? `#${String(ev.track_id).padStart(2, '0')}` : '-'}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] tabular-nums text-slate-400">
                    {new Date(ev.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">{ev.status}</td>
                  <td className="py-2.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelected(ev)}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                    >
                      Details
                    </button>
                    {ev.status === 'NEW' && (
                      <button
                        type="button"
                        onClick={() => updateStatus(ev.id, 'ACKNOWLEDGED')}
                        className="px-2 py-1 rounded bg-amber-950/60 border border-amber-800/60 text-amber-300"
                      >
                        Acknowledge
                      </button>
                    )}
                    {ev.status !== 'RESOLVED' && (
                      <button
                        type="button"
                        onClick={() => updateStatus(ev.id, 'RESOLVED')}
                        className="px-2 py-1 rounded bg-emerald-950/60 border border-emerald-800/60 text-emerald-300"
                      >
                        Resolve
                      </button>
                    )}
                    {ev.evidence_id && (
                      <button
                        type="button"
                        onClick={() => onNavigate('evidence')}
                        className="px-2 py-1 rounded bg-blue-600/20 text-blue-300"
                      >
                        Evidence
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="bg-[#0f172a] border border-slate-700 rounded-lg p-5 w-full max-w-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="font-display text-base font-semibold text-slate-100">{selected.event_type}</div>
                <div className="font-mono text-[11px] text-slate-400">{selected.id}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="px-2.5 py-1 rounded bg-slate-800 text-slate-300"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 text-slate-300">
              <div><strong className="text-slate-100">Severity:</strong> {selected.severity}</div>
              <div><strong className="text-slate-100">Status:</strong> {selected.status}</div>
              <div><strong className="text-slate-100">Camera:</strong> {selected.camera_name || selected.camera_id || '-'}</div>
              <div><strong className="text-slate-100">Description:</strong> {selected.description}</div>
              {selected.reason && <div><strong className="text-slate-100">Explanation:</strong> {selected.reason}</div>}
              <div><strong className="text-slate-100">Timestamp:</strong> {new Date(selected.created_at).toLocaleString()}</div>
            </div>
            {selected.evidence_id && (
              <div className="border border-slate-800 rounded overflow-hidden bg-slate-950">
                <img
                  src={`/api/evidence/file/${selected.evidence_id}`}
                  alt="Incident evidence snapshot"
                  className="w-full max-h-72 object-contain"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const EvidencePage: React.FC = () => {
  const [items, setItems] = useState<EvidenceRecord[]>([]);

  useEffect(() => {
    apiFetch<{ evidence: EvidenceRecord[] }>('/api/evidence')
      .then((res) => setItems(res.evidence))
      .catch(() => {});
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">Module 3 · Evidence Vault</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Captured forensic snapshots stored under evidence/YEAR/MONTH/EVENT_ID/ with SQLite metadata
        </p>
      </div>

      {items.length === 0 ? (
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-8 text-center space-y-2">
          <Archive className="w-8 h-8 text-slate-600 mx-auto" />
          <div className="text-sm text-slate-300">No evidence snapshots captured yet</div>
          <p className="text-xs text-slate-500">
            Evidence frames are captured automatically on HIGH/CRITICAL alerts (e.g., Restricted Zone Intrusion) or manual SNAPSHOT.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((ev) => (
            <div key={ev.id} className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden flex flex-col">
              <div className="aspect-video bg-slate-950 flex items-center justify-center overflow-hidden">
                <img
                  src={`/api/evidence/file/${ev.id}`}
                  alt={`${ev.event_type} snapshot`}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4 space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100">{ev.event_type}</span>
                  <span
                    className={`font-mono font-semibold ${
                      ev.severity === 'HIGH' || ev.severity === 'CRITICAL'
                        ? 'text-red-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {ev.severity}
                  </span>
                </div>
                <div className="text-slate-400">
                  {ev.camera_name || ev.camera_id || 'Unknown Camera'} ·{' '}
                  {ev.track_id !== null ? `Track #${String(ev.track_id).padStart(2, '0')}` : 'Scene Event'}
                </div>
                <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {new Date(ev.created_at).toLocaleString()}
                </div>
                <div className="font-mono text-[10px] text-slate-600 truncate">{ev.file_path}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
