import { useEffect, useRef, useState } from 'react';
import { Download, Languages, Share2 } from 'lucide-react';
import { useLang } from './i18n';

/** Keeps only digits so "+92 300 1234567" becomes "923001234567" (the form WhatsApp links need). */
export function waDigits(raw: string | undefined | null): string {
  return String(raw || '').replace(/\D+/g, '');
}

export function WhatsAppGlyph({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.02 3C9.4 3 4.04 8.36 4.04 14.97c0 2.36.69 4.55 1.88 6.41L4 29l7.8-1.87a11.9 11.9 0 0 0 4.22 .77c6.62 0 11.98-5.36 11.98-11.97C28 8.36 22.64 3 16.02 3Zm0 21.85c-1.35 0-2.64-.29-3.8-.82l-.7-.32-4.62 1.1 1.14-4.5-.37-.7a9.8 9.8 0 0 1-1.26-4.8c0-5.45 4.43-9.88 9.9-9.88 5.45 0 9.88 4.43 9.88 9.88 0 5.46-4.43 9.04-9.88 9.04Zm5.42-7.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.88.12.57-.08 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35Z" />
    </svg>
  );
}

export function waLink(number: string, text: string) {
  return `https://wa.me/${waDigits(number)}?text=${encodeURIComponent(text)}`;
}

/** Floating "Chat on WhatsApp" button. Shows only when the admin has saved a number. */
export function WhatsAppFab({ number, message, onTap }: { number: string; message: string; onTap?: () => void }) {
  const { t } = useLang();
  if (!waDigits(number)) return null;
  return (
    <a
      href={waLink(number, message)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onTap}
      aria-label={t('Chat on WhatsApp')}
      className="no-print wa-fab fixed right-4 z-40 hidden sm:flex items-center gap-2 rounded-full bg-[#25D366] text-white shadow-lg shadow-emerald-700/30 pl-3.5 pr-3.5 sm:pr-4 h-12 hover:brightness-105 active:scale-95 transition"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <WhatsAppGlyph />
      <span className="hidden sm:inline text-sm font-bold">{t('Chat on WhatsApp')}</span>
    </a>
  );
}

/** "Send to family on WhatsApp" — opens WhatsApp with the tracking link ready to send. */
export function WhatsAppShare({ url, text }: { url: string; text: string }) {
  const { t } = useLang();
  return (
    <a
      href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 text-xs sm:text-sm font-semibold text-emerald-800 transition-colors"
    >
      <WhatsAppGlyph className="w-4 h-4 text-emerald-600" />
      <span className="max-sm:sr-only">{t('Send to family on WhatsApp')}</span>
    </a>
  );
}

/** English / اردو switch. */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')}
      aria-label={lang === 'ur' ? 'Switch to English' : 'اردو میں دیکھیں'}
      className="no-print inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 h-10 text-xs sm:text-sm font-bold text-slate-700 transition-colors cursor-pointer"
    >
      <Languages className="w-4 h-4 text-sky-600" />
      <span>{lang === 'ur' ? 'English' : 'اردو'}</span>
    </button>
  );
}

/** Circular "how much is paid" ring. */
export function PaymentRing({ percent, size = 54 }: { percent: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setShown(pct));
    return () => window.cancelAnimationFrame(id);
  }, [pct]);
  const color = pct >= 100 ? '#059669' : pct > 0 ? '#0284c7' : '#94a3b8';
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${pct}% paid`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * shown) / 100}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <span className="absolute text-[11px] font-extrabold tabular-nums text-slate-800">{pct}%</span>
    </span>
  );
}

/** A passport-style stamp that slams down when it appears. */
export function VisaStamp({ label }: { label: string }) {
  return (
    <span className="visa-stamp" aria-hidden="true">
      <span className="visa-stamp-inner">{label}</span>
    </span>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Lets a customer put the portal on their phone's home screen. */
export function InstallButton() {
  const { t } = useLang();
  const deferred = useRef<InstallEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [iosHint, setIosHint] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const ua = navigator.userAgent || '';
    const isIos = /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua);
    if (isIos) setIosHint(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as InstallEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setCanInstall(false);
      setIosHint(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!canInstall && !iosHint) return null;

  const onClick = async () => {
    if (deferred.current) {
      try {
        await deferred.current.prompt();
        await deferred.current.userChoice;
      } catch {
        /* user dismissed */
      }
      deferred.current = null;
      setCanInstall(false);
    } else {
      setShowHint((v) => !v);
    }
  };

  return (
    <span className="relative no-print">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 hover:bg-sky-100 px-3 h-10 text-xs sm:text-sm font-bold text-sky-800 transition-colors cursor-pointer"
      >
        {iosHint && !canInstall ? <Share2 className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        <span>{t('Install app')}</span>
      </button>
      {showHint && (
        <span className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-slate-200 bg-white p-3 text-xs font-medium text-slate-700 shadow-xl">
          {t('Tap Share, then "Add to Home Screen".')}
        </span>
      )}
    </span>
  );
}

/** Makes the portal installable by pointing the browser at its own app manifest (only on this page). */
export function usePortalManifest() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/portal.webmanifest';
    link.setAttribute('data-portal-manifest', '1');
    const theme = document.createElement('meta');
    theme.name = 'theme-color';
    theme.content = '#0284c7';
    theme.setAttribute('data-portal-manifest', '1');
    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = '/portal-icon-192.png';
    apple.setAttribute('data-portal-manifest', '1');
    document.head.append(link, theme, apple);
    return () => {
      document.querySelectorAll('[data-portal-manifest="1"]').forEach((n) => n.remove());
    };
  }, []);
}
