import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScanFace, Loader2, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { setFacePass } from '../../lib/storage';
import {
  enrollFace, removeFace, scanForEnrollment, scanForPunch, startCamera, stopCamera, verifyFace,
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
      streamRef.current = await startCamera(video);
      if (signal.cancelled) return;
      setPhase('scanning');
      if (mode === 'verify') {
        const descriptor = await scanForPunch(video, setMessage, signal);
        setPhase('sending');
        const pass = await verifyFace(employeeId, descriptor);
        setFacePass(employeeId, { token: pass.token, expiresAt: pass.expiresAt });
      } else {
        const samples = await scanForEnrollment(video, setMessage, signal);
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
  }, [mode, employeeId, adminId, cleanup, onSuccess]);

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

        <div className={showVideo ? 'relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/3]' : 'hidden'}>
          <video ref={videoRef} className="w-full h-full object-cover -scale-x-100" muted playsInline />
          {phase === 'scanning' && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-44 h-56 rounded-[50%] border-4 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
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
