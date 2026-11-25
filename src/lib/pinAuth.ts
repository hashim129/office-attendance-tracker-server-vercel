/**
 * PIN checks. In the cloud setup the server keeps only scrambled PINs and does every check
 * (employees arrive in the browser with an empty `pin`). For the old local/Windows server the
 * browser still receives PINs, so a non-empty `pin` is compared locally exactly as before.
 */
import type { Employee } from '../types';

export type PinResult = { ok: boolean; error?: string };

// Remembered only in memory (never saved), so admin actions don't ask for the PIN again until reload.
let sessionActorId: string | null = null;
let sessionPin: string | null = null;

export function rememberSession(employeeId: string | null, pin?: string): void {
  if (!employeeId) {
    sessionActorId = null;
    sessionPin = null;
    return;
  }
  if (sessionActorId !== employeeId) sessionPin = null;
  sessionActorId = employeeId;
  if (pin) sessionPin = pin;
}

// Sign-in token handed out by the server after a correct PIN. Held here until the app saves it with the login.
let pendingToken: { employeeId: string; token: string } | null = null;
let kioskSessionToken: string | null = null;

/** Short-lived in-memory token used only while the shared kiosk is open. */
export function getKioskSessionToken(): string | null {
  return kioskSessionToken;
}
const tokenSavers: Array<(employeeId: string, token: string) => void> = [];

/** Lets storage.ts save a fresh token (e.g. after the person changes their own PIN). */
export function onSessionToken(fn: (employeeId: string, token: string) => void): void {
  tokenSavers.push(fn);
}

function gotToken(employeeId: string, token: unknown): void {
  if (typeof token !== 'string' || !token) return;
  pendingToken = { employeeId, token };
  for (const fn of tokenSavers) fn(employeeId, token);
}

/** The token for this person's login, if the server issued one just now. */
export function takePendingToken(employeeId: string): string | undefined {
  const t = pendingToken && pendingToken.employeeId === employeeId ? pendingToken.token : undefined;
  if (t) pendingToken = null;
  return t;
}

async function post(action: string, payload: Record<string, unknown>): Promise<{ status: number; json: any }> {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
      cache: 'no-store',
    });
    let json: any = {};
    try { json = await res.json(); } catch { /* ignore */ }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: { error: 'Cannot reach the server. Check your internet connection and try again.' } };
  }
}

const fail = (r: { json: any }, fallback: string): PinResult => ({ ok: false, error: r.json?.error || fallback });

export async function verifyEmployeePin(emp: Employee, pin: string): Promise<PinResult> {
  const clean = pin.trim();
  if (emp.pin) return clean === emp.pin ? { ok: true } : { ok: false, error: 'Incorrect PIN or password. Please try again.' };
  const r = await post('verify', { employeeId: emp.id, pin: clean });
  if (r.status === 200) { rememberSession(emp.id, clean); gotToken(emp.id, r.json.session); return { ok: true }; }
  return fail(r, 'Incorrect PIN or password. Please try again.');
}

export async function lookupLogin(identifier: string, pin: string, employees: Employee[]): Promise<PinResult & { employee?: Employee }> {
  const needle = identifier.trim().toLowerCase();
  const local = employees.find((e) => e.employeeCode.toLowerCase() === needle || e.email.toLowerCase() === needle);
  if (local?.pin) {
    return local.pin === pin.trim() ? { ok: true, employee: local } : { ok: false, error: 'Incorrect PIN or password.' };
  }
  const r = await post('lookup', { identifier, pin: pin.trim() });
  if (r.status === 200) {
    const emp = employees.find((e) => e.id === r.json.employeeId);
    const authenticatedEmployee = emp || r.json.employee;
    if (authenticatedEmployee) { rememberSession(authenticatedEmployee.id, pin.trim()); gotToken(authenticatedEmployee.id, r.json.session); return { ok: true, employee: authenticatedEmployee }; }
    return { ok: false, error: 'Account not found. Please refresh and try again.' };
  }
  return fail(r, 'Incorrect PIN or password.');
}

