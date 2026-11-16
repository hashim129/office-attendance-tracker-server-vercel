/* Fast blink / liveness engine (Google MediaPipe Face Landmarker).
 * It reads the eyelid-closure of both eyes directly ("blink scores"), so a blink is seen reliably from a normal
 * sitting distance and at camera speed. Runs entirely in the browser; files are served from /vendor and /models. */
import type { Pt } from './faceScan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let enginePromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadLivenessEngine(): Promise<any> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const url = '/vendor/mediapipe/vision_bundle.mjs';
      const mp = await import(/* @vite-ignore */ url);
      const fileset = await mp.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      const make = (delegate: 'GPU' | 'CPU') =>
        mp.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.4,
          minFacePresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        });
      try {
        return await make('GPU');
      } catch {
        return await make('CPU');
      }
    })().catch((err) => {
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

export interface LiveFrame {
  /** 0 (open) to 1 (closed) for each eye. */
  blinkL: number;
  blinkR: number;
  /** A handful of face points in video pixels, for the on-screen guide. */
  points: Pt[];
  box: { x: number; y: number; width: number; height: number };
  /** Looking roughly straight at the camera and fully inside the picture. */
  frontal: boolean;
}

const HUD_POINTS = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
  1, 4, 6, 168, 61, 291, 0, 17, 13, 14,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readLiveFrame(landmarker: any, video: HTMLVideoElement, tsMs: number): LiveFrame | null {
  const res = landmarker.detectForVideo(video, tsMs);
  const lm = res?.faceLandmarks?.[0];
  if (!lm || lm.length < 400) return null;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const cats: { categoryName: string; score: number }[] = res?.faceBlendshapes?.[0]?.categories || [];
  const get = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;

  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const inside = minX > 0.01 && minY > 0.01 && maxX < 0.99 && maxY < 0.99;
  // Head turn: the nose tip should sit between the outer eye corners, near the middle.
  const eyeL = lm[33], eyeR = lm[263], nose = lm[1];
  const span = Math.abs(eyeR.x - eyeL.x) || 1;
  const yaw = Math.abs((nose.x - (eyeL.x + eyeR.x) / 2) / span);
  const frontal = inside && yaw < 0.28;

  return {
    blinkL: get('eyeBlinkLeft'),
    blinkR: get('eyeBlinkRight'),
    points: HUD_POINTS.map((i) => ({ x: lm[i].x * vw, y: lm[i].y * vh })),
    box: { x: minX * vw, y: minY * vh, width: (maxX - minX) * vw, height: (maxY - minY) * vh },
    frontal,
  };
}

/**
 * A blink = BOTH eyes close together by clearly more than their normal resting value (within 2 frames).
 * A photo or a screen shows constant eyelids, so it can never do this.
 */
export class BlinkScoreTracker {
  private baseL: number[] = [];
  private baseR: number[] = [];
  private lastL = -99;
  private lastR = -99;
  private n = 0;
  public blinked = false;

  private static median(v: number[]): number {
    const s = [...v].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  get ready(): boolean {
    return this.baseL.length >= 5 && this.baseR.length >= 5;
  }

  update(l: number, r: number): boolean {
    if (this.blinked) return true;
    this.n++;
    let dipL = false;
    let dipR = false;
    if (this.ready) {
      const mL = BlinkScoreTracker.median(this.baseL);
      const mR = BlinkScoreTracker.median(this.baseR);
      dipL = l >= Math.max(0.32, mL + 0.2);
      dipR = r >= Math.max(0.32, mR + 0.2);
    }
    if (dipL) this.lastL = this.n;
    if (dipR) this.lastR = this.n;
    if (this.lastL > 0 && this.lastR > 0 && Math.abs(this.lastL - this.lastR) <= 2) {
      this.blinked = true;
      return true;
    }
    if (!dipL) { this.baseL.push(l); if (this.baseL.length > 15) this.baseL.shift(); }
    if (!dipR) { this.baseR.push(r); if (this.baseR.length > 15) this.baseR.shift(); }
    return false;
  }

  get progress(): number {
    if (this.blinked) return 100;
    if (this.ready) return 60;
    return Math.min(40, this.n * 8);
  }
}
