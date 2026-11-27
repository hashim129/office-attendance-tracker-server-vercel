/**
 * Small helpers for the Android app (window.BahaarApp bridge). Every call is safe in a normal browser.
 */
type Bridge = Record<string, (...args: any[]) => any>;
const bridge = (): Bridge | null => (typeof window !== 'undefined' && (window as any).BahaarApp) || null;
const call = (name: string, ...args: any[]): any => {
  try { const b = bridge(); return b && typeof b[name] === 'function' ? b[name](...args) : undefined; } catch { return undefined; }
};

export const inPhoneApp = (): boolean => Boolean(bridge());
export const hasBridge = (name: string): boolean => { const b = bridge(); return Boolean(b && typeof b[name] === 'function'); };

/** Short vibration: 'tap' for done, 'error' for a problem, 'success' for a punch. */
export function haptic(kind: 'tap' | 'success' | 'error' = 'tap'): void {
  const pattern = kind === 'error' ? [30, 60, 30] : kind === 'success' ? [20, 40, 40] : [12];
  if (hasBridge('vibrate')) { call('vibrate', JSON.stringify(pattern)); return; }
  try { if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern); } catch { /* not supported */ }
}

/** Blocks screenshots / screen recording while true (Android app only). */
export const setScreenSecure = (on: boolean): void => { call('setSecure', Boolean(on)); };

/** Fingerprint / face unlock for the phone app. */
export const biometricAvailable = (): boolean => call('biometricAvailable') === true;
export const biometricEnabled = (): boolean => call('biometricEnabled') === true;
export const setBiometric = (on: boolean): void => { call('setBiometric', Boolean(on)); };

/** Office arrive / leave reminders (asks for "Allow all the time" location). */
export const officeRemindersEnabled = (): boolean => call('officeRemindersEnabled') === true;
export const setOfficeReminders = (on: boolean): void => { call('setOfficeReminders', Boolean(on)); };

/** Home-screen widget text. */
export function updateWidget(status: { title: string; line: string; punchedIn: boolean; canPunch: boolean }): void {
  call('updateWidget', JSON.stringify(status));
}

/** An action the app was opened with (notification button, home-screen shortcut or widget), once. */
export function takeLaunchAction(): string {
  const v = call('takeAction');
  return typeof v === 'string' ? v : '';
}

/** A file shared into the app from another app (WhatsApp, Gallery…), once. */
export function takeSharedFile(): { name: string; type: string; data: string } | null {
  const v = call('takeSharedFile');
  if (typeof v !== 'string' || !v) return null;
  try { const o = JSON.parse(v); return o && o.data ? o : null; } catch { return null; }
}
