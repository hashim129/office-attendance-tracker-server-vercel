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
      // Warm-up: run one throwaway pass so the first real scan is not slowed by kernel compilation.
      try {
        const c = document.createElement('canvas');
        c.width = 96;
        c.height = 96;
        await faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 })).withFaceLandmarks();
      } catch { /* warm-up is best effort */ }
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
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
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
  // Relaxed: works at normal arm's-length distance and with a slightly turned head.
  const eyesOk = leftEye.length === 6 && rightEye.length === 6 && eyeSep >= box.width * 0.12;

  const noseCenter = avgPt(nose);
  const eyeMinX = Math.min(leftCenter.x, rightCenter.x);
  const eyeMaxX = Math.max(leftCenter.x, rightCenter.x);
  const noseOk =
    nose.length === 9 &&
    eyesOk &&
    noseCenter.x >= eyeMinX - box.width * 0.12 &&
    noseCenter.x <= eyeMaxX + box.width * 0.12;

  const mouthXs = mouth.map((p) => p.x);
  const mouthWidth = Math.max(...mouthXs) - Math.min(...mouthXs);
  const mouthCenter = avgPt(mouth);
  const mouthOk = mouth.length === 20 && mouthWidth >= box.width * 0.10 && mouthCenter.y > noseCenter.y;

  const jawXs = jaw.map((p) => p.x);
  const jawSpan = Math.max(...jawXs) - Math.min(...jawXs);
  const jawOk = jaw.length === 17 && jawSpan >= box.width * 0.30;

  // Jaw is shown in the HUD but no longer blocks the scan (it fails often with beards, masks, hijabs, glasses glare).
  return {
    featuresOk: eyesOk && noseOk && mouthOk,
    eyesOk,
    noseOk,
    mouthOk,
    jawOk,
  };
}

/**
 * Basic liveness: passes on EITHER a natural blink OR a small head movement (turn / nod).
 * A blink only needs the eyes to dip and reopen; no strict open-closed-open timing is required, so it
 * still works on slower devices that only process a few frames per second.
 */
export class BlinkTracker {
  private baseline = 0;
  private sawClosed = false;
  private frames = 0;
  private minYaw = Infinity;
  private maxYaw = -Infinity;
  private minPitch = Infinity;
  private maxPitch = -Infinity;
  public blinked = false;

  update(ear: number, points?: Pt[], featuresOk = true): boolean {
    if (this.blinked) return true;
    if (!Number.isFinite(ear) || !featuresOk) return false;
    this.frames++;

    // Track the open-eye level; it decays slowly so it adapts to lighting / glasses.
    this.baseline = this.baseline === 0 ? ear : Math.max(ear, this.baseline * 0.97);
    if (this.baseline >= 0.15) {
      if (ear < this.baseline * 0.86) this.sawClosed = true;
      else if (this.sawClosed && ear > this.baseline * 0.93) this.blinked = true;
    }

    // Head movement check using the nose position relative to the eyes.
    if (points && points.length >= 68) {
      const l = avgPt(points.slice(36, 42));
      const r = avgPt(points.slice(42, 48));
      const nose = points[30];
      const eyeSep = dist(l, r);
      if (eyeSep > 0) {
        const mid = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
        const yaw = (nose.x - mid.x) / eyeSep;
        const pitch = (nose.y - mid.y) / eyeSep;
        this.minYaw = Math.min(this.minYaw, yaw);
        this.maxYaw = Math.max(this.maxYaw, yaw);
        this.minPitch = Math.min(this.minPitch, pitch);
        this.maxPitch = Math.max(this.maxPitch, pitch);
        if (this.frames >= 3 && (this.maxYaw - this.minYaw >= 0.12 || this.maxPitch - this.minPitch >= 0.10)) {
          this.blinked = true;
        }
      }
    }
    return this.blinked;
  }

  /** 0-100 progress for the HUD. */
  get progress(): number {
    if (this.blinked) return 100;
    if (this.sawClosed) return 85;
    const motion = Math.max(
      this.maxYaw > this.minYaw ? (this.maxYaw - this.minYaw) / 0.12 : 0,
      this.maxPitch > this.minPitch ? (this.maxPitch - this.minPitch) / 0.10 : 0,
    );
    return Math.min(80, Math.max(this.frames * 10, motion * 80));
  }
}

declare const __FACE_TEST_SKIP_BLINK__: boolean | undefined;
const SKIP_BLINK_FOR_TESTS = typeof __FACE_TEST_SKIP_BLINK__ !== 'undefined' && __FACE_TEST_SKIP_BLINK__ === true;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tinyOpts(faceapi: any) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 });
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
  if (video.videoWidth > 0 && box.width < video.videoWidth * 0.08) {
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
  timeoutMs = 20000,
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
        // Descriptor failed on this frame (blur / turn); loop continues and tries the next frame.
      } else if (!feat.featuresOk) {
        progress('Look at the camera.');
      } else {
        progress(Date.now() - start > 4000 ? 'Slowly turn your head a little left, then right.' : 'Blink once or turn your head slightly...');
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
    await sleep(5);
  }
  if (signal.cancelled) throw new Error('cancelled');
  throw new Error(sawFace ? 'Liveness not verified. Please blink once or turn your head slightly and try again.' : 'No face found. Please try again.');
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

      if (f.detection.score > 0.5 && feat.featuresOk && ear > 0.15) {
        if (Date.now() - lastTaken > 150) {
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
    await sleep(10);
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

/** Warm the face engine in the background so the first scan of the day starts instantly. */
export function preloadFaceEngine() {
  const run = () => { void loadFaceEngine().catch(() => {}); };
  const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2500);
}
