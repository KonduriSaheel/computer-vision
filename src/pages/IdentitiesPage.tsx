import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { IdentityRecord } from '../types/visionguard.ts';

export const IdentitiesPage: React.FC = () => {
  const [identities, setIdentities] = useState<IdentityRecord[]>([]);
  const [name, setName] = useState('');
  const [roleLabel, setRoleLabel] = useState('Authorized Personnel');
  const [notes, setNotes] = useState('');
  const [threshold, setThreshold] = useState(0.62);
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [evalOutput, setEvalOutput] = useState<string | null>(null);

  const loadIdentities = useCallback(async () => {
    try {
      const data = await apiFetch<{ identities: IdentityRecord[] }>('/api/identities');
      setIdentities(data.identities);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadIdentities();
  }, [loadIdentities]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!name.trim() || !files || files.length === 0) {
      setErrorMsg('Provide a name and select at least one reference face image.');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('name', name.trim());
      form.append('role_label', roleLabel.trim());
      form.append('notes', notes.trim());
      form.append('similarity_threshold', String(threshold));
      for (let i = 0; i < files.length; i++) {
        form.append('images', files[i]);
      }
      const res = await apiFetch<{ message: string }>('/api/identities', {
        method: 'POST',
        body: form,
      });
      setStatusMsg(res.message);
      setName('');
      setNotes('');
      setFiles(null);
      await loadIdentities();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Enrollment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (idn: IdentityRecord) => {
    await apiFetch(`/api/identities/${idn.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: idn.enabled ? 0 : 1 }),
    });
    await loadIdentities();
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/identities/${id}`, { method: 'DELETE' });
    await loadIdentities();
  };

  const handleRunEvaluation = async () => {
    setEvalOutput(null);
    try {
      const res = await apiFetch<Record<string, unknown>>('/api/identities/evaluate', { method: 'POST' });
      setEvalOutput(JSON.stringify(res, null, 2));
    } catch (err) {
      setEvalOutput(err instanceof Error ? err.message : 'Evaluation unavailable.');
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h1 className="font-display text-xl font-semibold text-slate-100">
          Module 2 · Face / Identity &amp; Intruder Recognition
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Authorized identity enrollment using Face Detection · Alignment · ArcFace Embeddings · Cosine Similarity
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleEnroll} className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3.5 text-xs">
          <h2 className="font-display text-sm font-semibold text-slate-200">Enroll Authorized Identity</h2>

          <div>
            <label className="block text-slate-300 mb-1">Full Name / Label</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Dr. A. Sharma"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-1">Role / Access Group</label>
            <input
              type="text"
              value={roleLabel}
              onChange={(e) => setRoleLabel(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
            />
          </div>

          <div>
            <div className="flex justify-between text-slate-300 mb-1">
              <span>Cosine Similarity Threshold</span>
              <span className="font-mono tabular-nums">{threshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.35}
              max={0.85}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-1">Reference Face Images (.jpg / .png)</label>
            <label className="flex items-center justify-center gap-2 border border-dashed border-slate-700 rounded-md p-4 cursor-pointer hover:border-blue-500/60">
              <Upload className="w-4 h-4 text-slate-400" />
              <span className="text-slate-300">
                {files && files.length > 0 ? `${files.length} image(s) selected` : 'Select reference portraits'}
              </span>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setFiles(e.target.files)}
                className="hidden"
              />
            </label>
          </div>

          <div>
            <label className="block text-slate-300 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-slate-100"
            />
          </div>

          {statusMsg && <div className="p-2.5 rounded bg-emerald-950/30 border border-emerald-800/60 text-emerald-300">{statusMsg}</div>}
          {errorMsg && <div className="p-2.5 rounded bg-red-950/30 border border-red-800/60 text-red-300">{errorMsg}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white"
          >
            {submitting ? 'Enrolling...' : 'Save Identity & Generate Embeddings'}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-5">
          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">
              Enrolled Identities ({identities.length})
            </h2>
            {identities.length === 0 ? (
              <div className="text-xs text-slate-500 py-6 text-center">
                No authorized identities enrolled. Unknown faces detected during Python CV monitoring will appear as UNKNOWN PERSON.
              </div>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-md">
                {identities.map((idn) => (
                  <div key={idn.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      {idn.sample_image_path ? (
                        <img
                          src={idn.sample_image_path}
                          alt={idn.name}
                          className="w-10 h-10 rounded object-cover border border-slate-700 shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded bg-slate-900 border border-slate-800 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">{idn.name}</div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          {idn.role_label} · {idn.embedding_count || 0} ref(s) · thresh {idn.similarity_threshold}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggle(idn)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                          idn.enabled
                            ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/60'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {idn.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(idn.id)}
                        className="p-1.5 text-slate-500 hover:text-red-400"
                        title="Delete identity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-200">
                Labeled Dataset Evaluation (Accuracy, Precision, Recall, FAR, FRR)
              </h2>
              <button
                type="button"
                onClick={handleRunEvaluation}
                className="px-3 py-1.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200"
              >
                Run Evaluation
              </button>
            </div>
            <p className="text-slate-400">
              Evaluation metrics are calculated strictly on ground-truth labeled evaluation datasets via the Python CV Service. No synthetic scores are generated.
            </p>
            {evalOutput && (
              <pre className="bg-slate-950 border border-slate-800 rounded p-3 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
                {evalOutput}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
