/* Client-side face detection + 68-point landmark + 128-d descriptor engine.
 * face-api.js is loaded lazily from /vendor/face-api.esm.js so initial page load stays tiny.
 */

export type ScanProgress = (message: string) => void;

export interface FaceLiveTelemetry {
  detected: boolean;
  score: number;
  ear: number;
  featuresOk: boolean;
  eyesOk: boolean;
  noseOk: boolean;
  mouthOk: boolean;
  jawOk: boolean;
  livenessOk: boolean;
  livenessProgress: number;
  box?: { x: number; y: number; width: number; height: number; videoWidth: number; videoHeight: number };
  landmarks?: { x: number; y: number }[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let apiPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadFaceEngine(): Promise<any> {
  if (!apiPromise) {
    apiPromise = (async () => {
      // Load from /public/vendor/face-api.esm.js via runtime dynamic import
      const url = '/vendor/face-api.esm.js';
      const faceapi = await import(/* @vite-ignore */ url);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
      ]);
      return faceapi;
    })().catch((err) => {
      apiPromise = null;
      throw err;
    });
  }
  return apiPromise;
}

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  void loadFaceEngine().catch(() => {});
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2) return resolve();
    video.onloadedmetadata = () => resolve();
  });
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null | undefined) {
  if (!stream) return;
  for (const t of stream.getTracks()) t.stop();
}

export interface Pt { x: number; y: number }

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function avgPt(pts: Pt[]): Pt {
  const n = Math.max(1, pts.length);
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / n, y: sy / n };
}

/** Eye Aspect Ratio for a 6-point eye contour (standard Soukupova-Cech formula). */
export function eyeAspectRatio(eye: Pt[]): number {
  if (eye.length < 6) return 0.3;
  const v1 = dist(eye[1], eye[5]);
  const v2 = dist(eye[2], eye[4]);
  const h = dist(eye[0], eye[3]);
  return h > 0 ? (v1 + v2) / (2 * h) : 0.3;
}

export function averageEar(points68: Pt[]): number {
  const left = eyeAspectRatio(points68.slice(36, 42));
  const right = eyeAspectRatio(points68.slice(42, 48));
  return (left + right) / 2;
}

export function checkFacialFeatures(points68: Pt[], box: { width: number; height: number }) {
  if (points68.length < 68 || box.width <= 0) {
    return { featuresOk: false, eyesOk: false, noseOk: false, mouthOk: false, jawOk: false };
  }
  const leftEye = points68.slice(36, 42);
  const rightEye = points68.slice(42, 48);
  const nose = points68.slice(27, 36);
  const mouth = points68.slice(48, 68);
  const jaw = points68.slice(0, 17);

  const leftCenter = avgPt(leftEye);
  const rightCenter = avgPt(rightEye);
  const eyeSep = dist(leftCenter, rightCenter);
  const eyesOk = leftEye.length === 6 && rightEye.length === 6 && eyeSep >= box.width * 0.16;

  const noseCenter = avgPt(nose);
  const eyeMinX = Math.min(leftCenter.x, rightCenter.x);
  const eyeMaxX = Math.max(leftCenter.x, rightCenter.x);
  const noseOk =
    nose.length === 9 &&
    eyesOk &&
    noseCenter.x >= eyeMinX - box.width * 0.04 &&
    noseCenter.x <= eyeMaxX + box.width * 0.04;

  const mouthXs = mouth.map((p) => p.x);
  const mouthWidth = Math.max(...mouthXs) - Math.min(...mouthXs);
  const mouthCenter = avgPt(mouth);
  const mouthOk = mouth.length === 20 && mouthWidth >= box.width * 0.14 && mouthCenter.y > noseCenter.y;

  const jawXs = jaw.map((p) => p.x);
  const jawSpan = Math.max(...jawXs) - Math.min(...jawXs);
  const jawOk = jaw.length === 17 && jawSpan >= box.width * 0.42;

  return {
    featuresOk: eyesOk && noseOk && mouthOk && jawOk,
    eyesOk,
    noseOk,
    mouthOk,
    jawOk,
  };
}

/**
 * Blink liveness: the eyes must be seen open, then closed, then open again.
 * (A held-up photo or a screen cannot do this; small jitter in landmarks does not count.)
 */
export class BlinkTracker {
  private state: 'waiting-open' | 'open' | 'closed' = 'waiting-open';
  private baseline = 0;
  public blinked = false;
  private frames = 0;

  update(ear: number, _points?: Pt[], featuresOk = true): boolean {
    if (this.blinked) return true;
    if (!Number.isFinite(ear) || !featuresOk) return false;
    this.frames++;
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
    return this.blinked;
  }

  /** 0-100 progress for the HUD: waiting for open eyes, then for the blink. */
  get progress(): number {
    if (this.blinked) return 100;
    if (this.state === 'closed') return 85;
    if (this.state === 'open') return 60;
    return Math.min(40, this.frames * 8);
  }
}

