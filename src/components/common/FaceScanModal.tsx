import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScanFace, Loader2, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { setFacePass } from '../../lib/storage';
import {
  enrollFace, removeFace, scanForEnrollment, scanForPunch, startCamera, stopCamera, verifyFace, loadFaceEngine, type FaceLiveTelemetry,
} from '../../lib/faceScan';

export type FaceScanMode = 'verify' | 'enroll' | 'remove';

interface Props {
  isOpen: boolean;
  mode: FaceScanMode;
  employeeId: string;
  employeeName: string;
  adminId?: string; // needed for enroll / remove
  onClose: () => void;
  onSuccess: () => void;
}

type Phase = 'pin' | 'loading' | 'scanning' | 'sending' | 'done' | 'error';

export const FaceScanModal: React.FC<Props> = ({ isOpen, mode, employeeId, employeeName, adminId, onClose, onSuccess }) => {
  const needsPin = mode !== 'verify';
  const [phase, setPhase] = useState<Phase>(needsPin ? 'pin' : 'loading');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const signalRef = useRef({ cancelled: false });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [telemetry, setTelemetry] = useState<FaceLiveTelemetry | null>(null);
const [liveTime, setLiveTime] = useState(() => new Date());
  useEffect(() => {
    if (!isOpen) return;
    setLiveTime(new Date());
    const id = setInterval(() => setLiveTime(new Date()), 1000);
    return () => clearInterval(id);
  }, [isOpen]);
  const handleTelemetry = useCallback((t: FaceLiveTelemetry) => {
    setTelemetry(t);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cw = Math.round(rect.width || canvas.clientWidth);
    const ch = Math.round(rect.height || canvas.clientHeight);
    if (!cw || !ch) return;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, cw, ch);
    if (!t.detected || !t.box) return;
    const vw = t.box.videoWidth || 640;
    const vh = t.box.videoHeight || 480;
    const scale = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * scale) / 2;
    const oy = (ch - vh * scale) / 2;
    const mapX = (x: number) => x * scale + ox;
    const mapY = (y: number) => y * scale + oy;
    ctx.strokeStyle = t.livenessOk ? '#10b981' : '#06b6d4';
    ctx.lineWidth = 2;
    ctx.strokeRect(mapX(t.box.x), mapY(t.box.y), t.box.width * scale, t.box.height * scale);
    if (t.landmarks && t.landmarks.length > 0) {
      t.landmarks.forEach((pt, idx) => {
        let color = '#34d399';
        if (idx <= 16) color = t.jawOk ? '#10b981' : '#22d3ee';
        else if (idx >= 27 && idx <= 35) color = t.noseOk ? '#10b981' : '#22d3ee';
        else if (idx >= 36 && idx <= 47) color = t.eyesOk ? '#10b981' : '#22d3ee';
        else if (idx >= 48 && idx <= 67) color = t.mouthOk ? '#10b981' : '#22d3ee';
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(mapX(pt.x), mapY(pt.y), 2.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }, []);
  
  const cleanup = useCallback(() => {
    signalRef.current.cancelled = true;
    stopCamera(streamRef.current);
    streamRef.current = null;
  }, []);

  const run = useCallback(async (adminPin: string) => {
    cleanup();
    const signal = { cancelled: false };
    signalRef.current = signal;
    setError('');
    try {
      if (mode === 'remove') {
        setPhase('sending');
        await removeFace(employeeId, adminId || '', adminPin);
        setPhase('done');
        setTimeout(onSuccess, 700);
        return;
      }
      setPhase('loading');
      setMessage('Starting camera and loading face model…');
      const video = videoRef.current;
      if (!video) return;
      const [stream] = await Promise.all([startCamera(video), loadFaceEngine()]);
      streamRef.current = stream;
      if (signal.cancelled) return;
      setPhase('scanning');
      if (mode === 'verify') {
        const descriptor = await scanForPunch(video, setMessage, signal, 25000, handleTelemetry);
        setPhase('sending');
        const pass = await verifyFace(employeeId, descriptor);
        setFacePass(employeeId, { token: pass.token, expiresAt: pass.expiresAt });
      } else {
        const samples = await scanForEnrollment(video, setMessage, signal, 5, 40000, handleTelemetry);
        setPhase('sending');
        await enrollFace(employeeId, samples, adminId || '', adminPin);
      }
      cleanup();
      setPhase('done');
      setTimeout(onSuccess, 700);
    } catch (e) {
      if (signal.cancelled) return;
      cleanup();
      const err = e as Error & { name?: string };
      const msg =
        err.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow the camera for this site and try again.'
        : err.name === 'NotFoundError' ? 'No camera was found on this device.'
        : err.message || 'Face scan failed.';
      setError(msg);
      setPhase('error');
    }
  }, [mode, employeeId, adminId, cleanup, onSuccess, handleTelemetry]);

  useEffect(() => {
    if (!isOpen) return;
    setPin('');
    setError('');
    if (needsPin) setPhase('pin');
    else void run('');
    return cleanup;
  }, [isOpen, needsPin, run, cleanup]);

  const title = mode === 'verify' ? 'Face scan to punch' : mode === 'enroll' ? 'Enroll face' : 'Remove enrolled face';
  const showVideo = mode !== 'remove' && (phase === 'loading' || phase === 'scanning' || phase === 'sending');

  return (
    <Modal isOpen={isOpen} onClose={() => { cleanup(); onClose(); }} title={title} subtitle={employeeName} maxWidth="md">
      <div className="space-y-4">
        {phase === 'pin' && (
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (pin.trim()) void run(pin.trim()); }}
          >
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Enter the administrator PIN to {mode === 'enroll' ? 'enroll this face' : 'remove this face'}. It is checked on the server.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Administrator PIN"
              aria-label="Administrator PIN"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <button type="submit" className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">
              {mode === 'enroll' ? <ScanFace className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
              <span>{mode === 'enroll' ? 'Continue to camera' : 'Remove face'}</span>
            </button>
          </form>
        )}

        <div className={showVideo ? 'relative rounded-xl overflow-hidden bg-slate-900 w-full aspect-[3/4] sm:aspect-[4/3] max-h-[58dvh] sm:max-h-[360px] mx-auto shadow-inner' : 'hidden'}>
          <video ref={videoRef} className="w-full h-full object-cover -scale-x-100" muted playsInline />
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none -scale-x-100" />
          {showVideo && (
            <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2 pointer-events-none z-10">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-sm border border-white/15 text-white text-[11px] font-medium min-w-0">
                <span className={`w-2 h-2 rounded-full shrink-0 animate-pulse ${telemetry?.detected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="truncate max-w-[110px] sm:max-w-[160px]">{employeeName}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider shrink-0 ${telemetry?.detected ? 'bg-emerald-500/25 text-emerald-300' : 'bg-cyan-500/25 text-cyan-300'}`}>
                  {telemetry?.detected ? 'FACE DETECTED' : 'SCANNING'}
                </span>
              </div>
              <div className="px-2.5 py-1 rounded-full bg-slate-950/75 backdrop-blur-sm border border-white/15 text-white font-mono text-[10px] sm:text-[11px] shrink-0">
                {liveTime.toLocaleDateString([], { month: 'short', day: 'numeric' })} · {liveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>
          )}
          {phase === 'scanning' && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-36 h-48 sm:w-44 sm:h-56 rounded-[50%] border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
            </div>
          )}
          {showVideo && (
            <div className="absolute bottom-2.5 inset-x-2.5 flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-950/75 backdrop-blur-sm border border-white/15 text-[10px] sm:text-[11px] pointer-events-none z-10">
              <div className="flex flex-wrap items-center gap-1">
                {[
                  { label: 'Eyes', ok: telemetry?.eyesOk },
                  { label: 'Nose', ok: telemetry?.noseOk },
                  { label: 'Mouth', ok: telemetry?.mouthOk },
                  { label: 'Jaw', ok: telemetry?.jawOk },
                ].map((f) => (
                  <span
                    key={f.label}
                    className={`px-1.5 py-0.5 rounded font-medium ${f.ok ? 'bg-emerald-500/25 text-emerald-300' : 'bg-white/10 text-slate-300'}`}
                  >
                    {f.label} {f.ok ? '✓' : '·'}
                  </span>
                ))}
              </div>
              <span className={`px-2 py-0.5 rounded font-semibold ${telemetry?.livenessOk ? 'bg-emerald-500/30 text-emerald-300' : 'bg-cyan-500/25 text-cyan-200'}`}>
                {telemetry?.livenessOk ? 'LIVE VERIFIED ✓' : `Liveliness ${Math.round(telemetry?.livenessProgress ?? 0)}%`}
              </span>
            </div>
          )}
        </div>

        {(phase === 'loading' || phase === 'scanning' || phase === 'sending') && mode !== 'remove' && (
          <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200" role="status" aria-live="polite">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{phase === 'sending' ? 'Checking with the server…' : message}</span>
          </div>
        )}
        {phase === 'sending' && mode === 'remove' && (
          <div className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Removing…</div>
        )}
        {phase === 'done' && (
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600" role="status">
            <CheckCircle2 className="w-5 h-5" />
            <span>{mode === 'verify' ? 'Face verified' : mode === 'enroll' ? 'Face enrolled' : 'Face removed'}</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400" role="alert">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => (needsPin ? setPhase('pin') : void run(''))} className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">Try again</button>
              <button type="button" onClick={() => { cleanup(); onClose(); }} className="px-4 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-700 cursor-pointer">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