/** Lobby kiosk: which employee owns this PIN? */
export async function identifyByPin(pin: string, employees: Employee[]): Promise<PinResult & { employee?: Employee }> {
  const active = employees.filter((e) => e.isActive !== false);
  if (active.some((e) => e.pin)) {
    const hit = active.find((e) => e.pin === pin);
    return hit ? { ok: true, employee: hit } : { ok: false, error: 'PIN code not recognized.' };
  }
  const r = await post('kiosk', { pin });
  if (r.status === 200) {
    const emp = employees.find((e) => e.id === r.json.employeeId);
    if (emp && typeof r.json.session === 'string') kioskSessionToken = r.json.session;
    return emp ? { ok: true, employee: emp } : { ok: false, error: 'PIN code not recognized.' };
  }
  return fail(r, 'PIN code not recognized.');
}

export async function verifyAdminPin(pin: string, employees: Employee[]): Promise<PinResult> {
  const clean = pin.trim();
  const admins = employees.filter((e) => e.role === 'admin' && e.isActive !== false);
  if (admins.some((a) => a.pin)) {
    return admins.some((a) => a.pin === clean) ? { ok: true } : { ok: false, error: 'Invalid Admin PIN code.' };
  }
  const r = await post('admin-verify', { pin: clean });
  return r.status === 200 ? { ok: true } : fail(r, 'Invalid Admin PIN code.');
}

export async function changeOwnPin(emp: Employee, currentPin: string, newPin: string): Promise<PinResult> {
  const r = await post('change-pin', { employeeId: emp.id, currentPin: currentPin.trim(), newPin: newPin.trim() });
  if (r.status === 200) { rememberSession(emp.id, newPin.trim()); gotToken(emp.id, r.json.session); return { ok: true }; }
  return fail(r, 'Could not change the PIN.');
}

function askPin(message: string): string | null {
  const v = typeof window !== 'undefined' ? window.prompt(message) : null;
  return v === null ? null : v.trim();
}

/** The signed-in person's own PIN: remembered for this session, otherwise asked once. */
export function sessionPinOrAsk(message: string): { actorId: string; pin: string } | null {
  if (!sessionActorId) return null;
  if (sessionPin) return { actorId: sessionActorId, pin: sessionPin };
  const pin = askPin(message);
  if (!pin) return null;
  return { actorId: sessionActorId, pin };
}

/** Administrator sets or resets someone's PIN. */
export async function adminSetPin(employeeId: string, newPin: string): Promise<PinResult> {
  const actor = sessionPinOrAsk('Enter your Administrator PIN to save this employee\'s PIN:');
  if (!actor) return { ok: false, error: 'Administrator PIN is required to set a PIN.' };
  const r = await post('set-pin', { adminId: actor.actorId, adminPin: actor.pin, employeeId, newPin: newPin.trim() });
  if (r.status === 200) { rememberSession(actor.actorId, actor.pin); return { ok: true }; }
  if (r.status === 401 || r.status === 403) sessionPin = null;
  return fail(r, 'Could not set the PIN.');
}

/** Token for the Windows startup file (created by the server, never calculated in the browser). */
export async function getAutoStartToken(targetEmployeeId: string): Promise<{ token?: string; error?: string }> {
  const actor = sessionPinOrAsk('Enter your PIN to create the startup file:');
  if (!actor) return { error: 'Your PIN is required to create the startup file.' };
  const r = await post('auto-token', { actorId: actor.actorId, actorPin: actor.pin, employeeId: targetEmployeeId });
  if (r.status === 200) { rememberSession(actor.actorId, actor.pin); return { token: r.json.token }; }
  if (r.status === 401) sessionPin = null;
  return { error: r.json?.error || 'Could not create the startup file.' };
}
