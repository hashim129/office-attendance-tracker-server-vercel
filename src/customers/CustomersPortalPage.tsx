import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  CreditCard,
  FileText,
  Globe2,
  Info,
  MapPin,
  Plane,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { fmtAmount } from '../crm/currencies';
import PlaneAnimation from './PlaneAnimation';
import { inSeason } from './season';
import JourneySteps from './JourneySteps';
import { LangProvider, useLang } from './i18n';
import { InstallButton, LangToggle, PaymentRing, VisaStamp, WhatsAppFab, WhatsAppShare, usePortalManifest } from './PortalExtras';
import { Confetti, FloatingScene, RotatingWord, useTiltCards } from './PortalFx';
import { BottomBar, CountUp, DestinationExtras, PlaneSwoop, SeasonTheme, TripCountdown, themeFor, useSwipe, type ThemeChoice } from './PortalBatch3';
import JetShowcase from './JetShowcase';
import { photoSrcSet, prefetchPhoto } from './imageUtil';
import {
  CURATED_DESTINATIONS,
  DESTINATION_REGIONS,
  matchDestinationsForInvoices,
  type Destination,
  type DestinationRegion,
} from './destinations';

type VisaProgressStatus = 'not_started' | 'in_progress' | 'issued';
type PublicInvoiceStatus = 'unpaid' | 'paid' | 'cancelled';

interface PublicVisaProgress {
  enabled: boolean;
  status: VisaProgressStatus;
  inProgressDate: string | null;
  issuedDate: string | null;
  paymentApproved?: boolean;
  paymentApprovedDate?: string | null;
  hotelEnabled?: boolean;
  hotelStatus?: VisaProgressStatus;
  hotelName?: string | null;
  hotelCheckInDate?: string | null;
  hotelCheckOutDate?: string | null;
  hotelInProgressDate?: string | null;
  hotelIssuedDate?: string | null;
  ticketEnabled?: boolean;
  ticketStatus?: VisaProgressStatus;
  ticketDetails?: string | null;
  ticketInProgressDate?: string | null;
  ticketIssuedDate?: string | null;
  transferEnabled?: boolean;
  transferStatus?: VisaProgressStatus;
  transferDetails?: string | null;
  transferInProgressDate?: string | null;
  transferIssuedDate?: string | null;
  insuranceEnabled?: boolean;
  insuranceStatus?: VisaProgressStatus;
  insuranceDetails?: string | null;
  insuranceInProgressDate?: string | null;
  insuranceIssuedDate?: string | null;
  travelReadyEnabled?: boolean;
  travelReadyDate?: string | null;
  updatedAt: string | null;
}

interface PublicInvoiceLine {
  description: string;
  note: boolean;
  unitPrice: number | null;
  units: number | null;
  currency: string | null;
  rate: number | null;
  amount: number | null;
}

interface PublicInvoiceSection {
  title: string;
  lines: PublicInvoiceLine[];
}

interface PublicInvoiceDTO {
  id: string;
  amountsHidden?: boolean;
  portalNote?: string | null;
  portalNoteAt?: string | null;
  travelDate?: string | null;
  invoiceNo: string;
  crmId: string;
  queryCode: string;
  customerName: string;
  reference: string;
  invoiceDate: string;
  dueDate: string | null;
  currency: string;
  sections: PublicInvoiceSection[];
  taxLabel: string;
  taxRate: number;
  discount: number;
  advancePaid: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  balance: number;
  status: PublicInvoiceStatus;
  isVisa: boolean;
  isHotel?: boolean;
  isTicket?: boolean;
  isTransfer?: boolean;
  isInsurance?: boolean;
  visaProgress: PublicVisaProgress | null;
  createdAt: string;
  updatedAt: string;
}

interface PublicReceiptSummary {
  receiptNo: string;
  queryCode: string;
  paymentType: 'full' | 'partial';
  currency: string;
  totalAmount: number;
  amountReceived: number;
  items: string[];
  otherItem: string;
  createdAt: string;
}

interface PublicVisaStats {
  total: number;
  notStarted: number;
  inProgress: number;
  issued: number;
}

interface PublicPortalQueryDTO {
  queryRef: string;
  packageTitle: string;
  desiredCountries: string[];
  desiredDays: string | null;
  desiredServices: string[];
  crmId: string | null;
  isExistingCustomer: boolean;
  status: 'new' | 'contacted' | 'quoted' | 'closed';
  createdAt: string | null;
}

interface PublicLookupSuccessResponse {
  ok: true;
  available: true;
  found: true;
  query: string;
  customerName: string;
  invoices: PublicInvoiceDTO[];
  receiptsSummary: PublicReceiptSummary[];
  visaStats: PublicVisaStats;
  portalQueries?: PublicPortalQueryDTO[];
  amountsHidden?: boolean;
}

interface PublicApiErrorResponse {
  ok: false;
  available?: boolean;
  found?: boolean;
  error?: string;
  retryAfterSec?: number;
  message?: string;
}

type GateStatus = 'checking' | 'unavailable' | 'ready';

type LookupState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'found'; data: PublicLookupSuccessResponse }
  | { kind: 'not_found'; query: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'error'; message: string };

interface TimelineStep {
  id: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  state: 'completed' | 'current' | 'upcoming' | 'cancelled' | 'skipped';
  detail: string;
  meta?: string;
}

