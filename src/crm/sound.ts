/**
 * Alert sounds, generated in the browser (no audio files). Browsers only allow sound after the person has
 * touched the page once, so the first click/key press "unlocks" it.
 */
const OFF_KEY = 'crm_sound_off';
let ctx: AudioContext | null = null;
let unlocked = false;

const getCtx = (): AudioContext | null => {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    return ctx;
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

/** Call once at start-up. */
export const installSoundUnlock = () => {
  const unlock = () => {
    const c = getCtx();
    if (c && c.state === 'suspended') void c.resume();
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
};

const tone = (c: AudioContext, freq: number, start: number, dur: number, vol = 0.18) => {
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
  const c = getCtx();
  if (!c || !unlocked) return;
  try {
    if (c.state === 'suspended') void c.resume();
    const t = c.currentTime + 0.01;
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
