import type { Employee, OfficeSettings, PunchLocation } from '../types';

/** The Bahaar Office phone app, or any phone / tablet browser. Computers are never location-checked. */
export function isPhoneDevice(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  return /BahaarOfficeApp|Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

export const isPhoneApp = (ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean => /BahaarOfficeApp/.test(ua);

/** Admin switched it on for everyone, or for this person; and this punch comes from a phone. */
export function needsPhoneLocation(settings: OfficeSettings, emp: Pick<Employee, 'locationCheck'> | undefined, ua?: string): boolean {
  if (!emp) return false;
  return Boolean(settings.locationCheckEnabled || emp.locationCheck) && isPhoneDevice(ua);
}

/** Straight-line distance in metres between two points. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type LocationVerdict = { ok: true; loc: PunchLocation } | { ok: false; message: string };

/** Decides whether a fix is allowed for this person (pure, so it can be tested). */
export function judgeLocation(
  settings: OfficeSettings,
  emp: Pick<Employee, 'allowWorkFromHome'>,
  fix: { lat: number; lng: number; acc: number },
  at = new Date().toISOString(),
): LocationVerdict {
  const loc: PunchLocation = { lat: Math.round(fix.lat * 1e6) / 1e6, lng: Math.round(fix.lng * 1e6) / 1e6, acc: Math.round(fix.acc), at };
  const hasPin = Number.isFinite(settings.officeLat) && Number.isFinite(settings.officeLng);
  if (!hasPin) return { ok: true, loc };
  const radius = Math.max(50, Number(settings.officeRadiusM) || 300);
  const dist = Math.round(distanceM(fix.lat, fix.lng, settings.officeLat as number, settings.officeLng as number));
  loc.dist = dist;
  // a poor GPS fix gets the benefit of its own accuracy circle
  const inside = dist - Math.min(fix.acc || 0, 150) <= radius;
  if (inside) return { ok: true, loc };
  if (emp.allowWorkFromHome) return { ok: true, loc: { ...loc, outside: true } };
  const km = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`;
  return { ok: false, message: `You are about ${km} away from the office (allowed: ${radius} m). Punching from here is not allowed. Please punch when you reach the office, or ask the Administrator.` };
}

function readPosition(): Promise<{ lat: number; lng: number; acc: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
    );
  });
}

/** Asks the phone for its location and judges it. Never throws. */
export async function checkPunchLocation(settings: OfficeSettings, emp: Employee): Promise<LocationVerdict> {
  try {
    const fix = await readPosition();
    return judgeLocation(settings, emp, fix);
  } catch (e: any) {
    if (e?.code === 1) return { ok: false, message: 'Location permission is needed to punch from your phone. Please allow location for the Bahaar Office app (phone Settings → Apps → Bahaar Office → Permissions → Location), then try again.' };
    if (e?.message === 'unsupported') return { ok: false, message: 'This phone cannot share its location, so punching from it is not allowed. Please punch from an office computer.' };
    return { ok: false, message: 'Could not find your location. Turn on Location (GPS) on your phone and try again.' };
  }
}

export const mapLink = (p: { lat: number; lng: number }) => `https://www.google.com/maps?q=${p.lat},${p.lng}`;
