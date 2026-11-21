import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
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
import {
  CURATED_DESTINATIONS,
  DESTINATION_REGIONS,
  matchDestinationsForInvoices,
  type Destination,
  type DestinationArtwork,
  type DestinationRegion,
} from './destinations';

type VisaProgressStatus = 'not_started' | 'in_progress' | 'issued';
type PublicInvoiceStatus = 'unpaid' | 'paid' | 'cancelled';

interface PublicVisaProgress {
  enabled: true;
  status: VisaProgressStatus;
  inProgressDate: string | null;
  issuedDate: string | null;
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

interface PublicLookupSuccessResponse {
  ok: true;
  available: true;
  found: true;
  query: string;
  customerName: string;
  invoices: PublicInvoiceDTO[];
  receiptsSummary: PublicReceiptSummary[];
  visaStats: PublicVisaStats;
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

function DestinationArtworkSvg({ artwork, accent }: { artwork: DestinationArtwork; accent: string }) {
  switch (artwork) {
    case 'kaaba':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <circle cx="230" cy="28" r="14" fill={accent} fillOpacity="0.28" />
          <path d="M 224 20 A 11 11 0 1 0 236 34 A 9 9 0 1 1 224 20 Z" fill={accent} fillOpacity="0.9" />
          {/* Minarets */}
          <rect x="48" y="34" width="10" height="86" rx="2" fill="#ffffff" fillOpacity="0.2" />
          <polygon points="46,34 53,16 60,34" fill="#ffffff" fillOpacity="0.28" />
          <rect x="222" y="40" width="10" height="80" rx="2" fill="#ffffff" fillOpacity="0.2" />
          <polygon points="220,40 227,22 234,40" fill="#ffffff" fillOpacity="0.28" />
          {/* Courtyard arches */}
          <path d="M 16 120 L 16 86 Q 40 72 64 86 L 64 120 Z" fill="#ffffff" fillOpacity="0.14" />
          <path d="M 216 120 L 216 86 Q 240 72 264 86 L 264 120 Z" fill="#ffffff" fillOpacity="0.14" />
          {/* Sacred cube silhouette */}
          <rect x="108" y="52" width="64" height="68" rx="3" fill="#0f172a" fillOpacity="0.82" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5" />
          <rect x="108" y="64" width="64" height="7" fill={accent} fillOpacity="0.88" />
        </svg>
      );
    case 'baku':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          {/* Flame Towers */}
          <path d="M 96 120 C 94 74, 108 42, 122 24 C 128 48, 126 84, 124 120 Z" fill="#ffffff" fillOpacity="0.28" />
          <path d="M 128 120 C 126 66, 144 34, 158 18 C 166 46, 160 86, 156 120 Z" fill={accent} fillOpacity="0.45" />
          <path d="M 162 120 C 162 80, 176 52, 188 38 C 194 60, 190 90, 186 120 Z" fill="#ffffff" fillOpacity="0.24" />
          {/* Caspian waves & boulevard */}
          <path d="M 0 102 Q 70 92 140 102 T 280 102 L 280 120 L 0 120 Z" fill="#ffffff" fillOpacity="0.18" />
        </svg>
      );
    case 'balloons':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          {/* Cappadocia valleys & fairy chimneys */}
          <path d="M 0 120 L 0 92 L 36 82 L 72 96 L 112 78 L 156 96 L 204 80 L 246 94 L 280 84 L 280 120 Z" fill="#0f172a" fillOpacity="0.28" />
          <path d="M 48 104 L 54 68 L 62 104 Z" fill="#ffffff" fillOpacity="0.2" />
          <path d="M 218 106 L 226 64 L 234 106 Z" fill="#ffffff" fillOpacity="0.2" />
          {/* Hot-air balloons */}
          <circle cx="94" cy="40" r="14" fill={accent} fillOpacity="0.82" />
          <rect x="91" y="56" width="6" height="5" rx="1" fill="#ffffff" fillOpacity="0.85" />
          <circle cx="156" cy="30" r="18" fill="#ffffff" fillOpacity="0.34" />
          <rect x="152" y="50" width="8" height="6" rx="1" fill="#ffffff" fillOpacity="0.8" />
          <circle cx="204" cy="48" r="10" fill={accent} fillOpacity="0.58" />
        </svg>
      );
    case 'atoll':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <circle cx="216" cy="34" r="16" fill={accent} fillOpacity="0.45" />
          {/* Overwater bungalows */}
          <line x1="24" y1="88" x2="210" y2="88" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="2.5" />
          {[56, 108, 160].map((x) => (
            <g key={x}>
              <line x1={x + 12} y1="88" x2={x + 12} y2="100" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="2" />
              <rect x={x} y="66" width="24" height="18" rx="2" fill="#ffffff" fillOpacity="0.26" />
              <polygon points={`${x - 4},66 ${x + 12},52 ${x + 28},66`} fill={accent} fillOpacity="0.72" />
            </g>
          ))}
          <path d="M 0 100 Q 70 94 140 102 T 280 100 L 280 120 L 0 120 Z" fill="#ffffff" fillOpacity="0.2" />
        </svg>
      );
    case 'alps':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <polygon points="10,120 74,42 138,120" fill="#ffffff" fillOpacity="0.18" />
          <polygon points="74,42 94,66 76,62 62,70" fill="#ffffff" fillOpacity="0.55" />
          <polygon points="90,120 162,24 234,120" fill="#ffffff" fillOpacity="0.28" />
          <polygon points="162,24 185,54 166,48 144,58" fill="#ffffff" fillOpacity="0.8" />
          <polygon points="174,120 232,48 280,120" fill={accent} fillOpacity="0.28" />
        </svg>
      );
    case 'heritage':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          {/* Silk Road turquoise dome & iwan arch */}
          <rect x="74" y="58" width="132" height="62" rx="4" fill="#ffffff" fillOpacity="0.16" />
          <path d="M 106 58 C 106 24, 174 24, 174 58 Z" fill={accent} fillOpacity="0.55" />
          <path d="M 118 120 L 118 82 Q 140 62 162 82 L 162 120 Z" fill="#0f172a" fillOpacity="0.35" />
          <rect x="56" y="40" width="12" height="80" rx="2" fill="#ffffff" fillOpacity="0.24" />
          <rect x="212" y="40" width="12" height="80" rx="2" fill="#ffffff" fillOpacity="0.24" />
        </svg>
      );
    case 'tropical':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <circle cx="72" cy="36" r="18" fill={accent} fillOpacity="0.4" />
          {/* Lush island hills */}
          <path d="M 0 120 Q 68 68 146 120 Z" fill="#ffffff" fillOpacity="0.18" />
          <path d="M 112 120 Q 196 58 280 120 Z" fill="#ffffff" fillOpacity="0.22" />
          {/* Palm silhouettes */}
          <path d="M 206 116 Q 212 72 222 46" stroke="#0f172a" strokeOpacity="0.45" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M 222 46 Q 202 36 188 52 M 222 46 Q 242 36 254 54 M 222 46 Q 224 28 240 28 M 222 46 Q 206 28 194 34" stroke="#0f172a" strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case 'bridge':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          {/* Twin Gothic bridge towers */}
          <rect x="74" y="34" width="22" height="86" rx="2" fill="#ffffff" fillOpacity="0.26" />
          <polygon points="72,34 85,14 98,34" fill={accent} fillOpacity="0.7" />
          <rect x="184" y="34" width="22" height="86" rx="2" fill="#ffffff" fillOpacity="0.26" />
          <polygon points="182,34 195,14 208,34" fill={accent} fillOpacity="0.7" />
          <line x1="20" y1="84" x2="260" y2="84" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="4" />
          <line x1="96" y1="50" x2="184" y2="50" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="3" />
          <path d="M 20 84 Q 48 54 74 44 M 206 44 Q 232 54 260 84" stroke={accent} strokeOpacity="0.7" strokeWidth="2" />
        </svg>
      );
    case 'pagoda':
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <circle cx="196" cy="40" r="24" fill={accent} fillOpacity="0.42" />
          {/* Mt Fuji silhouette */}
          <polygon points="116,120 194,48 272,120" fill="#ffffff" fillOpacity="0.18" />
          <polygon points="194,48 216,68 196,64 176,70" fill="#ffffff" fillOpacity="0.55" />
          {/* Multi-tier pagoda */}
          <rect x="64" y="42" width="28" height="78" fill="#0f172a" fillOpacity="0.42" />
          <polygon points="50,52 78,38 106,52" fill="#ffffff" fillOpacity="0.4" />
          <polygon points="54,74 78,62 102,74" fill="#ffffff" fillOpacity="0.35" />
          <polygon points="58,96 78,84 98,96" fill="#ffffff" fillOpacity="0.3" />
        </svg>
      );
    case 'skyline':
    default:
      return (
        <svg viewBox="0 0 280 120" className="w-full h-full" fill="none" aria-hidden="true">
          <circle cx="222" cy="32" r="15" fill={accent} fillOpacity="0.52" />
          {/* Iconic spire & towers */}
          <rect x="34" y="68" width="22" height="52" rx="2" fill="#ffffff" fillOpacity="0.18" />
          <rect x="64" y="52" width="24" height="68" rx="2" fill="#ffffff" fillOpacity="0.24" />
          <polygon points="134,120 140,12 146,120" fill="#ffffff" fillOpacity="0.42" />
          <rect x="128" y="60" width="24" height="60" rx="2" fill="#ffffff" fillOpacity="0.22" />
          <rect x="164" y="48" width="24" height="72" rx="2" fill={accent} fillOpacity="0.28" />
          <rect x="196" y="66" width="26" height="54" rx="2" fill="#ffffff" fillOpacity="0.2" />
          <rect x="230" y="76" width="22" height="44" rx="2" fill="#ffffff" fillOpacity="0.15" />
        </svg>
      );
  }
}

