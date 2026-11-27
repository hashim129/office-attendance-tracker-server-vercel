/**
 * Alert sounds, generated in the browser (no audio files). Browsers only allow sound after the person has
 * touched the page once, so the first click/key press "unlocks" it.
 */
const OFF_KEY = 'crm_sound_off';
let ctx: AudioContext | null = null;
let unlocked = false; // set after the first touch/click/key press

const getCtx = (): AudioContext | null => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx || ctx.state === 'closed') ctx = new AC();
    return ctx;
  } catch {
    return null;
  }
};

/** The phone app plays the phone's own notification sound (uses the notification volume, not media volume). */
const phoneApp = (): any => {
  try {
    const b = (window as any).BahaarApp;
    return b && typeof b.playSound === 'function' ? b : null;
  } catch {
    return null;
  }
};

export const isSoundOn = (): boolean => {
  try {
    return localStorage.getItem(OFF_KEY) !== '1';
  } catch {
    return true;
  }
};

export const setSoundOn = (on: boolean) => {
  try {
    localStorage.setItem(OFF_KEY, on ? '0' : '1');
  } catch {
    // storage blocked: the choice just lasts until reload
  }
};

/** Call once at start-up. Every tap/click/key press keeps sound ready (Windows app, browsers, phones). */
let unlockInstalled = false;
export const installSoundUnlock = () => {
  if (unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    const c = getCtx();
    if (!c) return;
    unlocked = true;
    if (c.state !== 'running') void c.resume().catch(() => undefined);
  };
  ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true, capture: true }));
  // coming back to the window/app: wake the sound up again
  document.addEventListener('visibilitychange', () => { if (!document.hidden && unlocked) unlock(); });
};

const tone = (c: AudioContext, freq: number, start: number, dur: number, vol = 0.4) => {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
};

/** 'notice' = soft two-note chime; 'warning' = three quick notes (deadlines, punch-out reminders). */
export const playAlertSound = (kind: 'notice' | 'warning' = 'notice') => {
  if (!isSoundOn()) return;
  const app = phoneApp();
  if (app) {
    try { app.playSound(kind); return; } catch { /* fall back to the page sound */ }
  }
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state !== 'running') void c.resume().catch(() => undefined);
    const t = c.currentTime + 0.05;
    if (kind === 'warning') {
      tone(c, 988, t, 0.18);
      tone(c, 988, t + 0.2, 0.18);
      tone(c, 1319, t + 0.4, 0.32);
    } else {
      tone(c, 784, t, 0.2);
      tone(c, 1175, t + 0.16, 0.35);
    }
  } catch {
    // never let a sound problem break the page
  }
};