const QUERY_RE = /^[A-Za-z0-9_\-\/.:#+ ]{2,80}$/;
const HAS_ALNUM_RE = /[A-Za-z0-9]/;
const QUOTE_SERVICES_OPTIONS = [
  'Visa Processing',
  'Hotel Booking',
  'Flight Tickets',
  'Full Tour Package',
  'Airport Transfers',
  'Umrah / Ziyarat Package',
  'Travel Insurance',
] as const;

function normalizeQuery(raw: string): string {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function validateSearchQuery(raw: string): { ok: true; q: string } | { ok: false; message: string } {
  const q = normalizeQuery(raw);
  const nonSpaceLen = q.replace(/\s+/g, '').length;
  if (q.length < 2 || q.length > 80 || nonSpaceLen < 2) {
    return {
      ok: false,
      message: 'Enter between 2 and 80 characters (Query Code, CRM ID, or Invoice Number).',
    };
  }
  if (!QUERY_RE.test(q) || !HAS_ALNUM_RE.test(q)) {
    return {
      ok: false,
      message: 'Use letters, numbers, spaces, and standard reference symbols (_ - / . : # +).',
    };
  }
  return { ok: true, q };
}

function crmQueryOf(inv: Pick<PublicInvoiceDTO, 'crmId' | 'queryCode'>): string {
  const a = String(inv.crmId || '').trim();
  const b = String(inv.queryCode || '').trim();
  return a && b && a !== b ? `${a} / ${b}` : a || b;
}

function niceDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const head = String(iso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return '';
  const dt = new Date(`${head}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function niceTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupAmountsByCurrency<T>(
  items: T[],
  getCurrency: (item: T) => string,
  getAmount: (item: T) => number
): Array<{ currency: string; amount: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    const code = String(getCurrency(item) || 'PKR').toUpperCase();
    const val = Number(getAmount(item)) || 0;
    map.set(code, (map.get(code) || 0) + val);
  }
  return Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount }));
}

function visaStatusLabel(status: VisaProgressStatus): string {
  if (status === 'issued') return 'Visa Issued';
  if (status === 'in_progress') return 'In Progress';
  return 'Not Started';
}

function visaStatusClasses(status: VisaProgressStatus): string {
  if (status === 'issued') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'in_progress') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function invoiceStatusClasses(status: PublicInvoiceStatus): string {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

function invoiceStatusLabel(status: PublicInvoiceStatus): string {
  if (status === 'paid') return 'Paid';
  if (status === 'cancelled') return 'Cancelled';
  return 'Unpaid';
}

/** True while the element is (nearly) on screen; used to pause sliders that nobody can see. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

function FeaturedDestinationHeroSlider({
  destinations,
  prefersReducedMotion,
  onSelectDestination,
  onRequestQuote,
}: {
  destinations: Destination[];
  prefersReducedMotion: boolean | null;
  onSelectDestination: (dest: Destination) => void;
  onRequestQuote: (dest: Destination) => void;
}) {
  const { t, lang } = useLang();
  const [slideIdx, setSlideIdx] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const count = destinations.length;
  const safeIdx = count > 0 ? slideIdx % count : 0;
  const current = destinations[safeIdx];

  const heroRef = useRef<HTMLDivElement>(null);
  const heroVisible = useOnScreen(heroRef);
  const heroSwipe = useSwipe(
    () => setSlideIdx((prev) => (prev + 1) % Math.max(count, 1)),
    () => setSlideIdx((prev) => (prev - 1 + Math.max(count, 1)) % Math.max(count, 1)),
  );

  useEffect(() => {
    if (prefersReducedMotion || isPaused || count <= 1 || !heroVisible) return;
    const timer = window.setInterval(() => {
      setSlideIdx((prev) => (prev + 1) % count);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, isPaused, count, heroVisible]);

  // Download the next two slides ahead of time so the change is instant, even on a slow phone connection.
  useEffect(() => {
    if (count <= 1 || !heroVisible) return;
    prefetchPhoto(destinations[(safeIdx + 1) % count]?.photos[0], 1000);
    prefetchPhoto(destinations[(safeIdx + 2) % count]?.photos[0], 1000);
  }, [safeIdx, count, heroVisible, destinations]);

  if (!current) return null;

  return (
    <div
      ref={heroRef}
      className="relative rounded-3xl overflow-hidden border border-slate-200 shadow-lg bg-slate-900 h-[27rem] sm:h-88 md:h-96 group"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      {...heroSwipe}
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={current.id}
          initial={prefersReducedMotion ? false : { opacity: 0, x: 40, scale: 1.03 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, x: -40 }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
          className="absolute inset-0"
        >
          <img
            src={current.photos[0]}
            srcSet={photoSrcSet(current.photos[0])}
            sizes="(max-width: 1024px) 100vw, 1100px"
            alt={`${current.name}, ${current.country}`}
            decoding="async"
            fetchPriority="high"
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-slate-950/20" />
        </motion.div>
      </AnimatePresence>

      {/* Top region & caption bar */}
      <div className="relative z-10 p-5 sm:p-7 h-full flex flex-col justify-between">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-black/45 backdrop-blur-md border border-white/25 px-3.5 py-1 text-xs font-semibold text-white">
            <Globe2 className="w-3.5 h-3.5 text-sky-400" />
            <span>{current.region}</span>
            <span className="text-white/50">·</span>
            <span className="text-sky-200">{current.photoCaptions?.[0] || current.name}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSlideIdx((prev) => (prev - 1 + count) % count)}
              aria-label="Previous destination slide"
              className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md border border-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setSlideIdx((prev) => (prev + 1) % count)}
              aria-label="Next destination slide"
              className="w-9 h-9 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md border border-white/25 text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div className="max-w-2xl space-y-1.5">
            <p className="text-xs sm:text-sm font-semibold text-sky-300 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <MapPin className="w-4 h-4" />
              <span>{current.country}</span>
              <span className="text-white/40">•</span>
              <span className="text-white/80">{t('Best Season')}: {current.bestSeason}</span>
            </p>
            <h3 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-xs">
              {current.name}
            </h3>
            <p className="text-xs sm:text-sm text-white/90 line-clamp-2 leading-relaxed">
              {current.tagline}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => onRequestQuote(current)}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-sky-500 hover:bg-sky-400 text-white px-4 py-2.5 text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>{t('Get a quote & let our representative contact you')}</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectDestination(current)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white text-slate-950 hover:bg-sky-50 px-5 py-2.5 text-xs sm:text-sm font-bold shadow-md transition-all cursor-pointer"
            >
              <span>{lang === 'ur' ? `${current.name} ${t('Gallery')} ${t('Explore')}` : `Explore ${current.name} Gallery`}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Slide Dots */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 hidden sm:flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-xs px-3 py-1 border border-white/15">
        {destinations.map((d, i) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setSlideIdx(i)}
            aria-label={`Slide to ${d.name}`}
            className={`relative after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] h-1.5 rounded-full transition-all cursor-pointer ${
              i === safeIdx ? 'w-6 bg-sky-400' : 'w-1.5 bg-white/55 hover:bg-white'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function DestinationCardPhotoSlider({
  dest,
  cardIndex,
  isMatched,
  prefersReducedMotion,
}: {
  dest: Destination;
  cardIndex: number;
  isMatched: boolean;
  prefersReducedMotion: boolean | null;
}) {
  const { t } = useLang();
  const photos = dest.photos || [];
  const captions = dest.photoCaptions || [];
  const [photoIdx, setPhotoIdx] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const cardVisible = useOnScreen(cardRef);

  // Only cards that are on screen rotate (and download) photos; the next photo is fetched before it is shown.
  useEffect(() => {
    if (prefersReducedMotion || isHovered || photos.length <= 1 || !cardVisible) return;
    const intervalMs = 3400 + (cardIndex % 4) * 450;
    prefetchPhoto(photos[(photoIdx + 1) % photos.length], 640);
    const timer = window.setInterval(() => {
      setPhotoIdx((prev) => (prev + 1) % photos.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, isHovered, photos, cardIndex, cardVisible, photoIdx]);

  const currentPhoto = photos[photoIdx] || photos[0];
  const currentCaption = captions[photoIdx] || dest.name;
  const cardSwipe = useSwipe(
    () => photos.length > 1 && setPhotoIdx((p) => (p + 1) % photos.length),
    () => photos.length > 1 && setPhotoIdx((p) => (p - 1 + photos.length) % photos.length),
  );

  return (
    <div
      ref={cardRef}
      {...cardSwipe}
      className="img-shimmer relative h-52 w-full overflow-hidden bg-slate-900 p-4 flex flex-col justify-between"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Sliding Real Photographs */}
      <AnimatePresence mode="wait">
        <motion.img
          key={`${dest.id}-photo-${photoIdx}`}
          src={currentPhoto}
          srcSet={photoSrcSet(currentPhoto)}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
          alt={`${dest.name} — ${currentCaption}`}
          loading="lazy"
          decoding="async"
          initial={prefersReducedMotion ? false : { opacity: 0, x: 24, scale: 1.04 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={prefersReducedMotion ? undefined : { opacity: 0, x: -24 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="absolute inset-0 w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-700"
        />
      </AnimatePresence>

      {/* Scrim overlay for crisp text readability over real photos */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-slate-950/35 pointer-events-none" />

      {/* Top Row: Region Pill, Matched Badge, and Slide Dots */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className="rounded-full bg-black/45 backdrop-blur-md border border-white/25 px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-2xs">
          {dest.region}
        </span>

        <div className="flex items-center gap-1.5">
          {isMatched && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 text-white px-2.5 py-0.5 text-[11px] font-bold shadow-xs">
              <Sparkles className="w-3 h-3" />
              {t('Matched to Your Trip')}
            </span>
          )}
          {photos.length > 1 && (
            <div
              className="inline-flex items-center gap-1 rounded-full bg-black/45 backdrop-blur-xs px-2 py-1 border border-white/20"
              onClick={(e) => e.stopPropagation()}
            >
              {photos.map((_, idx) => (
                <span
                  key={idx}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPhotoIdx(idx);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      setPhotoIdx(idx);
                    }
                  }}
                  aria-label={`View photo ${idx + 1} of ${dest.name}`}
                  className={`relative after:absolute after:-inset-y-2.5 after:-inset-x-0.5 after:content-[''] block h-1.5 rounded-full transition-all cursor-pointer ${
                    idx === photoIdx ? 'w-4 bg-sky-400' : 'w-1.5 bg-white/60 hover:bg-white'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Left/Right Slide Controls on Hover */}
      {photos.length > 1 && (
        <div
          className="relative z-10 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setPhotoIdx((prev) => (prev - 1 + photos.length) % photos.length);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                setPhotoIdx((prev) => (prev - 1 + photos.length) % photos.length);
              }
            }}
            aria-label={`Previous photo of ${dest.name}`}
            className="w-7 h-7 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/25 flex items-center justify-center shadow-xs cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setPhotoIdx((prev) => (prev + 1) % photos.length);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                setPhotoIdx((prev) => (prev + 1) % photos.length);
              }
            }}
            aria-label={`Next photo of ${dest.name}`}
            className="w-7 h-7 rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/25 flex items-center justify-center shadow-xs cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      )}

      {/* Bottom Title & Photo Caption */}
      <div className="relative z-10">
        <p className="text-xs font-semibold text-sky-300 flex items-center gap-1 drop-shadow-2xs">
          <MapPin className="w-3.5 h-3.5" />
          <span>{dest.country}</span>
        </p>
        <h3 className="text-xl font-extrabold text-white tracking-tight drop-shadow-2xs">
          {dest.name}
        </h3>
        <p className="text-[11px] text-white/80 truncate mt-0.5">{currentCaption}</p>
      </div>
    </div>
  );
}

function DestinationModalPhotoSlider({
  dest,
  prefersReducedMotion,
  onClose,
}: {
  dest: Destination;
  prefersReducedMotion: boolean | null;
  onClose: () => void;
}) {
  const photos = dest.photos || [];
  const captions = dest.photoCaptions || [];
  const [photoIdx, setPhotoIdx] = useState(0);

  useEffect(() => {
    setPhotoIdx(0);
    // Only three photos: fetch them all right away so switching is instant.
    (dest.photos || []).slice(1).forEach((u) => prefetchPhoto(u, 700));
  }, [dest.id, dest.photos]);

  useEffect(() => {
    if (prefersReducedMotion || photos.length <= 1) return;
    const timer = window.setInterval(() => {
      setPhotoIdx((prev) => (prev + 1) % photos.length);
    }, 3800);
    return () => window.clearInterval(timer);
  }, [prefersReducedMotion, photos.length]);

  const currentPhoto = photos[photoIdx] || photos[0];
  const currentCaption = captions[photoIdx] || dest.name;
  const modalSwipe = useSwipe(
    () => photos.length > 1 && setPhotoIdx((p) => (p + 1) % photos.length),
    () => photos.length > 1 && setPhotoIdx((p) => (p - 1 + photos.length) % photos.length),
  );

  return (
    <div className="space-y-2.5 bg-slate-950">
      <div {...modalSwipe} className="img-shimmer relative h-40 sm:h-52 md:h-64 p-5 flex flex-col justify-between overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.img
            key={`${dest.id}-modal-${photoIdx}`}
            src={currentPhoto}
            srcSet={photoSrcSet(currentPhoto)}
            sizes="(max-width: 768px) 100vw, 520px"
            decoding="async"
            alt={`${dest.name} — ${currentCaption}`}
            initial={prefersReducedMotion ? false : { opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, x: -30 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="absolute inset-0 w-full h-full object-cover object-center"
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/25 to-slate-950/40 pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between">
          <span className="rounded-full bg-black/50 backdrop-blur-md border border-white/25 px-3 py-1 text-xs font-semibold text-white">
            {dest.region}
          </span>
          <div className="flex items-center gap-1.5">
            {photos.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((prev) => (prev - 1 + photos.length) % photos.length)}
                  aria-label="Previous destination photo"
                  className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 border border-white/20 text-white flex items-center justify-center cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoIdx((prev) => (prev + 1) % photos.length)}
                  aria-label="Next destination photo"
                  className="w-8 h-8 rounded-full bg-black/50 hover:bg-black/75 border border-white/20 text-white flex items-center justify-center cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close destination details"
              className="w-8 h-8 rounded-full bg-black/55 hover:bg-black/80 border border-white/25 text-white flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-xs font-semibold text-sky-300 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            <span>{dest.country}</span>
          </p>
          <h3 id="dest-modal-title" className="text-2xl font-extrabold text-white">
            {dest.name}
          </h3>
          <p className="text-xs text-white/85 mt-0.5">{currentCaption}</p>
        </div>
      </div>

      {/* Interactive Photo Thumbnails Strip */}
      {photos.length > 1 && (
        <div className="px-5 pb-3 grid grid-cols-3 gap-2">
          {photos.map((url, idx) => (
            <button
              key={url}
              type="button"
              onClick={() => setPhotoIdx(idx)}
              className={`relative h-14 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                idx === photoIdx
                  ? 'border-sky-400 ring-2 ring-sky-400/30 opacity-100'
                  : 'border-white/15 opacity-65 hover:opacity-100'
              }`}
            >
              <img
                src={url}
                srcSet={photoSrcSet(url)}
                sizes="140px"
                alt={captions[idx] || `${dest.name} photo ${idx + 1}`}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface PortalPublicConfig {
  whatsappNumber: string;
  whatsappMessage: string;
  effects: { jet: boolean; confetti: boolean; scene3d: boolean; planeMap: boolean };
  theme: ThemeChoice;
  announcement: { text: string; tone: 'info' | 'success' | 'warning' } | null;
  offers: { id: string; title: string; text: string; expiresAt: string }[];
  destinations: { order: string[]; hidden: string[]; overrides: Record<string, { tagline?: string; bestSeason?: string; fromPrice?: string; photos?: string[] }> };
}

const DEFAULT_PORTAL_CONFIG: PortalPublicConfig = {
  whatsappNumber: '',
  whatsappMessage: '',
  effects: { jet: true, confetti: true, scene3d: true, planeMap: true },
  theme: 'auto',
  announcement: null,
  offers: [],
  destinations: { order: [], hidden: [], overrides: {} },
};

/** Fire-and-forget visit counter for the admin's statistics page. */
function sendPortalEvent(type: 'dest_view' | 'wa_click', id?: string) {
  try {
    void fetch('/api/public-customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'event', type, id }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never block the customer */
  }
}

const ANNOUNCE_TONES: Record<string, string> = {
  info: 'bg-sky-600 text-white',
  success: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-slate-900',
};

function PortalInner() {
  const { t, lang } = useLang();
  usePortalManifest();
  const [portalConfig, setPortalConfig] = useState<PortalPublicConfig>(DEFAULT_PORTAL_CONFIG);
  const [bannerHidden, setBannerHidden] = useState(false);
  const prefersReducedMotion = useReducedMotion();

  const [gateStatus, setGateStatus] = useState<GateStatus>('checking');
  const [searchInput, setSearchInput] = useState('');
  const [lookupState, setLookupState] = useState<LookupState>({ kind: 'idle' });
  const [cooldownSec, setCooldownSec] = useState(0);

  const [selectedInvoiceFilter, setSelectedInvoiceFilter] = useState<string>('all');
  const [timelineInvoiceId, setTimelineInvoiceId] = useState<string>('');
  const [activeStepId, setActiveStepId] = useState<string>('booking');

  const [selectedRegion, setSelectedRegion] = useState<'All' | DestinationRegion>('All');
  const [inSeasonOnly, setInSeasonOnly] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const thisMonth = new Date().getMonth();
  const [activeDestination, setActiveDestination] = useState<Destination | null>(null);
  useEffect(() => {
    if (activeDestination) sendPortalEvent('dest_view', activeDestination.id);
  }, [activeDestination]);
  const [copiedShare, setCopiedShare] = useState(false);

  // Live Customers Portal Generated Queries Bar & "Get a quote" modal state
  const [recentPortalQueries, setRecentPortalQueries] = useState<PublicPortalQueryDTO[]>([]);
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [quotePackageTitle, setQuotePackageTitle] = useState('');
  const [quoteName, setQuoteName] = useState('');
  const [quoteMobile, setQuoteMobile] = useState('');
  const [quoteCountriesInput, setQuoteCountriesInput] = useState('');
  const [quoteCountries, setQuoteCountries] = useState<string[]>([]);
  const [quoteDays, setQuoteDays] = useState('');
  const [quoteServices, setQuoteServices] = useState<string[]>([]);
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteTrackingRef, setQuoteTrackingRef] = useState('');
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteSuccess, setQuoteSuccess] = useState<{
    queryRef: string;
    customerName: string;
    desiredCountries: string[];
    desiredDays: string | null;
    desiredServices: string[];
    crmId: string | null;
    isExistingCustomer: boolean;
  } | null>(null);

  const autoSearchedRef = useRef(false);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const shareTimerRef = useRef<number | null>(null);

  // Enforce light mode & neutral/portal document metadata without mutating localStorage
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.title = 'Loading...';
  }, []);

  useEffect(() => {
    if (gateStatus === 'unavailable') {
      document.title = 'Not Found';
      return;
    }
    if (gateStatus === 'ready') {
      document.title = 'Bahaar Journeys — Customer Portal';

      let icon = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
      if (!icon) {
        icon = document.createElement('link');
        icon.rel = 'icon';
        document.head.appendChild(icon);
      }
      icon.type = 'image/png';
      icon.href = '/bahaar-logo.png';

      let desc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      if (!desc) {
        desc = document.createElement('meta');
        desc.name = 'description';
        document.head.appendChild(desc);
      }
      desc.content = 'Bahaar Journeys Customer Portal — Track your trip, invoices, receipts, and visa progress.';
    }
  }, [gateStatus]);

  // Strict Beta Gate check on mount
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function checkGate() {
      try {
        const res = await fetch('/api/public-customers?action=status', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });
        let data: { ok?: boolean; available?: boolean; recentQueries?: PublicPortalQueryDTO[]; config?: Partial<PortalPublicConfig> } | null = null;
        try {
          data = (await res.json()) as {
            ok?: boolean;
            available?: boolean;
            recentQueries?: PublicPortalQueryDTO[];
            config?: Partial<PortalPublicConfig>;
          };
        } catch {
          data = null;
        }
        if (!active) return;

        if (res.ok && data?.available === true) {
          if (Array.isArray(data.recentQueries)) {
            setRecentPortalQueries(data.recentQueries);
          }
          if (data.config) {
            const cfg = data.config;
            setPortalConfig({
              whatsappNumber: cfg.whatsappNumber || '',
              whatsappMessage: cfg.whatsappMessage || '',
              effects: { ...DEFAULT_PORTAL_CONFIG.effects, ...(cfg.effects || {}) },
              theme: cfg.theme || 'auto',
              announcement: cfg.announcement && cfg.announcement.text ? cfg.announcement : null,
              offers: Array.isArray(cfg.offers) ? cfg.offers : [],
              destinations: { ...DEFAULT_PORTAL_CONFIG.destinations, ...(cfg.destinations || {}) },
            });
          }
          setGateStatus('ready');
        } else {
          setGateStatus('unavailable');
        }
      } catch {
        if (!active || controller.signal.aborted) return;
        setGateStatus('unavailable');
      }
    }

    void checkGate();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  // Rate limit live countdown timer
  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  // Cleanup active lookup request and share timer on unmount
  useEffect(() => {
    return () => {
      lookupAbortRef.current?.abort();
      if (shareTimerRef.current !== null) {
        window.clearTimeout(shareTimerRef.current);
        shareTimerRef.current = null;
      }
    };
  }, []);

  // Close destination modal on Escape
  useEffect(() => {
    if (!activeDestination) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveDestination(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeDestination]);

  const executeLookup = useCallback(
    async (rawQuery: string, syncHistory: boolean) => {
      if (cooldownSec > 0) return;

      const validation = validateSearchQuery(rawQuery);
      if (validation.ok === false) {
        setLookupState({ kind: 'invalid', message: validation.message });
        return;
      }

      const q = validation.q;
      setSearchInput(q);

      if (syncHistory) {
        const basePath = window.location.pathname.replace(/\/+$/, '') || '/customers';
        window.history.replaceState(null, '', `${basePath}?q=${encodeURIComponent(q)}`);
      }

      lookupAbortRef.current?.abort();
      const controller = new AbortController();
      lookupAbortRef.current = controller;

      setLookupState({ kind: 'loading', query: q });

      try {
        const res = await fetch(`/api/public-customers?q=${encodeURIComponent(q)}`, {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal,
        });

        let payload: PublicLookupSuccessResponse | PublicApiErrorResponse | null = null;
        try {
          payload = (await res.json()) as PublicLookupSuccessResponse | PublicApiErrorResponse;
        } catch {
          payload = null;
        }

        if (controller.signal.aborted) return;

        if (res.status === 404) {
          if (payload && payload.available === false) {
            setLookupState({ kind: 'idle' });
            setGateStatus('unavailable');
            return;
          }
          setLookupState({ kind: 'not_found', query: q });
          return;
        }

        if (res.status === 429) {
          const errPayload = payload as PublicApiErrorResponse | null;
          const headerSec = Number(res.headers.get('Retry-After'));
          const retrySec =
            Number.isFinite(errPayload?.retryAfterSec) && (errPayload?.retryAfterSec || 0) > 0
              ? Math.ceil(errPayload!.retryAfterSec!)
              : Number.isFinite(headerSec) && headerSec > 0
                ? Math.ceil(headerSec)
                : 60;
          setCooldownSec(retrySec);
          setLookupState({
            kind: 'rate_limited',
            message:
              errPayload?.message ||
              `Too many lookup requests. Please wait ${retrySec} seconds before searching again.`,
          });
          return;
        }

        if (res.status === 400) {
          const errPayload = payload as PublicApiErrorResponse | null;
          setLookupState({
            kind: 'invalid',
            message: errPayload?.message || 'Please check your Query Code, CRM ID, or Invoice Number.',
          });
          return;
        }

        if (!res.ok || !payload || !payload.ok) {
          const errPayload = payload as PublicApiErrorResponse | null;
          setLookupState({
            kind: 'error',
            message: errPayload?.message || 'Unable to retrieve records right now. Please try again.',
          });
          return;
        }

        const success = payload as PublicLookupSuccessResponse;
        setLookupState({ kind: 'found', data: success });
        setSelectedInvoiceFilter('all');

        const firstVisa = success.invoices.find((inv) => inv.isVisa) || success.invoices[0];
        setTimelineInvoiceId(firstVisa?.id || '');
        if (firstVisa?.isVisa && firstVisa.visaProgress) {
          if (firstVisa.visaProgress.status === 'issued') setActiveStepId('visa_issued');
          else setActiveStepId('visa_progress');
        } else {
          setActiveStepId('booking');
        }
      } catch {
        if (controller.signal.aborted) return;
        setLookupState({
          kind: 'error',
          message: 'Network error while checking your booking. Please check your connection and try again.',
        });
      }
    },
    [cooldownSec]
  );

  // Auto-read ?q= once Beta gate opens
  useEffect(() => {
    if (gateStatus !== 'ready' || autoSearchedRef.current) return;
    autoSearchedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const initialQ = params.get('q');
    if (initialQ && initialQ.trim()) {
      setSearchInput(initialQ.trim());
      void executeLookup(initialQ, false);
    }
  }, [gateStatus, executeLookup]);

  const foundData = lookupState.kind === 'found' ? lookupState.data : null;
  useTiltCards();
  const [surpriseKey, setSurpriseKey] = useState('');
  // Jet flyover: the booking details stay hidden until the dropped box bursts open.
  const [jetKey, setJetKey] = useState(0);
  const [swoopKey, setSwoopKey] = useState(0);
  const [holdResults, setHoldResults] = useState(false);
  const [blastKey, setBlastKey] = useState('');
  const resultsRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (lookupState.kind === 'found') {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !portalConfig.effects.jet) return;
      setHoldResults(true);
      setJetKey((n) => n + 1);
    } else {
      setHoldResults(false);
    }
  }, [lookupState]);
  useEffect(() => {
    if (!holdResults) return;
    const t = window.setTimeout(() => setHoldResults(false), 7000); // safety net
    return () => window.clearTimeout(t);
  }, [holdResults]);
  const handleBlast = () => {
    setHoldResults(false);
    setBlastKey(`blast-${Date.now()}`);
    window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  };
  // A little celebration when a visa has been issued for the booking being tracked.
  const confettiKey = foundData && foundData.invoices.some((inv) => inv.visaProgress?.status === 'issued') ? `${foundData.query}-issued` : '';

  const filteredInvoices = useMemo(() => {
    if (!foundData) return [];
    if (selectedInvoiceFilter === 'all') return foundData.invoices;
    return foundData.invoices.filter((inv) => inv.id === selectedInvoiceFilter);
  }, [foundData, selectedInvoiceFilter]);

  const nextTripDate = useMemo(() => {
    const today = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
    const dates = filteredInvoices
      .filter((inv) => inv.status !== 'cancelled' && inv.travelDate && inv.travelDate >= today)
      .map((inv) => inv.travelDate as string)
      .sort();
    return dates[0] || '';
  }, [filteredInvoices]);

  const activeCurrencyTotals = useMemo(() => {
    const active = filteredInvoices.filter((inv) => inv.status !== 'cancelled');
    return {
      billed: groupAmountsByCurrency(active, (inv) => inv.currency, (inv) => inv.total),
      paidOnInvoices: groupAmountsByCurrency(
        active,
        (inv) => inv.currency,
        (inv) => (inv.status === 'paid' ? inv.total : inv.advancePaid)
      ),
      outstanding: groupAmountsByCurrency(active, (inv) => inv.currency, (inv) => inv.balance),
      cancelledCount: filteredInvoices.filter((inv) => inv.status === 'cancelled').length,
    };
  }, [filteredInvoices]);

  const receiptTotalsByCurrency = useMemo(() => {
    if (!foundData) return [];
    return groupAmountsByCurrency(
      foundData.receiptsSummary,
      (rcp) => rcp.currency,
      (rcp) => rcp.amountReceived
    );
  }, [foundData]);

  const computedVisaStats = useMemo<PublicVisaStats>(() => {
    if (!foundData) return { total: 0, notStarted: 0, inProgress: 0, issued: 0 };
    if (selectedInvoiceFilter === 'all') return foundData.visaStats;
    const stats: PublicVisaStats = { total: 0, notStarted: 0, inProgress: 0, issued: 0 };
    for (const inv of filteredInvoices) {
      if (!inv.isVisa || !inv.visaProgress) continue;
      stats.total += 1;
      if (inv.visaProgress.status === 'issued') stats.issued += 1;
      else if (inv.visaProgress.status === 'in_progress') stats.inProgress += 1;
      else stats.notStarted += 1;
    }
    return stats;
  }, [foundData, selectedInvoiceFilter, filteredInvoices]);

  const timelineInvoice = useMemo(() => {
    if (!foundData || foundData.invoices.length === 0) return null;
    if (selectedInvoiceFilter !== 'all') {
      return foundData.invoices.find((inv) => inv.id === selectedInvoiceFilter) || foundData.invoices[0];
    }
    return (
      foundData.invoices.find((inv) => inv.id === timelineInvoiceId) ||
      foundData.invoices.find((inv) => inv.isVisa) ||
      foundData.invoices[0]
    );
  }, [foundData, selectedInvoiceFilter, timelineInvoiceId]);

  const timelineSteps = useMemo<TimelineStep[]>(() => {
    if (!timelineInvoice) return [];
    const inv = timelineInvoice;
    const isCancelled = inv.status === 'cancelled';
    const isPaid = inv.status === 'paid' || inv.balance <= 0;
    const hasPartialPayment = !isPaid && inv.advancePaid > 0;
    const receiptsCount = foundData?.receiptsSummary.length || 0;
    const employeePayApproved = Boolean(inv.visaProgress?.paymentApproved);
    const payApprovedDate = niceDate(inv.visaProgress?.paymentApprovedDate);
    const isPaymentApproved = !isCancelled && (isPaid || hasPartialPayment || receiptsCount > 0 || employeePayApproved);

    const invText = [
      inv.reference || '',
      ...inv.sections.flatMap((s) => [s.title || '', ...s.lines.map((l) => l.description || '')]),
    ].join(' ');

    const hasHotel =
      Boolean(inv.isHotel) ||
      Boolean(inv.visaProgress?.hotelEnabled) ||
      /\b(hotel|resort|accommodation|stay|room|suite|nights?|check-?in|check-?out|bed\s*&\s*breakfast|half\s+board|full\s+board|package|family\s+tour|group\s+tour|holiday|honeymoon|umrah|ziyarat|hajj|makkah|madinah|baku|shahdag|gabala|dubai|abu\s+dhabi|doha|tashkent|samarkand|almaty|shymbulak|istanbul|cappadocia|antalya|kuala\s+lumpur|langkawi|bangkok|phuket|maldives|pullman|hilton|marriott|hyatt|sheraton|swissotel|fairmont|mov[eé]npick|rotana|intercontinental|radisson|holiday\s+inn|novotel|ibis|villa|palace|apartments?)\b/i.test(
        invText
      );
    const hasTicket =
      Boolean(inv.isTicket) ||
      Boolean(inv.visaProgress?.ticketEnabled) ||
      /\b(ticket|flight|airfare|airline|pnr|sector|return\s+ticket|one\s+way|pia|emirates|qatar\s+airways|saudia|flydubai|airblue|serene|etihad|turkish\s+airlines|azerbaijan\s+airlines|azal)\b/i.test(
        invText
      );
    const hasTransfer =
      Boolean(inv.isTransfer) ||
      Boolean(inv.visaProgress?.transferEnabled) ||
      /\b(transfer|tour|excursion|coaster|transport|pickup|pick-up|drop-off|haramain|train|railway|safari|cruise|cable\s+car|sightseeing|ziyarat\s+tour)\b/i.test(
        invText
      );
    const hasInsurance =
      Boolean(inv.isInsurance) ||
      Boolean(inv.visaProgress?.insuranceEnabled) ||
      /\b(insurance|medical\s+cover|travel\s+care|policy|coverage)\b/i.test(invText);

    const steps: TimelineStep[] = [
      {
        id: 'booking',
        title: 'Booking Created',
        subtitle: niceDate(inv.invoiceDate) || 'Recorded',
        dateLabel: niceDate(inv.invoiceDate) || 'Date recorded',
        state: isCancelled ? 'cancelled' : 'completed',
        detail: `Invoice ${inv.invoiceNo} (${crmQueryOf(inv) || 'Customer File'}) was issued${
          inv.reference ? ` for ${inv.reference}` : ''
        }.`,
        meta: inv.dueDate ? `Due Date: ${niceDate(inv.dueDate)}` : undefined,
      },
      {
        id: 'payment',
        title: 'Payment Progress',
        subtitle: isCancelled
          ? 'Cancelled'
          : isPaid
            ? 'Approved & Settled'
            : hasPartialPayment || receiptsCount > 0
              ? 'Approved (Advance Received)'
              : employeePayApproved
                ? payApprovedDate
                  ? `Approved · ${payApprovedDate}`
                  : 'Payment Approved'
                : 'Awaiting Payment',
        dateLabel: isCancelled
          ? 'Cancelled'
          : isPaid
            ? inv.amountsHidden ? 'Paid' : `${inv.currency} ${fmtAmount(inv.total)} paid`
            : employeePayApproved
              ? payApprovedDate || 'Approved'
              : inv.amountsHidden ? 'Payment pending' : `${inv.currency} ${fmtAmount(inv.balance)} balance`,
        state: isCancelled
          ? 'cancelled'
          : isPaymentApproved
            ? 'completed'
            : 'current',
        detail: isCancelled
          ? 'This booking invoice is marked as cancelled.'
          : isPaid
            ? inv.amountsHidden ? 'Payment approved — this booking is fully settled.' : `Payment approved — full invoice amount of ${inv.currency} ${fmtAmount(inv.total)} is settled${
                receiptsCount > 0 ? ` (${receiptsCount} payment receipt${receiptsCount === 1 ? '' : 's'} on file)` : ''
              }. Downstream visa, hotel, and travel steps are unlocked.`
            : inv.amountsHidden && (hasPartialPayment || receiptsCount > 0)
              ? 'Payment approved with advance received. Downstream processing steps are active.'
            : hasPartialPayment || receiptsCount > 0
              ? `Payment approved with advance received (${inv.currency} ${fmtAmount(inv.advancePaid)}). Remaining balance: ${inv.currency} ${fmtAmount(inv.balance)}. Downstream processing steps are active.`
              : employeePayApproved
                ? `Payment approval confirmed by our team${payApprovedDate ? ` on ${payApprovedDate}` : ''}. Downstream visa, hotel, and travel requirements are unlocked.`
                : inv.amountsHidden
                  ? 'Awaiting payment approval. Subsequent steps unlock one after another once payment is approved.'
                  : `Awaiting payment approval (${inv.currency} ${fmtAmount(inv.balance)} balance due). Subsequent steps unlock one after another once payment is approved.`,
      },
    ];

    if (inv.isVisa && inv.visaProgress) {
      const vs = inv.visaProgress.status;
      const inProgDate = niceDate(inv.visaProgress.inProgressDate);
      const issDate = niceDate(inv.visaProgress.issuedDate);
      const visaExplicitlyStarted = vs === 'in_progress' || vs === 'issued';
      const visaStepUnlocked = isPaymentApproved || visaExplicitlyStarted;

      steps.push(
        {
          id: 'visa_progress',
          title: 'Visa Progress',
          subtitle: !visaStepUnlocked
            ? 'Awaiting Payment Approval'
            : vs === 'issued'
              ? 'Visa Issued'
              : vs === 'in_progress'
                ? 'Visa Started (In Progress)'
                : 'Visa Not Started',
          dateLabel: !visaStepUnlocked
            ? 'Locked until payment'
            : vs === 'issued'
              ? issDate || inProgDate || 'Issued'
              : vs === 'in_progress'
                ? inProgDate || 'In Progress'
                : 'Not Started',
          state: isCancelled
            ? 'cancelled'
            : !visaStepUnlocked
              ? 'upcoming'
              : vs === 'issued'
                ? 'completed'
                : 'current',
          detail: !visaStepUnlocked
            ? 'Visa Progress unlocks automatically right after your booking payment is approved.'
            : vs === 'issued'
              ? `Visa Progress is complete — your visa was issued${issDate ? ` on ${issDate}` : ''}.`
              : vs === 'in_progress'
                ? `Visa Progress is active — your visa application has started${inProgDate ? ` (started on ${inProgDate})` : ''}.`
                : 'Visa Progress is registered — visa processing has not started yet.',
          meta: inv.visaProgress.updatedAt ? `Last updated: ${niceTimestamp(inv.visaProgress.updatedAt)}` : undefined,
        },
        {
          id: 'visa_in_progress',
          title: !visaStepUnlocked || vs === 'not_started' ? 'Visa Not Started' : 'Visa Started',
          subtitle: !visaStepUnlocked
            ? 'Awaiting Payment Approval'
            : vs === 'in_progress' || vs === 'issued'
              ? inProgDate
                ? `Started · ${inProgDate}`
                : 'Application Started'
              : 'Not Started Yet',
          dateLabel: !visaStepUnlocked
            ? 'Pending payment'
            : inProgDate || (vs === 'not_started' ? 'Not Started' : 'Started'),
          state: isCancelled
            ? 'cancelled'
            : !visaStepUnlocked
              ? 'upcoming'
              : vs === 'issued'
                ? 'completed'
                : vs === 'in_progress'
                  ? 'current'
                  : 'upcoming',
          detail: !visaStepUnlocked
            ? 'This step activates sequentially once Payment Approval is completed.'
            : vs === 'not_started'
              ? 'Visa Status: Not Started — your visa file is queued and awaiting submission.'
              : inProgDate
                ? `Visa Status: Started (In Progress) — processing began on ${inProgDate}.`
                : 'Visa Status: Started (In Progress) — application is actively under processing.',
          meta: inv.visaProgress.updatedAt ? `Last updated: ${niceTimestamp(inv.visaProgress.updatedAt)}` : undefined,
        },
        {
          id: 'visa_issued',
          title: 'Visa Issued',
          subtitle: !visaStepUnlocked
            ? 'Awaiting Payment Approval'
            : vs === 'issued'
              ? issDate || 'Approved & Issued'
              : 'Pending Issuance',
          dateLabel: !visaStepUnlocked ? 'Pending' : issDate || (vs === 'issued' ? 'Issued' : 'Pending'),
          state: isCancelled
            ? 'cancelled'
            : !visaStepUnlocked
              ? 'upcoming'
              : vs === 'issued'
                ? 'completed'
                : 'upcoming',
          detail: !visaStepUnlocked
            ? 'Visa issuance follows sequentially after Payment Approval and Visa Started.'
            : vs === 'issued'
              ? issDate
                ? `Your visa was issued on ${issDate}. Please review your travel documents before departure.`
                : 'Your visa is marked as Issued.'
              : 'Your visa issuance date will appear here once approved and recorded by our team.',
        }
      );
    }

    if (hasHotel) {
      const hs: VisaProgressStatus = inv.visaProgress?.hotelStatus || 'not_started';
      const hName = (inv.visaProgress?.hotelName || '').trim();
      const hCheckIn = niceDate(inv.visaProgress?.hotelCheckInDate);
      const hCheckOut = niceDate(inv.visaProgress?.hotelCheckOutDate);
      const hInProgDate = niceDate(inv.visaProgress?.hotelInProgressDate);
      const hIssDate = niceDate(inv.visaProgress?.hotelIssuedDate);
      const hotelExplicitlyStarted = hs === 'in_progress' || hs === 'issued';
      const visaGatePassed = !inv.isVisa || inv.visaProgress?.status === 'in_progress' || inv.visaProgress?.status === 'issued';
      const hotelUnlocked = (isPaymentApproved && visaGatePassed) || hotelExplicitlyStarted;
      const stayRangeLabel =
        hCheckIn && hCheckOut
          ? `${hCheckIn} – ${hCheckOut}`
          : hCheckIn
            ? `Check-in ${hCheckIn}`
            : hCheckOut
              ? `Check-out ${hCheckOut}`
              : '';

      steps.push({
        id: 'hotel_booking',
        title: hs === 'issued' ? 'Hotel Confirmed' : 'Hotel Booking',
        subtitle:
          hs === 'issued'
            ? [hName, stayRangeLabel || (hIssDate ? `Confirmed · ${hIssDate}` : 'Confirmed')]
                .filter(Boolean)
                .join(' · ')
            : hs === 'in_progress'
              ? [hName, hInProgDate ? `In Progress · ${hInProgDate}` : 'In Progress']
                  .filter(Boolean)
                  .join(' · ')
              : !isPaymentApproved
                ? hName
                  ? `${hName} · Awaiting Payment`
                  : 'Awaiting Payment Approval'
                : hName
                  ? `${hName} · Queued`
                  : 'Package Requirement · Queued',
        dateLabel:
          hs === 'issued'
            ? hIssDate || stayRangeLabel || 'Confirmed'
            : hs === 'in_progress'
              ? hInProgDate || stayRangeLabel || 'In Progress'
              : !isPaymentApproved
                ? 'Locked until payment'
                : stayRangeLabel || 'Queued',
        state: isCancelled
          ? 'cancelled'
          : hs === 'issued'
            ? 'completed'
            : hs === 'in_progress' || (isPaymentApproved && hotelUnlocked)
              ? 'current'
              : 'upcoming',
        detail:
          hs === 'issued'
            ? `Hotel reservation is confirmed${hName ? ` at ${hName}` : ''}${
                stayRangeLabel ? ` (${stayRangeLabel})` : ''
              }${hIssDate ? ` — confirmed on ${hIssDate}` : ''}. Your check-in voucher is ready.`
            : hs === 'in_progress'
              ? `Hotel booking${hName ? ` at ${hName}` : ''} is actively in progress${
                  stayRangeLabel ? ` (${stayRangeLabel})` : ''
                }${hInProgDate ? ` — started ${hInProgDate}` : ''}.`
              : !isPaymentApproved
                ? `Product catalogue requirement: Hotel Booking${
                    hName ? ` (${hName})` : ''
                  }. Hotel reservation processing unlocks after Payment Approval.`
                : `Product catalogue requirement: Hotel Booking${
                    hName ? ` (${hName})` : ''
                  }. Room allocation and voucher confirmation are queued.`,
        meta:
          hName || stayRangeLabel
            ? [hName ? `Hotel: ${hName}` : '', stayRangeLabel ? `Stay Dates: ${stayRangeLabel}` : '']
                .filter(Boolean)
                .join(' · ')
            : undefined,
      });
    }

    if (hasTicket) {
      const ts: VisaProgressStatus = inv.visaProgress?.ticketStatus || 'not_started';
      const tDetails = (inv.visaProgress?.ticketDetails || '').trim();
      const tInProgDate = niceDate(inv.visaProgress?.ticketInProgressDate);
      const tIssDate = niceDate(inv.visaProgress?.ticketIssuedDate);
      const ticketExplicit = ts === 'in_progress' || ts === 'issued';
      const ticketUnlocked = isPaymentApproved || ticketExplicit;
      steps.push({
        id: 'ticket_booking',
        title: ts === 'issued' ? 'Tickets Issued' : 'Air Tickets',
        subtitle:
          ts === 'issued'
            ? [tDetails, tIssDate ? `Issued · ${tIssDate}` : 'E-Ticket Issued'].filter(Boolean).join(' · ')
            : ts === 'in_progress'
              ? [tDetails, tInProgDate ? `In Progress · ${tInProgDate}` : 'Ticketing In Progress']
                  .filter(Boolean)
                  .join(' · ')
              : !ticketUnlocked
                ? 'Awaiting Payment Approval'
                : tDetails || 'Reservation Queued',
        dateLabel:
          ts === 'issued'
            ? tIssDate || 'Issued'
            : ts === 'in_progress'
              ? tInProgDate || 'In Progress'
              : !ticketUnlocked
                ? 'Locked until payment'
                : 'Queued',
        state: isCancelled
          ? 'cancelled'
          : ts === 'issued'
            ? 'completed'
            : ts === 'in_progress'
              ? 'current'
              : 'upcoming',
        detail:
          ts === 'issued'
            ? `Flight e-tickets${tDetails ? ` (${tDetails})` : ''} have been issued${
                tIssDate ? ` on ${tIssDate}` : ''
              }.`
            : ts === 'in_progress'
              ? `Airline PNR and ticket issuance${tDetails ? ` (${tDetails})` : ''} are currently in progress.`
              : 'Product catalogue requirement: Air Tickets. Flight sector ticketing is queued.',
      });
    }

    if (hasTransfer && (inv.visaProgress?.transferEnabled || inv.visaProgress?.transferStatus === 'in_progress' || inv.visaProgress?.transferStatus === 'issued')) {
      const trs: VisaProgressStatus = inv.visaProgress?.transferStatus || 'not_started';
      const trDetails = (inv.visaProgress?.transferDetails || '').trim();
      const trInProgDate = niceDate(inv.visaProgress?.transferInProgressDate);
      const trIssDate = niceDate(inv.visaProgress?.transferIssuedDate);
      steps.push({
        id: 'transfer_booking',
        title: trs === 'issued' ? 'Transfers Confirmed' : 'Tours & Transfers',
        subtitle:
          trs === 'issued'
            ? [trDetails, trIssDate ? `Confirmed · ${trIssDate}` : 'Confirmed'].filter(Boolean).join(' · ')
            : trs === 'in_progress'
              ? [trDetails, trInProgDate ? `In Progress · ${trInProgDate}` : 'In Progress']
                  .filter(Boolean)
                  .join(' · ')
              : trDetails || 'Transport Queued',
        dateLabel:
          trs === 'issued'
            ? trIssDate || 'Confirmed'
            : trs === 'in_progress'
              ? trInProgDate || 'In Progress'
              : 'Queued',
        state: isCancelled
          ? 'cancelled'
          : trs === 'issued'
            ? 'completed'
            : trs === 'in_progress'
              ? 'current'
              : 'upcoming',
        detail:
          trs === 'issued'
            ? `Tours and ground transfers${trDetails ? ` (${trDetails})` : ''} are confirmed${
                trIssDate ? ` on ${trIssDate}` : ''
              }.`
            : trs === 'in_progress'
              ? `Ground transport and tour arrangements${trDetails ? ` (${trDetails})` : ''} are in progress.`
              : 'Product catalogue requirement: Tours & Transfers.',
      });
    }

    if (hasInsurance && (inv.visaProgress?.insuranceEnabled || inv.visaProgress?.insuranceStatus === 'in_progress' || inv.visaProgress?.insuranceStatus === 'issued')) {
      const ins: VisaProgressStatus = inv.visaProgress?.insuranceStatus || 'not_started';
      const insIssDate = niceDate(inv.visaProgress?.insuranceIssuedDate);
      steps.push({
        id: 'insurance_booking',
        title: ins === 'issued' ? 'Insurance Issued' : 'Travel Insurance',
        subtitle: ins === 'issued' ? (insIssDate ? `Issued · ${insIssDate}` : 'Policy Issued') : ins === 'in_progress' ? 'In Progress' : 'Queued',
        dateLabel: ins === 'issued' ? insIssDate || 'Issued' : ins === 'in_progress' ? 'In Progress' : 'Queued',
        state: isCancelled ? 'cancelled' : ins === 'issued' ? 'completed' : ins === 'in_progress' ? 'current' : 'upcoming',
        detail:
          ins === 'issued'
            ? `Travel insurance policy is issued${insIssDate ? ` on ${insIssDate}` : ''}.`
            : 'Product catalogue requirement: Travel Insurance coverage.',
      });
    }

    const visaReady = !inv.isVisa || inv.visaProgress?.status === 'issued';
    const hotelReady = !hasHotel || inv.visaProgress?.hotelStatus === 'issued';
    const manualTravelReady = Boolean(inv.visaProgress?.travelReadyEnabled);
    const travelReadyDate = niceDate(inv.visaProgress?.travelReadyDate);
    const travelReady = !isCancelled && (manualTravelReady || (isPaymentApproved && visaReady && hotelReady));

    steps.push({
      id: 'travel_ready',
      title: 'Travel Ready',
      subtitle: isCancelled
        ? 'Cancelled'
        : travelReady
          ? travelReadyDate
            ? `Ready · ${travelReadyDate}`
            : 'Cleared to Travel'
          : 'Pending Milestones',
      dateLabel: travelReady ? travelReadyDate || 'All set' : 'Awaiting completion',
      state: isCancelled ? 'cancelled' : travelReady ? 'completed' : 'upcoming',
      detail: isCancelled
        ? 'Booking is cancelled.'
        : travelReady
          ? `All travel requirements for ${inv.invoiceNo} are confirmed and cleared for departure${
              travelReadyDate ? ` (${travelReadyDate})` : ''
            }.`
          : 'Travel readiness unlocks sequentially once payment is approved and all active visa / hotel package milestones are completed.',
    });

    return steps;
  }, [timelineInvoice, foundData]);

  const activeTimelineStep = useMemo(() => {
    return timelineSteps.find((s) => s.id === activeStepId) || timelineSteps[0] || null;
  }, [timelineSteps, activeStepId]);

  const matchedDestinationIds = useMemo(() => {
    if (!foundData) return [];
    return matchDestinationsForInvoices(foundData.invoices);
  }, [foundData]);

  const allDestinations = useMemo<Destination[]>(() => {
    const cfg = portalConfig.destinations;
    const hiddenSet = new Set(cfg.hidden);
    const rank = (id: string) => {
      const i = cfg.order.indexOf(id);
      return i < 0 ? 9999 : i;
    };
    return CURATED_DESTINATIONS.filter((d) => !hiddenSet.has(d.id))
      .map((d) => {
        const o = cfg.overrides[d.id];
        if (!o) return d;
        const photos = o.photos && o.photos.length ? o.photos : null;
        return {
          ...d,
          tagline: o.tagline || d.tagline,
          bestSeason: o.bestSeason || d.bestSeason,
          fromPrice: o.fromPrice || undefined,
          ...(photos
            ? {
                photos: photos as unknown as Destination['photos'],
                photoCaptions: photos.map((_, i) => d.photoCaptions[i] || d.name) as unknown as Destination['photoCaptions'],
              }
            : {}),
        };
      })
      .sort((a, b) => rank(a.id) - rank(b.id));
  }, [portalConfig.destinations]);

  const displayedDestinations = useMemo(() => {
    const matchedSet = new Set(matchedDestinationIds);
    const byRegion =
      selectedRegion === 'All'
        ? allDestinations
        : allDestinations.filter((d) => d.region === selectedRegion);
    const pool = inSeasonOnly ? byRegion.filter((d) => inSeason(d.bestSeason, new Date().getMonth())) : byRegion;

    return [...pool].sort((a, b) => {
      const am = matchedSet.has(a.id) ? 0 : 1;
      const bm = matchedSet.has(b.id) ? 0 : 1;
      return am - bm;
    });
  }, [selectedRegion, inSeasonOnly, matchedDestinationIds, allDestinations]);

  const inSeasonCount = allDestinations.filter((d) => inSeason(d.bestSeason, thisMonth)).length;
  const surpriseMe = () => {
    const pool = displayedDestinations.length ? displayedDestinations : allDestinations;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setHighlightId(pick.id);
    setSurpriseKey(`surprise-${Date.now()}`);
    document.getElementById(`dest-card-${pick.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => setActiveDestination(pick), 1500);
    window.setTimeout(() => setHighlightId(null), 2600);
  };

  const planeProps = useMemo(() => {
    if (!foundData) {
      return {
        statusLabel: 'Live Flight Corridor · Bahaar Global Desk',
        destinationHint: 'Worldwide Trips & Visa Support',
        visaStatus: null as VisaProgressStatus | null,
        isVisaActive: false,
      };
    }
    const matchedDest = allDestinations.find((d) => matchedDestinationIds.includes(d.id));
    const focusInv = timelineInvoice || foundData.invoices[0];
    const vp = focusInv?.visaProgress || null;
    return {
      statusLabel: foundData.customerName
        ? `Guest File · ${foundData.customerName}`
        : `Tracking · ${foundData.query}`,
      destinationHint: matchedDest
        ? `${matchedDest.name}, ${matchedDest.country}`
        : focusInv?.reference || `${foundData.invoices.length} Booking${foundData.invoices.length === 1 ? '' : 's'} Found`,
      visaStatus: vp ? vp.status : null,
      isVisaActive: Boolean(focusInv?.isVisa),
    };
  }, [foundData, matchedDestinationIds, timelineInvoice]);

  const shareUrl = foundData
    ? `${window.location.origin}${window.location.pathname.replace(/\/+$/, '') || '/customers'}?q=${encodeURIComponent(foundData.query)}`
    : '';

  const handleShareLink = async () => {
    if (!foundData) return;
    const basePath = window.location.pathname.replace(/\/+$/, '') || '/customers';
    const shareUrl = `${window.location.origin}${basePath}?q=${encodeURIComponent(foundData.query)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedShare(true);
    }
    if (shareTimerRef.current !== null) {
      window.clearTimeout(shareTimerRef.current);
    }
    shareTimerRef.current = window.setTimeout(() => {
      setCopiedShare(false);
      shareTimerRef.current = null;
    }, 2500);
  };

  const handleClearSearch = () => {
    lookupAbortRef.current?.abort();
    setSearchInput('');
    setLookupState({ kind: 'idle' });
    setSelectedInvoiceFilter('all');
    setTimelineInvoiceId('');
    const basePath = window.location.pathname.replace(/\/+$/, '') || '/customers';
    window.history.replaceState(null, '', basePath);
  };

  const openQuoteModalForDestination = (dest?: Destination | null) => {
    const activeTracking =
      foundData?.query ||
      (foundData?.invoices?.[0] ? crmQueryOf(foundData.invoices[0]) || foundData.invoices[0].invoiceNo : '') ||
      searchInput.trim();
    const initialCountries = dest
      ? [`${dest.name} (${dest.country})`]
      : matchedDestinationIds.length > 0
        ? allDestinations.filter((d) => matchedDestinationIds.includes(d.id)).map(
            (d) => `${d.name} (${d.country})`
          )
        : [];
    setQuotePackageTitle(dest ? `${dest.name}, ${dest.country} — ${dest.packageCue}` : '');
    setQuoteName(foundData?.customerName || '');
    setQuoteTrackingRef(activeTracking);
    setQuoteCountries(initialCountries);
    setQuoteCountriesInput('');
    setQuoteDays(dest ? dest.packageCue : '');
    setQuoteServices(
      dest?.region === 'Religious & Heritage'
        ? ['Umrah / Ziyarat Package', 'Visa Processing', 'Hotel Booking']
        : ['Full Tour Package', 'Visa Processing', 'Hotel Booking']
    );
    setQuoteNotes('');
    setQuoteError('');
    setQuoteSuccess(null);
    setQuoteModalOpen(true);
  };

  const addQuoteCountryChip = () => {
    const parts = quoteCountriesInput
      .split(/[,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setQuoteCountries((prev) => {
      const next = [...prev];
      for (const p of parts) {
        if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) {
          next.push(p);
        }
      }
      return next;
    });
    setQuoteCountriesInput('');
  };

  const toggleQuoteService = (service: string) => {
    setQuoteServices((prev) =>
      prev.includes(service) ? prev.filter((s) => s !== service) : [...prev, service]
    );
  };

  const handleSubmitQuoteRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (quoteBusy) return;
    setQuoteError('');

    const pendingParts = quoteCountriesInput
      .split(/[,;]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const allCountries = [...quoteCountries];
    for (const p of pendingParts) {
      if (!allCountries.some((x) => x.toLowerCase() === p.toLowerCase())) {
        allCountries.push(p);
      }
    }

    const cleanName = quoteName.trim();
    const cleanMobile = quoteMobile.trim();

    if (!cleanName && !quoteTrackingRef.trim()) {
      setQuoteError('Please enter your name.');
      return;
    }
    if (!cleanMobile && !quoteTrackingRef.trim()) {
      setQuoteError('Please enter your mobile number so our representative can contact you.');
      return;
    }
    if (allCountries.length === 0) {
      setQuoteError('Please select or type at least one desired country or destination.');
      return;
    }

    setQuoteBusy(true);
    try {
      const res = await fetch('/api/public-customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'quote_request',
          customerName: cleanName,
          mobileNumber: cleanMobile,
          desiredCountries: allCountries,
          desiredDays: quoteDays.trim(),
          desiredServices: quoteServices,
          notes: quoteNotes.trim(),
          packageTitle: quotePackageTitle.trim() || allCountries.join(', '),
          trackingQuery: quoteTrackingRef.trim(),
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok || !data || data.ok === false) {
        setQuoteError(data?.message || 'Could not submit your quote request. Please try again.');
        return;
      }
      const createdQuote = data.quote;
      setQuoteSuccess({
        queryRef: createdQuote?.queryRef || data.queryRef || 'PQ-LIVE',
        customerName: createdQuote?.customerName || cleanName || 'Valued Guest',
        desiredCountries: createdQuote?.desiredCountries || allCountries,
        desiredDays: createdQuote?.desiredDays || quoteDays.trim() || null,
        desiredServices: createdQuote?.desiredServices || quoteServices,
        crmId: createdQuote?.crmId || quoteTrackingRef.trim() || null,
        isExistingCustomer: Boolean(createdQuote?.isExistingCustomer || quoteTrackingRef.trim()),
      });

      const newDto: PublicPortalQueryDTO = {
        queryRef: createdQuote?.queryRef || data.queryRef || 'PQ-LIVE',
        packageTitle: quotePackageTitle.trim() || allCountries.join(', '),
        desiredCountries: createdQuote?.desiredCountries || allCountries,
        desiredDays: createdQuote?.desiredDays || quoteDays.trim() || null,
        desiredServices: createdQuote?.desiredServices || quoteServices,
        crmId: createdQuote?.crmId || quoteTrackingRef.trim() || null,
        isExistingCustomer: Boolean(createdQuote?.isExistingCustomer || quoteTrackingRef.trim()),
        status: 'new',
        createdAt: createdQuote?.createdAt || new Date().toISOString(),
      };
      setRecentPortalQueries((prev) => [newDto, ...prev.filter((x) => x.queryRef !== newDto.queryRef)].slice(0, 12));
    } catch {
      setQuoteError('Network error while sending your quote request. Please try again.');
    } finally {
      setQuoteBusy(false);
    }
  };

  // 1. Initial Gate Loading State (Bahaar Journeys branding only; zero portal features or staff data)
  if (gateStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4 p-6">
        <img
          src="/bahaar-logo.png"
          alt="Bahaar Journeys"
          className="h-14 w-auto object-contain"
        />
        <div
          role="status"
          aria-label="Loading Bahaar Journeys"
          className="w-8 h-8 rounded-full border-[3px] border-slate-200 border-t-sky-600 animate-spin"
        />
        <p className="text-xs font-medium text-slate-500">Bahaar Journeys</p>
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  // 2. Strict Beta OFF / Unavailable 404 Screen (ZERO portal/brand/attendance features)
  if (gateStatus === 'unavailable') {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">404</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Page Not Found</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            The page you are looking for is not available or may have moved.
          </p>
        </div>
      </main>
    );
  }

  // 3. Ready — Bahaar Journeys Public Customer Portal
  const activeTheme = portalConfig.theme === 'auto' || !portalConfig.theme ? themeFor() : portalConfig.theme;
  const waDigitsStr = portalConfig.whatsappNumber.replace(/\D+/g, '');
  const waHref = waDigitsStr
    ? `https://wa.me/${waDigitsStr}?text=${encodeURIComponent(`${portalConfig.whatsappMessage || 'Hello Bahaar Journeys, I need help with my booking.'}${foundData ? ` (Ref: ${foundData.query})` : ''}`)}`
    : '';
  const activeMatchedSet = new Set(matchedDestinationIds);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col max-sm:pb-16">
      {portalConfig.effects.confetti && <Confetti burstKey={blastKey || confettiKey || surpriseKey} />}
      {portalConfig.effects.jet && <JetShowcase showKey={jetKey} name={foundData?.customerName || ''} onBlast={handleBlast} />}
      {activeTheme !== 'none' && <SeasonTheme theme={activeTheme} />}
      <PlaneSwoop swoopKey={swoopKey} />
      <BottomBar
        whatsappHref={waHref}
        onTrack={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); window.setTimeout(() => document.querySelector<HTMLInputElement>('input[type="text"]')?.focus(), 400); }}
        onDestinations={() => document.getElementById('destinations')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onChatTap={() => sendPortalEvent('wa_click')}
      />
      <WhatsAppFab
        onTap={() => sendPortalEvent('wa_click')}
        number={portalConfig.whatsappNumber}
        message={`${portalConfig.whatsappMessage || 'Hello Bahaar Journeys, I need help with my booking.'}${foundData ? ` (Ref: ${foundData.query})` : ''}`}
      />
      {/* Screen Header */}
      {portalConfig.announcement && !bannerHidden && (
        <div role="status" className={`no-print relative z-40 px-4 py-2.5 text-center text-xs sm:text-sm font-semibold ${ANNOUNCE_TONES[portalConfig.announcement.tone] || ANNOUNCE_TONES.info}`}>
          <span className="pr-6">{portalConfig.announcement.text}</span>
          <button type="button" onClick={() => setBannerHidden(true)} aria-label="Close" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hover:bg-black/10 text-lg leading-none cursor-pointer">×</button>
        </div>
      )}
      <header className="no-print relative sm:sticky sm:top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-8 lg:px-10 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/bahaar-logo.png"
              alt="Bahaar Journeys"
              className="h-11 sm:h-14 w-auto object-contain shrink-0"
            />
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800">
              <Globe2 className="w-3.5 h-3.5 text-sky-600" />
              <span>{t('Customer Trip & Visa Portal')}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <InstallButton />
            <LangToggle />
          {foundData && (
            <>
              <WhatsAppShare url={shareUrl} text="Bahaar Journeys booking tracker:" />
              <button
                type="button"
                onClick={handleShareLink}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                {copiedShare ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700 max-sm:sr-only">{t('Copied!')}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-500" />
                    <span className="max-sm:sr-only">{t('Share Link')}</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white transition-colors cursor-pointer shadow-xs"
              >
                <Printer className="w-4 h-4" />
                <span className="max-sm:sr-only">{t('Print Summary')}</span>
              </button>
            </>
          )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1480px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-10 space-y-8">
        {/* Hero + Lookup + Live Plane Animation */}
        <section className="no-print relative space-y-5">
          {portalConfig.effects.scene3d && <FloatingScene />}
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-5 space-y-4">

              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                {t('Track your journey to')}{' '}
                <span className="whitespace-nowrap"><RotatingWord words={['Dubai', 'Istanbul', 'Bangkok', 'Singapore', 'London', 'Paris', 'Maldives', 'Kuala Lumpur']} />,</span>{' '}
                {t('invoices & visa progress.')}
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                {t('Enter your')} <strong>{t('Query Code')}</strong>, <strong>{t('CRM ID')}</strong>, {t('or')}{' '}
                <strong>{t('Invoice Number')}</strong>{' '}
                {t('to view live invoice details, payment receipts, and visa milestones with Bahaar Journeys.')}
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void executeLookup(searchInput, true);
                }}
                className="space-y-2.5"
              >
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder={t('e.g. Q-1042, CRM-208, or INV-0091')}
                      aria-label="Query Code, CRM ID, or Invoice Number"
                      maxLength={80}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 py-3 text-base sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 shadow-2xs"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={handleClearSearch}
                        aria-label="Clear search"
                        className="absolute right-1 sm:right-2.5 top-1/2 -translate-y-1/2 p-2.5 sm:p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={lookupState.kind === 'loading' || cooldownSec > 0}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:text-slate-600 px-5 py-3 text-sm font-semibold text-white transition-colors cursor-pointer shadow-xs shrink-0"
                  >
                    {lookupState.kind === 'loading' ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{t('Searching...')}</span>
                      </>
                    ) : cooldownSec > 0 ? (
                      <>
                        <Clock className="w-4 h-4" />
                        <span>{t('Wait')} {cooldownSec}s</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>{t('Track Booking')}</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-slate-500">
                  {t('Only customer-safe summary fields are shown. Need help? Reference any code printed on your Bahaar Journeys invoice.')}
                </p>
              </form>
            </div>

            {portalConfig.effects.planeMap && (
              <div className="lg:col-span-7">
                <PlaneAnimation
                  statusLabel={planeProps.statusLabel}
                  destinationHint={planeProps.destinationHint}
                  visaStatus={planeProps.visaStatus}
                  isVisaActive={planeProps.isVisaActive}
                />
              </div>
            )}
          </div>

          {/* Search Feedback Banners */}
          <AnimatePresence mode="wait">
            {lookupState.kind === 'invalid' && (
              <motion.div
                key="invalid"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 flex items-start gap-3 text-sm text-amber-900"
              >
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">{t('Check your reference format')}</p>
                  <p className="text-amber-800 mt-0.5">{lookupState.message}</p>
                </div>
              </motion.div>
            )}

            {lookupState.kind === 'rate_limited' && (
              <motion.div
                key="rate_limited"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 flex items-start gap-3 text-sm text-amber-900"
              >
                <Clock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Lookup limit reached{cooldownSec > 0 ? ` — retry in ${cooldownSec}s` : ' — ready to retry'}
                  </p>
                  <p className="text-amber-800 mt-0.5">{lookupState.message}</p>
                </div>
              </motion.div>
            )}

            {lookupState.kind === 'error' && (
              <motion.div
                key="error"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3.5 flex items-start justify-between gap-3 text-sm text-rose-900"
              >
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">{t('Unable to complete lookup')}</p>
                    <p className="text-rose-800 mt-0.5">{lookupState.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void executeLookup(searchInput, false)}
                  className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                >
                  {t('Retry')}
                </button>
              </motion.div>
            )}

            {lookupState.kind === 'not_found' && (
              <motion.div
                key="not_found"
                initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? undefined : { opacity: 0, y: -6 }}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                    <Search className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      No booking found for &ldquo;{lookupState.query}&rdquo;
                    </h2>
                    <p className="text-sm text-slate-600 mt-1">
                      Double-check your Query Code, CRM ID, or Invoice Number as printed on your Bahaar
                      Journeys document (including hyphens or slashes).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="self-start sm:self-center rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                >
                  {t('Clear Search')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Interactive Booking Results & Print Container */}
        {foundData && (
          <section ref={resultsRef} className={`print-container scroll-mt-24 space-y-6 print:space-y-3 ${foundData?.amountsHidden ? 'amounts-hidden' : ''} ${holdResults ? 'fx-results-hold' : jetKey ? 'fx-results-pop' : ''}`}>
            {/* Print-Only Branded Header */}
            <div className="hidden print-only border-b border-slate-300 pb-3 mb-2">
              <div className="flex items-center justify-between gap-4">
                <img
                  src="/bahaar-logo.png"
                  alt="Bahaar Journeys"
                  className="h-14 w-auto object-contain"
                />
                <div className="text-right text-xs text-slate-600">
                  <p className="font-bold text-slate-900 text-sm">{t('Customer Trip Journey, Booking & Visa Summary')}</p>
                  <p>Reference: {foundData.query}</p>
                  <p>Printed: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
            </div>

            {nextTripDate && <TripCountdown date={nextTripDate} />}

            {/* Customer Overview & Multi-Invoice Filter Bar */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 print:p-3.5 shadow-xs print-break-inside-avoid">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                    {t('Verified Customer File')}
                  </p>
                  <h2 className="text-2xl font-bold text-slate-900 mt-0.5">
                    {foundData.customerName || 'Valued Guest'}
                  </h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 font-mono font-medium text-slate-700">
                      Query: {foundData.query}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-800 px-2.5 py-1 font-medium">
                      <FileText className="w-3.5 h-3.5" />
                      {foundData.invoices.length} Invoice{foundData.invoices.length === 1 ? '' : 's'}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1 font-medium">
                      <Receipt className="w-3.5 h-3.5" />
                      {foundData.receiptsSummary.length} Receipt{foundData.receiptsSummary.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                {foundData.visaStats.total > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                      <ShieldCheck className="w-4 h-4" />
                      {t('Visa Issued')}: {foundData.visaStats.issued}/{foundData.visaStats.total}
                    </span>
                    {foundData.visaStats.inProgress > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">
                        <Clock className="w-4 h-4" />
                        In Progress: {foundData.visaStats.inProgress}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Multi-invoice Interactive Filter Pills */}
              {foundData.invoices.length > 1 && (
                <div className="no-print mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500 mr-1">{t('Filter Booking:')}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedInvoiceFilter('all')}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
                      selectedInvoiceFilter === 'all'
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    All Bookings ({foundData.invoices.length})
                  </button>
                  {foundData.invoices.map((inv) => {
                    const active = selectedInvoiceFilter === inv.id;
                    return (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => {
                          setSelectedInvoiceFilter(inv.id);
                          setTimelineInvoiceId(inv.id);
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-sky-600 text-white border-sky-600'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <span>{inv.invoiceNo}</span>
                        {inv.isVisa && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                              active ? 'bg-white/20 text-white' : 'bg-sky-100 text-sky-800'
                            }`}
                          >
                            {t('Visa')}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Interactive Stats Explorer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-4 print:gap-2.5 print-break-inside-avoid">
              {foundData.amountsHidden && (
                <div className="sm:col-span-2 lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex items-center text-sm font-semibold text-slate-600">
                  {t('Amounts for this booking are not shown online. Please contact our team for payment details.')}
                </div>
              )}
              {/* Total Billed */}
              <div className="money-card rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{t('Total Billed')}</span>
                  <FileText className="w-4 h-4 text-sky-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.billed.length > 0 ? (
                    activeCurrencyTotals.billed.map((entry) => (
                      <p key={entry.currency} className="text-xl font-bold text-slate-900 tabular-nums">
                        {entry.currency} <CountUp value={entry.amount} format={fmtAmount} />
                      </p>
                    ))
                  ) : (
                    <p className="text-lg font-bold text-slate-400">{t('Cancelled')}</p>
                  )}
                </div>
                {activeCurrencyTotals.cancelledCount > 0 && (
                  <p className="mt-1.5 text-xs text-rose-600 font-medium">
                    {activeCurrencyTotals.cancelledCount} cancelled invoice
                    {activeCurrencyTotals.cancelledCount === 1 ? '' : 's'} excluded
                  </p>
                )}
              </div>

              {/* Paid & Receipts */}
              <div className="money-card rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{t('Paid / Advance')}</span>
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.paidOnInvoices.length > 0 ? (
                    activeCurrencyTotals.paidOnInvoices.map((entry) => {
                      const billedAmt = activeCurrencyTotals.billed.find((b) => b.currency === entry.currency)?.amount || 0;
                      const owed = activeCurrencyTotals.outstanding.find((o) => o.currency === entry.currency)?.amount ?? billedAmt - entry.amount;
                      const paidPct = billedAmt > 0 ? ((billedAmt - Math.max(0, owed)) / billedAmt) * 100 : 0;
                      return (
                        <div key={entry.currency} className="flex items-center justify-between gap-3">
                          <p className="text-xl font-bold text-emerald-700 tabular-nums">
                            {entry.currency} <CountUp value={entry.amount} format={fmtAmount} />
                          </p>
                          {billedAmt > 0 && <PaymentRing percent={paidPct} size={46} />}
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-lg font-bold text-slate-400">—</p>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {foundData.receiptsSummary.length} receipt
                  {foundData.receiptsSummary.length === 1 ? '' : 's'}
                  {receiptTotalsByCurrency.length > 0
                    ? ` · ${receiptTotalsByCurrency.map((r) => `${r.currency} ${fmtAmount(r.amount)}`).join(' + ')}`
                    : ''}
                </p>
              </div>

              {/* Outstanding Balance */}
              <div className="money-card rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{t('Outstanding Balance')}</span>
                  <CheckCircle2 className="w-4 h-4 text-amber-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.outstanding.length === 0 ? (
                    <p className="text-lg font-bold text-slate-400">—</p>
                  ) : activeCurrencyTotals.outstanding.every((e) => e.amount <= 0.005) ? (
                    <p className="text-xl font-bold text-emerald-700">{t('Settled')}</p>
                  ) : (
                    activeCurrencyTotals.outstanding.map((entry) => (
                      <p
                        key={entry.currency}
                        className={`text-xl font-bold tabular-nums ${
                          entry.amount <= 0.005 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {entry.currency} <CountUp value={entry.amount} format={fmtAmount} />
                      </p>
                    ))
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{t('Active customer balance due')}</p>
              </div>

              {/* Visa Status */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                {computedVisaStats.issued > 0 && <VisaStamp label={t('VISA ISSUED')} />}
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{t('Visa Progress')}</span>
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                </div>
                {computedVisaStats.total > 0 ? (
                  <>
                    <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">
                      {computedVisaStats.issued} / {computedVisaStats.total}{' '}
                      <span className="text-sm font-semibold text-slate-500">{t('Issued')}</span>
                    </p>
                    <p className="mt-1.5 text-xs text-slate-600">
                      {computedVisaStats.inProgress} in progress · {computedVisaStats.notStarted} not started
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-lg font-bold text-slate-700">{t('Non-Visa Booking')}</p>
                    <p className="mt-1.5 text-xs text-slate-500">{t('No visa items in selection')}</p>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Progress Timeline (Shown on Screen AND Printed on Page 1) */}
            {timelineInvoice && (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 print:p-3.5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 print:pb-2.5 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg print:text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Plane className="w-5 h-5 print:w-4 print:h-4 text-sky-600" />
                      <span>{t('Customer Trip Journey & Visa Progress Timeline')}</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Trip &amp; visa milestones for{' '}
                      <span className="font-semibold text-slate-700">{timelineInvoice.invoiceNo}</span>
                      {timelineInvoice.reference ? ` — ${timelineInvoice.reference}` : ''}.
                    </p>
                  </div>

                  {selectedInvoiceFilter === 'all' && foundData.invoices.length > 1 && (
                    <div className="no-print flex items-center gap-2">
                      <label htmlFor="timeline-invoice-select" className="text-xs font-semibold text-slate-500">
                        {t('Invoice:')}
                      </label>
                      <select
                        id="timeline-invoice-select"
                        value={timelineInvoice.id}
                        onChange={(e) => {
                          setTimelineInvoiceId(e.target.value);
                          setActiveStepId('booking');
                        }}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-base sm:text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
                      >
                        {foundData.invoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNo}
                            {inv.isVisa && inv.visaProgress
                              ? ` (${visaStatusLabel(inv.visaProgress.status)})`
                              : ' (Booking)'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {!timelineInvoice.isVisa && (
                  <div className="mt-4 print:mt-2 inline-flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <Info className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Non-Visa booking — showing core booking, payment, and travel-readiness stages.</span>
                  </div>
                )}

                <div
                  className={`mt-5 print:mt-2.5 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-3 ${
                    timelineSteps.length >= 7
                      ? 'lg:grid-cols-7'
                      : timelineSteps.length === 6
                        ? 'lg:grid-cols-6'
                        : timelineSteps.length === 5
                          ? 'lg:grid-cols-5'
                          : timelineSteps.length === 4
                            ? 'lg:grid-cols-4'
                            : 'lg:grid-cols-3'
                  } gap-3 print:gap-2`}
                >
                  {timelineSteps.map((step, idx) => {
                    const isSelected = activeTimelineStep?.id === step.id;
                    const badgeColor =
                      step.state === 'completed'
                        ? 'bg-emerald-600 text-white border-emerald-600'
                        : step.state === 'current'
                          ? 'bg-amber-500 text-white border-amber-500'
                          : step.state === 'cancelled'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-slate-100 text-slate-500 border-slate-200';

                    const cardColor = isSelected
                      ? 'border-sky-500 bg-sky-50/70 ring-2 ring-sky-500/20'
                      : step.state === 'completed'
                        ? 'border-emerald-200/90 bg-emerald-50/35 hover:border-emerald-300'
                        : step.state === 'current'
                          ? 'border-amber-200 bg-amber-50/45 hover:border-amber-300'
                          : 'border-slate-200 bg-white hover:bg-slate-50';

                    return (
                      <button
                        key={step.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setActiveStepId(step.id)}
                        className={`text-left rounded-2xl border p-3.5 print:p-2.5 transition-all cursor-pointer ${cardColor}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`w-6 h-6 print:w-5 print:h-5 rounded-full border text-[11px] print:text-[10px] font-bold inline-flex items-center justify-center shrink-0 ${badgeColor}`}
                          >
                            {step.state === 'completed' ? '✓' : idx + 1}
                          </span>
                          <span className="text-[11px] print:text-[10px] font-medium text-slate-500 truncate">
                            {step.dateLabel}
                          </span>
                        </div>
                        <p className="mt-2.5 print:mt-1.5 text-sm print:text-xs font-bold text-slate-900 leading-snug">
                          {step.title}
                        </p>
                        <p className="mt-0.5 text-xs print:text-[11px] font-medium text-slate-600">{step.subtitle}</p>
                      </button>
                    );
                  })}
                </div>

                {/* Visa Progress -> Visa Started / Not Started -> Visa Issued Breakdown Bar */}
                {timelineInvoice.isVisa && timelineInvoice.visaProgress && (
                  <div className="mt-3 rounded-2xl border border-indigo-200/80 bg-indigo-50/50 p-3 print:p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-indigo-950 uppercase tracking-wider text-[11px]">
                        {t('Visa Progress:')}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                          timelineInvoice.visaProgress.status === 'not_started'
                            ? 'bg-amber-100 text-amber-900 border-amber-300'
                            : 'bg-white text-slate-600 border-slate-200'
                        }`}
                      >
                        {timelineInvoice.visaProgress.status === 'not_started' ? '● ' : ''}Visa Not Started
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                          timelineInvoice.visaProgress.status === 'in_progress'
                            ? 'bg-sky-600 text-white border-sky-600'
                            : timelineInvoice.visaProgress.status === 'issued'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-white text-slate-500 border-slate-200'
                        }`}
                      >
                        {timelineInvoice.visaProgress.status === 'in_progress'
                          ? '● '
                          : timelineInvoice.visaProgress.status === 'issued'
                            ? '✓ '
                            : ''}
                        {t('Visa Started (In Progress)')}
                        {niceDate(timelineInvoice.visaProgress.inProgressDate)
                          ? ` · ${niceDate(timelineInvoice.visaProgress.inProgressDate)}`
                          : ''}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                          timelineInvoice.visaProgress.status === 'issued'
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-white text-slate-500 border-slate-200'
                        }`}
                      >
                        {timelineInvoice.visaProgress.status === 'issued' ? '✓ ' : ''}
                        {t('Visa Issued')}
                        {niceDate(timelineInvoice.visaProgress.issuedDate)
                          ? ` · ${niceDate(timelineInvoice.visaProgress.issuedDate)}`
                          : ''}
                      </span>
                    </div>
                  </div>
                )}

                {/* Hotel Booking Confirmation Breakdown Bar (Hotel Name, Check-In / Check-Out & Confirmed Dates) */}
                {timelineSteps.some((s) => s.id === 'hotel_booking') && (() => {
                  const hs: VisaProgressStatus = timelineInvoice.visaProgress?.hotelStatus || 'not_started';
                  const hName = (timelineInvoice.visaProgress?.hotelName || '').trim();
                  const hCheckIn = niceDate(timelineInvoice.visaProgress?.hotelCheckInDate);
                  const hCheckOut = niceDate(timelineInvoice.visaProgress?.hotelCheckOutDate);
                  const hInProg = niceDate(timelineInvoice.visaProgress?.hotelInProgressDate);
                  const hIssued = niceDate(timelineInvoice.visaProgress?.hotelIssuedDate);
                  return (
                    <div className="mt-2.5 rounded-2xl border border-emerald-200/80 bg-emerald-50/45 p-3 print:p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-emerald-950 uppercase tracking-wider text-[11px]">
                          {t('Hotel Booking:')}
                        </span>
                        {hName && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-2.5 py-0.5 font-bold text-emerald-950">
                            🏨 {hName}
                          </span>
                        )}
                        {(hCheckIn || hCheckOut) && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 font-semibold text-sky-900">
                            📅 {hCheckIn ? `Check-In: ${hCheckIn}` : ''}
                            {hCheckIn && hCheckOut ? ' → ' : ''}
                            {hCheckOut ? `Check-Out: ${hCheckOut}` : ''}
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                            hs === 'not_started'
                              ? 'bg-amber-100 text-amber-900 border-amber-300'
                              : 'bg-white text-slate-600 border-slate-200'
                          }`}
                        >
                          {hs === 'not_started' ? '● ' : ''}Hotel Not Started
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                            hs === 'in_progress'
                              ? 'bg-sky-600 text-white border-sky-600'
                              : hs === 'issued'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {hs === 'in_progress' ? '● ' : hs === 'issued' ? '✓ ' : ''}
                          Hotel In Progress{hInProg ? ` · ${hInProg}` : ''}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-bold ${
                            hs === 'issued'
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-500 border-slate-200'
                          }`}
                        >
                          {hs === 'issued' ? '✓ ' : ''}
                          Hotel Confirmed{hIssued ? ` · ${hIssued}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <AnimatePresence mode="wait">
                  {activeTimelineStep && (
                    <motion.div
                      key={`${timelineInvoice.id}-${activeTimelineStep.id}`}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                      className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 print:p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                          Stage Details · {activeTimelineStep.title}
                        </p>
                        <p className="text-sm print:text-xs text-slate-800">{activeTimelineStep.detail}</p>
                        {activeTimelineStep.meta && (
                          <p className="text-xs text-slate-500">{activeTimelineStep.meta}</p>
                        )}
                      </div>
                      <span className="self-start sm:self-center shrink-0 rounded-xl bg-white border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">
                        {activeTimelineStep.dateLabel}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Matched Destination Trip Journey Details & Worldwide HD Photo Showcase (Shown right after Progress Display on Screen & in Print Plan) */}
                {(() => {
                  const matchedList = allDestinations.filter((d) => matchedDestinationIds.includes(d.id));
                  const hasHotelInInv =
                    Boolean(timelineInvoice.isHotel) ||
                    Boolean(timelineInvoice.visaProgress?.hotelEnabled) ||
                    /\b(hotel|resort|accommodation|stay|room|suite|pullman|hilton|marriott|hyatt|sheraton|swissotel|fairmont|mov[eé]npick|rotana|intercontinental|radisson|holiday\s+inn|novotel|ibis)\b/i.test(
                      [
                        timelineInvoice.reference || '',
                        ...timelineInvoice.sections.flatMap((s) => [
                          s.title || '',
                          ...s.lines.map((l) => l.description || ''),
                        ]),
                      ].join(' ')
                    );
                  const showcaseDestinations =
                    matchedList.length > 0 ? matchedList : allDestinations.slice(0, 3);
                  const galleryPhotos = showcaseDestinations
                    .flatMap((dest) =>
                      dest.photos.map((url, pIdx) => ({
                        url,
                        caption: dest.photoCaptions?.[pIdx] || `${dest.name}, ${dest.country}`,
                        destName: dest.name,
                        country: dest.country,
                        region: dest.region,
                      }))
                    )
                    .slice(0, 6);

                  return (
                    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-3.5 print:p-2.5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-sky-800 flex items-center gap-1.5">
                          <Compass className="w-3.5 h-3.5 text-sky-600" />
                          <span>
                            {matchedList.length > 0
                              ? 'Trip Destination, Hotel & Worldwide HD Visual Plan'
                              : 'Worldwide Destination & Luxury Travel HD Visual Plan'}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {hasHotelInInv && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 text-[10px] font-bold">
                              <Sparkles className="w-3 h-3 text-emerald-700" />
                              Smart AI: Hotel Booking Included
                            </span>
                          )}
                          <span className="rounded-full bg-white border border-sky-200 px-2.5 py-0.5 text-[10px] font-semibold text-sky-800">
                            HD Destination Photography · Included in Print Plan
                          </span>
                        </div>
                      </div>

                      {matchedList.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {matchedList.map((dest) => (
                            <div
                              key={dest.id}
                              className="rounded-xl bg-white border border-sky-100 p-2.5 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-bold text-slate-900">
                                  {dest.name} ({dest.country})
                                </span>
                                <span className="text-[11px] font-semibold text-sky-700">
                                  {dest.bestSeason}
                                </span>
                              </div>
                              <p className="text-slate-600 text-[11px]">{dest.tagline}</p>
                              <p className="text-[11px] font-medium text-emerald-800">
                                {dest.visaCue} · {dest.packageCue}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* HD Destination & Hotel Pictures Grid (Rendered on Screen & Printed in Print Plan after Progress Display) */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 print:grid-cols-3 gap-2.5 print:gap-2">
                        {galleryPhotos.map((ph, gIdx) => (
                          <div
                            key={`${ph.url}-${gIdx}`}
                            className="group relative rounded-xl overflow-hidden border border-sky-200/80 bg-slate-900 shadow-2xs"
                          >
                            <img
                              src={ph.url}
                              srcSet={photoSrcSet(ph.url)}
                              sizes="(max-width: 640px) 50vw, 300px"
                              loading="lazy"
                              decoding="async"
                              alt={`${ph.destName} — ${ph.caption}`}
                              className="w-full h-28 sm:h-32 print:h-24 object-cover object-center"
                            />
                            <div className="bg-white/95 px-2.5 py-1.5 border-t border-slate-100">
                              <p className="text-[11px] print:text-[10px] font-bold text-slate-900 truncate">
                                {ph.destName} · {ph.country}
                              </p>
                              <p className="text-[10px] print:text-[9px] text-slate-600 truncate">
                                {ph.caption}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Itemized Customer-Safe Invoices */}
            <div className="space-y-4 print:space-y-3">
              {filteredInvoices.map((inv) => {
                let sectionNum = 0;
                return (
                  <article
                    key={inv.id}
                    className={`rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-xs ${inv.amountsHidden ? 'inv-hidden' : ''}`}
                  >
                    <div className="p-5 sm:p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start justify-between gap-4 bg-slate-50/50">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-bold text-slate-900">{inv.invoiceNo}</h3>
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${invoiceStatusClasses(inv.status)}`}
                          >
                            {invoiceStatusLabel(inv.status)}
                          </span>
                          {inv.isVisa && inv.visaProgress && (
                            <span
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${visaStatusClasses(inv.visaProgress.status)}`}
                            >
                              {visaStatusLabel(inv.visaProgress.status)}
                            </span>
                          )}
                        </div>
                        {inv.reference && (
                          <p className="text-sm font-medium text-slate-700">{inv.reference}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                          {crmQueryOf(inv) && <span>Ref: {crmQueryOf(inv)}</span>}
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Issued: {niceDate(inv.invoiceDate) || inv.invoiceDate}
                          </span>
                          {inv.dueDate && <span>Due: {niceDate(inv.dueDate)}</span>}
                        </div>
                      </div>

                      <div className="sm:text-right space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 inv-money">
                          {t('Invoice Total')}
                        </p>
                        <p className="text-2xl font-extrabold text-slate-900 tabular-nums inv-money">
                          {inv.currency} {fmtAmount(inv.total)}
                        </p>
                        {inv.isVisa && inv.visaProgress && (
                          <div className="flex flex-wrap sm:justify-end gap-2 text-xs text-slate-600 pt-1">
                            <span>
                              In Progress:{' '}
                              <strong>
                                {niceDate(inv.visaProgress.inProgressDate) ||
                                  (inv.visaProgress.status === 'not_started' ? 'Pending' : 'Date not recorded')}
                              </strong>
                            </span>
                            <span>·</span>
                            <span>
                              Issued:{' '}
                              <strong>
                                {niceDate(inv.visaProgress.issuedDate) ||
                                  (inv.visaProgress.status === 'issued' ? 'Date not recorded' : 'Pending')}
                              </strong>
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {inv.portalNote && (
                      <div className="px-5 sm:px-6 pt-4">
                        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">{t('Message from our team')}</p>
                          <p className="mt-0.5 font-medium">{inv.portalNote}</p>
                        </div>
                      </div>
                    )}

                    {/* Invoice Sections & Lines */}
                    <div className="p-5 sm:p-6 overflow-x-auto inv-money">
                      <table className="w-full text-sm border-collapse min-w-[540px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <th className="py-2 pr-3">{t('Description')}</th>
                            <th className="py-2 px-3 text-right">{t('Qty')}</th>
                            <th className="py-2 px-3 text-right">{t('Unit Price')}</th>
                            <th className="py-2 pl-3 text-right">Amount ({inv.currency})</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {inv.sections.map((sec, sIdx) => {
                            const hasTitle = Boolean(sec.title && sec.title.trim());
                            if (hasTitle) sectionNum += 1;
                            const currentSn = sectionNum;

                            return (
                              <FragmentSection
                                key={`${inv.id}-sec-${sIdx}`}
                                title={hasTitle ? `${currentSn}. ${sec.title.trim()}` : ''}
                                lines={sec.lines}
                                invoiceCurrency={inv.currency}
                              />
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Invoice Totals */}
                      <div className="mt-5 pt-4 border-t border-slate-200 flex justify-end">
                        <dl className="w-full sm:w-72 space-y-1.5 text-sm">
                          <div className="flex justify-between text-slate-600">
                            <dt>{t('Subtotal')}</dt>
                            <dd className="font-medium tabular-nums">
                              {inv.currency} {fmtAmount(inv.subtotal)}
                            </dd>
                          </div>
                          {inv.taxAmount > 0 && (
                            <div className="flex justify-between text-slate-600">
                              <dt>
                                {inv.taxLabel || 'Tax'} ({inv.taxRate}%)
                              </dt>
                              <dd className="font-medium tabular-nums">
                                {inv.currency} {fmtAmount(inv.taxAmount)}
                              </dd>
                            </div>
                          )}
                          {inv.discount > 0 && (
                            <div className="flex justify-between text-emerald-700">
                              <dt>{t('Discount')}</dt>
                              <dd className="font-medium tabular-nums">
                                -{inv.currency} {fmtAmount(inv.discount)}
                              </dd>
                            </div>
                          )}
                          {inv.advancePaid > 0 && (
                            <div className="flex justify-between text-emerald-700">
                              <dt>{t('Advance Paid')}</dt>
                              <dd className="font-medium tabular-nums">
                                -{inv.currency} {fmtAmount(inv.advancePaid)}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                            <dt>{t('Total')}</dt>
                            <dd className="tabular-nums">
                              {inv.currency} {fmtAmount(inv.total)}
                            </dd>
                          </div>
                          <div className="flex justify-between font-bold">
                            <dt className="text-slate-700">{t('Balance Due')}</dt>
                            <dd
                              className={`tabular-nums ${
                                inv.status === 'cancelled'
                                  ? 'text-slate-400 line-through'
                                  : inv.balance <= 0.005
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'
                              }`}
                            >
                              {inv.currency} {fmtAmount(inv.balance)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Sanitized Payment Receipts Summary */}
            {foundData.receiptsSummary.length > 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs print-break-inside-avoid">
                <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Receipt className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-lg font-bold text-slate-900">{t('Payment Receipts')}</h3>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {foundData.receiptsSummary.length} record
                    {foundData.receiptsSummary.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {foundData.receiptsSummary.map((rcp) => {
                    const itemList = [
                      ...rcp.items,
                      ...(rcp.otherItem ? [`Other: ${rcp.otherItem}`] : []),
                    ];
                    return (
                      <div
                        key={`${rcp.receiptNo}-${rcp.createdAt}`}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col justify-between gap-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{rcp.receiptNo}</p>
                            <p className="text-xs text-slate-500">
                              {niceTimestamp(rcp.createdAt) || rcp.createdAt}
                              {rcp.queryCode ? ` · Ref: ${rcp.queryCode}` : ''}
                            </p>
                          </div>
                          <span
                            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                              rcp.paymentType === 'full'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-sky-50 text-sky-700 border-sky-200'
                            }`}
                          >
                            {rcp.paymentType === 'full' ? 'Full Payment' : 'Partial Payment'}
                          </span>
                        </div>

                        {itemList.length > 0 && (
                          <p className="text-xs text-slate-600">{itemList.join(' · ')}</p>
                        )}

                        <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-sm">
                          <span className="text-xs font-medium text-slate-500">{t('Amount Received')}</span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {foundData.amountsHidden ? '—' : `${rcp.currency} ${fmtAmount(rcp.amountReceived)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Print-Only Footer */}
            <div className="hidden print-only pt-4 border-t border-slate-300 text-xs text-slate-500">
              <div className="flex items-center justify-between gap-4">
                <span>Bahaar Journeys — Customer Trip &amp; Visa Summary</span>
                <span>Customer-safe public summary</span>
              </div>
            </div>
          </section>
        )}

        {/* How tracking works: the real stages a booking moves through */}
        <JourneySteps />

        {/* Offers the office has switched on */}
        {portalConfig.offers.length > 0 && (
          <section className="no-print space-y-3 pt-2">
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">{t('Current offers')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {portalConfig.offers.map((o) => (
                <div key={o.id} className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 sm:p-5 flex flex-col gap-2 shadow-xs">
                  <p className="text-base font-extrabold text-slate-900">{o.title}</p>
                  {o.text && <p className="text-sm text-slate-700">{o.text}</p>}
                  {o.expiresAt && <p className="text-xs font-semibold text-amber-800">{t('Until')} {niceDate(o.expiresAt) || o.expiresAt}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      openQuoteModalForDestination(null);
                      setQuotePackageTitle(o.title);
                    }}
                    className="mt-auto self-start rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2 text-xs sm:text-sm font-bold text-slate-900 transition-colors cursor-pointer"
                  >
                    {t('Ask about this offer')}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Curated Worldwide Destinations Showcase */}
        <section id="destinations" className="no-print space-y-5 pt-2 scroll-mt-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                {t('Curated Global Portfolio')}
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
                {t('Explore Worldwide Destinations')}
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {t('Handpicked religious, cultural, alpine, and island journeys crafted with Bahaar Journeys visa and concierge care.')}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {DESTINATION_REGIONS.map((region) => {
                const active = selectedRegion === region;
                return (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setSelectedRegion(region)}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {t(region)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setInSeasonOnly((v) => !v)}
              aria-pressed={inSeasonOnly}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                inSeasonOnly ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${inSeasonOnly ? 'bg-white' : 'bg-emerald-500'} animate-pulse`} />
              {t('In season now')} ({inSeasonCount})
            </button>
            <button
              type="button"
              onClick={surpriseMe}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 hover:bg-sky-100 px-3.5 py-1.5 text-xs font-semibold text-sky-800 transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              {t('Surprise me')}
            </button>
            <span className="text-xs text-slate-500">
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}: {inSeasonCount} of {allDestinations.length} destinations are in their best season.
            </span>
          </div>

          {/* Panoramic Featured Destination Photo Slider */}
          <FeaturedDestinationHeroSlider
            destinations={displayedDestinations}
            prefersReducedMotion={prefersReducedMotion}
            onSelectDestination={(dest) => { setSwoopKey(Date.now()); setActiveDestination(dest); }}
            onRequestQuote={(dest) => openQuoteModalForDestination(dest)}
          />

          {matchedDestinationIds.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2.5 text-sm text-emerald-900">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>{t('Recommended from Your Itinerary:')}</strong> Destinations matching your booking
                details are highlighted first below.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayedDestinations.map((dest, cardIdx) => {
              const isMatched = activeMatchedSet.has(dest.id);
              return (
                <div
                  key={dest.id}
                  id={`dest-card-${dest.id}`}
                  data-tilt
                  onClick={() => setActiveDestination(dest)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveDestination(dest);
                    }
                  }}
                  className={`group text-left rounded-3xl border bg-white overflow-hidden shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col ${
                    highlightId === dest.id
                      ? 'border-sky-400 ring-4 ring-sky-400/40 scale-[1.02]'
                      : isMatched
                      ? 'border-emerald-300 ring-2 ring-emerald-500/15'
                      : 'border-slate-200 hover:border-sky-300'
                  }`}
                >
                  <DestinationCardPhotoSlider
                    dest={dest}
                    cardIndex={cardIdx}
                    isMatched={isMatched}
                    prefersReducedMotion={prefersReducedMotion}
                  />

                  <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                    <div className="space-y-2.5">
                      <p className="text-sm text-slate-600 leading-relaxed">{dest.tagline}</p>
                      {dest.fromPrice && (
                        <p className="inline-block rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-800">{dest.fromPrice}</p>
                      )}
                      <ul className="space-y-1 text-xs text-slate-600">
                        {dest.highlights.slice(0, 2).map((hl) => (
                          <li key={hl} className="flex items-start gap-1.5">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                            <span>{hl}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2.5 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-500">
                          Best: {dest.bestSeason}
                          {inSeason(dest.bestSeason, thisMonth) && (
                            <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> In season now
                            </span>
                          )}
                        </span>
                        <span className="font-semibold text-sky-700 group-hover:translate-x-0.5 transition-transform">
                          View Guide →
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openQuoteModalForDestination(dest);
                        }}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white px-3 py-2 text-xs font-bold shadow-2xs transition-colors cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>{t('Get a quote and let our representative contact you')}</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="no-print border-t border-slate-200 bg-white mt-12">
        <div className="max-w-[1480px] mx-auto px-4 sm:px-8 lg:px-10 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/bahaar-logo.png"
              alt="Bahaar Journeys"
              className="h-12 w-auto object-contain"
            />
          </div>
          <p className="text-xs text-slate-500 text-center sm:text-right">
            Bahaar Journeys · Customer Travel, Booking &amp; Visa Tracking Portal
          </p>
        </div>
      </footer>

      {/* Interactive Destination Modal */}
      <AnimatePresence>
        {activeDestination && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            className="no-print fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setActiveDestination(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="dest-modal-title"
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg md:max-w-4xl max-h-[92dvh] flex flex-col md:flex-row rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div className="md:w-[46%] shrink-0 md:overflow-y-auto bg-slate-950">
              <DestinationModalPhotoSlider
                dest={activeDestination}
                prefersReducedMotion={prefersReducedMotion}
                onClose={() => setActiveDestination(null)}
              />
              </div>

              <div className="p-5 sm:p-6 space-y-4 flex-1 min-w-0 overflow-y-auto">
                <p className="text-sm text-slate-700 leading-relaxed">{activeDestination.tagline}</p>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    {t('Trip Highlights')}
                  </h4>
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {activeDestination.highlights.map((hl) => (
                      <li key={hl} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span>{hl}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Best Season
                    </p>
                    <p className="text-xs font-semibold text-slate-800 mt-1">
                      {activeDestination.bestSeason}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {t('Visa Support')}
                    </p>
                    <p className="text-xs font-semibold text-slate-800 mt-1">
                      {activeDestination.visaCue}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 flex items-center gap-2 text-xs font-medium text-sky-900">
                  <Compass className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>{activeDestination.packageCue}</span>
                  {activeDestination.fromPrice && (
                    <span className="ml-auto shrink-0 rounded-full bg-white border border-sky-200 px-2.5 py-0.5 text-[11px] font-bold text-sky-800">{activeDestination.fromPrice}</span>
                  )}
                </div>

                <DestinationExtras dest={activeDestination} />

                <button
                  type="button"
                  onClick={() => {
                    const target = activeDestination;
                    setActiveDestination(null);
                    openQuoteModalForDestination(target);
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 text-xs sm:text-sm font-bold shadow-sm transition-colors cursor-pointer"
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>{t('Get a quote and let our representative contact you')}</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Get a Quote & Representative Callback Modal */}
      <AnimatePresence>
        {quoteModalOpen && (
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0 }}
            className="no-print fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="quote-modal-title"
              initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden my-6"
            >
              <div className="bg-gradient-to-r from-slate-900 via-sky-950 to-slate-900 text-white p-5 sm:p-6 flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 border border-sky-400/30 px-2.5 py-0.5 text-[11px] font-bold text-sky-300">
                    <Sparkles className="w-3 h-3" />
                    <span>{t('Bahaar Journeys Concierge Desk')}</span>
                  </div>
                  <h3 id="quote-modal-title" className="text-lg sm:text-xl font-extrabold">
                    Get a Quote &amp; Let Our Representative Contact You
                  </h3>
                  {quotePackageTitle && (
                    <p className="text-xs text-sky-200 font-medium">
                      Selected Package: {quotePackageTitle}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setQuoteModalOpen(false)}
                  aria-label="Close quote modal"
                  className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {quoteSuccess ? (
                <div className="p-6 space-y-4">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-start gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="text-sm font-extrabold text-emerald-950">
                        Your Quote Query ({quoteSuccess.queryRef}) is Live!
                      </p>
                      <p className="text-xs text-emerald-800 leading-relaxed">
                        Thank you, <strong>{quoteSuccess.customerName}</strong>. Your inquiry has been added to our live Customer Portal Queries bar and routed to a Bahaar Journeys travel representative who will contact you shortly.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-500">Generated Query Reference</span>
                      <span className="font-mono font-bold text-sky-700">{quoteSuccess.queryRef}</span>
                    </div>
                    {quoteSuccess.crmId && (
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-500">Linked Tracking / CRM ID</span>
                        <span className="font-mono font-bold text-indigo-700">{quoteSuccess.crmId}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-500">Desired Countries</span>
                      <span className="font-bold text-slate-900">
                        {quoteSuccess.desiredCountries.join(', ')}
                      </span>
                    </div>
                    {quoteSuccess.desiredDays && (
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-500">Desired Duration / Days</span>
                        <span className="font-semibold text-slate-800">{quoteSuccess.desiredDays}</span>
                      </div>
                    )}
                    {quoteSuccess.desiredServices.length > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-500">Desired Services</span>
                        <span className="font-semibold text-slate-800">
                          {quoteSuccess.desiredServices.join(' · ')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setQuoteModalOpen(false)}
                      className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-xs font-bold cursor-pointer"
                    >
                      {t('Done')}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitQuoteRequest} className="p-5 sm:p-6 space-y-4">
                  {/* Smart Existing Customer Detection Banner */}
                  {quoteTrackingRef ? (
                    <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3.5 flex items-start justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <p className="font-bold text-sky-950 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
                          <span>
                            Existing Customer Check-In Detected ({quoteTrackingRef})
                          </span>
                        </p>
                        <p className="text-sky-800">
                          Your query will automatically link to your CRM / tracking number{' '}
                          <strong className="font-mono">{quoteTrackingRef}</strong>
                          {foundData?.customerName ? ` (${foundData.customerName})` : ''}.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        {t('Your Name')} <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="text"
                        value={quoteName}
                        onChange={(e) => setQuoteName(e.target.value)}
                        placeholder={t('e.g. Muhammad Hashir')}
                        maxLength={120}
                        required={!quoteTrackingRef.trim()}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Mobile Number <span className="text-rose-600">*</span>
                      </label>
                      <input
                        type="tel"
                        value={quoteMobile}
                        onChange={(e) => setQuoteMobile(e.target.value)}
                        placeholder="e.g. +92 300 1234567"
                        maxLength={60}
                        required
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* Desired Countries (Required) */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Desired Countries / Destinations <span className="text-rose-600">*</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={quoteCountriesInput}
                        onChange={(e) => setQuoteCountriesInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addQuoteCountryChip();
                          }
                        }}
                        placeholder="Type country or city (e.g. Saudi Arabia, Baku, Dubai) and press Add..."
                        maxLength={100}
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={addQuoteCountryChip}
                        className="rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 cursor-pointer shrink-0"
                      >
                        + Add
                      </button>
                    </div>

                    {/* Quick Pick Country Pills */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {allDestinations.map((d) => {
                        const label = `${d.name} (${d.country})`;
                        const active = quoteCountries.some(
                          (c) => c.toLowerCase() === label.toLowerCase() || c.toLowerCase() === d.country.toLowerCase()
                        );
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() =>
                              setQuoteCountries((prev) =>
                                active
                                  ? prev.filter(
                                      (c) =>
                                        c.toLowerCase() !== label.toLowerCase() &&
                                        c.toLowerCase() !== d.country.toLowerCase()
                                    )
                                  : [...prev, label]
                              )
                            }
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border transition-colors cursor-pointer ${
                              active
                                ? 'bg-sky-600 text-white border-sky-600'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {active ? '✓ ' : '+ '}
                            {d.country} ({d.name})
                          </button>
                        );
                      })}
                    </div>

                    {quoteCountries.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 pt-2 border-t border-slate-100">
                        {quoteCountries.map((c) => (
                          <span
                            key={c}
                            className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 text-sky-900 border border-sky-200 px-3 py-1 text-xs font-bold"
                          >
                            <span>{c}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setQuoteCountries((prev) => prev.filter((item) => item !== c))
                              }
                              className="text-sky-600 hover:text-rose-600 cursor-pointer"
                              aria-label={`Remove ${c}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Optional Fields: Desired Days & Existing Tracking / CRM ID */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Desired Days / Duration <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={quoteDays}
                        onChange={(e) => setQuoteDays(e.target.value)}
                        placeholder="e.g. 7 Days / 6 Nights"
                        maxLength={60}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Existing Tracking / CRM ID <span className="text-slate-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={quoteTrackingRef}
                        onChange={(e) => setQuoteTrackingRef(e.target.value)}
                        placeholder="Auto-filled if checking in with CRM ID"
                        maxLength={80}
                        className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-base sm:text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                      />
                    </div>
                  </div>

                  {/* Optional Desired Services */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">
                      Desired Services <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {QUOTE_SERVICES_OPTIONS.map((srv) => {
                        const active = quoteServices.includes(srv);
                        return (
                          <button
                            key={srv}
                            type="button"
                            onClick={() => toggleQuoteService(srv)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors cursor-pointer ${
                              active
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            {active ? '✓ ' : ''}
                            {srv}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Optional Additional Notes */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Additional Preferences or Notes <span className="text-slate-400 font-normal">(Optional)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={quoteNotes}
                      onChange={(e) => setQuoteNotes(e.target.value)}
                      placeholder="e.g. Number of adults/children, preferred hotel star rating, travel dates..."
                      maxLength={600}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-base sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500"
                    />
                  </div>

                  {quoteError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-semibold text-rose-800 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{quoteError}</span>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setQuoteModalOpen(false)}
                      className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-700 cursor-pointer"
                    >
                      {t('Cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={quoteBusy}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white px-5 py-2.5 text-xs sm:text-sm font-bold shadow-xs cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{quoteBusy ? 'Submitting Query…' : 'Submit Quote Request'}</span>
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FragmentSection({
  title,
  lines,
  invoiceCurrency,
}: {
  title: string;
  lines: PublicInvoiceLine[];
  invoiceCurrency: string;
}) {
  return (
    <>
      {title && (
        <tr className="bg-slate-50/90">
          <td colSpan={4} className="py-2 px-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            {title}
          </td>
        </tr>
      )}
      {lines.map((ln, lIdx) => {
        if (ln.note) {
          return (
            <tr key={`ln-${lIdx}`}>
              <td colSpan={4} className="py-2.5 pr-3 font-semibold text-slate-800">
                {ln.description}
              </td>
            </tr>
          );
        }

        const lineCurrency = ln.currency || invoiceCurrency;
        const showFx = Boolean(ln.currency && ln.currency !== invoiceCurrency && ln.rate);

        return (
          <tr key={`ln-${lIdx}`}>
            <td className="py-2.5 pr-3 text-slate-800">
              <p>{ln.description}</p>
              {showFx && (
                <p className="text-xs text-slate-500 mt-0.5">
                  1 {ln.currency} = {fmtAmount(ln.rate!)} {invoiceCurrency}
                </p>
              )}
            </td>
            <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
              {ln.units !== null ? fmtAmount(ln.units) : '—'}
            </td>
            <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
              {ln.unitPrice !== null ? `${lineCurrency} ${fmtAmount(ln.unitPrice)}` : '—'}
            </td>
            <td className="py-2.5 pl-3 text-right font-semibold text-slate-900 tabular-nums">
              {ln.amount !== null ? fmtAmount(ln.amount) : '—'}
            </td>
          </tr>
        );
      })}
    </>
  );
}

export default function CustomersPortalPage() {
  return (
    <LangProvider>
      <PortalInner />
    </LangProvider>
  );
}