export default function CustomersPortalPage() {
  const prefersReducedMotion = useReducedMotion();

  const [gateStatus, setGateStatus] = useState<GateStatus>('checking');
  const [searchInput, setSearchInput] = useState('');
  const [lookupState, setLookupState] = useState<LookupState>({ kind: 'idle' });
  const [cooldownSec, setCooldownSec] = useState(0);

  const [selectedInvoiceFilter, setSelectedInvoiceFilter] = useState<string>('all');
  const [timelineInvoiceId, setTimelineInvoiceId] = useState<string>('');
  const [activeStepId, setActiveStepId] = useState<string>('booking');

  const [selectedRegion, setSelectedRegion] = useState<'All' | DestinationRegion>('All');
  const [activeDestination, setActiveDestination] = useState<Destination | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);

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
        let data: { ok?: boolean; available?: boolean } | null = null;
        try {
          data = (await res.json()) as { ok?: boolean; available?: boolean };
        } catch {
          data = null;
        }
        if (!active) return;

        if (res.ok && data?.available === true) {
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
          else if (firstVisa.visaProgress.status === 'in_progress') setActiveStepId('visa_in_progress');
          else setActiveStepId('visa_not_started');
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

  const filteredInvoices = useMemo(() => {
    if (!foundData) return [];
    if (selectedInvoiceFilter === 'all') return foundData.invoices;
    return foundData.invoices.filter((inv) => inv.id === selectedInvoiceFilter);
  }, [foundData, selectedInvoiceFilter]);

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
            ? 'Settled in Full'
            : hasPartialPayment
              ? 'Advance Received'
              : 'Awaiting Payment',
        dateLabel: isCancelled
          ? 'Cancelled'
          : isPaid
            ? `${inv.currency} ${fmtAmount(inv.total)} paid`
            : `${inv.currency} ${fmtAmount(inv.balance)} balance`,
        state: isCancelled ? 'cancelled' : isPaid ? 'completed' : hasPartialPayment ? 'current' : 'upcoming',
        detail: isCancelled
          ? 'This booking invoice is marked as cancelled.'
          : isPaid
            ? `Full invoice amount of ${inv.currency} ${fmtAmount(inv.total)} is settled${
                receiptsCount > 0 ? ` (${receiptsCount} payment receipt${receiptsCount === 1 ? '' : 's'} on file)` : ''
              }.`
            : hasPartialPayment
              ? `Advance of ${inv.currency} ${fmtAmount(inv.advancePaid)} recorded. Remaining balance: ${inv.currency} ${fmtAmount(inv.balance)}.`
              : `Outstanding balance of ${inv.currency} ${fmtAmount(inv.balance)} is pending.`,
      },
    ];

    if (inv.isVisa && inv.visaProgress) {
      const vs = inv.visaProgress.status;
      const inProgDate = niceDate(inv.visaProgress.inProgressDate);
      const issDate = niceDate(inv.visaProgress.issuedDate);

      steps.push(
        {
          id: 'visa_not_started',
          title: 'Visa Not Started',
          subtitle: vs === 'not_started' ? 'Queued' : 'Completed',
          dateLabel: vs === 'not_started' ? 'Pending start' : 'Passed',
          state: isCancelled ? 'cancelled' : vs === 'not_started' ? 'current' : 'completed',
          detail:
            vs === 'not_started'
              ? 'Your visa invoice is registered and queued with our visa processing desk.'
              : 'Initial visa file registration completed and moved into active processing.',
        },
        {
          id: 'visa_in_progress',
          title: 'Visa In Progress',
          subtitle:
            vs === 'in_progress' || vs === 'issued'
              ? inProgDate || 'Date not recorded'
              : 'Pending',
          dateLabel: inProgDate || (vs === 'not_started' ? 'Pending' : 'Date not recorded'),
          state: isCancelled
            ? 'cancelled'
            : vs === 'issued'
              ? 'completed'
              : vs === 'in_progress'
                ? 'current'
                : 'upcoming',
          detail:
            vs === 'not_started'
              ? 'Visa application submission has not started yet.'
              : inProgDate
                ? `Visa processing started on ${inProgDate}.`
                : 'Visa application is in processing (In Progress date not recorded).',
          meta: inv.visaProgress.updatedAt ? `Last updated: ${niceTimestamp(inv.visaProgress.updatedAt)}` : undefined,
        },
        {
          id: 'visa_issued',
          title: 'Visa Issued',
          subtitle: vs === 'issued' ? issDate || 'Date not recorded' : 'Pending',
          dateLabel: issDate || (vs === 'issued' ? 'Date not recorded' : 'Pending'),
          state: isCancelled ? 'cancelled' : vs === 'issued' ? 'completed' : 'upcoming',
          detail:
            vs === 'issued'
              ? issDate
                ? `Your visa was issued on ${issDate}. Please review your travel documents before departure.`
                : 'Your visa is marked as Issued (Issued date not recorded).'
              : 'Your visa issuance date will appear here once approved and recorded by our team.',
        }
      );
    }

    const travelReady =
      !isCancelled && isPaid && (!inv.isVisa || inv.visaProgress?.status === 'issued');

    steps.push({
      id: 'travel_ready',
      title: 'Travel Ready',
      subtitle: isCancelled ? 'Cancelled' : travelReady ? 'Cleared to Travel' : 'Pending Milestones',
      dateLabel: travelReady ? 'All set' : 'Awaiting completion',
      state: isCancelled ? 'cancelled' : travelReady ? 'completed' : 'upcoming',
      detail: isCancelled
        ? 'Booking is cancelled.'
        : travelReady
          ? 'Payment is settled and all booking/visa requirements for this invoice are complete.'
          : inv.isVisa
            ? 'Travel readiness unlocks once payment is settled and your visa status reaches Issued.'
            : 'Travel readiness unlocks once the booking payment balance is settled.',
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

  const displayedDestinations = useMemo(() => {
    const matchedSet = new Set(matchedDestinationIds);
    const pool =
      selectedRegion === 'All'
        ? CURATED_DESTINATIONS
        : CURATED_DESTINATIONS.filter((d) => d.region === selectedRegion);

    return [...pool].sort((a, b) => {
      const am = matchedSet.has(a.id) ? 0 : 1;
      const bm = matchedSet.has(b.id) ? 0 : 1;
      return am - bm;
    });
  }, [selectedRegion, matchedDestinationIds]);

  const planeProps = useMemo(() => {
    if (!foundData) {
      return {
        statusLabel: 'Live Flight Corridor · Bahaar Global Desk',
        destinationHint: 'Worldwide Trips & Visa Support',
        visaStatus: null as VisaProgressStatus | null,
        isVisaActive: false,
      };
    }
    const matchedDest = CURATED_DESTINATIONS.find((d) => matchedDestinationIds.includes(d.id));
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

  // 1. Initial Gate Loading State (Bahaar Journeys branding only; zero portal features or staff data)
  if (gateStatus === 'checking') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col items-center justify-center gap-4 p-6">
        <img
          src="/bahaar-logo.png"
          alt="Bahaar Journeys"
          className="h-10 w-auto object-contain"
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
  const activeMatchedSet = new Set(matchedDestinationIds);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Screen Header */}
      <header className="no-print sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/bahaar-logo.png"
              alt="Bahaar Journeys"
              className="h-9 sm:h-11 w-auto object-contain shrink-0"
            />
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-sky-50 border border-sky-200 px-3 py-1 text-xs font-semibold text-sky-800">
              <Globe2 className="w-3.5 h-3.5 text-sky-600" />
              <span>Customer Trip &amp; Visa Portal</span>
            </span>
          </div>

          {foundData && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShareLink}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 text-xs sm:text-sm font-semibold text-slate-700 transition-colors cursor-pointer"
              >
                {copiedShare ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-500" />
                    <span>Share Link</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-3.5 py-2 text-xs sm:text-sm font-semibold text-white transition-colors cursor-pointer shadow-xs"
              >
                <Printer className="w-4 h-4" />
                <span>Print Summary</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
        {/* Hero + Lookup + Live Plane Animation */}
        <section className="no-print space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            <div className="lg:col-span-5 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200/90 px-3 py-1 text-xs font-semibold text-amber-800">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>Instant Booking &amp; Visa Status Lookup</span>
              </div>

              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Track your journey, invoices &amp; visa progress.
              </h1>

              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Enter your <strong>Query Code</strong>, <strong>CRM ID</strong>, or{' '}
                <strong>Invoice Number</strong> to view live invoice details, payment receipts, and
                visa milestones with Bahaar Journeys.
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
                      placeholder="e.g. Q-1042, CRM-208, or INV-0091"
                      aria-label="Query Code, CRM ID, or Invoice Number"
                      maxLength={80}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 shadow-2xs"
                    />
                    {searchInput && (
                      <button
                        type="button"
                        onClick={handleClearSearch}
                        aria-label="Clear search"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
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
                        <span>Searching...</span>
                      </>
                    ) : cooldownSec > 0 ? (
                      <>
                        <Clock className="w-4 h-4" />
                        <span>Wait {cooldownSec}s</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-4 h-4" />
                        <span>Track Booking</span>
                      </>
                    )}
                  </button>
                </div>

                <p className="text-xs text-slate-500">
                  Only customer-safe summary fields are shown. Need help? Reference any code printed on
                  your Bahaar Journeys invoice.
                </p>
              </form>
            </div>

            <div className="lg:col-span-7">
              <PlaneAnimation
                statusLabel={planeProps.statusLabel}
                destinationHint={planeProps.destinationHint}
                visaStatus={planeProps.visaStatus}
                isVisaActive={planeProps.isVisaActive}
              />
            </div>
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
                  <p className="font-semibold">Check your reference format</p>
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
                    <p className="font-semibold">Unable to complete lookup</p>
                    <p className="text-rose-800 mt-0.5">{lookupState.message}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void executeLookup(searchInput, false)}
                  className="shrink-0 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                >
                  Retry
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
                  Clear Search
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Interactive Booking Results & Print Container */}
        {foundData && (
          <section className="print-container space-y-6">
            {/* Print-Only Branded Header */}
            <div className="hidden print-only border-b border-slate-300 pb-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <img
                  src="/bahaar-logo.png"
                  alt="Bahaar Journeys"
                  className="h-11 w-auto object-contain"
                />
                <div className="text-right text-xs text-slate-600">
                  <p className="font-bold text-slate-900 text-sm">Customer Booking &amp; Visa Summary</p>
                  <p>Reference: {foundData.query}</p>
                  <p>Printed: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                </div>
              </div>
            </div>

            {/* Customer Overview & Multi-Invoice Filter Bar */}
            <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs print-break-inside-avoid">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                    Verified Customer File
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
                      Visa Issued: {foundData.visaStats.issued}/{foundData.visaStats.total}
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
                  <span className="text-xs font-semibold text-slate-500 mr-1">Filter Booking:</span>
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
                            Visa
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Interactive Stats Explorer */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print-break-inside-avoid">
              {/* Total Billed */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Total Billed</span>
                  <FileText className="w-4 h-4 text-sky-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.billed.length > 0 ? (
                    activeCurrencyTotals.billed.map((entry) => (
                      <p key={entry.currency} className="text-xl font-bold text-slate-900 tabular-nums">
                        {entry.currency} {fmtAmount(entry.amount)}
                      </p>
                    ))
                  ) : (
                    <p className="text-lg font-bold text-slate-400">Cancelled</p>
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Paid / Advance</span>
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.paidOnInvoices.length > 0 ? (
                    activeCurrencyTotals.paidOnInvoices.map((entry) => (
                      <p key={entry.currency} className="text-xl font-bold text-emerald-700 tabular-nums">
                        {entry.currency} {fmtAmount(entry.amount)}
                      </p>
                    ))
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
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Outstanding Balance</span>
                  <CheckCircle2 className="w-4 h-4 text-amber-600" />
                </div>
                <div className="mt-2 space-y-1">
                  {activeCurrencyTotals.outstanding.length === 0 ? (
                    <p className="text-lg font-bold text-slate-400">—</p>
                  ) : activeCurrencyTotals.outstanding.every((e) => e.amount <= 0.005) ? (
                    <p className="text-xl font-bold text-emerald-700">Settled</p>
                  ) : (
                    activeCurrencyTotals.outstanding.map((entry) => (
                      <p
                        key={entry.currency}
                        className={`text-xl font-bold tabular-nums ${
                          entry.amount <= 0.005 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {entry.currency} {fmtAmount(entry.amount)}
                      </p>
                    ))
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">Active customer balance due</p>
              </div>

              {/* Visa Status */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Visa Progress</span>
                  <ShieldCheck className="w-4 h-4 text-indigo-600" />
                </div>
                {computedVisaStats.total > 0 ? (
                  <>
                    <p className="mt-2 text-xl font-bold text-slate-900 tabular-nums">
                      {computedVisaStats.issued} / {computedVisaStats.total}{' '}
                      <span className="text-sm font-semibold text-slate-500">Issued</span>
                    </p>
                    <p className="mt-1.5 text-xs text-slate-600">
                      {computedVisaStats.inProgress} in progress · {computedVisaStats.notStarted} not started
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-lg font-bold text-slate-700">Non-Visa Booking</p>
                    <p className="mt-1.5 text-xs text-slate-500">No visa items in selection</p>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Progress Timeline */}
            {timelineInvoice && (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-xs print-break-inside-avoid">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                      <Plane className="w-5 h-5 text-sky-600" />
                      <span>Interactive Journey &amp; Visa Timeline</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Inspect milestones for{' '}
                      <span className="font-semibold text-slate-700">{timelineInvoice.invoiceNo}</span>
                      {timelineInvoice.reference ? ` — ${timelineInvoice.reference}` : ''}. Click any step
                      for details.
                    </p>
                  </div>

                  {selectedInvoiceFilter === 'all' && foundData.invoices.length > 1 && (
                    <div className="no-print flex items-center gap-2">
                      <label htmlFor="timeline-invoice-select" className="text-xs font-semibold text-slate-500">
                        Invoice:
                      </label>
                      <select
                        id="timeline-invoice-select"
                        value={timelineInvoice.id}
                        onChange={(e) => {
                          setTimelineInvoiceId(e.target.value);
                          setActiveStepId('booking');
                        }}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
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
                  <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                    <Info className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>Non-Visa booking — showing core booking, payment, and travel-readiness stages.</span>
                  </div>
                )}

                <div
                  className={`mt-5 grid grid-cols-1 sm:grid-cols-2 ${
                    timelineSteps.length >= 6 ? 'lg:grid-cols-6' : 'lg:grid-cols-3'
                  } gap-3`}
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
                        className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer ${cardColor}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`w-6 h-6 rounded-full border text-[11px] font-bold inline-flex items-center justify-center shrink-0 ${badgeColor}`}
                          >
                            {step.state === 'completed' ? '✓' : idx + 1}
                          </span>
                          <span className="text-[11px] font-medium text-slate-500 truncate">
                            {step.dateLabel}
                          </span>
                        </div>
                        <p className="mt-2.5 text-sm font-bold text-slate-900 leading-snug">
                          {step.title}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-slate-600">{step.subtitle}</p>
                      </button>
                    );
                  })}
                </div>

                <AnimatePresence mode="wait">
                  {activeTimelineStep && (
                    <motion.div
                      key={`${timelineInvoice.id}-${activeTimelineStep.id}`}
                      initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, y: -4 }}
                      className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                          Stage Details · {activeTimelineStep.title}
                        </p>
                        <p className="text-sm text-slate-800">{activeTimelineStep.detail}</p>
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
              </div>
            )}

            {/* Itemized Customer-Safe Invoices */}
            <div className="space-y-4">
              {filteredInvoices.map((inv) => {
                let sectionNum = 0;
                return (
                  <article
                    key={inv.id}
                    className="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-xs print-break-inside-avoid"
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
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Invoice Total
                        </p>
                        <p className="text-2xl font-extrabold text-slate-900 tabular-nums">
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

                    {/* Invoice Sections & Lines */}
                    <div className="p-5 sm:p-6 overflow-x-auto">
                      <table className="w-full text-sm border-collapse min-w-[540px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                            <th className="py-2 pr-3">Description</th>
                            <th className="py-2 px-3 text-right">Qty</th>
                            <th className="py-2 px-3 text-right">Unit Price</th>
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
                            <dt>Subtotal</dt>
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
                              <dt>Discount</dt>
                              <dd className="font-medium tabular-nums">
                                -{inv.currency} {fmtAmount(inv.discount)}
                              </dd>
                            </div>
                          )}
                          {inv.advancePaid > 0 && (
                            <div className="flex justify-between text-emerald-700">
                              <dt>Advance Paid</dt>
                              <dd className="font-medium tabular-nums">
                                -{inv.currency} {fmtAmount(inv.advancePaid)}
                              </dd>
                            </div>
                          )}
                          <div className="flex justify-between font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                            <dt>Total</dt>
                            <dd className="tabular-nums">
                              {inv.currency} {fmtAmount(inv.total)}
                            </dd>
                          </div>
                          <div className="flex justify-between font-bold">
                            <dt className="text-slate-700">Balance Due</dt>
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
                    <h3 className="text-lg font-bold text-slate-900">Payment Receipts</h3>
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
                          <span className="text-xs font-medium text-slate-500">Amount Received</span>
                          <span className="font-bold text-emerald-700 tabular-nums">
                            {rcp.currency} {fmtAmount(rcp.amountReceived)}
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

        {/* Curated Worldwide Destinations Showcase */}
        <section className="no-print space-y-5 pt-2">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">
                Curated Global Portfolio
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1">
                Explore Worldwide Destinations
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                Handpicked religious, cultural, alpine, and island journeys crafted with Bahaar Journeys
                visa and concierge care.
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
                    {region}
                  </button>
                );
              })}
            </div>
          </div>

          {matchedDestinationIds.length > 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2.5 text-sm text-emerald-900">
              <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Recommended from Your Itinerary:</strong> Destinations matching your booking
                details are highlighted first below.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {displayedDestinations.map((dest) => {
              const isMatched = activeMatchedSet.has(dest.id);
              return (
                <button
                  key={dest.id}
                  type="button"
                  onClick={() => setActiveDestination(dest)}
                  className={`group text-left rounded-3xl border bg-white overflow-hidden shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col ${
                    isMatched
                      ? 'border-emerald-300 ring-2 ring-emerald-500/15'
                      : 'border-slate-200 hover:border-sky-300'
                  }`}
                >
                  <div
                    className="relative h-36 w-full overflow-hidden p-4 flex flex-col justify-between"
                    style={{
                      background: `linear-gradient(135deg, ${dest.palette.from}, ${dest.palette.via}, ${dest.palette.to})`,
                    }}
                  >
                    <div className="absolute inset-0 pointer-events-none">
                      <DestinationArtworkSvg artwork={dest.artwork} accent={dest.palette.accent} />
                    </div>

                    <div className="relative z-10 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-white/18 backdrop-blur-xs border border-white/25 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                        {dest.region}
                      </span>
                      {isMatched && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 text-white px-2.5 py-0.5 text-[11px] font-bold shadow-xs">
                          <Sparkles className="w-3 h-3" />
                          Matched to Your Trip
                        </span>
                      )}
                    </div>

                    <div className="relative z-10">
                      <p className="text-xs font-medium text-white/85 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{dest.country}</span>
                      </p>
                      <h3 className="text-xl font-extrabold text-white tracking-tight">{dest.name}</h3>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                    <div className="space-y-2.5">
                      <p className="text-sm text-slate-600 leading-relaxed">{dest.tagline}</p>
                      <ul className="space-y-1 text-xs text-slate-600">
                        {dest.highlights.slice(0, 2).map((hl) => (
                          <li key={hl} className="flex items-start gap-1.5">
                            <span className="mt-1 w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0" />
                            <span>{hl}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-500">Best: {dest.bestSeason}</span>
                      <span className="font-semibold text-sky-700 group-hover:translate-x-0.5 transition-transform">
                        View Guide →
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="no-print border-t border-slate-200 bg-white mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/bahaar-logo.png"
              alt="Bahaar Journeys"
              className="h-8 w-auto object-contain"
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
              className="w-full max-w-lg rounded-3xl bg-white border border-slate-200 shadow-2xl overflow-hidden"
            >
              <div
                className="relative h-44 p-5 flex flex-col justify-between"
                style={{
                  background: `linear-gradient(135deg, ${activeDestination.palette.from}, ${activeDestination.palette.via}, ${activeDestination.palette.to})`,
                }}
              >
                <div className="absolute inset-0 pointer-events-none">
                  <DestinationArtworkSvg
                    artwork={activeDestination.artwork}
                    accent={activeDestination.palette.accent}
                  />
                </div>

                <div className="relative z-10 flex items-center justify-between">
                  <span className="rounded-full bg-white/20 border border-white/30 px-3 py-1 text-xs font-semibold text-white">
                    {activeDestination.region}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveDestination(null)}
                    aria-label="Close destination details"
                    className="w-8 h-8 rounded-full bg-slate-900/40 hover:bg-slate-900/60 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="relative z-10">
                  <p className="text-xs font-medium text-white/85 flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{activeDestination.country}</span>
                  </p>
                  <h3 id="dest-modal-title" className="text-2xl font-extrabold text-white">
                    {activeDestination.name}
                  </h3>
                </div>
              </div>

              <div className="p-5 sm:p-6 space-y-4">
                <p className="text-sm text-slate-700 leading-relaxed">{activeDestination.tagline}</p>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Trip Highlights
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
                      Visa Support
                    </p>
                    <p className="text-xs font-semibold text-slate-800 mt-1">
                      {activeDestination.visaCue}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3.5 py-2.5 flex items-center gap-2 text-xs font-medium text-sky-900">
                  <Compass className="w-4 h-4 text-sky-600 shrink-0" />
                  <span>{activeDestination.packageCue}</span>
                </div>
              </div>
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
