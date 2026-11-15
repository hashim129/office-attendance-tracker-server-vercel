/**
 * Face scan helpers (browser side).
 * The recognition library (face-api) and its models are served from /vendor and /models and are only
 * downloaded when someone actually opens a face scan, so normal pages stay light.
 * The browser only turns a face into 128 numbers; the server does the matching.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
let enginePromise: Promise<any> | null = null;

export function loadFaceEngine(): Promise<any> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const url = '/vendor/face-api.esm.js';
      const faceapi: any = await import(/* @vite-ignore */ url);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      return faceapi;
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot open the camera. Use Chrome, Edge or Safari over https.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  (video as any).playsInline = true;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye Aspect Ratio from the 6 landmark points of one eye (about 0.3 open, below 0.2 closed). */
export function eyeAspectRatio(eye: Pt[]): number {
  if (eye.length < 6) return 0.3;
  const horizontal = dist(eye[0], eye[3]);
  if (horizontal === 0) return 0.3;
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * horizontal);
}

export function averageEar(points68: Pt[]): number {
  return (eyeAspectRatio(points68.slice(36, 42)) + eyeAspectRatio(points68.slice(42, 48))) / 2;
}

/**
 * Counts a blink once the eyes were open, then clearly closed, then open again.
 * Thresholds follow this person's own open-eye level, so narrow eyes and glasses work too.
 */
export class BlinkTracker {
  private state: 'waiting-open' | 'open' | 'closed' = 'waiting-open';
  private baseline = 0;
  blinked = false;
  update(ear: number): void {
    if (this.blinked || !Number.isFinite(ear)) return;
    if (this.state !== 'closed') this.baseline = Math.max(ear, this.baseline * 0.985);
    const closedBelow = this.baseline * 0.75;
    const openAbove = this.baseline * 0.88;
    if (this.state === 'waiting-open') {
      if (this.baseline >= 0.2 && ear >= openAbove) this.state = 'open';
    } else if (this.state === 'open') {
      if (ear < closedBelow) this.state = 'closed';
    } else if (ear > openAbove) {
      this.blinked = true;
    }
  }
}

// Only an automated test build sets this (via the bundler); it is undefined in the real app.
declare const __FACE_TEST_SKIP_BLINK__: boolean | undefined;
const SKIP_BLINK_FOR_TESTS = typeof __FACE_TEST_SKIP_BLINK__ !== 'undefined' && __FACE_TEST_SKIP_BLINK__ === true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ScanProgress = (msg: string) => void;

function tinyOpts(faceapi: any) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
}

/** Looks at the camera until it sees ONE clear face, returns its landmarks. */
async function readFrame(faceapi: any, video: HTMLVideoElement, progress: ScanProgress) {
  const faces = await faceapi.detectAllFaces(video, tinyOpts(faceapi)).withFaceLandmarks();
  if (faces.length === 0) {
    progress('Looking for your face…');
    return null;
  }
  if (faces.length > 1) {
    progress('Only one person should be in front of the camera.');
    return null;
  }
  const f = faces[0];
  const box = f.detection.box;
  if (box.width < video.videoWidth * 0.22) {
    progress('Move a little closer to the camera.');
    return null;
  }
  return f;
}

async function captureDescriptor(faceapi: any, video: HTMLVideoElement): Promise<number[] | null> {
  const one = await faceapi.detectSingleFace(video, tinyOpts(faceapi)).withFaceLandmarks().withFaceDescriptor();
  return one ? Array.from(one.descriptor as Float32Array) : null;
}

/** Punch check: needs a live blink, then returns one face descriptor. */
export async function scanForPunch(
  video: HTMLVideoElement,
  progress: ScanProgress,
  signal: { cancelled: boolean },
  timeoutMs = 25000
): Promise<number[]> {
  const faceapi = await loadFaceEngine();
  const tracker = new BlinkTracker();
  const start = Date.now();
  let sawFace = false;
  while (!signal.cancelled && Date.now() - start < timeoutMs) {
    const f = await readFrame(faceapi, video, progress);
    if (f) {
      sawFace = true;
      tracker.update(averageEar(f.landmarks.positions));
      if (tracker.blinked || SKIP_BLINK_FOR_TESTS) {
        progress('Hold still…');
        const d = await captureDescriptor(faceapi, video);
        if (d) return d;
      } else {
        progress('Look at the camera and blink once.');
      }
    }
    await sleep(90);
  }
  if (signal.cancelled) throw new Error('cancelled');
  throw new Error(sawFace ? 'No blink detected. Please try again and blink naturally.' : 'No face found. Please try again.');
}

/** Enrollment: collects several samples of a clear, open-eyed, front-facing face. */
export async function scanForEnrollment(
  video: HTMLVideoElement,
  progress: ScanProgress,
  signal: { cancelled: boolean },
  samplesNeeded = 5,
  timeoutMs = 40000
): Promise<number[][]> {
  const faceapi = await loadFaceEngine();
  const samples: number[][] = [];
  const start = Date.now();
  let lastTaken = 0;
  while (!signal.cancelled && Date.now() - start < timeoutMs && samples.length < samplesNeeded) {
    const f = await readFrame(faceapi, video, progress);
    if (f && f.detection.score > 0.7 && averageEar(f.landmarks.positions) > 0.22) {
      if (Date.now() - lastTaken > 600) {
        const d = await captureDescriptor(faceapi, video);
        if (d) {
          samples.push(d);
          lastTaken = Date.now();
          progress(`Captured ${samples.length} of ${samplesNeeded}. Turn your head very slightly between captures.`);
        }
      }
    } else if (f) {
      progress('Face the camera with eyes open.');
    }
    await sleep(120);
  }
  if (signal.cancelled) throw new Error('cancelled');
  if (samples.length < samplesNeeded) throw new Error('Could not capture enough clear samples. Try better light and look straight at the camera.');
  return samples;
}

/* ---- server calls ---- */
async function post(body: Record<string, unknown>) {
  const res = await fetch('/api/face', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json: any = {};
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    (err as any).code = json.code;
    throw err;
  }
  return json;
}

export const verifyFace = (employeeId: string, descriptor: number[]) =>
  post({ action: 'verify', employeeId, descriptor }) as Promise<{ token: string; expiresAt: number }>;

export const enrollFace = (employeeId: string, descriptors: number[][], adminId: string, adminPin: string) =>
  post({ action: 'enroll', employeeId, descriptors, adminId, adminPin });

export const removeFace = (employeeId: string, adminId: string, adminPin: string) =>
  post({ action: 'remove', employeeId, adminId, adminPin });
