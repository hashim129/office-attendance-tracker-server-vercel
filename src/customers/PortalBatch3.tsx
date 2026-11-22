import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { CalendarClock, Compass, Moon, Search, Snowflake, Sun } from 'lucide-react';
import type { Destination } from './destinations';
import { useLang } from './i18n';
import { WhatsAppGlyph } from './PortalExtras';

/* ------------------------------------------------------------------ */
/* Seasonal themes                                                     */
/* ------------------------------------------------------------------ */

export type ThemeId = 'ramadan' | 'eid' | 'winter' | 'summer' | 'none';
export type ThemeChoice = 'auto' | ThemeId;

/** Picks the theme for a date. Ramadan / Eid follow the Islamic calendar (approximate: moon sighting can differ by a day). */
export function themeFor(now: Date = new Date()): ThemeId {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Karachi' }).formatToParts(now);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    if ((month === 10 && day <= 3) || (month === 12 && day >= 10 && day <= 13)) return 'eid';
    if (month === 9) return 'ramadan';
  } catch {
    /* browser without that calendar: fall through to the weather seasons */
  }
  const m = now.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m >= 5 && m <= 7) return 'summer';
  return 'none';
}

function Lantern({ left, cord, delay, size }: { left: string; cord: number; delay: number; size: number }) {
  return (
    <span className="theme-lantern" style={{ left, animationDelay: `${delay}s` }}>
      <span className="theme-lantern-cord" style={{ height: cord }} />
      <svg width={size} height={size * 1.5} viewBox="0 0 40 60" aria-hidden="true">
        <defs>
          <linearGradient id={`lg-${left.replace('%', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <rect x="14" y="0" width="12" height="6" rx="2" fill="#92400e" />
        <path d="M8 8h24l4 10c0 14-6 30-16 34C10 48 4 32 4 18z" fill={`url(#lg-${left.replace('%', '')})`} stroke="#b45309" strokeWidth="1.5" />
        <path d="M20 10v40M12 14c-3 12 0 26 8 36M28 14c3 12 0 26-8 36" stroke="#b45309" strokeOpacity=".45" fill="none" />
        <rect x="15" y="52" width="10" height="5" rx="2" fill="#92400e" />
      </svg>
    </span>
  );
}

export function SeasonTheme({ theme }: { theme: ThemeId }) {
  const { lang } = useLang();
  const [reduced, setReduced] = useState(false);
  const [badge, setBadge] = useState(true);
  useEffect(() => {
    setReduced(Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
    setBadge(true);
    const id = window.setTimeout(() => setBadge(false), 7000);
    return () => window.clearTimeout(id);
  }, [theme]);
  const flakes = useMemo(
    () => Array.from({ length: 26 }, (_, i) => ({ left: (i * 37) % 100, delay: (i * 0.7) % 9, dur: 9 + ((i * 13) % 8), size: 3 + (i % 4) }) ),
    [],
  );
  if (theme === 'none') return null;
  const wish =
    theme === 'ramadan' ? (lang === 'ur' ? 'رمضان مبارک' : 'Ramadan Mubarak') : theme === 'eid' ? (lang === 'ur' ? 'عید مبارک' : 'Eid Mubarak') : '';
  return (
    <div className="theme-layer no-print" aria-hidden="true" data-theme-id={theme}>
      {(theme === 'ramadan' || theme === 'eid') && (
        <>
          <Lantern left="5%" cord={4} delay={0} size={18} />
          <Lantern left="18%" cord={4} delay={0.8} size={18} />
          <Lantern left="80%" cord={4} delay={0.4} size={18} />
          <Moon className="theme-moon" />
        </>
      )}
      {theme === 'winter' && (
        <>
          <div className="theme-winter-tint" />
          {!reduced && flakes.map((f, i) => (
            <span key={i} className="theme-flake" style={{ left: `${f.left}%`, width: f.size, height: f.size, animationDelay: `-${f.delay}s`, animationDuration: `${f.dur}s` }} />
          ))}
        </>
      )}
      {theme === 'summer' && (
        <>
          <div className="theme-summer-glow" />
          <Sun className="theme-sun" />
        </>
      )}
      {wish && badge && (
        <span className="theme-wish">
          {theme === 'winter' ? <Snowflake className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          {wish}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Travel countdown                                                    */
/* ------------------------------------------------------------------ */

export function TripCountdown({ date }: { date: string }) {
  const { t, lang } = useLang();
  const target = useMemo(() => Date.parse(`${date}T00:00:00+05:00`), [date]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  if (!Number.isFinite(target)) return null;
  const diff = target - now;
  const today = diff <= 0 && now - target < 24 * 3600 * 1000;
  if (diff <= 0 && !today) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const box = (n: number, label: string) => (
    <div className="flex-1 min-w-0 rounded-2xl bg-white/15 border border-white/25 py-2.5 sm:py-3 text-center backdrop-blur-sm">
      <p className="text-2xl sm:text-4xl font-extrabold tabular-nums leading-none">{String(n).padStart(2, '0')}</p>
      <p className="mt-1 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-white/80">{label}</p>
    </div>
  );
  return (
    <div className="no-print rounded-3xl bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 text-white p-4 sm:p-6 shadow-md space-y-3">
      <div className="flex items-center gap-2 text-sm sm:text-base font-bold">
        <CalendarClock className="w-5 h-5 shrink-0" />
        <span>
          {today
            ? (lang === 'ur' ? 'آج آپ کے سفر کا دن ہے، سفر مبارک!' : 'Today is the day. Safe travels!')
            : t('Countdown to your trip')}
        </span>
      </div>
      {!today && (
        <div className="flex gap-2 sm:gap-3">
          {box(days, t('Days'))}
          {box(hours, t('Hours'))}
          {box(mins, t('Min'))}
          {box(secs, t('Sec'))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Destination extras: weather, currency, checklist                    */
/* ------------------------------------------------------------------ */

interface Extra { lat: number; lon: number; cur: string; city: string }
const EXTRAS: Record<string, Extra> = {
  'makkah-madinah': { lat: 21.4225, lon: 39.8262, cur: 'SAR', city: 'Makkah' },
  'dubai-abu-dhabi': { lat: 25.2048, lon: 55.2708, cur: 'AED', city: 'Dubai' },
  doha: { lat: 25.2854, lon: 51.531, cur: 'QAR', city: 'Doha' },
  'baku-shahdag': { lat: 40.4093, lon: 49.8671, cur: 'AZN', city: 'Baku' },
  'tashkent-samarkand': { lat: 41.2995, lon: 69.2401, cur: 'UZS', city: 'Tashkent' },
  almaty: { lat: 43.222, lon: 76.8512, cur: 'KZT', city: 'Almaty' },
  'istanbul-cappadocia': { lat: 41.0082, lon: 28.9784, cur: 'TRY', city: 'Istanbul' },
  'london-edinburgh': { lat: 51.5072, lon: -0.1276, cur: 'GBP', city: 'London' },
  'paris-swiss-alps': { lat: 48.8566, lon: 2.3522, cur: 'EUR', city: 'Paris' },
  'kuala-lumpur-langkawi': { lat: 3.139, lon: 101.6869, cur: 'MYR', city: 'Kuala Lumpur' },
  bali: { lat: -8.4095, lon: 115.1889, cur: 'IDR', city: 'Bali' },
  maldives: { lat: 4.1755, lon: 73.5093, cur: 'MVR', city: 'Malé' },
  tokyo: { lat: 35.6762, lon: 139.6503, cur: 'JPY', city: 'Tokyo' },
};

function weatherWord(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'Rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Snow';
  if (code >= 95) return 'Thunderstorm';
  return 'Mixed weather';
}

function cacheGet<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const { at, v } = JSON.parse(raw) as { at: number; v: T };
    return Date.now() - at < maxAgeMs ? v : null;
  } catch {
    return null;
  }
}
function cacheSet(key: string, v: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v }));
  } catch {
    /* fine */
  }
}

const BASE_LIST = [
  'Passport valid for at least 6 months',
  'Visa approval copy (printed and on your phone)',
  'Hotel booking confirmation',
  'Return flight ticket',
  'Travel insurance (recommended)',
  'Some local currency and a working bank card',
  'Phone charger and a travel adapter',
];
const REGION_LIST: Record<string, string[]> = {
  'Religious & Heritage': ['Modest, comfortable clothing', 'Comfortable walking shoes', 'Prayer essentials and a small bag for the Haram'],
  'Middle East': ['Light, breathable clothing and sunscreen', 'A light jacket for air-conditioned places'],
  'Central Asia & Caucasus': ['Layers, as mornings and evenings can be cool', 'Comfortable walking shoes'],
  Europe: ['Warm layers and a rain jacket', 'Comfortable walking shoes'],
  'Asia Pacific': ['Light clothing, sunscreen and an umbrella', 'Insect repellent'],
};

export function DestinationExtras({ dest }: { dest: Destination }) {
  const { t } = useLang();
  const ex = EXTRAS[dest.id];
  const [weather, setWeather] = useState<{ temp: number; code: number } | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [pkr, setPkr] = useState('100000');
  const checklist = useMemo(() => [...BASE_LIST, ...(REGION_LIST[dest.region] || [])], [dest.region]);
  const storeKey = `bj_checklist_${dest.id}`;
  const [done, setDone] = useState<number[]>([]);

  useEffect(() => {
    try {
      setDone(JSON.parse(window.localStorage.getItem(storeKey) || '[]'));
    } catch {
      setDone([]);
    }
  }, [storeKey]);
  const toggle = (i: number) => {
    setDone((d) => {
      const n = d.includes(i) ? d.filter((x) => x !== i) : [...d, i];
      try {
        window.localStorage.setItem(storeKey, JSON.stringify(n));
      } catch {
        /* not remembered */
      }
      return n;
    });
  };

  useEffect(() => {
    if (!ex) return;
    let alive = true;
    const wKey = `bj_wx_${dest.id}`;
    const cached = cacheGet<{ temp: number; code: number }>(wKey, 30 * 60 * 1000);
    if (cached) setWeather(cached);
    else {
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ex.lat}&longitude=${ex.lon}&current=temperature_2m,weather_code&timezone=auto`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => {
          const v = { temp: Math.round(j.current.temperature_2m), code: Number(j.current.weather_code) };
          cacheSet(wKey, v);
          if (alive) setWeather(v);
        })
        .catch(() => {});
    }
    const rKey = `bj_fx_${ex.cur}`;
    const r0 = cacheGet<number>(rKey, 6 * 3600 * 1000);
    if (r0) setRate(r0);
    else {
      fetch('https://open.er-api.com/v6/latest/PKR')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j) => {
          const v = Number(j?.rates?.[ex.cur]);
          if (v > 0) {
            cacheSet(rKey, v);
            if (alive) setRate(v);
          }
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [dest.id, ex]);

  const amount = Number(pkr.replace(/[^\d.]/g, '')) || 0;
  const converted = rate ? amount * rate : 0;
  const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 }));

  return (
    <div className="space-y-3 pt-1">
      {(weather || rate) && ex && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {weather && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('Weather now')} · {ex.city}</p>
              <p className="mt-1 text-lg font-extrabold text-slate-900 tabular-nums">{weather.temp}°C <span className="text-xs font-semibold text-slate-600">{weatherWord(weather.code)}</span></p>
            </div>
          )}
          {rate && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('Currency converter')}</p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="text-xs font-bold text-slate-600">PKR</span>
                <input
                  inputMode="numeric"
                  value={pkr}
                  onChange={(e) => setPkr(e.target.value)}
                  aria-label="PKR amount"
                  className="w-24 min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-base sm:text-xs font-semibold text-slate-900 tabular-nums"
                />
                <span className="text-xs text-slate-500">≈</span>
                <b className="text-sm text-slate-900 tabular-nums">{fmt(converted)} {ex.cur}</b>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">{t('Approximate market rate, for guidance only.')}</p>
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('Travel checklist')}</h4>
          <span className="text-[11px] font-bold text-emerald-700 tabular-nums">{done.length}/{checklist.length}</span>
        </div>
        <ul className="mt-2 space-y-1.5">
          {checklist.map((item, i) => (
            <li key={item}>
              <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={done.includes(i)} onChange={() => toggle(i)} className="mt-0.5 h-4 w-4 accent-emerald-600 shrink-0" />
                <span className={done.includes(i) ? 'line-through text-slate-400' : ''}>{t(item)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-slate-400">{t('A general list. Requirements can differ by nationality; please confirm with our team.')}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Swipe, bottom bar, plane swoop, count-up                            */
/* ------------------------------------------------------------------ */

export function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const p = e.touches[0];
      start.current = { x: p.clientX, y: p.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s.x;
      const dy = p.clientY - s.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) (dx < 0 ? onLeft : onRight)();
    },
  };
}

export function PlaneSwoop({ swoopKey }: { swoopKey: number }) {
  const [alive, setAlive] = useState(0);
  useEffect(() => {
    if (!swoopKey || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    setAlive(swoopKey);
    const id = window.setTimeout(() => setAlive(0), 1300);
    return () => window.clearTimeout(id);
  }, [swoopKey]);
  if (!alive) return null;
  return (
    <div className="plane-swoop no-print" aria-hidden="true" key={alive}>
      <span className="plane-swoop-trail" />
      <svg viewBox="0 0 24 24" width="30" height="30" fill="#0284c7" className="plane-swoop-jet"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)" /></svg>
    </div>
  );
}

/** Phone-only bar at the bottom: Track, Destinations and (when set) WhatsApp. */
export function BottomBar({ whatsappHref, onTrack, onDestinations, onChatTap }: { whatsappHref: string; onTrack: () => void; onDestinations: () => void; onChatTap: () => void }) {
  const { t } = useLang();
  const btn = 'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-bold text-slate-700 active:bg-slate-100 cursor-pointer';
  return (
    <nav className="no-print sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 flex" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Quick actions">
      <button type="button" onClick={onTrack} className={btn}>
        <Search className="w-5 h-5 text-sky-600" />
        <span>{t('Track')}</span>
      </button>
      <button type="button" onClick={onDestinations} className={btn}>
        <Compass className="w-5 h-5 text-indigo-600" />
        <span>{t('Destinations')}</span>
      </button>
      {whatsappHref && (
        <a href={whatsappHref} target="_blank" rel="noopener noreferrer" onClick={onChatTap} className={btn}>
          <WhatsAppGlyph className="w-5 h-5 text-[#25D366]" />
          <span>{t('Chat')}</span>
        </a>
      )}
    </nav>
  );
}

/** Numbers that count up once when they appear. */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !Number.isFinite(value) || value === 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setShown(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
