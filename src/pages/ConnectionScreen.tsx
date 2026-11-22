import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  Film,
  Globe,
  Link2,
  Play,
  Radio,
  Smartphone,
  Upload,
  Video,
  Wifi,
} from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AppPage, CameraRecord, CameraSourceType } from '../types/visionguard.ts';

export interface ActiveSessionConfig {
  camera: CameraRecord;
  demoVideoUrl?: string;
  webcamStream?: MediaStream;
}

interface DemoVideoItem {
  filename: string;
  source: 'sample_data' | 'uploaded';
  size_bytes: number;
  stream_url: string;
  created_at: string;
}

interface ConnectionScreenProps {
  cameras: CameraRecord[];
  activeSession: ActiveSessionConfig | null;
  latestMobileFrame: { camera_id: string; frame_data_url: string; width: number; height: number; capture_fps: number; latency_ms: number } | null;
  onRefreshCameras: () => Promise<void>;
  onActivateSession: (session: ActiveSessionConfig) => void;
  onDisconnectSession: (cameraId: string) => Promise<void>;
  onNavigate: (page: AppPage) => void;
}

export const ConnectionScreen: React.FC<ConnectionScreenProps> = ({
  cameras,
  activeSession,
  latestMobileFrame,
  onRefreshCameras,
  onActivateSession,
  onDisconnectSession,
  onNavigate,
}) => {
  const [mode, setMode] = useState<'connect' | 'demo'>('connect');
  const [sourceType, setSourceType] = useState<CameraSourceType>('MOBILE');
  const [cameraName, setCameraName] = useState('Mobile Cam 01');
  const [streamUrl, setStreamUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [registeredMobileCam, setRegisteredMobileCam] = useState<CameraRecord | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const [demoVideos, setDemoVideos] = useState<DemoVideoItem[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<DemoVideoItem | null>(null);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const webcamPreviewStreamRef = useRef<MediaStream | null>(null);
  const [previewStats, setPreviewStats] = useState<{
    status: string;
    resolution: string;
    fps: number;
    latency: number;
  }>({
    status: 'DISCONNECTED',
    resolution: '0 x 0',
    fps: 0,
    latency: 0,
  });

  const loadDemoVideos = async () => {
    try {
      const data = await apiFetch<{ videos: DemoVideoItem[] }>('/api/demo/videos');
      setDemoVideos(data.videos);
      if (data.videos.length > 0 && !selectedVideo) {
        setSelectedVideo(data.videos[0]);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadDemoVideos();
    return () => {
      if (webcamPreviewStreamRef.current && !activeSession?.webcamStream) {
        webcamPreviewStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    if (latestMobileFrame && registeredMobileCam && latestMobileFrame.camera_id === registeredMobileCam.id) {
      setPreviewStats({
        status: 'CONNECTED',
        resolution: `${latestMobileFrame.width} x ${latestMobileFrame.height}`,
        fps: latestMobileFrame.capture_fps,
        latency: latestMobileFrame.latency_ms,
      });
    }
  }, [latestMobileFrame, registeredMobileCam]);

  const handleSourceSelect = (t: CameraSourceType) => {
    setSourceType(t);
    setTestResult(null);
    setErrorMsg(null);
    if (t === 'MOBILE') setCameraName('Mobile Cam 01');
    if (t === 'WEBCAM') setCameraName('Laptop Webcam');
    if (t === 'IP') setCameraName('IP Camera 01');
    if (t === 'RTSP') setCameraName('RTSP Perimeter Feed');
    if (t === 'VIDEO_FILE') setCameraName('Video File Feed');
  };

  const handleTestConnection = async () => {
    setErrorMsg(null);
    setTestResult(null);

    if (sourceType === 'WEBCAM') {
      setTesting(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        if (webcamPreviewStreamRef.current) {
          webcamPreviewStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        webcamPreviewStreamRef.current = stream;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = stream;
          await previewVideoRef.current.play();
        }
        setPreviewStats({
          status: 'CONNECTED',
          resolution: `${settings.width || 640} x ${settings.height || 480}`,
          fps: Math.round(settings.frameRate || 30),
          latency: 8,
        });
        setTestResult({
          ok: true,
          message: `Webcam permission granted (${settings.width || 640}x${settings.height || 480}). Live frames verified.`,
        });
      } catch (err) {
        setTestResult({
          ok: false,
          message: err instanceof Error ? err.message : 'Webcam permission denied or device unavailable.',
        });
      } finally {
        setTesting(false);
      }
      return;
    }

    if (sourceType === 'MOBILE' && !streamUrl.trim()) {
      setTestResult({
        ok: true,
        message: 'Ready to generate Mobile Live Sender Link. Click Connect to open the WebSocket camera ingest channel for your phone.',
      });
      return;
    }

    setTesting(true);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string; error?: string; width?: number; height?: number }>(
        '/api/cameras/test-connection',
        {
          method: 'POST',
          body: JSON.stringify({ source_type: sourceType, stream_url: streamUrl.trim() }),
        }
      );
      if (res.ok) {
        setTestResult({ ok: true, message: res.message || 'Stream connection verified.' });
        if (res.width && res.height) {
          setPreviewStats((s) => ({ ...s, resolution: `${res.width} x ${res.height}`, status: 'CONNECTED' }));
        }
      } else {
        setTestResult({ ok: false, message: res.error || 'Failed to verify stream.' });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = async () => {
    setErrorMsg(null);
    setConnecting(true);
    try {
      if (sourceType === 'VIDEO_FILE') {
        setMode('demo');
        setConnecting(false);
        return;
      }

      if (sourceType === 'WEBCAM') {
        let stream = webcamPreviewStreamRef.current;
        if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          webcamPreviewStreamRef.current = stream;
        }
        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();

        const created = await apiFetch<{ camera: CameraRecord }>('/api/cameras', {
          method: 'POST',
          body: JSON.stringify({
            name: cameraName.trim() || 'Laptop Webcam',
            source_type: 'WEBCAM',
            stream_url: 'webcam://0',
          }),
        });

        const updated = await apiFetch<{ camera: CameraRecord }>(`/api/cameras/${created.camera.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'CONNECTED',
            is_active: 1,
            resolution_width: settings.width || 640,
            resolution_height: settings.height || 480,
            capture_fps: Math.round(settings.frameRate || 30),
          }),
        });

        await onRefreshCameras();
        onActivateSession({ camera: updated.camera, webcamStream: stream });
        onNavigate('live');
        return;
      }

      if (sourceType === 'MOBILE') {
        const created = await apiFetch<{ camera: CameraRecord }>('/api/cameras', {
          method: 'POST',
          body: JSON.stringify({
            name: cameraName.trim() || 'Mobile Cam 01',
            source_type: 'MOBILE',
            stream_url: streamUrl.trim() || undefined,
          }),
        });
        await onRefreshCameras();
        setRegisteredMobileCam(created.camera);

        if (streamUrl.trim()) {
          // If an HTTP MJPEG URL was provided, test it first before claiming connected
          const check = await apiFetch<{ ok: boolean; error?: string }>('/api/cameras/test-connection', {
            method: 'POST',
            body: JSON.stringify({ source_type: 'MOBILE', stream_url: streamUrl.trim() }),
          });
          if (!check.ok) {
            setErrorMsg(check.error || 'Could not receive frames from provided mobile URL.');
            return;
          }
          const updated = await apiFetch<{ camera: CameraRecord }>(`/api/cameras/${created.camera.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'CONNECTED', is_active: 1 }),
          });
          await onRefreshCameras();
          onActivateSession({ camera: updated.camera });
          onNavigate('live');
        } else {
          // Mobile WebSocket Broadcaster workflow: stays in CONNECTING until real frames arrive from phone
          await apiFetch(`/api/cameras/${created.camera.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'CONNECTING', is_active: 1 }),
          });
          await onRefreshCameras();
          onActivateSession({ camera: created.camera });
        }
        return;
      }

      // IP or RTSP Camera
      const created = await apiFetch<{ camera: CameraRecord }>('/api/cameras', {
        method: 'POST',
        body: JSON.stringify({
          name: cameraName.trim() || `${sourceType} Camera`,
          source_type: sourceType,
          stream_url: streamUrl.trim(),
        }),
      });
      const check = await apiFetch<{ ok: boolean; error?: string; via?: string }>('/api/cameras/test-connection', {
        method: 'POST',
        body: JSON.stringify({ source_type: sourceType, stream_url: streamUrl.trim() }),
      });

      if (!check.ok) {
        await apiFetch(`/api/cameras/${created.camera.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ERROR', last_error: check.error || 'Unable to connect' }),
        });
        await onRefreshCameras();
        setErrorMsg(check.error || 'Stream verification failed.');
        return;
      }

      const updated = await apiFetch<{ camera: CameraRecord }>(`/api/cameras/${created.camera.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CONNECTED', is_active: 1 }),
      });
      await onRefreshCameras();
      onActivateSession({ camera: updated.camera });
      onNavigate('live');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to connect camera.');
    } finally {
      setConnecting(false);
    }
  };

  const handleUploadDemoVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append('video', file);
      const res = await apiFetch<{ video: DemoVideoItem }>('/api/demo/upload', {
        method: 'POST',
        body: form,
      });
      await loadDemoVideos();
      setSelectedVideo(res.video);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Video upload failed.');
    } finally {
      setUploadingVideo(false);
      e.target.value = '';
    }
  };

  const handleLaunchDemoVideo = async (video: DemoVideoItem) => {
    setErrorMsg(null);
    setConnecting(true);
    try {
      const created = await apiFetch<{ camera: CameraRecord }>('/api/cameras', {
        method: 'POST',
        body: JSON.stringify({
          name: `Demo: ${video.filename}`,
          source_type: 'VIDEO_FILE',
          stream_url: `${window.location.origin}${video.stream_url}`,
        }),
      });
      const updated = await apiFetch<{ camera: CameraRecord }>(`/api/cameras/${created.camera.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'CONNECTED', is_active: 1 }),
      });
      await onRefreshCameras();
      onActivateSession({
        camera: updated.camera,
        demoVideoUrl: video.stream_url,
      });
      onNavigate('live');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to launch demo video.');
    } finally {
      setConnecting(false);
    }
  };

  const mobileSenderUrl = registeredMobileCam
    ? `${window.location.origin}/mobile-cam?cam=${encodeURIComponent(registeredMobileCam.id)}&token=${encodeURIComponent(
        registeredMobileCam.ingest_token || ''
      )}&name=${encodeURIComponent(registeredMobileCam.name)}`
    : null;

  const copySenderUrl = async () => {
    if (!mobileSenderUrl) return;
    await navigator.clipboard.writeText(mobileSenderUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const sourceCards: Array<{
    type: CameraSourceType;
    label: string;
    detail: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { type: 'MOBILE', label: 'Mobile Camera', detail: 'Phone live link or MJPEG URL', icon: Smartphone },
    { type: 'WEBCAM', label: 'Webcam', detail: 'Browser camera permission', icon: Camera },
    { type: 'IP', label: 'IP Camera', detail: 'HTTP / MJPEG stream URL', icon: Globe },
    { type: 'RTSP', label: 'RTSP Camera', detail: 'Via Python OpenCV Service', icon: Radio },
    { type: 'VIDEO_FILE', label: 'Video File', detail: 'Prerecorded MP4 / WebM', icon: Film },
  ];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-100">
          VisionGuard
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Intelligent Real-Time Computer Vision &amp; Situational Awareness
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <button
            type="button"
            onClick={() => setMode('connect')}
            className={`text-left p-5 rounded-lg border transition-colors ${
              mode === 'connect'
                ? 'bg-[#111a2e] border-blue-500/60'
                : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base font-semibold text-slate-100">Connect Camera</span>
              <Wifi className={`w-5 h-5 ${mode === 'connect' ? 'text-blue-400' : 'text-slate-500'}`} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Acquire live video from a mobile phone camera, laptop webcam, IP camera, or RTSP stream into the CV pipeline.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setMode('demo')}
            className={`text-left p-5 rounded-lg border transition-colors ${
              mode === 'demo'
                ? 'bg-[#111a2e] border-blue-500/60'
                : 'bg-[#0f172a] border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-display text-base font-semibold text-slate-100">Demo Mode</span>
              <Video className={`w-5 h-5 ${mode === 'demo' ? 'text-blue-400' : 'text-slate-500'}`} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Upload prerecorded real-world footage and run the identical detection, tracking, zone, and evidence pipeline.
            </p>
          </button>
        </div>
      </div>

      {mode === 'connect' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-5">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-200 mb-3">1. Select Video Input Source</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {sourceCards.map((item) => {
                  const Icon = item.icon;
                  const active = sourceType === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleSourceSelect(item.type)}
                      className={`p-3 rounded-md border text-left transition-colors ${
                        active
                          ? 'bg-blue-600/15 border-blue-500/50 text-slate-100'
                          : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <Icon className={`w-4 h-4 mb-1.5 ${active ? 'text-blue-400' : 'text-slate-400'}`} />
                      <div className="text-xs font-semibold whitespace-nowrap">{item.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">{item.detail}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Camera Name</label>
                <input
                  type="text"
                  value={cameraName}
                  onChange={(e) => setCameraName(e.target.value)}
                  placeholder="e.g., Main Entrance Mobile Cam"
                  className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500"
                />
              </div>

              {(sourceType === 'MOBILE' || sourceType === 'IP' || sourceType === 'RTSP') && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Stream URL {sourceType === 'MOBILE' && <span className="text-slate-500">(optional if using Mobile Broadcaster Link)</span>}
                  </label>
                  <input
                    type="text"
                    value={streamUrl}
                    onChange={(e) => setStreamUrl(e.target.value)}
                    placeholder={
                      sourceType === 'RTSP'
                        ? 'rtsp://user:pass@192.168.1.50:554/stream1'
                        : sourceType === 'MOBILE'
                          ? 'Leave blank for Phone Live Link, or enter http://192.168.1.x:8080/video'
                          : 'http://camera-host:8080/video'
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                  {sourceType === 'RTSP' && (
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Browser limitation: HTML5 video cannot decode raw RTSP directly. Start the Python OpenCV CV Service (<code className="text-slate-300">cv_service/run_windows.bat</code>) to acquire RTSP streams.
                    </p>
                  )}
                  {sourceType === 'MOBILE' && (
                    <p className="text-[11px] text-slate-400 mt-1.5">
                      Recommended for real phone streaming: leave URL blank and click <strong className="text-slate-200">Connect</strong> to generate a secure HTTPS phone camera broadcaster link that streams frames directly into VisionGuard.
                    </p>
                  )}
                </div>
              )}

              {testResult && (
                <div
                  className={`p-3 rounded-md border text-xs flex items-start gap-2 ${
                    testResult.ok
                      ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                      : 'bg-amber-950/30 border-amber-800/60 text-amber-300'
                  }`}
                >
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>{testResult.message}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 rounded-md border bg-red-950/30 border-red-800/60 text-red-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testing || connecting}
                  className="px-4 py-2 rounded-md border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap"
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={connecting}
                  className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap"
                >
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
                {activeSession && (
                  <button
                    type="button"
                    onClick={() => onDisconnectSession(activeSession.camera.id)}
                    className="px-4 py-2 rounded-md border border-red-800/70 bg-red-950/30 hover:bg-red-900/40 text-xs font-medium text-red-300 transition-colors whitespace-nowrap"
                  >
                    Disconnect Active
                  </button>
                )}
              </div>

              {mobileSenderUrl && (
                <div className="mt-4 p-4 rounded-md bg-slate-950 border border-blue-500/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                      <Link2 className="w-4 h-4" />
                      Mobile Phone Live Broadcaster Ready
                    </span>
                    <button
                      type="button"
                      onClick={() => onNavigate('live')}
                      className="text-xs font-medium text-blue-400 hover:text-blue-300 underline"
                    >
                      Open Live Monitor
                    </button>
                  </div>
                  <p className="text-xs text-slate-400">
                    Open this URL on your phone (or in another tab) and tap <strong className="text-slate-200">Start Mobile Stream</strong>. Frames will stream live into VisionGuard:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={mobileSenderUrl}
                      className="flex-1 bg-[#0f172a] border border-slate-800 rounded px-2.5 py-1.5 text-[11px] font-mono text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={copySenderUrl}
                      className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1 whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                    <a
                      href={mobileSenderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white flex items-center gap-1 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-lg p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-sm font-semibold text-slate-200">Live Connection Preview</h2>
                <span className="font-mono text-xs text-slate-400">{previewStats.status}</span>
              </div>
              <div className="aspect-video bg-slate-950 border border-slate-800 rounded-md overflow-hidden flex items-center justify-center relative">
                {latestMobileFrame && registeredMobileCam && latestMobileFrame.camera_id === registeredMobileCam.id ? (
                  <img
                    src={latestMobileFrame.frame_data_url}
                    alt="Mobile live preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <video ref={previewVideoRef} playsInline muted className="w-full h-full object-contain" />
                )}
                {previewStats.status === 'DISCONNECTED' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-slate-950/80">
                    <Camera className="w-8 h-8 text-slate-600 mb-2" />
                    <span className="text-xs text-slate-400">
                      Run Test Connection or Connect to verify live frames.
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 text-xs">
              <div>
                <div className="text-slate-500">Resolution</div>
                <div className="font-mono tabular-nums text-slate-200 mt-0.5">{previewStats.resolution}</div>
              </div>
              <div>
                <div className="text-slate-500">Capture FPS</div>
                <div className="font-mono tabular-nums text-slate-200 mt-0.5">{previewStats.fps} fps</div>
              </div>
              <div>
                <div className="text-slate-500">Latency</div>
                <div className="font-mono tabular-nums text-slate-200 mt-0.5">{previewStats.latency} ms</div>
              </div>
              <div>
                <div className="text-slate-500">Registered Cameras</div>
                <div className="font-mono tabular-nums text-slate-200 mt-0.5">{cameras.length}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-200">Prerecorded Video Ingestion</h2>
              <label className="cursor-pointer px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap">
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingVideo ? 'Uploading...' : 'Upload Video (.mp4/.webm)'}</span>
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                  onChange={handleUploadDemoVideo}
                  className="hidden"
                />
              </label>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-md border bg-red-950/30 border-red-800/60 text-red-300 text-xs">
                {errorMsg}
              </div>
            )}

            {demoVideos.length === 0 ? (
              <div className="border border-dashed border-slate-700 rounded-md p-6 text-center space-y-2">
                <Film className="w-8 h-8 text-slate-500 mx-auto" />
                <div className="text-sm font-medium text-slate-300">No demonstration videos found</div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Upload a real-world MP4/WebM video above, or place royalty-free demonstration footage inside{' '}
                  <code className="text-slate-200">sample_data/videos/</code>. VisionGuard processes uploaded footage through the exact same real CV pipeline.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-md">
                {demoVideos.map((vid) => {
                  const isSel = selectedVideo?.filename === vid.filename;
                  return (
                    <div
                      key={`${vid.source}_${vid.filename}`}
                      className={`p-3 flex items-center justify-between gap-3 ${
                        isSel ? 'bg-slate-800/60' : 'hover:bg-slate-900/60'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedVideo(vid)}
                        className="text-left min-w-0 flex-1"
                      >
                        <div className="text-xs font-medium text-slate-100 truncate">{vid.filename}</div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          {vid.source} · {(vid.size_bytes / (1024 * 1024)).toFixed(2)} MB
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLaunchDemoVideo(vid)}
                        disabled={connecting}
                        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Process Video</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-lg p-5 space-y-3">
            <h2 className="font-display text-sm font-semibold text-slate-200">Supported Capstone Scenarios</h2>
            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-100">DEMO 01 · People Walking</div>
                <div className="text-slate-400 mt-0.5">
                  Verifies bounding boxes, confidence scores, persistent Track IDs, and trajectory history.
                </div>
              </div>
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-100">DEMO 02 · Crowded Public Area</div>
                <div className="text-slate-400 mt-0.5">
                  Verifies occupancy counting (0–4 NORMAL, 5–9 ELEVATED, 10+ HIGH) and CROWDING alerts.
                </div>
              </div>
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-100">DEMO 03 · Restricted Zone Entry</div>
                <div className="text-slate-400 mt-0.5">
                  Draw a Restricted polygon in Live Monitor to trigger DANGER_ZONE_INTRUSION, LOITERING_DETECTED, and evidence capture.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