declare const __FACE_TEST_SKIP_BLINK__: boolean | undefined;
const SKIP_BLINK_FOR_TESTS = typeof __FACE_TEST_SKIP_BLINK__ !== 'undefined' && __FACE_TEST_SKIP_BLINK__ === true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tinyOpts(faceapi: any) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readFrame(faceapi: any, video: HTMLVideoElement, progress?: ScanProgress) {
  const dets = await faceapi.detectAllFaces(video, tinyOpts(faceapi)).withFaceLandmarks();
  if (!dets.length) {
    progress?.('Position your face inside the frame...');
    return null;
  }
  if (dets.length > 1) {
    progress?.('Only one face can be in frame.');
    return null;
  }
  const d = dets[0];
  const box = d.detection.box;
  if (video.videoWidth > 0 && box.width < video.videoWidth * 0.16) {
    progress?.('Move a little closer to the camera.');
    return null;
  }
  return d;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function captureDescriptor(faceapi: any, video: HTMLVideoElement): Promise<number[] | null> {
  const full = await faceapi
    .detectSingleFace(video, tinyOpts(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!full) return null;
  return Array.from(full.descriptor as Float32Array);
}

/**
 * Attendance punch scan: checks facial features, verifies liveness (blink or live micro-motion),
 * emits real-time FaceLiveTelemetry, and captures a 128-d face descriptor.
 */
export async function scanForPunch(
  video: HTMLVideoElement,
  progress: ScanProgress,
  signal: { cancelled: boolean },
  timeoutMs = 25000,
  onTelemetry?: (t: FaceLiveTelemetry) => void
): Promise<number[]> {
  const faceapi = await loadFaceEngine();
  const tracker = new BlinkTracker();
  const start = Date.now();
  let sawFace = false;

  while (!signal.cancelled && Date.now() - start < timeoutMs) {
    const f = await readFrame(faceapi, video, progress);
    if (f) {
      sawFace = true;
      const points: Pt[] = f.landmarks.positions;
      const box = f.detection.box;
      const ear = averageEar(points);
      const feat = checkFacialFeatures(points, box);
      tracker.update(ear, points, feat.featuresOk);

      onTelemetry?.({
        detected: true,
        score: f.detection.score,
        ear,
        ...feat,
        livenessOk: tracker.blinked,
        livenessProgress: tracker.progress,
        box: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        },
        landmarks: points.map((p) => ({ x: p.x, y: p.y })),
      });

      if (feat.featuresOk && (tracker.blinked || SKIP_BLINK_FOR_TESTS)) {
        progress('Liveness verified. Capturing face...');
        const desc = await captureDescriptor(faceapi, video);
        if (desc) return desc;
      } else if (!feat.featuresOk) {
        progress('Center your full face clearly in frame.');
      } else {
        progress('Look at the camera and blink naturally...');
      }
    } else {
      onTelemetry?.({
        detected: false,
        score: 0,
        ear: 0,
        featuresOk: false,
        eyesOk: false,
        noseOk: false,
        mouthOk: false,
        jawOk: false,
        livenessOk: tracker.blinked,
        livenessProgress: tracker.progress,
      });
    }
    await sleep(30);
  }
  if (signal.cancelled) throw new Error('cancelled');
  throw new Error(sawFace ? 'Liveness not verified. Please try again and blink naturally.' : 'No face found. Please try again.');
}

/** Enrollment: collects several samples of a clear, open-eyed, front-facing face with live telemetry. */
export async function scanForEnrollment(
  video: HTMLVideoElement,
  progress: ScanProgress,
  signal: { cancelled: boolean },
  samplesNeeded = 5,
  timeoutMs = 40000,
  onTelemetry?: (t: FaceLiveTelemetry) => void
): Promise<number[][]> {
  const faceapi = await loadFaceEngine();
  const tracker = new BlinkTracker();
  const samples: number[][] = [];
  const start = Date.now();
  let lastTaken = 0;

  while (!signal.cancelled && Date.now() - start < timeoutMs && samples.length < samplesNeeded) {
    const f = await readFrame(faceapi, video, progress);
    if (f) {
      const points: Pt[] = f.landmarks.positions;
      const box = f.detection.box;
      const ear = averageEar(points);
      const feat = checkFacialFeatures(points, box);
      tracker.update(ear, points, feat.featuresOk);
      const samplePct = Math.round((samples.length / samplesNeeded) * 100);

      onTelemetry?.({
        detected: true,
        score: f.detection.score,
        ear,
        ...feat,
        livenessOk: tracker.blinked || samples.length >= samplesNeeded,
        livenessProgress: Math.max(tracker.progress, samplePct),
        box: {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        },
        landmarks: points.map((p) => ({ x: p.x, y: p.y })),
      });

      if (f.detection.score > 0.6 && feat.featuresOk && ear > 0.2) {
        if (Date.now() - lastTaken > 250) {
          const d = await captureDescriptor(faceapi, video);
          if (d) {
            samples.push(d);
            lastTaken = Date.now();
            progress(`Captured ${samples.length} of ${samplesNeeded}. Turn your head very slightly between captures.`);
          }
        }
      } else {
        progress('Face the camera clearly with eyes open.');
      }
    } else {
      onTelemetry?.({
        detected: false,
        score: 0,
        ear: 0,
        featuresOk: false,
        eyesOk: false,
        noseOk: false,
        mouthOk: false,
        jawOk: false,
        livenessOk: tracker.blinked,
        livenessProgress: Math.max(tracker.progress, Math.round((samples.length / samplesNeeded) * 100)),
      });
    }
    await sleep(40);
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = {};
  try { json = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
