// CRM API (travel agency): customers, follow-ups/tasks, CEO meetings, notifications.
// Self-contained: only reads the employees table and its own crm_* tables.
// Every call needs the signed-in person's token; what they may do is decided here from the database, never from the browser.
import crypto from 'node:crypto';
import { confirmOpenWork, isSupabaseConfigured, supabaseFetch, sweepShiftReminders } from './_supabase.js';
import { format12h, getShiftEndWindowMs } from './_cloud.js';
import { getSessionEmployee } from './_session.js';
import { PaymentError, assertWithinTotal, buildPayments, cleanStored, receiptProblem, sumPayments } from './_invoicePayments.js';
import { updateVendorPosting } from './_vendorLines.js';
import { canEditFinancialRecord } from '../src/lib/financePermissions.js';

const KINDS = ['meeting', 'corporate', 'internal', 'regular', 'personal'];
const KIND_LABEL = { meeting: 'Meeting follow-up', corporate: 'Corporate follow-up', internal: 'Internal follow-up', regular: 'Regular customers follow-up', personal: 'Personal follow-up' };
// Default inventory list + dynamic catalog managed by Admin & Accounts in Supabase
const DEFAULT_INVENTORY_ITEMS = [
  'Laptop',
  'Keyboard',
  'Mouse',
  'Mouse Pad',
  'Pen',
  'Headphones',
  'Writing Pads',
  'Tissues',
  'SIMs',
  'Laptop Charger',
  'Mobile Charger',
  'Mobile Package',
];
const INVENTORY_STATUSES = ['approved', 'rejected', 'delivered'];
const SALE_TYPES = { visa: 'Visa', ticket: 'Ticket', hotel: 'Hotel', transfers: 'Transfers', insurance: 'Insurance', others: 'Others' };
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'QAR', 'KWD', 'OMR', 'BHD', 'TRY', 'INR', 'BDT', 'LKR', 'NPR', 'AFN', 'CAD', 'AUD', 'NZD', 'CNY', 'JPY', 'KRW', 'HKD', 'SGD', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'RUB', 'UAH', 'GEL', 'AZN', 'AMD', 'KZT', 'UZS', 'EGP', 'JOD', 'LBP', 'IQD', 'IRR', 'MAD', 'TND', 'DZD', 'ZAR', 'KES', 'NGN', 'GHS', 'ETB', 'TZS', 'MXN', 'BRL', 'ARS'];
// Settings the admin controls for the public Customer Portal (stored as one row in crm_company)
const DEFAULT_PORTAL_CONFIG = {
  whatsappNumber: '',
  whatsappMessage: 'Hello Bahaar Journeys, I need help with my booking.',
  effects: { jet: true, confetti: true, scene3d: true, planeMap: true },
  theme: 'auto',
  announcement: { enabled: false, text: '', tone: 'info', expiresAt: '' },
  offers: [],
  destinations: { order: [], hidden: [], overrides: {} },
};
const PORTAL_TONES = ['info', 'success', 'warning'];
const PORTAL_THEMES = ['auto', 'none', 'ramadan', 'eid', 'winter', 'summer'];
const cleanText = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const cleanDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const cleanHttps = (v) => { const u = String(v || '').trim(); return /^https:\/\/[^\s"'<>]{4,480}$/.test(u) ? u : ''; };
const DEST_ID_RE = /^[a-z0-9-]{1,40}$/;
// Returns the portal settings with only the sections the admin sent replaced (everything else is kept as it was).
function mergePortalConfig(prev, c) {
  const out = { ...DEFAULT_PORTAL_CONFIG, ...prev };
  out.effects = { ...DEFAULT_PORTAL_CONFIG.effects, ...(prev.effects || {}) };
  if (!PORTAL_THEMES.includes(out.theme)) out.theme = 'auto';
  out.announcement = { ...DEFAULT_PORTAL_CONFIG.announcement, ...(prev.announcement || {}) };
  out.destinations = { order: [], hidden: [], overrides: {}, ...(prev.destinations || {}) };
  const changed = [];
  if (c.effects && typeof c.effects === 'object') {
    for (const k of Object.keys(DEFAULT_PORTAL_CONFIG.effects)) if (c.effects[k] !== undefined) out.effects[k] = c.effects[k] !== false;
    changed.push('effects');
  }
  if (c.theme !== undefined) {
    out.theme = PORTAL_THEMES.includes(c.theme) ? c.theme : 'auto';
    if (!changed.includes('effects')) changed.push('effects');
  }
  if (c.announcement && typeof c.announcement === 'object') {
    const a = c.announcement;
    out.announcement = { enabled: a.enabled === true, text: cleanText(a.text, 300), tone: PORTAL_TONES.includes(a.tone) ? a.tone : 'info', expiresAt: cleanDate(a.expiresAt) };
    changed.push('announcement');
  }
  if (Array.isArray(c.offers)) {
    out.offers = c.offers.slice(0, 6).map((o) => ({
      id: /^[A-Za-z0-9-]{1,50}$/.test(String(o?.id || '')) ? String(o.id) : id('offer'),
      title: cleanText(o?.title, 80), text: cleanText(o?.text, 240), expiresAt: cleanDate(o?.expiresAt), active: o?.active !== false,
    })).filter((o) => o.title);
    changed.push('offers');
  }
  if (c.destinations && typeof c.destinations === 'object') {
    const d = c.destinations;
    const ids = (a) => asArray(a).map((x) => String(x)).filter((x) => DEST_ID_RE.test(x)).slice(0, 60);
    const overrides = {};
    for (const [k, v] of Object.entries(d.overrides && typeof d.overrides === 'object' ? d.overrides : {})) {
      if (!DEST_ID_RE.test(k) || !v || typeof v !== 'object') continue;
      const o = {
        tagline: cleanText(v.tagline, 200), bestSeason: cleanText(v.bestSeason, 80), fromPrice: cleanText(v.fromPrice, 80),
        photos: asArray(v.photos).map(cleanHttps).filter(Boolean).slice(0, 6),
      };
      if (o.tagline || o.bestSeason || o.fromPrice || o.photos.length) overrides[k] = o;
    }
    out.destinations = { order: ids(d.order), hidden: ids(d.hidden), overrides };
    changed.push('destinations');
  }
  return { config: out, changed };
}
async function logPortalActivity(me, text) {
  try {
    const row = await getOne('crm_company', 'portal-activity');
    const items = asArray(parseJsonObj(row?.data, {}).items);
    items.unshift({ at: nowIso(), by: me.id, byName: me.name || '', text: cleanText(text, 240) });
    await upsert('crm_company', { id: 'portal-activity', data: { items: items.slice(0, 100) }, updated_at: nowIso() });
  } catch (e) { console.error('portal activity log failed:', e?.message); }
}
const OUTCOMES = ['completed', 'not_completed', 'rescheduled'];
const OPEN = ['pending', 'rescheduled'];
const LIMIT = 5000;

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (m, code = 'BAD_REQUEST') => new HttpError(400, m, code);
const forbidden = (m = 'You do not have permission to do this.', code = 'FORBIDDEN') => new HttpError(403, m, code);
const notFound = (m = 'Not found.') => new HttpError(404, m, 'NOT_FOUND');

const id = (p) => `${p}-${crypto.randomUUID()}`;
const nowIso = () => new Date().toISOString();
const str = (v, max, { required = false, name = 'Value' } = {}) => {
  const s = String(v ?? '').trim();
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s;
};
const isoOrNull = (v, name, { required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required.`);
    return null;
  }
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw bad(`${name} is not a valid date and time.`);
  return new Date(t).toISOString();
};
const asArray = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : []);
const parseJsonObj = (v, fallback = {}) => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
};
const VISA_STATUSES = ['not_started', 'in_progress', 'issued'];
const VISA_WORD_RE = /\b(visa|e-visa|evisa|umrah|ziyarat|hajj|schengen|embassy|sticker\s+visa|asan)\b/i;
const HOTEL_WORD_RE = /\b(hotel|resort|accommodation|stay|room|suite|nights?|check-?in|check-?out|bed\s*&\s*breakfast|half\s+board|full\s+board|package|family\s+tour|group\s+tour|holiday|honeymoon|umrah|ziyarat|hajj|makkah|madinah|baku|shahdag|gabala|dubai|abu\s+dhabi|doha|tashkent|samarkand|almaty|shymbulak|istanbul|cappadocia|antalya|kuala\s+lumpur|langkawi|bangkok|phuket|maldives|pullman|hilton|marriott|hyatt|sheraton|swissotel|fairmont|mov[eé]npick|rotana|intercontinental|radisson|holiday\s+inn|novotel|ibis|villa|palace|apartments?)\b/i;
const TICKET_WORD_RE = /\b(ticket|flight|airfare|airline|pnr|sector|return\s+ticket|one\s+way|pia|emirates|qatar\s+airways|saudia|flydubai|airblue|serene|etihad|turkish\s+airlines|azerbaijan\s+airlines|azal)\b/i;
const TRANSFER_WORD_RE = /\b(transfer|tour|excursion|coaster|transport|pickup|pick-up|drop-off|haramain|train|railway|safari|cruise|cable\s+car|sightseeing|ziyarat\s+tour|package|family\s+tour)\b/i;
const INSURANCE_WORD_RE = /\b(insurance|medical\s+cover|travel\s+care|policy|coverage)\b/i;

function hasVisaKeyword(sections, reference = '', notes = '') {
  if (VISA_WORD_RE.test(String(reference || '')) || VISA_WORD_RE.test(String(notes || ''))) return true;
  return asArray(sections).some((sec) => {
    if (VISA_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => VISA_WORD_RE.test(String(ln?.description || '')));
  });
}
function hasHotelKeyword(sections, reference = '', notes = '') {
  if (HOTEL_WORD_RE.test(String(reference || '')) || HOTEL_WORD_RE.test(String(notes || ''))) return true;
  return asArray(sections).some((sec) => {
    if (HOTEL_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => HOTEL_WORD_RE.test(String(ln?.description || '')));
  });
}
function hasTicketKeyword(sections, reference = '', notes = '') {
  if (TICKET_WORD_RE.test(String(reference || '')) || TICKET_WORD_RE.test(String(notes || ''))) return true;
  return asArray(sections).some((sec) => {
    if (TICKET_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => TICKET_WORD_RE.test(String(ln?.description || '')));
  });
}
function hasTransferKeyword(sections, reference = '', notes = '') {
  if (TRANSFER_WORD_RE.test(String(reference || '')) || TRANSFER_WORD_RE.test(String(notes || ''))) return true;
  return asArray(sections).some((sec) => {
    if (TRANSFER_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => TRANSFER_WORD_RE.test(String(ln?.description || '')));
  });
}
function hasInsuranceKeyword(sections, reference = '', notes = '') {
  if (INSURANCE_WORD_RE.test(String(reference || '')) || INSURANCE_WORD_RE.test(String(notes || ''))) return true;
  return asArray(sections).some((sec) => {
    if (INSURANCE_WORD_RE.test(String(sec?.title || ''))) return true;
    return asArray(sec?.lines).some((ln) => INSURANCE_WORD_RE.test(String(ln?.description || '')));
  });
}
function extractSmartHotelName(sections, reference = '', notes = '') {
  for (const sec of asArray(sections)) {
    const title = String(sec?.title || '').trim();
    for (const ln of asArray(sec?.lines)) {
      const desc = String(ln?.description || '').trim();
      if (HOTEL_WORD_RE.test(desc)) return desc.slice(0, 140);
    }
    if (HOTEL_WORD_RE.test(title)) {
      const firstLine = String(asArray(sec?.lines)[0]?.description || '').trim();
      return (firstLine || title).slice(0, 140);
    }
  }
  if (HOTEL_WORD_RE.test(String(reference || ''))) return String(reference).trim().slice(0, 140);
  if (HOTEL_WORD_RE.test(String(notes || ''))) return String(notes).trim().slice(0, 140);
  return '';
}
const strictDateOnly = (v, name) => {
  if (v === undefined || v === null || v === '') return null;
  const d = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad(`${name} must be a valid YYYY-MM-DD date.`);
  const dt = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== d) {
    throw bad(`${name} is not a valid calendar date.`);
  }
  return d;
};
const safeDateOnly = (v) => {
  if (!v) return null;
  const d = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const dt = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d ? d : null;
};
const todayPktDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
async function isCustomerPortalBetaEnabled() {
  const rows = await supabaseFetch('/settings?id=eq.current&select=data');
  const data = parseJsonObj(rows?.[0]?.data, {});
  return data.customerPortalBetaEnabled !== false;
}
function normalizeVisaProgress(raw, existing = null) {
  const enabled = raw?.enabled !== undefined ? raw.enabled !== false : (existing?.enabled !== undefined ? existing.enabled !== false : true);
  const status = String(raw?.status !== undefined ? raw.status : (existing?.status || 'not_started'));
  if (!VISA_STATUSES.includes(status)) throw bad('Choose Not Started, In Progress, or Issued.');
  const exInProg = safeDateOnly(existing?.inProgressDate);
  const exIssued = safeDateOnly(existing?.issuedDate);
  const inProgressDate = raw?.inProgressDate !== undefined
    ? strictDateOnly(raw.inProgressDate, 'In Progress date')
    : (status === 'in_progress' ? (exInProg || todayPktDate()) : status === 'issued' ? exInProg : null);
  const issuedDate = raw?.issuedDate !== undefined
    ? strictDateOnly(raw.issuedDate, 'Issued date')
    : (status === 'issued' ? (exIssued || todayPktDate()) : null);

  const paymentApproved = raw?.paymentApproved !== undefined ? Boolean(raw.paymentApproved) : Boolean(existing?.paymentApproved);
  const exPayDate = safeDateOnly(existing?.paymentApprovedDate);
  const paymentApprovedDate = raw?.paymentApprovedDate !== undefined
    ? strictDateOnly(raw.paymentApprovedDate, 'Payment Approved date')
    : (paymentApproved ? (exPayDate || todayPktDate()) : null);

  const hotelEnabled = raw?.hotelEnabled !== undefined ? Boolean(raw.hotelEnabled) : Boolean(existing?.hotelEnabled);
  const hotelStatus = String(raw?.hotelStatus !== undefined ? raw.hotelStatus : (existing?.hotelStatus || 'not_started'));
  if (!VISA_STATUSES.includes(hotelStatus)) throw bad('Choose Not Started, In Progress, or Confirmed for Hotel Booking.');
  const hotelName = raw?.hotelName !== undefined
    ? String(raw.hotelName || '').trim().slice(0, 160) || null
    : (existing?.hotelName ? String(existing.hotelName).trim().slice(0, 160) : null);
  const hotelCheckInDate = raw?.hotelCheckInDate !== undefined
    ? strictDateOnly(raw.hotelCheckInDate, 'Hotel Check-In date')
    : safeDateOnly(existing?.hotelCheckInDate);
  const hotelCheckOutDate = raw?.hotelCheckOutDate !== undefined
    ? strictDateOnly(raw.hotelCheckOutDate, 'Hotel Check-Out date')
    : safeDateOnly(existing?.hotelCheckOutDate);
  const exHotelInProg = safeDateOnly(existing?.hotelInProgressDate);
  const exHotelIssued = safeDateOnly(existing?.hotelIssuedDate);
  const hotelInProgressDate = raw?.hotelInProgressDate !== undefined
    ? strictDateOnly(raw.hotelInProgressDate, 'Hotel In Progress date')
    : (hotelStatus === 'in_progress' ? (exHotelInProg || todayPktDate()) : hotelStatus === 'issued' ? exHotelInProg : null);
  const hotelIssuedDate = raw?.hotelIssuedDate !== undefined
    ? strictDateOnly(raw.hotelIssuedDate, 'Hotel Confirmed date')
    : (hotelStatus === 'issued' ? (exHotelIssued || todayPktDate()) : null);

  const ticketEnabled = raw?.ticketEnabled !== undefined ? Boolean(raw.ticketEnabled) : Boolean(existing?.ticketEnabled);
  const ticketStatus = String(raw?.ticketStatus !== undefined ? raw.ticketStatus : (existing?.ticketStatus || 'not_started'));
  if (!VISA_STATUSES.includes(ticketStatus)) throw bad('Choose Not Started, In Progress, or Issued for Air Tickets.');
  const ticketDetails = raw?.ticketDetails !== undefined
    ? String(raw.ticketDetails || '').trim().slice(0, 160) || null
    : (existing?.ticketDetails ? String(existing.ticketDetails).trim().slice(0, 160) : null);
  const exTicketInProg = safeDateOnly(existing?.ticketInProgressDate);
  const exTicketIssued = safeDateOnly(existing?.ticketIssuedDate);
  const ticketInProgressDate = raw?.ticketInProgressDate !== undefined
    ? strictDateOnly(raw.ticketInProgressDate, 'Ticket In Progress date')
    : (ticketStatus === 'in_progress' ? (exTicketInProg || todayPktDate()) : ticketStatus === 'issued' ? exTicketInProg : null);
  const ticketIssuedDate = raw?.ticketIssuedDate !== undefined
    ? strictDateOnly(raw.ticketIssuedDate, 'Ticket Issued date')
    : (ticketStatus === 'issued' ? (exTicketIssued || todayPktDate()) : null);

  const transferEnabled = raw?.transferEnabled !== undefined ? Boolean(raw.transferEnabled) : Boolean(existing?.transferEnabled);
  const transferStatus = String(raw?.transferStatus !== undefined ? raw.transferStatus : (existing?.transferStatus || 'not_started'));
  if (!VISA_STATUSES.includes(transferStatus)) throw bad('Choose Not Started, In Progress, or Confirmed for Tours & Transfers.');
  const transferDetails = raw?.transferDetails !== undefined
    ? String(raw.transferDetails || '').trim().slice(0, 160) || null
    : (existing?.transferDetails ? String(existing.transferDetails).trim().slice(0, 160) : null);
  const exTransferInProg = safeDateOnly(existing?.transferInProgressDate);
  const exTransferIssued = safeDateOnly(existing?.transferIssuedDate);
  const transferInProgressDate = raw?.transferInProgressDate !== undefined
    ? strictDateOnly(raw.transferInProgressDate, 'Transfer In Progress date')
    : (transferStatus === 'in_progress' ? (exTransferInProg || todayPktDate()) : transferStatus === 'issued' ? exTransferInProg : null);
  const transferIssuedDate = raw?.transferIssuedDate !== undefined
    ? strictDateOnly(raw.transferIssuedDate, 'Transfer Confirmed date')
    : (transferStatus === 'issued' ? (exTransferIssued || todayPktDate()) : null);

  const insuranceEnabled = raw?.insuranceEnabled !== undefined ? Boolean(raw.insuranceEnabled) : Boolean(existing?.insuranceEnabled);
  const insuranceStatus = String(raw?.insuranceStatus !== undefined ? raw.insuranceStatus : (existing?.insuranceStatus || 'not_started'));
  if (!VISA_STATUSES.includes(insuranceStatus)) throw bad('Choose Not Started, In Progress, or Issued for Travel Insurance.');
  const insuranceDetails = raw?.insuranceDetails !== undefined
    ? String(raw.insuranceDetails || '').trim().slice(0, 160) || null
    : (existing?.insuranceDetails ? String(existing.insuranceDetails).trim().slice(0, 160) : null);
  const exInsInProg = safeDateOnly(existing?.insuranceInProgressDate);
  const exInsIssued = safeDateOnly(existing?.insuranceIssuedDate);
  const insuranceInProgressDate = raw?.insuranceInProgressDate !== undefined
    ? strictDateOnly(raw.insuranceInProgressDate, 'Insurance In Progress date')
    : (insuranceStatus === 'in_progress' ? (exInsInProg || todayPktDate()) : insuranceStatus === 'issued' ? exInsInProg : null);
  const insuranceIssuedDate = raw?.insuranceIssuedDate !== undefined
    ? strictDateOnly(raw.insuranceIssuedDate, 'Insurance Issued date')
    : (insuranceStatus === 'issued' ? (exInsIssued || todayPktDate()) : null);

  const travelReadyEnabled = raw?.travelReadyEnabled !== undefined ? Boolean(raw.travelReadyEnabled) : Boolean(existing?.travelReadyEnabled);
  const exReadyDate = safeDateOnly(existing?.travelReadyDate);
  const travelReadyDate = raw?.travelReadyDate !== undefined
    ? strictDateOnly(raw.travelReadyDate, 'Travel Ready date')
    : (travelReadyEnabled ? (exReadyDate || todayPktDate()) : null);

  return {
    enabled,
    status,
    inProgressDate,
    issuedDate,
    paymentApproved,
    paymentApprovedDate,
    hotelEnabled,
    hotelStatus,
    hotelName,
    hotelCheckInDate,
    hotelCheckOutDate,
    hotelInProgressDate,
    hotelIssuedDate,
    ticketEnabled,
    ticketStatus,
    ticketDetails,
    ticketInProgressDate,
    ticketIssuedDate,
    transferEnabled,
    transferStatus,
    transferDetails,
    transferInProgressDate,
    transferIssuedDate,
    insuranceEnabled,
    insuranceStatus,
    insuranceDetails,
    insuranceInProgressDate,
    insuranceIssuedDate,
    travelReadyEnabled,
    travelReadyDate,
    updatedAt: nowIso(),
  };
}
function formatVisaProgress(raw, rowUpdatedAt = null) {
  const vp = parseJsonObj(raw, null);
  if (!vp) return null;
  const enabled = vp.enabled === true;
  const paymentApproved = vp.paymentApproved === true;
  const hotelEnabled = vp.hotelEnabled === true;
  const ticketEnabled = vp.ticketEnabled === true;
  const transferEnabled = vp.transferEnabled === true;
  const insuranceEnabled = vp.insuranceEnabled === true;
  const travelReadyEnabled = vp.travelReadyEnabled === true;
  if (!enabled && !paymentApproved && !hotelEnabled && !ticketEnabled && !transferEnabled && !insuranceEnabled && !travelReadyEnabled) {
    return null;
  }
  const status = VISA_STATUSES.includes(vp.status) ? vp.status : 'not_started';
  const hotelStatus = VISA_STATUSES.includes(vp.hotelStatus) ? vp.hotelStatus : 'not_started';
  const ticketStatus = VISA_STATUSES.includes(vp.ticketStatus) ? vp.ticketStatus : 'not_started';
  const transferStatus = VISA_STATUSES.includes(vp.transferStatus) ? vp.transferStatus : 'not_started';
  const insuranceStatus = VISA_STATUSES.includes(vp.insuranceStatus) ? vp.insuranceStatus : 'not_started';
  return {
    enabled,
    status,
    inProgressDate: safeDateOnly(vp.inProgressDate),
    issuedDate: safeDateOnly(vp.issuedDate),
    paymentApproved,
    paymentApprovedDate: safeDateOnly(vp.paymentApprovedDate),
    hotelEnabled,
    hotelStatus,
    hotelName: vp.hotelName ? String(vp.hotelName).trim().slice(0, 160) : null,
    hotelCheckInDate: safeDateOnly(vp.hotelCheckInDate),
    hotelCheckOutDate: safeDateOnly(vp.hotelCheckOutDate),
    hotelInProgressDate: safeDateOnly(vp.hotelInProgressDate),
    hotelIssuedDate: safeDateOnly(vp.hotelIssuedDate),
    ticketEnabled,
    ticketStatus,
    ticketDetails: vp.ticketDetails ? String(vp.ticketDetails).trim().slice(0, 160) : null,
    ticketInProgressDate: safeDateOnly(vp.ticketInProgressDate),
    ticketIssuedDate: safeDateOnly(vp.ticketIssuedDate),
    transferEnabled,
    transferStatus,
    transferDetails: vp.transferDetails ? String(vp.transferDetails).trim().slice(0, 160) : null,
    transferInProgressDate: safeDateOnly(vp.transferInProgressDate),
    transferIssuedDate: safeDateOnly(vp.transferIssuedDate),
    insuranceEnabled,
    insuranceStatus,
    insuranceDetails: vp.insuranceDetails ? String(vp.insuranceDetails).trim().slice(0, 160) : null,
    insuranceInProgressDate: safeDateOnly(vp.insuranceInProgressDate),
    insuranceIssuedDate: safeDateOnly(vp.insuranceIssuedDate),
    travelReadyEnabled,
    travelReadyDate: safeDateOnly(vp.travelReadyDate),
    updatedAt: vp.updatedAt || rowUpdatedAt || null,
  };
}

const DESC_PREFIX = '__desc__:';
const extractCustDesc = (r) => {
  const raw = asArray(r?.shared_with);
  const token = raw.find((x) => typeof x === 'string' && x.startsWith(DESC_PREFIX));
  return r?.description ? String(r.description) : token ? token.slice(DESC_PREFIX.length) : '';
};
const cleanSharedIds = (arr) => asArray(arr).filter((x) => typeof x === 'string' && !x.startsWith(DESC_PREFIX));
const packSharedWith = (ids, description) => {
  const clean = cleanSharedIds(ids);
  const desc = String(description || '').trim();
  return desc ? [...clean, `${DESC_PREFIX}${desc}`] : clean;
};

const mapCustomer = (r) => ({
  id: r.id, customerName: r.customer_name, companyName: r.company_name || '', description: extractCustDesc(r), destinations: asArray(r.destinations),
  customerNumber: r.customer_number || '', acquiredThrough: r.acquired_through || '', acquiredBy: r.acquired_by || '',
  sharedWith: cleanSharedIds(r.shared_with), createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapFollowup = (r) => ({
  id: r.id, customerId: r.customer_id || null, participantIds: asArray(r.participant_ids), kind: r.kind, subject: r.subject || '', assignedTo: r.assigned_to, remarks: r.remarks || '', dueAt: r.due_at,
  status: r.status, outcomeRemarks: r.outcome_remarks || '', history: asArray(r.history), createdBy: r.created_by,
  createdAt: r.created_at, updatedAt: r.updated_at, completedAt: r.completed_at, remarkLog: asArray(r.remark_log),
});
const mapInventory = (r) => ({
  id: r.id, requestedBy: r.requested_by, assignedTo: r.assigned_to, items: asArray(r.items), note: r.note || '', status: r.status,
  decisionRemarks: r.decision_remarks || '', decidedBy: r.decided_by || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const num = (v) => Number(v) || 0;
const flagOf = (e, name) => {
  let p = e && e.pending_device_request;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return Boolean(p && p[name]);
};
// Sales: Admin, Accounts and CEO always; any other employee only when an administrator has switched it on for them.
// Customer Portal (Beta) staff view: Admin always; everyone else only when an admin switched it on for them.
// Sales teams: an employee can belong to the B2C or the B2B sales team; a team head also sees the customers of their whole team.
const SALES_TEAMS = ['B2C', 'B2B'];
const parsePending = (e) => {
  let p = e && e.pending_device_request;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return p && typeof p === 'object' ? p : {};
};
const teamInfo = (e) => { const p = parsePending(e); return { team: SALES_TEAMS.includes(p.salesTeam) ? p.salesTeam : '', head: Boolean(p.salesTeamHead) }; };
const teamMemberIds = async (team) => ((await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,pending_device_request')) || []).filter((e) => teamInfo(e).team === team).map((e) => e.id);
// Live Dashboard layout (positions, sizes, colours) that an administrator saves for everyone.
const DASH_COLORS = ['blue', 'emerald', 'violet', 'amber', 'rose', 'sky', 'teal', 'slate'];
const cleanLayout = (raw) => {
  const items = {};
  const src = raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object' ? raw.items : {};
  for (const [k, v] of Object.entries(src).slice(0, 60)) {
    if (!/^[a-z0-9-]{1,40}$/.test(k) || !v || typeof v !== 'object') continue;
    const clamp = (n, lo, hi, d) => { const x = Number(n); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
    items[k] = { order: clamp(v.order, -1000, 100000, 0), span: clamp(v.span, 2, 12, 12), h: v.h ? clamp(v.h, 80, 1400, 0) : 0, color: DASH_COLORS.includes(v.color) ? v.color : '', hidden: v.hidden === true };
  }
  return { items, updatedAt: String(raw?.updatedAt || ''), updatedBy: String(raw?.updatedBy || ''), updatedByName: String(raw?.updatedByName || '').slice(0, 80) };
};
const hasPortalAccess = (e) => Boolean(e) && (e.role === 'admin' || flagOf(e, 'customerPortalAccess'));
const hasSalesAccess = (e) => Boolean(e) && (['admin', 'accounts', 'ceo'].includes(e.role) || flagOf(e, 'salesAccess'));
const DEFAULT_COMPANY = {
  name: 'Bahaar Journeys (Pvt) Ltd', payTo: 'BAHAAR JOURNEYS (PVT) LTD', ntn: '6988772-2',
  address: '', phone: '', email: '', website: '', bankDetails: '', terms: '', footer: 'Thanking you',
};
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// Payments of an invoice. Older invoices only have a single "advance received" amount: it is shown as the first payment.
const paymentsOf = (r) => {
  const list = asArray(r.payments).map(cleanStored).filter((p) => p.id);
  if (list.length || !(num(r.advance_paid) > 0) || r.kind === 'vendor') return list;
  return [cleanStored({ id: 'pay-legacy', date: String(r.invoice_date || '').slice(0, 10), amount: num(r.advance_paid), note: 'Advance received', by: r.created_by, at: r.created_at })];
};
const mapInvoice = (r, visaProgress = null) => ({
  id: r.id, kind: r.kind === 'vendor' ? 'vendor' : 'customer', crmId: r.crm_id || '', queryCode: r.query_code || '', invoiceNo: r.invoice_no, createdBy: r.created_by, customerName: r.customer_name, customerPhone: r.customer_phone || '',
  customerAddress: r.customer_address || '', customerNtn: r.customer_ntn || '', reference: r.reference || '',
  invoiceDate: r.invoice_date, dueDate: r.due_date || null, travelDate: r.travel_date || null, currency: r.currency, sections: asArray(r.sections),
  taxLabel: r.tax_label || 'Tax', taxRate: num(r.tax_rate), discount: num(r.discount), advancePaid: num(r.advance_paid), payments: paymentsOf(r),
  subtotal: num(r.subtotal), taxAmount: num(r.tax_amount), total: num(r.total), balance: num(r.balance), notes: r.notes || '',
  vendors: asArray(r.vendors), ntn: r.ntn === null || r.ntn === undefined ? null : String(r.ntn), showNtn: r.show_ntn !== false,
  status: r.status, paymentReceived: Boolean(r.payment_received), paymentReceivedAt: r.payment_received_at || null, paymentReceivedBy: r.payment_received_by || null, paymentReceivedAuto: Boolean(r.payment_received_auto), travelers: asArray(r.travelers), vendorPosted: Boolean(r.vendor_posted), vendorPostedAt: r.vendor_posted_at || null, vendorPostedBy: r.vendor_posted_by || null, vendorStatus: r.vendor_status === 'paid' ? 'paid' : 'unpaid', vendorPaidAt: r.vendor_paid_at || null, vendorPaidBy: r.vendor_paid_by || null,
  cancelRemarks: r.cancel_remarks || '', cancelledBy: r.cancelled_by || null, cancelledAt: r.cancelled_at || null,
  visaProgress: r.kind === 'vendor' ? null : (visaProgress || null), createdAt: r.created_at, updatedAt: r.updated_at,
});
const RECEIPT_ITEMS = ['Package', 'Visa Charges', 'Air Tickets', 'Hotel', 'Transfers', 'Insurance', 'Service Charges'];
const mapReceipt = (r) => ({
  id: r.id, receiptNo: r.receipt_no, createdBy: r.created_by, queryCode: r.query_code, clientName: r.client_name, items: asArray(r.items), otherItem: r.other_item || '',
  paymentType: r.payment_type === 'partial' ? 'partial' : 'full', currency: r.currency, totalAmount: num(r.total_amount), amountReceived: num(r.amount_received),
  method: r.method === 'bank' ? 'bank' : 'cash', bankName: r.bank_name || '', referenceNo: r.reference_no || '', hasProof: Boolean(r.has_proof), purpose: r.purpose || '',
  linkedInvoiceId: r.linked_invoice_id || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapSale = (r) => ({
  id: r.id, couponNo: r.coupon_no, createdBy: r.created_by, saleType: r.sale_type, otherType: r.other_type || '',
  customerName: r.customer_name, vendorName: r.vendor_name, packageDetails: r.package_details, paxName: r.pax_name,
  currency: r.currency, costAmount: num(r.cost_amount), saleAmount: num(r.sale_amount), queryCode: r.query_code, psfProfit: num(r.psf_profit),
  status: r.status, paymentStatus: r.payment_status, reviewRemarks: r.review_remarks || '', reviewedBy: r.reviewed_by || null,
  reviewedAt: r.reviewed_at || null, createdAt: r.created_at, updatedAt: r.updated_at,
});
const mapMeeting = (r) => ({
  id: r.id, title: r.title, customerId: r.customer_id || null, externalName: r.external_name || '', attendeeIds: asArray(r.attendee_ids),
  startAt: r.start_at, endAt: r.end_at, location: r.location || '', notes: r.notes || '', status: r.status,
  requestedBy: r.requested_by || null, decidedBy: r.decided_by || null, decisionNote: r.decision_note || '', noteLog: asArray(r.note_log),
  createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
});

const upsert = (table, rows) => supabaseFetch(`/${table}`, {
  method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
});
const getAll = async (table) => (await supabaseFetch(`/${table}?select=*&limit=${LIMIT}`)) || [];
const myNotifications = async (empId) => (await supabaseFetch(`/crm_notifications?employee_id=eq.${encodeURIComponent(empId)}&order=created_at.desc&limit=300&select=*`)) || [];
const getOne = async (table, rowId) => (await supabaseFetch(`/${table}?id=eq.${encodeURIComponent(rowId)}&select=*`))?.[0] || null;

async function getInventoryCatalog() {
  try {
    const row = await getOne('crm_company', 'inventory_catalog');
    const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter(Boolean);
    const removed = new Set(asArray(row?.data?.removedItems).map((x) => String(x || '').trim().toLowerCase()));
    const combined = [];
    const seen = new Set();
    for (const item of [...DEFAULT_INVENTORY_ITEMS, ...custom]) {
      const key = item.toLowerCase();
      if (!key || seen.has(key) || removed.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }
    return combined;
  } catch {
    return [...DEFAULT_INVENTORY_ITEMS];
  }
}

const PURCHASE_CATEGORIES = ['ticket', 'hotel', 'visa', 'tour', 'insurance', 'other'];

async function getPurchaseSchema() {
  try {
    const row = await getOne('crm_company', 'purchases_schema');
    const customFields = asArray(row?.data?.customFields).filter((f) => f && f.id && f.label);
    const customCategories = asArray(row?.data?.customCategories).filter((c) => c && c.id && c.label);
    return { customFields, customCategories };
  } catch {
    return { customFields: [], customCategories: [] };
  }
}

async function getPurchaseCustomFields() {
  const { customFields } = await getPurchaseSchema();
  return customFields;
}

async function getAllPurchases() {
  try {
    const rows = (await supabaseFetch(`/crm_company?id=like.pur-*&order=updated_at.desc&limit=${LIMIT}&select=*`)) || [];
    return rows.map((r) => ({ ...(r.data || {}), id: r.id, updatedAt: r.updated_at || r.data?.updatedAt || '' })).filter((p) => p && p.purchaseNo);
  } catch {
    return [];
  }
}

async function updatePurchaseRow(existingRow, data, at) {
  const revision = existingRow.updated_at ? `eq.${encodeURIComponent(existingRow.updated_at)}` : 'is.null';
  const changed = await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(existingRow.id)}&updated_at=${revision}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, updated_at: at }),
  });
  if (!changed?.length) throw bad('Purchase changed. Refresh and try again.');
  return { ...changed[0].data, id: changed[0].id, updatedAt: changed[0].updated_at || at };
}

async function getAllPortalQueries() {
  try {
    const rows = (await supabaseFetch(`/crm_company?id=like.pqr-*&order=updated_at.desc&limit=250&select=*`)) || [];
    return rows
      .map((r) => {
        const d = parseJsonObj(r?.data, {});
        if (!d || !d.queryRef) return null;
        return {
          id: r.id,
          queryRef: String(d.queryRef || ''),
          customerName: String(d.customerName || ''),
          mobileNumber: String(d.mobileNumber || ''),
          desiredCountries: asArray(d.desiredCountries).map((c) => String(c || '')).filter(Boolean),
          desiredDays: String(d.desiredDays || ''),
          desiredServices: asArray(d.desiredServices).map((s) => String(s || '')).filter(Boolean),
          notes: String(d.notes || ''),
          packageTitle: String(d.packageTitle || ''),
          trackingQuery: String(d.trackingQuery || ''),
          crmId: String(d.crmId || ''),
          isExistingCustomer: Boolean(d.isExistingCustomer),
          status: ['new', 'contacted', 'quoted', 'closed'].includes(d.status) ? d.status : 'new',
          assignedTo: d.assignedTo ? String(d.assignedTo) : null,
          createdAt: d.createdAt || r.updated_at || '',
          updatedAt: r.updated_at || d.updatedAt || '',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function activeEmployees() {
  return (await supabaseFetch('/employees?deleted_at=is.null&is_active=eq.true&select=id,name,role')) || [];
}

async function notify(employeeIds, category, refId, message, exceptId) {
  const ids = [...new Set(employeeIds)].filter((e) => e && e !== exceptId);
  if (!ids.length) return;
  const at = nowIso();
  await upsert('crm_notifications', ids.map((e) => ({ id: id('ntf'), employee_id: e, category, ref_id: refId, message, created_at: at, read_at: null })));
}

// Plain-language list of what changed in an edit, used in the "edited" notifications (kept short).
const changedBits = (pairs) => {
  const bits = [];
  for (const [label, a, b] of pairs) {
    const x = a === null || a === undefined ? '' : String(a);
    const y = b === null || b === undefined ? '' : String(b);
    if (x !== y) bits.push(`${label}: ${x || '-'} -> ${y || '-'}`);
  }
  const out = bits.join('; ');
  return out.length > 260 ? `${out.slice(0, 257)}...` : out;
};
const salesStaffIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin' || e.role === 'accounts' || e.role === 'ceo').map((e) => e.id);
const accountsIds = async () => (await activeEmployees()).filter((e) => e.role === 'accounts').map((e) => e.id);
const adminIds = async () => (await activeEmployees()).filter((e) => e.role === 'admin' || e.role === 'ceo').map((e) => e.id);

async function assertEmployee(empId, label = 'Employee') {
  const list = await activeEmployees();
  const found = list.find((e) => e.id === empId);
  if (!found) throw bad(`${label} was not found or is not active.`);
  return found;
}

// A meeting slot is busy when another scheduled meeting overlaps it.
async function assertSlotFree(startAt, endAt, exceptId) {
  const clash = (await getAll('crm_meetings')).find((m) =>
    m.id !== exceptId && m.status === 'scheduled' && Date.parse(m.start_at) < Date.parse(endAt) && Date.parse(m.end_at) > Date.parse(startAt));
  if (clash) {
    throw new HttpError(409, `The CEO already has "${clash.title}" at that time. Please choose another slot.`, 'SLOT_BUSY');
  }
}

// A "Meeting follow-up" that involves the CEO and has a time also books the CEO's calendar (30 minutes, as with Add to Calendar).
const FOLLOWUP_SLOT_MS = 30 * 60 * 1000;
const ceoIdList = async () => (await activeEmployees()).filter((e) => e.role === 'ceo').map((e) => e.id);
function ceoFollowupSlots(followups, ceoIds, exceptId) {
  return followups
    .filter((f) => f.id !== exceptId && f.kind === 'meeting' && OPEN.includes(f.status) && f.due_at && !Number.isNaN(Date.parse(f.due_at)))
    .filter((f) => [f.assigned_to, f.created_by, ...asArray(f.participant_ids)].some((x) => ceoIds.includes(x)))
    .map((f) => ({ id: f.id, title: `Meeting follow-up${f.remarks ? `: ${String(f.remarks).slice(0, 40)}` : ''}`, start: Date.parse(f.due_at), end: Date.parse(f.due_at) + FOLLOWUP_SLOT_MS }));
}
/** Everything already booked in the CEO's calendar that overlaps [startMs, endMs). */
async function findCeoOverlaps(startMs, endMs, { exceptFollowupId, exceptMeetingId } = {}) {
  const [ceoIds, followups, meetings] = await Promise.all([ceoIdList(), getAll('crm_followups'), getAll('crm_meetings')]);
  const out = meetings
    .filter((m) => m.id !== exceptMeetingId && m.status === 'scheduled' && Date.parse(m.start_at) < endMs && Date.parse(m.end_at) > startMs)
    .map((m) => ({ id: m.id, title: `CEO meeting: ${m.title}`, start: Date.parse(m.start_at), end: Date.parse(m.end_at) }));
  for (const s of ceoFollowupSlots(followups, ceoIds, exceptFollowupId)) if (s.start < endMs && s.end > startMs) out.push(s);
  return out;
}
const pktClock = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
/** Tells the CEO and every administrator that two bookings clash. */
async function notifyOverlap(refId, what, startMs, clashes, exceptId) {
  if (!clashes.length) return;
  const people = [...(await ceoIdList()), ...(await adminIds())];
  const names = clashes.slice(0, 3).map((c) => `${c.title} (${pktClock(c.start)})`).join('; ');
  await notify(people, 'meeting', refId, `⚠ Meeting time overlap: ${what} at ${pktClock(startMs)} clashes with ${names}.`, exceptId);
}

// Keeps receipts and invoices in step: a receipt attached as a payment is marked with the invoice, and freed again when that payment is removed.
async function syncReceiptLinks(invoiceId, added, removed) {
  for (const p of added) if (p.receiptId) await supabaseFetch(`/crm_receipts?id=eq.${encodeURIComponent(p.receiptId)}`, { method: 'PATCH', body: JSON.stringify({ linked_invoice_id: invoiceId }) });
  for (const p of removed) if (p.receiptId) await supabaseFetch(`/crm_receipts?id=eq.${encodeURIComponent(p.receiptId)}&linked_invoice_id=eq.${encodeURIComponent(invoiceId)}`, { method: 'PATCH', body: JSON.stringify({ linked_invoice_id: null }) });
}

function readMeetingInput(m, { requireEnd = true } = {}) {
  const startAt = isoOrNull(m?.startAt, 'Start time', { required: true });
  const endAt = isoOrNull(m?.endAt, 'End time', { required: requireEnd });
  if (Date.parse(endAt) <= Date.parse(startAt)) throw bad('The end time must be after the start time.');
  if (Date.parse(endAt) - Date.parse(startAt) > 12 * 3600 * 1000) throw bad('A meeting cannot be longer than 12 hours.');
  return {
    title: str(m?.title, 160, { required: true, name: 'Meeting title' }),
    customer_id: m?.customerId ? String(m.customerId) : null,
    external_name: str(m?.externalName, 160, { name: 'Outside person / company' }),
    location: str(m?.location, 200, { name: 'Location or link' }),
    notes: str(m?.notes, 4000, { name: 'Notes' }),
    start_at: startAt,
    end_at: endAt,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isSupabaseConfigured()) return res.status(501).json({ error: 'The CRM needs the cloud database.', code: 'NO_CRM' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const me = await getSessionEmployee(body.sessionToken);
    if (!me) throw new HttpError(401, 'Please sign in again.', 'SESSION_REQUIRED');
    if (!me.isSuperAdmin) {
      const action = String(body.action || '');
      const page = action.startsWith('customer') ? 'crm-customers'
        : action.startsWith('followup') || action.startsWith('task') ? 'crm-tasks'
        : action.startsWith('meeting') ? 'crm-meetings'
        : action.startsWith('inventory') ? 'crm-inventory'
        : action.startsWith('sale') ? 'crm-sales'
        : action.startsWith('purchase') ? 'crm-purchases'
        : action.startsWith('invoice') ? 'crm-invoices'
        : action.startsWith('receipt') ? 'crm-receipts'
        : action.startsWith('portal') ? 'crm-portal'
        : action.startsWith('notification') ? 'crm-notifications' : undefined;
      if (page && me.featureAccess?.[page] === false) throw forbidden('Your Super Admin has disabled access to this page.');
    }
    const isAdmin = me.role === 'admin' || me.role === 'ceo'; // the CEO has every administrator right in the CRM and Office sections
    const seeAllCust = isAdmin || me.role === 'accounts' || me.role === 'ceo';
    // Everyone can add customers; they see their own plus the ones shared with them. Admin, CEO and Accounts see all.
    const myTeam = teamInfo(me);
    const teamIds = myTeam.head && myTeam.team ? new Set(await teamMemberIds(myTeam.team)) : null;
    const canSeeCust = (c) => seeAllCust || c.created_by === me.id || asArray(c.shared_with).includes(me.id) || Boolean(teamIds && teamIds.has(c.created_by));
    const canSales = hasSalesAccess(me);
    const { action } = body;

    // ------------------------------------------------------------------ reading
    if (action === 'list' || action === 'badges') {
      // Punch-out reminders are created here too, so they reach people who have the portal open.
      await sweepShiftReminders({ getShiftEndWindowMs, format12h });
      const [followups, meetings, notifs, inventory, salesRows] = await Promise.all([getAll('crm_followups'), getAll('crm_meetings'), myNotifications(me.id), getAll('crm_inventory_requests'), getAll('crm_sales')]);
      const mine = notifs.filter((n) => !n.read_at);
      const salesViewer = isAdmin || me.role === 'accounts' || me.role === 'ceo';
      // Deadlines coming up (or just missed) for this person: drives the live countdown alerts on every page.
      const nowMs = Date.now();
      const upcoming = [];
      for (const f of followups) {
        if (!OPEN.includes(f.status) || !f.due_at) continue;
        if (f.assigned_to !== me.id && !asArray(f.participant_ids).includes(me.id)) continue;
        const t = Date.parse(f.due_at);
        if (t > nowMs + 3 * 86400000 || t < nowMs - 86400000) continue;
        upcoming.push({ kind: 'followup', id: f.id, title: `${KIND_LABEL[f.kind] || 'Follow-up'}${f.remarks ? `: ${String(f.remarks).slice(0, 50)}` : ''}`, at: f.due_at });
      }
      for (const m of meetings) {
        if (m.status !== 'scheduled') continue;
        if (!isAdmin && !asArray(m.attendee_ids).includes(me.id) && m.requested_by !== me.id) continue;
        const t = Date.parse(m.start_at);
        if (t > nowMs + 3 * 86400000 || t < nowMs - 3600000) continue;
        upcoming.push({ kind: 'meeting', id: m.id, title: `Meeting: ${m.title}`, at: m.start_at });
      }
      const myOpen = followups.filter((f) => f.assigned_to === me.id && OPEN.includes(f.status));
      const pendingApprovals = meetings.filter((m) => m.status === 'pending_approval').length;
      const badges = {
        tasksOpen: myOpen.length,
        tasksNew: mine.filter((n) => n.category === 'followup').length,
        meetingsNew: mine.filter((n) => n.category === 'meeting').length,
        meetingsPending: isAdmin ? pendingApprovals : 0,
        inventoryNew: mine.filter((n) => n.category === 'inventory').length,
        inventoryPending: inventory.filter((r) => r.assigned_to === me.id && r.status === 'pending').length,
        salesNew: mine.filter((n) => n.category === 'sale').length,
        invoiceNew: mine.filter((n) => n.category === 'invoice').length,
        receiptNew: mine.filter((n) => n.category === 'receipt').length,
        customersNew: mine.filter((n) => n.category === 'customer').length,
        salesPending: (isAdmin || me.role === 'accounts') ? salesRows.filter((x) => x.status === 'pending').length : 0,
        unreadTotal: mine.length,
        unreadLatest: [...mine].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, 5).map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message })),
        upcoming,
      };
      if (action === 'badges') return res.status(200).json({ ok: true, badges });

      const visibleFollowups = followups.filter((f) => isAdmin || f.assigned_to === me.id || f.created_by === me.id || asArray(f.participant_ids).includes(me.id)).map(mapFollowup);
      const allCustomers = (await getAll('crm_customers')).filter((c) => !c.deleted_at);
      // Employees without Customers access only ever see the customer attached to a follow-up/meeting they are part of.
      const linkedIds = new Set([...visibleFollowups.map((f) => f.customerId), ...meetings.filter((m) => asArray(m.attendee_ids).includes(me.id) || m.requested_by === me.id).map((m) => m.customer_id)].filter(Boolean));
      const customers = allCustomers.filter((c) => canSeeCust(c) || linkedIds.has(c.id)).map(mapCustomer);
      const visibleInventory = inventory.filter((r) => isAdmin || r.requested_by === me.id || r.assigned_to === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapInventory);
      const sales = (!canSales ? [] : salesRows).filter((x) => salesViewer || x.created_by === me.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(mapSale);
      const history = notifs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200)
        .map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at, read: Boolean(n.read_at) }));
      let invoices = [];
      let receipts = [];
      let purchases = [];
      let portalQueries = [];
      let portalInvoices = {};
      let purchaseCustomFields = [];
      let purchaseCustomCategories = [];
      let company = DEFAULT_COMPANY;
      let inventoryItems = DEFAULT_INVENTORY_ITEMS;
      let business = null;
      if (action === 'list') {
        const [invRows, companyRow, receiptRows, catalogItems, allPurchases, purchaseSchema, betaEnabled, allPortalQueries, visaRowsAll] = await Promise.all([
          getAll('crm_invoices'),
          getOne('crm_company', 'main'),
          supabaseFetch(`/crm_receipts?select=id,receipt_no,created_by,query_code,client_name,items,other_item,payment_type,currency,total_amount,amount_received,method,bank_name,reference_no,has_proof,purpose,linked_invoice_id,created_at,updated_at&order=created_at.desc&limit=${LIMIT}`),
          getInventoryCatalog(),
          getAllPurchases(),
          getPurchaseSchema(),
          isCustomerPortalBetaEnabled(),
          getAllPortalQueries(),
          supabaseFetch(`/crm_company?id=like.visa-*&select=id,data,updated_at&limit=${LIMIT}`).catch(() => []),
        ]);
        const visaByInvId = new Map();
        if (betaEnabled) {
          const visaRows = visaRowsAll || [];
          for (const vr of visaRows) {
            if (typeof vr?.id === 'string' && vr.id.startsWith('visa-')) {
              const vp = formatVisaProgress(vr.data, vr.updated_at || null);
              if (vp) visaByInvId.set(vr.id.slice(5), vp);
            }
          }
        }
        // Receipts go to Accounts (and Admin / CEO); everyone else only sees the receipts they made themselves.
        receipts = (receiptRows || []).filter((x) => salesViewer || x.created_by === me.id).map(mapReceipt);
        invoices = invRows
          .filter((x) => salesViewer || x.created_by === me.id)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
          .map((r) => mapInvoice(r, betaEnabled && r.kind !== 'vendor' ? (visaByInvId.get(r.id) || null) : null));
        purchases = (allPurchases || []).filter((x) => salesViewer || x.createdBy === me.id);
        // Sales target / leaderboard / payables-due calendar for the Live Dashboard.
        // Totals only (never cost or profit); the leaderboard and payables need Admin / CEO / Accounts or an admin-granted switch.
        const monthKey = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 7);
        const targetRow = await getOne('crm_company', 'sales-targets').catch(() => null);
        const tdata = parseJsonObj(targetRow?.data, {});
        const targets = { currency: str(tdata.currency, 6) || 'PKR', team: num(tdata.team), people: parseJsonObj(tdata.people, {}) };
        const inMonth = (x) => String(new Date(Date.parse(x.created_at) + 5 * 3600 * 1000).toISOString()).slice(0, 7) === monthKey;
        const closed = salesRows.filter((x) => x.status === 'approved' && inMonth(x));
        const tally = (rows) => ({ count: rows.length, amount: r2(rows.filter((x) => x.currency === targets.currency).reduce((a, x) => a + num(x.sale_amount), 0)) });
        const canBoard = salesViewer || flagOf(me, 'leaderboardAccess');
        const canPay = salesViewer || flagOf(me, 'payablesAccess');
        const staffNames = canBoard ? await activeEmployees() : [];
        business = {
          monthKey, targets: canBoard || canSales ? targets : null,
          me: canSales || canBoard ? { ...tally(closed.filter((x) => x.created_by === me.id)), target: num(targets.people[me.id]) } : null,
          leaderboard: canBoard
            ? staffNames.map((e) => ({ id: e.id, name: e.name, ...tally(closed.filter((x) => x.created_by === e.id)), target: num(targets.people[e.id]) })).filter((x) => x.count > 0 || x.target > 0).sort((a, b) => b.amount - a.amount || b.count - a.count)
            : null,
          payables: canPay
            ? invRows.filter((x) => x.kind === 'vendor' && x.status === 'unpaid').map((x) => ({ id: x.id, invoiceNo: x.invoice_no, vendor: x.customer_name, dueDate: x.due_date || null, currency: x.currency, total: num(x.total) })).slice(0, 300)
            : null,
        };
        portalQueries = betaEnabled && hasPortalAccess(me) ? (allPortalQueries || []) : [];
        if (betaEnabled && (isAdmin || hasPortalAccess(me))) {
          const pinvRows = (await supabaseFetch(`/crm_company?id=like.pinv-*&select=id,data&limit=${LIMIT}`).catch(() => [])) || [];
          for (const pr of pinvRows) {
            if (typeof pr?.id === 'string' && pr.id.startsWith('pinv-')) portalInvoices[pr.id.slice(5)] = parseJsonObj(pr.data, {});
          }
        }
        purchaseCustomFields = purchaseSchema?.customFields || [];
        purchaseCustomCategories = purchaseSchema?.customCategories || [];
        company = { ...DEFAULT_COMPANY, ...parseJsonObj(companyRow?.data, {}) };
        inventoryItems = catalogItems;
      }
      // Times the CEO is busy with a Meeting follow-up: shown in the Meetings portal to everyone (details only to people involved).
      const dashboardLayout = cleanLayout(parseJsonObj((await getOne('crm_company', 'dashboard-layout').catch(() => null))?.data, {}));
      const ceoIdsNow = await ceoIdList();
      const bookedSlots = ceoFollowupSlots(followups, ceoIdsNow).filter((x) => x.end >= Date.now() - 45 * 24 * 3600 * 1000).map((x) => {
        const f = followups.find((r) => r.id === x.id);
        const involved = isAdmin || f.assigned_to === me.id || f.created_by === me.id || asArray(f.participant_ids).includes(me.id);
        return { id: x.id, title: involved ? x.title : 'Booked (meeting follow-up)', startAt: new Date(x.start).toISOString(), endAt: new Date(x.end).toISOString() };
      });
      const since = Date.now() - 45 * 24 * 3600 * 1000;
      const visibleMeetings = meetings
        .filter((m) => Date.parse(m.end_at) >= since)
        .filter((m) => isAdmin || !['pending_approval', 'rejected'].includes(m.status) || m.requested_by === me.id)
        .map(mapMeeting);
      return res.status(200).json({
        ok: true, me: { id: me.id, role: me.role, customerAccess: true, salesAccess: canSales, portalAccess: hasPortalAccess(me), salesTeam: myTeam.team, salesTeamHead: myTeam.head }, dashboardLayout, customers, followups: visibleFollowups, meetings: visibleMeetings, bookedSlots, inventory: visibleInventory, inventoryItems, sales, purchases, portalQueries, portalInvoices, purchaseCustomFields, purchaseCustomCategories, history, invoices, receipts, company, saleTypes: SALE_TYPES, currencies: CURRENCIES, business,
        unread: mine.map((n) => ({ id: n.id, category: n.category, refId: n.ref_id, message: n.message, createdAt: n.created_at })), badges,
      });
    }

    // Live Dashboard layout (Admin / CEO): saved once and shown to everybody.
    if (action === 'dashboard_layout_save') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can change the dashboard layout.');
      const layout = cleanLayout({ items: body.layout?.items, updatedAt: nowIso(), updatedBy: me.id, updatedByName: me.name });
      await upsert('crm_company', { id: 'dashboard-layout', data: layout, updated_at: nowIso() });
      return res.status(200).json({ ok: true, dashboardLayout: layout });
    }

    // Monthly sales targets (Admin / CEO). Same target every month until changed.
    if (action === 'targets_save') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can set sales targets.');
      const t = body.targets || {};
      const people = {};
      for (const [k, v] of Object.entries(parseJsonObj(t.people, {}))) {
        const n = Math.max(0, Math.min(1e12, num(v)));
        if (n > 0 && typeof k === 'string' && k.length <= 80) people[k] = n;
      }
      const next = { currency: CURRENCIES.includes(t.currency) ? t.currency : 'PKR', team: Math.max(0, Math.min(1e12, num(t.team))), people, updatedAt: nowIso(), updatedBy: me.id };
      await upsert('crm_company', { id: 'sales-targets', data: next, updated_at: next.updatedAt });
      return res.status(200).json({ ok: true, targets: { currency: next.currency, team: next.team, people } });
    }

    if (action === 'notifications_read') {
      const cat = ['followup', 'meeting', 'inventory', 'sale', 'reminder', 'invoice', 'receipt', 'customer'].includes(body.category) ? body.category : null;
      const rows = (await myNotifications(me.id)).filter((n) => !n.read_at && (!cat || n.category === cat));
      if (rows.length) await upsert('crm_notifications', rows.map((n) => ({ ...n, read_at: nowIso() })));
      return res.status(200).json({ ok: true, marked: rows.length });
    }

    // Employee answers "Are you still working online?" - postpones the automatic punch-out
    if (action === 'work_confirm') {
      const at = nowIso();
      const updated = await confirmOpenWork(me.id, at);
      if (!updated.length) throw bad('You are not punched in right now.');
      if (!updated.every((r) => r.work_confirmed_at)) {
        throw new HttpError(409, 'Your attendance record changed before confirmation. Refresh your attendance and try again.', 'WORK_CONFIRM_NOT_SAVED');
      }
      // Saving the confirmation is the critical operation. Clearing reminder badges is
      // secondary and must not turn a successful confirmation into a reported failure.
      try {
        const asks = (await myNotifications(me.id)).filter((n) => !n.read_at && n.category === 'reminder' && /-(end|ask-\d+-\d+)$/.test(String(n.id)));
        if (asks.length) await upsert('crm_notifications', asks.map((n) => ({ ...n, read_at: at })));
      } catch (notificationError) {
        console.warn('Overtime confirmed, but reminder notifications could not be marked read:', notificationError?.message);
      }
      return res.status(200).json({ ok: true, confirmedAt: updated[0].work_confirmed_at });
    }

    // ---------------------------------------------------------------- customers
    if (action === 'customer_save') {
      const c = body.customer || {};
      const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean);
      if (destinations.length > 30) throw bad('Too many destinations (max 30).');
      const description = str(c.description, 2000, { name: 'Customer description' });
      const fields = {
        customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }),
        company_name: str(c.companyName, 160, { name: 'Company name' }),
        destinations,
        customer_number: str(c.customerNumber, 60, { name: 'Customer number' }),
        acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
        acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }),
        updated_at: nowIso(),
      };
      // Only the person who added the customer (or Admin / CEO / Accounts) decides who else may see it.
      const staffList = await activeEmployees();
      const sharedWith = [...new Set(cleanSharedIds(c.sharedWith).map(String))].slice(0, 100);
      for (const sid of sharedWith) if (!staffList.some((e) => e.id === sid)) throw bad('One of the employees chosen to see this customer was not found or is no longer active.');
      if (c.id) {
        const existing = await getOne('crm_customers', c.id);
        if (!existing || existing.deleted_at) throw notFound('Customer not found.');
        if (!seeAllCust && existing.created_by !== me.id) throw forbidden('You can only change customers you added.');
        const cleanNewShared = sharedWith.filter((x) => x !== existing.created_by);
        const upd = { ...existing, ...fields, shared_with: packSharedWith(cleanNewShared, description) };
        await upsert('crm_customers', upd);
        const prevShared = cleanSharedIds(existing.shared_with);
        const newlyShared = cleanNewShared.filter((x) => !prevShared.includes(x) && x !== me.id);
        if (newlyShared.length) await notify(newlyShared, 'followup', existing.id, `${me.name || 'A colleague'} shared customer ${fields.customer_name} with you.`, me.id);
        return res.status(200).json({ ok: true, customer: mapCustomer(upd) });
      }
      const cleanNewShared = sharedWith.filter((x) => x !== me.id);
      const row = { id: id('cus'), ...fields, shared_with: packSharedWith(cleanNewShared, description), created_by: me.id, created_at: nowIso(), deleted_at: null };
      if (cleanNewShared.length) await notify(cleanNewShared, 'followup', row.id, `${me.name || 'A colleague'} shared customer ${fields.customer_name} with you.`, me.id);
      await upsert('crm_customers', row);
      return res.status(200).json({ ok: true, customer: mapCustomer(row) });
    }

    if (action === 'customer_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a customer.');
      const existing = await getOne('crm_customers', body.id);
      if (!existing) throw notFound('Customer not found.');
      await upsert('crm_customers', { ...existing, deleted_at: nowIso(), updated_at: nowIso() });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- follow-ups
    // When a Meeting follow-up with the CEO gets a time that clashes with another booking, the CEO and admins are told right away.
    const followupOverlaps = async (row) => {
      if (row.kind !== 'meeting' || !row.due_at || !OPEN.includes(row.status || 'pending')) return [];
      const ceoIds = await ceoIdList();
      if (![row.assigned_to, row.created_by, ...asArray(row.participant_ids)].some((x) => ceoIds.includes(x))) return [];
      const start = Date.parse(row.due_at);
      const clashes = await findCeoOverlaps(start, start + FOLLOWUP_SLOT_MS, { exceptFollowupId: row.id });
      await notifyOverlap(row.id, 'a meeting follow-up', start, clashes, null);
      return clashes.map((c) => ({ title: c.title, startAt: new Date(c.start).toISOString(), endAt: new Date(c.end).toISOString() }));
    };

    if (action === 'followup_save') {
      const f = body.followup || {};
      const kind = String(f.kind || '');
      if (!KINDS.includes(kind)) throw bad('Choose a follow-up type.');
      await assertEmployee(String(f.assignedTo || ''), 'The employee for this follow-up');
      // The customer is optional. It can be an existing one, or a new one typed in right here.
      let customer = null;
      let newCustomerRow = null;
      const existingFu = f.id ? await getOne('crm_followups', f.id) : null;
      if (f.customerId) {
        customer = await getOne('crm_customers', f.customerId);
        if (!customer || customer.deleted_at) throw bad('The selected customer was not found.');
        if (f.customerId !== existingFu?.customer_id && !canSeeCust(customer)) throw forbidden('You can only use customers you added or that were shared with you.');
      } else if (f.newCustomer && String(f.newCustomer.customerName || '').trim()) {
        const c = f.newCustomer;
        const destinations = asArray(c.destinations).map((d) => str(d, 100)).filter(Boolean).slice(0, 30);
        const newDesc = str(c.description, 2000, { name: 'Customer description' });
        newCustomerRow = {
          id: id('cus'), customer_name: str(c.customerName, 120, { required: true, name: 'Customer name' }), company_name: str(c.companyName, 160, { name: 'Company name' }),
          destinations, customer_number: str(c.customerNumber, 60, { name: 'Customer number' }), acquired_through: str(c.acquiredThrough, 120, { name: 'Acquired through' }),
          acquired_by: str(c.acquiredBy, 80, { name: 'Acquired by' }), shared_with: packSharedWith([], newDesc), created_by: me.id, created_at: nowIso(), updated_at: nowIso(), deleted_at: null,
        };
        customer = newCustomerRow;
      }
      // Optional extra employees who also see this follow-up and are notified.
      const staff = await activeEmployees();
      const participantIds = [...new Set(asArray(f.participantIds).map(String))].filter((p) => p !== String(f.assignedTo));
      if (participantIds.length > 30) throw bad('Too many extra employees (max 30).');
      for (const p of participantIds) if (!staff.some((e) => e.id === p)) throw bad('One of the extra employees was not found or is no longer active.');
      const fields = {
        customer_id: customer ? customer.id : null, kind, assigned_to: String(f.assignedTo), participant_ids: participantIds,
        subject: str(f.subject, 180, { name: 'Subject' }), remarks: str(f.remarks, 4000, { name: 'Remarks' }), due_at: isoOrNull(f.dueAt, 'Due date'), updated_at: nowIso(),
      };
      if (!customer && !fields.remarks) throw bad('Without a customer, please type the follow-up remarks so it can be identified.');
      if (kind === 'internal' && !str(f.subject, 180, { required: true, name: 'Subject' })) throw bad('Enter a subject for this internal follow-up.');
      const label = KIND_LABEL[kind];
      const forWhom = customer ? ` for ${customer.customer_name}` : '';
      if (newCustomerRow) await upsert('crm_customers', newCustomerRow);
      if (f.id) {
        const existing = await getOne('crm_followups', f.id);
        if (!existing) throw notFound('Follow-up not found.');
        if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who created this follow-up (or an administrator) can change it.');
        if (!OPEN.includes(existing.status)) throw bad('This follow-up is already closed.');
        const row = { ...existing, ...fields };
        await upsert('crm_followups', row);
        if (existing.assigned_to !== fields.assigned_to) await notify([fields.assigned_to], 'followup', row.id, `${label}${forWhom} was assigned to you.`, me.id);
        const addedPeople = participantIds.filter((p) => !asArray(existing.participant_ids).includes(p));
        await notify(addedPeople, 'followup', row.id, `You were added to a ${label.toLowerCase()}${forWhom}.`, me.id);
        const overlaps = await followupOverlaps(row);
        return res.status(200).json({ ok: true, followup: mapFollowup(row), customer: newCustomerRow ? mapCustomer(newCustomerRow) : undefined, overlaps });
      }
      const row = { id: id('fup'), ...fields, status: 'pending', outcome_remarks: '', history: [], created_by: me.id, created_at: nowIso(), completed_at: null };
      await upsert('crm_followups', row);
      await notify([fields.assigned_to], 'followup', row.id, `${label}${forWhom} was assigned to you.`, me.id);
      await notify(participantIds, 'followup', row.id, `You were added to a ${label.toLowerCase()}${forWhom}.`, me.id);
      const overlaps = await followupOverlaps(row);
      return res.status(200).json({ ok: true, followup: mapFollowup(row), customer: newCustomerRow ? mapCustomer(newCustomerRow) : undefined, overlaps });
    }

    if (action === 'followup_outcome') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      if (existing.assigned_to !== me.id && existing.created_by !== me.id && !isAdmin) throw forbidden('Only the person who created this follow-up, the assigned employee, an administrator or the CEO can close or update it.');
      const outcome = String(body.outcome || '');
      if (!OUTCOMES.includes(outcome)) throw bad('Choose Completed, Not completed or Rescheduled.');
      const remarks = str(body.remarks, 4000, { name: 'Remarks' });
      const newDue = outcome === 'rescheduled' ? isoOrNull(body.newDueAt, 'New date', { required: true }) : existing.due_at;
      const at = nowIso();
      const history = [...asArray(existing.history), { at, by: me.id, outcome, remarks, dueAt: newDue }];
      const row = {
        ...existing, status: outcome, outcome_remarks: remarks, due_at: newDue, history, updated_at: at,
        completed_at: outcome === 'rescheduled' ? null : at,
      };
      await upsert('crm_followups', row);
      if (outcome === 'rescheduled') await followupOverlaps(row);
      const customer = existing.customer_id ? await getOne('crm_customers', existing.customer_id) : null;
      const words = { completed: 'completed', not_completed: 'could not be completed', rescheduled: 'was rescheduled' }[outcome];
      await notify([existing.created_by, ...(await adminIds())], 'followup', row.id, `Follow-up${customer ? ` for ${customer.customer_name}` : ''} ${words}.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row) });
    }

    // Everyone on a follow-up (creator, assigned, added/tagged people, admin, CEO) can add their own remarks; they are kept permanently.
    if (action === 'followup_remark') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      const involved = existing.created_by === me.id || existing.assigned_to === me.id || asArray(existing.participant_ids).includes(me.id);
      if (!involved && !isAdmin) throw forbidden('Only people on this follow-up can add remarks.');
      const text = str(body.text, 2000, { required: true, name: 'Remark' });
      const at = nowIso();
      const entry = { id: id('rmk'), at, by: me.id, text };
      const remarkLog = [...asArray(existing.remark_log), entry].slice(-500);
      const row = { ...existing, remark_log: remarkLog, updated_at: at };
      await upsert('crm_followups', row);
      const customer = existing.customer_id ? await getOne('crm_customers', existing.customer_id) : null;
      const others = [existing.created_by, existing.assigned_to, ...asArray(existing.participant_ids)].filter((x) => x && x !== me.id);
      await notify([...new Set(others)], 'followup', row.id, `${me.name || 'Someone'} added a remark on the follow-up${customer ? ` for ${customer.customer_name}` : ''}.`, me.id);
      return res.status(200).json({ ok: true, followup: mapFollowup(row) });
    }

    if (action === 'followup_delete') {
      const existing = await getOne('crm_followups', body.id);
      if (!existing) throw notFound('Follow-up not found.');
      if (!isAdmin && existing.created_by !== me.id) throw forbidden('Only the person who created this follow-up (or an administrator) can delete it.');
      await supabaseFetch(`/crm_followups?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ------------------------------------------------------------------ meetings
    // Administrator sets up a CEO meeting (with colleagues and/or outside people) and the colleagues are notified.
    // A CEO meeting that lands on a time already taken by a Meeting follow-up tells the CEO and admins.
    const meetingVsFollowups = async (row) => {
      if (row.status !== 'scheduled') return;
      const clashes = (await findCeoOverlaps(Date.parse(row.start_at), Date.parse(row.end_at), { exceptMeetingId: row.id })).filter((c) => !String(c.title).startsWith('CEO meeting'));
      await notifyOverlap(row.id, `CEO meeting "${row.title}"`, Date.parse(row.start_at), clashes, null);
    };

    if (action === 'meeting_note_add') {
      const existing = await getOne('crm_meetings', body.id);
      if (!existing) throw notFound('Meeting not found.');
      if (!(isAdmin || existing.created_by === me.id || existing.requested_by === me.id || asArray(existing.attendee_ids).includes(me.id))) throw forbidden('Only meeting participants can add updates.');
      const note = str(body.text, 4000, { required: true, name: 'Meeting update' });
      const noteLog = [...asArray(existing.note_log), { id: id('mnote'), at: nowIso(), by: me.id, text: note }];
      const row = { ...existing, note_log: noteLog, updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await notify([...new Set([existing.created_by, existing.requested_by, ...asArray(existing.attendee_ids)].filter(Boolean).filter((x) => x !== me.id))], 'meeting', row.id, `New meeting update added to: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    if (action === 'meeting_save') {
      if (!isAdmin) throw forbidden('Only an administrator can set up CEO meetings. You can request a slot instead.');
      const m = body.meeting || {};
      const fields = readMeetingInput(m);
      const attendeeIds = [...new Set(asArray(m.attendeeIds).map(String))];
      const staff = await activeEmployees();
      for (const a of attendeeIds) if (!staff.some((e) => e.id === a)) throw bad('One of the selected employees is not active.');
      if (fields.customer_id) {
        const c = await getOne('crm_customers', fields.customer_id);
        if (!c || c.deleted_at) throw bad('The selected customer was not found.');
      }
      if (m.id) {
        const existing = await getOne('crm_meetings', m.id);
        if (!existing) throw notFound('Meeting not found.');
        await assertSlotFree(fields.start_at, fields.end_at, existing.id);
        const row = { ...existing, ...fields, attendee_ids: attendeeIds, status: existing.status === 'pending_approval' ? 'pending_approval' : 'scheduled', updated_at: nowIso() };
        await upsert('crm_meetings', row);
        await meetingVsFollowups(row);
        const added = attendeeIds.filter((a) => !asArray(existing.attendee_ids).includes(a));
        await notify(added, 'meeting', row.id, `You were added to a CEO meeting: ${row.title}.`, me.id);
        await notify(asArray(existing.attendee_ids).filter((a) => attendeeIds.includes(a)), 'meeting', row.id, `CEO meeting updated: ${row.title}.`, me.id);
        return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
      }
      await assertSlotFree(fields.start_at, fields.end_at);
      const row = { id: id('mtg'), ...fields, attendee_ids: attendeeIds, status: 'scheduled', requested_by: null, decided_by: null, decision_note: '', created_by: me.id, created_at: nowIso(), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await meetingVsFollowups(row);
      await notify(attendeeIds, 'meeting', row.id, `You were added to a CEO meeting: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    // Any employee can ask for their own slot with the CEO; the administrator decides.
    if (action === 'meeting_request') {
      const fields = readMeetingInput(body.meeting || {});
      if (fields.customer_id) {
        const cu = await getOne('crm_customers', fields.customer_id);
        if (!cu || cu.deleted_at) throw bad('The selected customer was not found.');
        if (!canSeeCust(cu)) throw forbidden('You can only use customers you added or that were shared with you.');
      }
      if (Date.parse(fields.start_at) < Date.now() - 5 * 60 * 1000) throw bad('Please choose a time in the future.');
      await assertSlotFree(fields.start_at, fields.end_at);
      const row = { id: id('mtg'), ...fields, attendee_ids: [me.id], status: 'pending_approval', requested_by: me.id, decided_by: null, decision_note: '', created_by: me.id, created_at: nowIso(), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      await notify(await adminIds(), 'meeting', row.id, `${me.name || 'An employee'} requested a CEO meeting: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    if (action === 'meeting_decide') {
      if (!isAdmin) throw forbidden('Only an administrator can approve or reject meeting requests.');
      const existing = await getOne('crm_meetings', body.id);
      if (!existing) throw notFound('Meeting not found.');
      if (existing.status !== 'pending_approval') throw bad('This request has already been decided.');
      const approve = body.approve === true;
      if (approve) await assertSlotFree(existing.start_at, existing.end_at, existing.id);
      const row = { ...existing, status: approve ? 'scheduled' : 'rejected', decided_by: me.id, decision_note: str(body.note, 1000, { name: 'Note' }), updated_at: nowIso() };
      await upsert('crm_meetings', row);
      if (approve) await meetingVsFollowups(row);
      await notify([existing.requested_by], 'meeting', row.id, approve ? `Your CEO meeting request was approved: ${row.title}.` : `Your CEO meeting request was not approved: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    if (action === 'meeting_cancel' || action === 'meeting_complete') {
      const existing = await getOne('crm_meetings', body.id);
      if (!existing) throw notFound('Meeting not found.');
      if (action === 'meeting_complete' && !isAdmin) throw forbidden('Only an administrator can close a meeting.');
      if (action === 'meeting_cancel' && !isAdmin && existing.requested_by !== me.id) throw forbidden('Only an administrator or the person who requested it can cancel this meeting.');
      const status = action === 'meeting_cancel' ? 'cancelled' : 'completed';
      const row = { ...existing, status, updated_at: nowIso() };
      await upsert('crm_meetings', row);
      if (status === 'cancelled') await notify(asArray(existing.attendee_ids), 'meeting', row.id, `CEO meeting cancelled: ${row.title}.`, me.id);
      return res.status(200).json({ ok: true, meeting: mapMeeting(row) });
    }

    // ---------------------------------------------------------------- inventory requests
    if (action === 'inventory_item_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add inventory products.');
      const newItem = str(body.item, 80, { required: true, name: 'Product name' });
      const row = await getOne('crm_company', 'inventory_catalog');
      const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter(Boolean);
      const removed = asArray(row?.data?.removedItems).map((x) => String(x || '').trim()).filter((x) => x.toLowerCase() !== newItem.toLowerCase());
      if (![...DEFAULT_INVENTORY_ITEMS, ...custom].some((x) => x.toLowerCase() === newItem.toLowerCase())) {
        custom.push(newItem);
      }
      await upsert('crm_company', { id: 'inventory_catalog', data: { customItems: custom, removedItems: removed }, updated_at: nowIso() });
      const inventoryItems = await getInventoryCatalog();
      return res.status(200).json({ ok: true, inventoryItems });
    }

    if (action === 'inventory_item_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove inventory products.');
      const target = str(body.item, 80, { required: true, name: 'Product name' });
      const row = await getOne('crm_company', 'inventory_catalog');
      const custom = asArray(row?.data?.customItems).map((x) => String(x || '').trim()).filter((x) => x && x.toLowerCase() !== target.toLowerCase());
      const removed = asArray(row?.data?.removedItems).map((x) => String(x || '').trim()).filter(Boolean);
      if (DEFAULT_INVENTORY_ITEMS.some((x) => x.toLowerCase() === target.toLowerCase()) && !removed.some((x) => x.toLowerCase() === target.toLowerCase())) {
        removed.push(target);
      }
      await upsert('crm_company', { id: 'inventory_catalog', data: { customItems: custom, removedItems: removed }, updated_at: nowIso() });
      const inventoryItems = await getInventoryCatalog();
      return res.status(200).json({ ok: true, inventoryItems });
    }

    // Any employee requests items from the catalog (with quantities) and assigns it to an Accounts or Admin employee.
    if (action === 'inventory_save') {
      const r = body.request || {};
      const catalog = await getInventoryCatalog();
      const catalogByLower = new Map(catalog.map((x) => [x.toLowerCase(), x]));
      const merged = new Map();
      for (const line of asArray(r.items)) {
        const rawItem = String(line?.item || '').trim();
        const canonical = catalogByLower.get(rawItem.toLowerCase());
        if (!canonical) throw bad('Only items from the inventory list can be requested.');
        const qty = Number(line?.qty);
        if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw bad('Each quantity must be a whole number from 1 to 999.');
        merged.set(canonical, (merged.get(canonical) || 0) + qty);
      }
      if (!merged.size) throw bad('Add at least one item.');
      const items = [...merged].map(([item, qty]) => ({ item, qty: Math.min(999, qty) }));
      const staff = await activeEmployees();
      const assignee = staff.find((e) => e.id === String(r.assignedTo || ''));
      if (!assignee || !['accounts', 'admin'].includes(assignee.role)) throw bad('Assign the request to an Accounts or Admin employee.');
      const at = nowIso();
      const row = { id: id('inv'), requested_by: me.id, assigned_to: assignee.id, items, note: str(r.note, 1000, { name: 'Note' }), status: 'pending', decision_remarks: '', decided_by: null, created_at: at, updated_at: at };
      await upsert('crm_inventory_requests', row);
      const summary = items.map((i) => `${i.qty} x ${i.item}`).join(', ');
      await notify([assignee.id, ...(await adminIds())], 'inventory', row.id, `${me.name || 'An employee'} requested inventory: ${summary}.`, me.id);
      return res.status(200).json({ ok: true, request: mapInventory(row) });
    }

    if (action === 'inventory_decide') {
      const existing = await getOne('crm_inventory_requests', body.id);
      if (!existing) throw notFound('Request not found.');
      if (existing.assigned_to !== me.id && !isAdmin) throw forbidden('Only the person this request is assigned to (or an administrator) can update it.');
      const status = String(body.status || '');
      if (!INVENTORY_STATUSES.includes(status)) throw bad('Choose Approved, Rejected or Delivered.');
      if (['rejected', 'delivered'].includes(existing.status)) throw bad('This request is already closed.');
      const row = { ...existing, status, decision_remarks: str(body.remarks, 1000, { name: 'Remarks' }), decided_by: me.id, updated_at: nowIso() };
      await upsert('crm_inventory_requests', row);
      const words = { approved: 'was approved', rejected: 'was rejected', delivered: 'was delivered' }[status];
      await notify([existing.requested_by], 'inventory', row.id, `Your inventory request ${words}.`, me.id);
      await notify(await adminIds(), 'inventory', row.id, `${me.name || 'Someone'} marked an inventory request as ${status}.`, me.id);
      return res.status(200).json({ ok: true, request: mapInventory(row) });
    }

    if (action === 'inventory_delete') {
      const existing = await getOne('crm_inventory_requests', body.id);
      if (!existing) throw notFound('Request not found.');
      if (!isAdmin && !(existing.requested_by === me.id && existing.status === 'pending')) throw forbidden('You can only withdraw your own request while it is still pending.');
      await supabaseFetch(`/crm_inventory_requests?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- sales coupons
    // Any employee generates a coupon; Accounts / Admin review it (approve or decline) and mark it paid or unpaid.
    if (String(action).startsWith('sale_') && !canSales) throw forbidden('You do not have access to Sales. Ask an administrator.');
    if (action === 'sale_save') {
      const x = body.sale || {};
      const saleType = String(x.saleType || '');
      if (!SALE_TYPES[saleType]) throw bad('Choose a sale type.');
      const otherType = saleType === 'others' ? str(x.otherType, 80, { required: true, name: 'Sale type (Others)' }) : '';
      const money = (v, label) => {
        const n = Number(v);
        if (v === '' || v === null || v === undefined || !Number.isFinite(n)) throw bad(`${label} is required (numbers only).`);
        if (Math.abs(n) > 9999999999) throw bad(`${label} is too large.`);
        return Math.round(n * 100) / 100;
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!CURRENCIES.includes(currency)) throw bad('Choose a currency from the list.');
      const costAmount = money(x.costAmount, 'Cost amount');
      const saleAmount = money(x.saleAmount, 'Sale amount');
      const psfProfit = money(x.psfProfit, 'PSF / Profit');
      if (costAmount < 0 || saleAmount < 0) throw bad('Cost and sale amounts cannot be negative.');
      const couponNo = await supabaseFetch('/rpc/crm_next_sale_no', { method: 'POST', body: '{}' });
      const at = nowIso();
      const row = {
        id: id('sale'), coupon_no: String(couponNo), created_by: me.id, sale_type: saleType, other_type: otherType,
        customer_name: str(x.customerName, 160, { required: true, name: 'Customer name' }),
        vendor_name: str(x.vendorName, 160, { required: true, name: 'Vendor name' }),
        package_details: str(x.packageDetails, 2000, { required: true, name: 'Package details' }),
        pax_name: str(x.paxName, 400, { required: true, name: 'PAX name' }),
        currency, cost_amount: costAmount, sale_amount: saleAmount,
        query_code: str(x.queryCode, 80, { required: true, name: 'Query code' }), psf_profit: psfProfit,
        status: 'pending', payment_status: 'unpaid', review_remarks: '', reviewed_by: null, reviewed_at: null, created_at: at, updated_at: at,
      };
      await upsert('crm_sales', row);
      const kind = saleType === 'others' ? otherType : SALE_TYPES[saleType];
      await notify(await salesStaffIds(), 'sale', row.id, `${me.name || 'An employee'} generated sales coupon ${row.coupon_no} (${kind}, ${currency} ${saleAmount}).`, me.id);
      return res.status(200).json({ ok: true, sale: mapSale(row) });
    }

    if (action === 'sale_decide' || action === 'sale_payment') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only the Accounts Officer (or an administrator) can review sales coupons.');
      const existing = await getOne('crm_sales', body.id);
      if (!existing) throw notFound('Coupon not found.');
      const at = nowIso();
      let row; let message;
      if (action === 'sale_decide') {
        const status = String(body.status || '');
        if (!['approved', 'declined', 'pending'].includes(status)) throw bad('Choose Approve or Decline.');
        row = { ...existing, status, review_remarks: str(body.remarks, 1000, { name: 'Remarks' }), reviewed_by: me.id, reviewed_at: at, updated_at: at };
        if (status === 'declined') row.payment_status = 'unpaid';
        message = status === 'approved' ? `Your sales coupon ${existing.coupon_no} was approved.` : status === 'declined' ? `Your sales coupon ${existing.coupon_no} was declined.` : `Your sales coupon ${existing.coupon_no} was sent back to pending.`;
      } else {
        const pay = String(body.paymentStatus || '');
        if (!['paid', 'unpaid'].includes(pay)) throw bad('Choose Paid or Not paid.');
        if (existing.status !== 'approved') throw bad('Approve the coupon before marking it paid.');
        row = { ...existing, payment_status: pay, reviewed_by: me.id, reviewed_at: at, updated_at: at };
        message = `Your sales coupon ${existing.coupon_no} was marked ${pay === 'paid' ? 'PAID' : 'NOT PAID'}.`;
      }
      await upsert('crm_sales', row);
      await notify([existing.created_by], 'sale', row.id, message, me.id);
      return res.status(200).json({ ok: true, sale: mapSale(row) });
    }

    if (action === 'sale_delete') {
      const existing = await getOne('crm_sales', body.id);
      if (!existing) throw notFound('Coupon not found.');
      if (!isAdmin && !(existing.created_by === me.id && existing.status === 'pending')) throw forbidden('You can only withdraw your own coupon while it is still pending.');
      await supabaseFetch(`/crm_sales?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- invoices
    if (action === 'company_save') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can change the company details.');
      const c = body.company || {};
      const data = {
        name: str(c.name, 160, { required: true, name: 'Company name' }), payTo: str(c.payTo, 160, { name: 'Cheque payee' }), ntn: str(c.ntn, 60, { name: 'NTN' }),
        address: str(c.address, 400, { name: 'Address' }), phone: str(c.phone, 80, { name: 'Phone' }), email: str(c.email, 120, { name: 'Email' }),
        website: str(c.website, 120, { name: 'Website' }), bankDetails: str(c.bankDetails, 600, { name: 'Bank details' }), terms: str(c.terms, 1200, { name: 'Terms' }),
        footer: str(c.footer, 200, { name: 'Footer line' }),
      };
      await upsert('crm_company', { id: 'main', data, updated_at: nowIso() });
      return res.status(200).json({ ok: true, company: { ...DEFAULT_COMPANY, ...data } });
    }

    if (action === 'portal_config_get') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can open the Customer Portal settings.');
      const row = await getOne('crm_company', 'portal-config');
      return res.status(200).json({ ok: true, config: mergePortalConfig(parseJsonObj(row?.data, {}), {}).config });
    }

    if (action === 'portal_config_save') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can change the Customer Portal settings.');
      const c = body.config || {};
      const row = await getOne('crm_company', 'portal-config');
      const prev = parseJsonObj(row?.data, {});
      const { config: next, changed } = mergePortalConfig(prev, c);
      if (c.whatsappNumber !== undefined || c.whatsappMessage !== undefined) {
        const rawNumber = str(c.whatsappNumber ?? prev.whatsappNumber ?? '', 30, { name: 'WhatsApp number' });
        let digits = rawNumber.replace(/\D+/g, '');
        if (/^0[1-9]/.test(digits)) digits = `92${digits.slice(1)}`; // a local Pakistani number like 0300… becomes +92 300…
        if (digits && (digits.length < 8 || digits.length > 15)) throw bad('Enter the WhatsApp number with country code, e.g. +92 300 1234567.');
        next.whatsappNumber = digits ? `+${digits}` : '';
        next.whatsappMessage = str(c.whatsappMessage ?? prev.whatsappMessage ?? '', 300, { name: 'WhatsApp message' }) || DEFAULT_PORTAL_CONFIG.whatsappMessage;
        changed.push('WhatsApp contact');
      }
      next.updatedAt = nowIso();
      next.updatedBy = me.id;
      await upsert('crm_company', { id: 'portal-config', data: next, updated_at: next.updatedAt });
      if (changed.length) await logPortalActivity(me, `Changed portal settings: ${changed.join(', ')}`);
      return res.status(200).json({ ok: true, config: next });
    }

    if (action === 'portal_overview') {
      if (!isAdmin) throw forbidden('Only Admin or the CEO can open the Customer Portal statistics.');
      const [statsRow, actRow] = await Promise.all([getOne('crm_company', 'portal-stats'), getOne('crm_company', 'portal-activity')]);
      return res.status(200).json({ ok: true, stats: parseJsonObj(statsRow?.data, {}), activity: asArray(parseJsonObj(actRow?.data, {}).items) });
    }

    if (action === 'portal_invoice_save') {
      if (!isAdmin && !hasPortalAccess(me)) throw forbidden('Customer Portal access is only for Admin or employees an admin has allowed.');
      const invId = str(body.invoiceId, 100, { required: true, name: 'Invoice' });
      const inv = await getOne('crm_invoices', invId);
      if (!inv) throw notFound('Invoice not found.');
      const rowId = `pinv-${invId}`;
      const prevRow = await getOne('crm_company', rowId);
      const prev = parseJsonObj(prevRow?.data, {});
      const note = cleanText(body.note, 400);
      const data = {
        hideAmounts: body.hideAmounts === true,
        disabled: body.disabled === true,
        expiresAt: cleanDate(body.expiresAt),
        note,
        noteAt: note ? (note !== (prev.note || '') ? nowIso() : prev.noteAt || nowIso()) : '',
        updatedBy: me.id,
        updatedAt: nowIso(),
      };
      const isDefault = !data.hideAmounts && !data.disabled && !data.expiresAt && !data.note;
      if (isDefault) {
        if (prevRow) await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(rowId)}`, { method: 'DELETE' });
      } else {
        await upsert('crm_company', { id: rowId, data, updated_at: data.updatedAt });
      }
      const bits = [];
      if (data.hideAmounts !== Boolean(prev.hideAmounts)) bits.push(data.hideAmounts ? 'amounts hidden' : 'amounts shown');
      if (data.disabled !== Boolean(prev.disabled)) bits.push(data.disabled ? 'tracking turned off' : 'tracking turned on');
      if (data.expiresAt !== (prev.expiresAt || '')) bits.push(data.expiresAt ? `tracking expires ${data.expiresAt}` : 'expiry removed');
      if (note !== (prev.note || '')) bits.push(note ? 'message to customer updated' : 'message to customer removed');
      if (bits.length) await logPortalActivity(me, `Invoice ${inv.invoice_no || invId}: ${bits.join(', ')}`);
      return res.status(200).json({ ok: true, portalInvoice: isDefault ? null : data });
    }

    if (action === 'invoice_save') {
      const x = body.invoice || {};
      const existing = x.id ? await getOne('crm_invoices', x.id) : null;
      if (x.id && !existing) throw notFound('Invoice not found.');
      const kind = existing ? (existing.kind === 'vendor' ? 'vendor' : 'customer') : (x.kind === 'vendor' ? 'vendor' : 'customer');
      const vendorBill = kind === 'vendor';
      const usedKeys = new Set();
      const keyOf = (k, prefix) => {
        let v = /^[A-Za-z0-9_-]{1,40}$/.test(String(k || '')) ? String(k) : '';
        if (!v || usedKeys.has(v)) v = id(prefix);
        usedKeys.add(v);
        return v;
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose the invoice currency.');
      const money = (v, label, { min = 0 } = {}) => {
        const n = Number(v === '' || v === null || v === undefined ? 0 : v);
        if (!Number.isFinite(n) || n < min || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return n;
      };
      const taxRate = money(x.taxRate, 'Tax rate');
      if (taxRate > 100) throw bad('Tax rate cannot be more than 100%.');
      const sectionsIn = Array.isArray(x.sections) ? x.sections.slice(0, 30) : [];
      let subtotal = 0; let taxable = 0; let priced = 0;
      const sections = sectionsIn.map((sec, si) => {
        const lines = (Array.isArray(sec.lines) ? sec.lines : []).slice(0, 60).map((l, li) => {
          const description = str(l.description, 300, { required: true, name: `Section ${si + 1}, line ${li + 1} description` });
          const hasPrice = !(l.unitPrice === '' || l.unitPrice === null || l.unitPrice === undefined);
          if (!hasPrice) return { description, note: true, key: keyOf(l.key, 'ln'), locked: Boolean(l.locked) };
          const unitPrice = money(l.unitPrice, `Unit price of "${description}"`);
          const units = money(l.units === '' || l.units === undefined ? 1 : l.units, `Units of "${description}"`);
          const lineCur = String(l.currency || currency).toUpperCase();
          if (!/^[A-Z]{3}$/.test(lineCur)) throw bad(`Currency of "${description}" is not valid.`);
          let rate = 1;
          if (lineCur !== currency) {
            rate = Number(l.rate);
            if (!Number.isFinite(rate) || rate <= 0) throw bad(`Enter the exchange rate for "${description}" (1 ${lineCur} = ? ${currency}).`);
          }
          const amount = r2(unitPrice * units * rate);
          subtotal += amount; priced++;
          if (l.taxable) taxable += amount;
          return { description, unitPrice, units, currency: lineCur, rate, amount, taxable: Boolean(l.taxable), key: keyOf(l.key, 'ln'), locked: Boolean(l.locked) };
        });
        return { title: str(sec.title, 160, { name: 'Section title' }), key: keyOf(sec.key, 'sec'), locked: Boolean(sec.locked), lines };
      }).filter((sec) => sec.title || sec.lines.length);
      if (!priced) throw bad('Add at least one priced line to the invoice.');
      // Save & lock: lines saved as locked cannot be changed or removed by the person who made the invoice, or by Accounts; new lines can always be added.
      // Admin / CEO may unlock a section or line (and then edit it); anything they leave locked stays locked.
      if (existing && !isAdmin) {
        const sig = (l) => JSON.stringify([l.description, Boolean(l.note), l.unitPrice ?? null, l.units ?? null, l.currency ?? null, l.rate ?? null, Boolean(l.taxable)]);
        const newLineByKey = new Map();
        sections.forEach((sec) => sec.lines.forEach((l) => newLineByKey.set(l.key, { sec, l })));
        const newSecByKey = new Map(sections.map((sec) => [sec.key, sec]));
        for (const ps of Array.isArray(existing.sections) ? existing.sections : []) {
          if (ps.locked) {
            const ns = ps.key && newSecByKey.get(ps.key);
            if (!ns || ns.title !== ps.title) throw bad('A saved & locked section cannot be changed or removed. Ask an administrator to unlock it.');
            ns.locked = true;
          }
          for (const pl of ps.lines || []) {
            if (!pl.locked) continue;
            const f = pl.key && newLineByKey.get(pl.key);
            if (!f || f.sec.key !== ps.key || sig(f.l) !== sig(pl)) throw bad('A saved & locked line cannot be changed or removed. You can add new lines, or ask an administrator to unlock it.');
            f.l.locked = true;
          }
        }
      }
      const discount = money(x.discount, 'Discount');
      let advancePaid = money(x.advancePaid, 'Advance received');
      const taxAmount = r2(taxable * taxRate / 100);
      const total = r2(subtotal + taxAmount - discount);
      if (total < 0) throw bad('The discount is larger than the invoice total.');
      let balance = r2(Math.max(0, total - advancePaid));
      const dateOnly = (v, name, required) => {
        const d = String(v || '').slice(0, 10);
        if (!d) { if (required) throw bad(`${name} is required.`); return null; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw bad(`${name} is not a valid date.`);
        return d;
      };
      const crmQuery = str(x.crmId || x.queryCode, 80, { name: 'CRM ID / Query Code' });
      // Payment history: several payments received at different times, each with its own date. The running total is kept in advance_paid.
      let paymentsOut = null;
      let paymentsAdded = [];
      let paymentsRemoved = [];
      const attachedReceipts = new Map();
      if (!vendorBill && Array.isArray(x.payments)) {
        try {
          const wantedIds = [...new Set(x.payments.filter((p) => p && p.receiptId && !(existing ? paymentsOf(existing) : []).some((e) => e && e.id === p.id)).map((p) => String(p.receiptId)))];
          for (const rid of wantedIds) {
            const rc = await getOne('crm_receipts', rid);
            const problem = receiptProblem(rc, { invoiceId: existing?.id || '', invoiceCurrency: currency, customerName: str(x.customerName, 160), crmQuery, canSee: Boolean(rc) && (isAdmin || me.role === 'accounts' || rc.created_by === me.id) });
            if (problem) throw bad(problem);
            attachedReceipts.set(rid, rc);
          }
          const built = buildPayments({ existing: existing ? paymentsOf(existing) : [], incoming: x.payments, privileged: isAdmin || me.role === 'accounts', actor: me, nowIso: nowIso(), receipts: attachedReceipts });
          assertWithinTotal(built.payments, total);
          paymentsOut = built.payments; paymentsAdded = built.added; paymentsRemoved = built.removed;
        } catch (e) {
          if (e instanceof PaymentError) throw bad(e.message);
          throw e;
        }
        advancePaid = sumPayments(paymentsOut);
        balance = r2(Math.max(0, total - advancePaid));
      }
      // Vendors we pay for this invoice: office record only, never printed on the customer's PDF.
      const vendors = vendorBill ? [] : (Array.isArray(x.vendors) ? x.vendors.slice(0, 20) : []).map((v, vi) => {
        const name = str(v?.name, 160, { name: `Vendor ${vi + 1} name` });
        const description = str(v?.description, 300, { name: `Vendor ${vi + 1} description` });
        const bank = str(v?.bank, 600, { name: `Vendor ${vi + 1} bank account details` });
        const hasUnitPrice = !(v?.unitPrice === '' || v?.unitPrice === null || v?.unitPrice === undefined);
        const hasUnits = !(v?.units === '' || v?.units === null || v?.units === undefined);
        const hasAmount = !(v?.amount === '' || v?.amount === null || v?.amount === undefined);
        if (!name && !description && !bank && !hasAmount && !hasUnitPrice && !hasUnits) return null;
        if (!name) throw bad(`Enter the name of vendor ${vi + 1}.`);
        const vCur = String(v?.currency || currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(vCur)) throw bad(`Currency of vendor ${name} is not valid.`);
        const unitPrice = hasUnitPrice ? money(v.unitPrice, `Unit price for ${name}`) : null;
        const units = hasUnits ? money(v.units, `Units for ${name}`) : null;
        const computedAmt = unitPrice !== null ? r2(unitPrice * (units ?? 1)) : 0;
        const amount = hasAmount ? money(v.amount, `Payable to ${name}`) : computedAmt;
        const previous = asArray(existing?.vendors).find((p, pi) => (p.id || `legacy-${pi}`) === v.id);
        return { name, description, unitPrice, units, amount, currency: vCur, bank, id: previous?.id || id('vendor'), posted: Boolean(previous?.posted), postedAt: previous?.postedAt || null, postedBy: previous?.postedBy || null };
      }).filter(Boolean);
      const at = nowIso();
      const base = {
        customer_name: str(x.customerName, 160, { required: true, name: vendorBill ? 'Vendor name' : 'Customer name' }), customer_phone: str(x.customerPhone, 60, { name: 'Phone' }),
        customer_address: str(x.customerAddress, 400, { name: 'Address' }), customer_ntn: str(x.customerNtn, 60, { name: 'Customer NTN' }),
        // one box on the form: "CRM ID / Query Code" (kept in both columns so searches and reports find it either way)
        reference: str(x.reference, 120, { name: 'Reference' }), crm_id: crmQuery, query_code: crmQuery,
        ntn: str(x.ntn, 60, { name: 'NTN' }), show_ntn: x.showNtn !== false, vendors, invoice_date: dateOnly(x.invoiceDate, 'Invoice date', true), due_date: dateOnly(x.dueDate, 'Due date', false), travel_date: vendorBill ? null : dateOnly(x.travelDate, 'Travel date', false),
        currency, sections, travelers: asArray(x.travelers).map((name) => str(name, 120, { name: 'Traveler name' })).filter(Boolean).slice(0, 100), tax_label: str(x.taxLabel, 40, { name: 'Tax label' }) || 'Tax', tax_rate: taxRate, discount, advance_paid: advancePaid, ...(paymentsOut ? { payments: paymentsOut } : {}),
        subtotal: r2(subtotal), tax_amount: taxAmount, total, balance, notes: str(x.notes, 1500, { name: 'Notes' }),
        payment_received: existing ? (existing.created_by === me.id && existing.status === 'unpaid' ? Boolean(x.paymentReceived) : Boolean(existing.payment_received)) : Boolean(x.paymentReceived),
        payment_received_at: existing ? (existing.created_by === me.id && existing.status === 'unpaid' ? (x.paymentReceived ? (existing.payment_received_at || at) : null) : existing.payment_received_at) : (x.paymentReceived ? at : null),
        payment_received_by: existing ? (existing.created_by === me.id && existing.status === 'unpaid' ? (x.paymentReceived ? me.id : null) : existing.payment_received_by) : (x.paymentReceived ? me.id : null),
        payment_received_auto: existing ? Boolean(existing.payment_received_auto) : false,
      };
      if (existing && !canEditFinancialRecord(me.role, me.id, existing.created_by, 'invoice', existing.status)) {
        throw forbidden('You can only edit your own unpaid invoices.');
      }
      const betaEnabled = await isCustomerPortalBetaEnabled();
      let visaOp = null; // null | 'delete' | 'upsert'
      let visaObj = null;
      if (betaEnabled && !vendorBill) {
        const autoVisa = hasVisaKeyword(sections, base.reference, base.notes);
        const autoHotel = hasHotelKeyword(sections, base.reference, base.notes);
        const autoTicket = hasTicketKeyword(sections, base.reference, base.notes);
        const autoTransfer = hasTransferKeyword(sections, base.reference, base.notes);
        const autoInsurance = hasInsuranceKeyword(sections, base.reference, base.notes);
        const detectedHotelName = extractSmartHotelName(sections, base.reference, base.notes);
        if (x.visaProgress === undefined) {
          const existingVisaRow = existing ? await getOne('crm_company', `visa-${existing.id}`) : null;
          const existingVp = existingVisaRow
            ? formatVisaProgress(existingVisaRow.data, existingVisaRow.updated_at || null)
            : null;
          if (existingVp) {
            visaObj = normalizeVisaProgress(
              {
                ...existingVp,
                enabled: existingVp.enabled || autoVisa,
                hotelEnabled: existingVp.hotelEnabled || autoHotel,
                hotelName: existingVp.hotelName || detectedHotelName || null,
                ticketEnabled: existingVp.ticketEnabled || autoTicket,
                transferEnabled: existingVp.transferEnabled || autoTransfer,
                insuranceEnabled: existingVp.insuranceEnabled || autoInsurance,
              },
              existingVp
            );
            visaOp = 'upsert';
          } else if (autoVisa || autoHotel || autoTicket || autoTransfer || autoInsurance) {
            visaObj = normalizeVisaProgress(
              {
                enabled: autoVisa,
                status: 'not_started',
                inProgressDate: null,
                issuedDate: null,
                hotelEnabled: autoHotel,
                hotelStatus: 'not_started',
                hotelName: detectedHotelName || null,
                hotelCheckInDate: null,
                hotelCheckOutDate: null,
                hotelInProgressDate: null,
                hotelIssuedDate: null,
                ticketEnabled: autoTicket,
                ticketStatus: 'not_started',
                ticketInProgressDate: null,
                ticketIssuedDate: null,
                transferEnabled: autoTransfer,
                transferStatus: 'not_started',
                transferInProgressDate: null,
                transferIssuedDate: null,
                insuranceEnabled: autoInsurance,
                insuranceStatus: 'not_started',
                insuranceInProgressDate: null,
                insuranceIssuedDate: null,
              },
              null
            );
            visaOp = 'upsert';
          }
        } else if (
          x.visaProgress === null ||
          x.visaProgress === false ||
          (x.visaProgress?.enabled === false &&
            x.visaProgress?.paymentApproved !== true &&
            x.visaProgress?.hotelEnabled !== true &&
            x.visaProgress?.ticketEnabled !== true &&
            x.visaProgress?.transferEnabled !== true &&
            x.visaProgress?.insuranceEnabled !== true &&
            x.visaProgress?.travelReadyEnabled !== true)
        ) {
          visaOp = existing ? 'delete' : null;
          visaObj = null;
        } else {
          const existingVisaRow = existing ? await getOne('crm_company', `visa-${existing.id}`) : null;
          const existingVp = existingVisaRow ? parseJsonObj(existingVisaRow.data, null) : null;
          const nextEnabled =
            x.visaProgress.enabled !== undefined
              ? x.visaProgress.enabled !== false
              : (existingVp?.enabled === true || autoVisa);
          const nextHotelEnabled =
            x.visaProgress.hotelEnabled !== undefined
              ? Boolean(x.visaProgress.hotelEnabled)
              : (existingVp?.hotelEnabled === true || autoHotel);
          const nextTicketEnabled =
            x.visaProgress.ticketEnabled !== undefined
              ? Boolean(x.visaProgress.ticketEnabled)
              : (existingVp?.ticketEnabled === true || autoTicket);
          const nextTransferEnabled =
            x.visaProgress.transferEnabled !== undefined
              ? Boolean(x.visaProgress.transferEnabled)
              : (existingVp?.transferEnabled === true || autoTransfer);
          const nextInsuranceEnabled =
            x.visaProgress.insuranceEnabled !== undefined
              ? Boolean(x.visaProgress.insuranceEnabled)
              : (existingVp?.insuranceEnabled === true || autoInsurance);
          visaObj = normalizeVisaProgress(
            {
              ...x.visaProgress,
              enabled: nextEnabled,
              hotelEnabled: nextHotelEnabled,
              hotelName:
                x.visaProgress.hotelName !== undefined
                  ? x.visaProgress.hotelName
                  : (existingVp?.hotelName || detectedHotelName || null),
              ticketEnabled: nextTicketEnabled,
              transferEnabled: nextTransferEnabled,
              insuranceEnabled: nextInsuranceEnabled,
            },
            existingVp
          );
          visaOp = 'upsert';
        }
      }
      if (existing) {
        const row = { ...existing, ...base, updated_at: at };
        await upsert('crm_invoices', row);
        await syncReceiptLinks(row.id, paymentsAdded, paymentsRemoved);
        if (visaOp === 'delete') {
          await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(`visa-${row.id}`)}`, { method: 'DELETE' });
        } else if (visaOp === 'upsert' && visaObj) {
          await upsert('crm_company', { id: `visa-${row.id}`, data: visaObj, updated_at: visaObj.updatedAt });
        }
        const what = changedBits([
          [vendorBill ? 'vendor' : 'customer', existing.customer_name, base.customer_name], ['currency', existing.currency, base.currency], ['total', num(existing.total), num(base.total)],
          ['discount', num(existing.discount), num(base.discount)], ['advance', num(existing.advance_paid), num(base.advance_paid)], ['due', existing.due_date, base.due_date], ['travel date', existing.travel_date, base.travel_date], ['payments', paymentsOf(existing).length, asArray(base.payments ?? paymentsOf(existing)).length],
          ['query code', existing.query_code, base.query_code], ['notes', existing.notes, base.notes],
        ]);
        await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'Someone'} edited ${vendorBill ? 'vendor payable' : 'invoice'} ${row.invoice_no}${what ? ` (${what})` : ' (details updated)'}.`, me.id);
        return res.status(200).json({ ok: true, invoice: mapInvoice(row, visaObj) });
      }
      const invoiceNo = await supabaseFetch(vendorBill ? '/rpc/crm_next_payable_no' : '/rpc/crm_next_invoice_no', { method: 'POST', body: '{}' });
      const row = { id: id('inv'), kind, invoice_no: String(invoiceNo), created_by: me.id, status: 'unpaid', created_at: at, updated_at: at, ...base };
      await upsert('crm_invoices', row);
      await syncReceiptLinks(row.id, paymentsAdded, paymentsRemoved);
      if (visaOp === 'upsert' && visaObj) {
        await upsert('crm_company', { id: `visa-${row.id}`, data: visaObj, updated_at: visaObj.updatedAt });
      }
      await notify(await salesStaffIds(), 'invoice', row.id, `${me.name || 'An employee'} generated ${vendorBill ? 'vendor payable' : 'invoice'} ${row.invoice_no} ${vendorBill ? 'for vendor' : 'for'} ${base.customer_name} (${currency} ${total}).`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row, visaObj) });
    }

    if (action === 'invoice_visa_update') {
      const betaEnabled = await isCustomerPortalBetaEnabled();
      if (!betaEnabled) throw forbidden('Customer Portal Beta is currently disabled.', 'BETA_DISABLED');
      const invId = str(body.id, 100, { required: true, name: 'Invoice ID' });
      const existing = await getOne('crm_invoices', invId);
      if (!existing) throw notFound('Invoice not found.');
      if (existing.kind === 'vendor') throw bad('Visa progress tracking is only available for customer invoices.');
      if (!isAdmin && me.role !== 'accounts' && existing.created_by !== me.id) {
        throw forbidden('Only the invoice creator, Accounts, or Admin can update Visa progress.');
      }
      const vpInput = body.visaProgress && typeof body.visaProgress === 'object' && !Array.isArray(body.visaProgress)
        ? body.visaProgress
        : {
            enabled: body.enabled,
            status: body.status,
            inProgressDate: body.inProgressDate,
            issuedDate: body.issuedDate,
            paymentApproved: body.paymentApproved,
            paymentApprovedDate: body.paymentApprovedDate,
            hotelEnabled: body.hotelEnabled,
            hotelStatus: body.hotelStatus,
            hotelName: body.hotelName,
            hotelCheckInDate: body.hotelCheckInDate,
            hotelCheckOutDate: body.hotelCheckOutDate,
            hotelInProgressDate: body.hotelInProgressDate,
            hotelIssuedDate: body.hotelIssuedDate,
            ticketEnabled: body.ticketEnabled,
            ticketStatus: body.ticketStatus,
            ticketDetails: body.ticketDetails,
            ticketInProgressDate: body.ticketInProgressDate,
            ticketIssuedDate: body.ticketIssuedDate,
            transferEnabled: body.transferEnabled,
            transferStatus: body.transferStatus,
            transferDetails: body.transferDetails,
            transferInProgressDate: body.transferInProgressDate,
            transferIssuedDate: body.transferIssuedDate,
            insuranceEnabled: body.insuranceEnabled,
            insuranceStatus: body.insuranceStatus,
            insuranceDetails: body.insuranceDetails,
            insuranceInProgressDate: body.insuranceInProgressDate,
            insuranceIssuedDate: body.insuranceIssuedDate,
            travelReadyEnabled: body.travelReadyEnabled,
            travelReadyDate: body.travelReadyDate,
          };
      const visaRowId = `visa-${existing.id}`;
      const existingVisaRow = await getOne('crm_company', visaRowId);
      const existingVp = existingVisaRow ? parseJsonObj(existingVisaRow.data, null) : null;
      const autoVisa = hasVisaKeyword(existing.sections, existing.reference, existing.notes);
      const autoHotel = hasHotelKeyword(existing.sections, existing.reference, existing.notes);
      const autoTicket = hasTicketKeyword(existing.sections, existing.reference, existing.notes);
      const autoTransfer = hasTransferKeyword(existing.sections, existing.reference, existing.notes);
      const autoInsurance = hasInsuranceKeyword(existing.sections, existing.reference, existing.notes);
      const detectedHotelName = extractSmartHotelName(existing.sections, existing.reference, existing.notes);

      const nextEnabled =
        vpInput.enabled !== undefined
          ? vpInput.enabled !== false
          : (existingVp?.enabled === true || autoVisa || vpInput.status !== undefined);
      const nextHotelEnabled =
        vpInput.hotelEnabled !== undefined
          ? Boolean(vpInput.hotelEnabled)
          : (existingVp?.hotelEnabled === true || autoHotel || vpInput.hotelStatus !== undefined || vpInput.hotelName !== undefined);
      const nextTicketEnabled =
        vpInput.ticketEnabled !== undefined
          ? Boolean(vpInput.ticketEnabled)
          : (existingVp?.ticketEnabled === true || autoTicket || vpInput.ticketStatus !== undefined);
      const nextTransferEnabled =
        vpInput.transferEnabled !== undefined
          ? Boolean(vpInput.transferEnabled)
          : (existingVp?.transferEnabled === true || autoTransfer || vpInput.transferStatus !== undefined);
      const nextInsuranceEnabled =
        vpInput.insuranceEnabled !== undefined
          ? Boolean(vpInput.insuranceEnabled)
          : (existingVp?.insuranceEnabled === true || autoInsurance || vpInput.insuranceStatus !== undefined);
      const nextPaymentApproved =
        vpInput.paymentApproved !== undefined
          ? Boolean(vpInput.paymentApproved)
          : Boolean(existingVp?.paymentApproved);
      const nextTravelReady =
        vpInput.travelReadyEnabled !== undefined
          ? Boolean(vpInput.travelReadyEnabled)
          : Boolean(existingVp?.travelReadyEnabled);

      if (
        !nextEnabled &&
        !nextPaymentApproved &&
        !nextHotelEnabled &&
        !nextTicketEnabled &&
        !nextTransferEnabled &&
        !nextInsuranceEnabled &&
        !nextTravelReady
      ) {
        await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(visaRowId)}`, { method: 'DELETE' });
        return res.status(200).json({ ok: true, visaProgress: null, invoice: mapInvoice(existing, null) });
      }

      const vpObj = normalizeVisaProgress(
        {
          ...vpInput,
          enabled: nextEnabled,
          paymentApproved: nextPaymentApproved,
          hotelEnabled: nextHotelEnabled,
          hotelName:
            vpInput.hotelName !== undefined
              ? vpInput.hotelName
              : (existingVp?.hotelName || detectedHotelName || null),
          ticketEnabled: nextTicketEnabled,
          transferEnabled: nextTransferEnabled,
          insuranceEnabled: nextInsuranceEnabled,
          travelReadyEnabled: nextTravelReady,
        },
        existingVp
      );
      await upsert('crm_company', { id: visaRowId, data: vpObj, updated_at: vpObj.updatedAt });
      return res.status(200).json({ ok: true, visaProgress: vpObj, invoice: mapInvoice(existing, vpObj) });
    }

    if (action === 'invoice_status') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      const status = String(body.status || '');
      if (!['unpaid', 'paid', 'cancelled'].includes(status)) throw bad('Choose Unpaid, Paid or Cancelled.');
      const staff = isAdmin || me.role === 'accounts';
      if (me.role === 'accounts' && !isAdmin && status !== 'paid') throw forbidden('Accounts Officer can only mark an invoice as received.');
      if (!staff && !(existing.created_by === me.id && status === 'cancelled' && existing.status === 'unpaid')) throw forbidden('Only Accounts or Admin can change the invoice status.');
      if (status === 'paid' && existing.status === 'cancelled') throw bad('A cancelled invoice cannot be marked as received.');
      const at = nowIso();
      const row = {
        ...existing, status, updated_at: at,
        ...(status === 'paid' ? {
          payment_received: true, payment_received_at: existing.payment_received_at || at,
          payment_received_by: me.id, payment_received_auto: !Boolean(existing.payment_received),
        } : status === 'unpaid' ? {
          payment_received: false, payment_received_at: null, payment_received_by: null, payment_received_auto: false,
        } : {}),
      };
      if (status === 'cancelled') {
        const remarks = str(body.remarks, 600, { required: true, name: 'Cancellation remarks' });
        row.cancel_remarks = remarks; row.cancelled_by = me.id; row.cancelled_at = at;
      }
      await upsert('crm_invoices', row);
      if (status === 'cancelled') {
        const label = existing.kind === 'vendor' ? 'vendor payable' : 'invoice';
        const targets = [...new Set([...(await salesStaffIds()), existing.created_by])];
        await notify(targets, 'invoice', row.id, `${me.name || 'Someone'} cancelled ${label} ${existing.invoice_no}. Remarks: ${row.cancel_remarks}`, me.id);
      } else if (existing.created_by !== me.id) await notify([existing.created_by], 'invoice', row.id, `Your invoice ${existing.invoice_no} was marked ${(status === 'paid' && existing.kind !== 'vendor' ? 'RECEIVED' : status.toUpperCase())}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    // The vendor side of an invoice is paid separately from the customer side (Accounts / Admin / CEO).
    if (action === 'invoice_vendor_status') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      const status = String(body.status || '');
      if (!['unpaid', 'paid'].includes(status)) throw bad('Choose Paid or Unpaid for the vendor side.');
      if (!(isAdmin || me.role === 'accounts')) throw forbidden('Only Accounts or Admin can mark the vendor side paid.');
      if (existing.kind === 'vendor') throw bad('This is a vendor payable itself. Use its own Mark paid button.');
      const at = nowIso();
      const row = { ...existing, vendor_status: status, vendor_paid_at: status === 'paid' ? at : null, vendor_paid_by: status === 'paid' ? me.id : null, updated_at: at };
      await upsert('crm_invoices', row);
      if (existing.created_by !== me.id) await notify([existing.created_by], 'invoice', row.id, `Vendor side of invoice ${existing.invoice_no} was marked ${status.toUpperCase()}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    if (action === 'invoice_vendor_line_posted') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      if (!(isAdmin || me.role === 'accounts')) throw forbidden('Only Accounts or Admin can post a vendor line.');
      if (existing.kind === 'vendor' || existing.status === 'cancelled') throw bad('This invoice cannot be posted.');
      if (body.revision !== existing.updated_at) throw bad('Invoice changed. Refresh and try again.');
      const vendors = asArray(existing.vendors);
      const at = nowIso();
      const posted = body.posted === true;
      const updated = updateVendorPosting(vendors, body.vendorId, posted, me.id, at, () => id('vendor'));
      if (!updated) throw notFound('Vendor line no longer exists. Refresh the invoice.');
      const revision = existing.updated_at ? `eq.${encodeURIComponent(existing.updated_at)}` : 'is.null';
      const changed = await supabaseFetch(`/crm_invoices?id=eq.${encodeURIComponent(existing.id)}&updated_at=${revision}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ vendors: updated, updated_at: at }) });
      if (!changed?.length) throw bad('Invoice changed. Refresh and try again.');
      return res.status(200).json({ ok: true, invoice: mapInvoice(changed[0]) });
    }

    if (action === 'invoice_vendor_posted') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Vendor payable not found.');
      if (existing.kind !== 'vendor') throw bad('Posting is only available for vendor payable records.');
      if (existing.status === 'cancelled') throw bad('A cancelled payable cannot be posted.');
      if (!(isAdmin || me.role === 'accounts')) throw forbidden('Only Accounts or Admin can post a vendor payable.');
      const posted = body.posted !== false;
      const at = nowIso();
      const row = { ...existing, vendor_posted: posted, vendor_posted_at: posted ? at : null, vendor_posted_by: posted ? me.id : null, updated_at: at };
      await upsert('crm_invoices', row);
      await notify([existing.created_by, ...(await salesStaffIds())], 'invoice', row.id, `Vendor payable ${row.invoice_no} was ${posted ? 'posted' : 'unposted'} by ${me.name || 'Accounts'}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    // A payment received later on an existing invoice (several payments at different times), optionally from a receipt already on file.
    if (action === 'invoice_payment_add' || action === 'invoice_payment_remove') {
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      if (existing.kind === 'vendor') throw bad('Payments are recorded on customer invoices.');
      if (existing.status === 'cancelled') throw bad('A cancelled invoice cannot take payments.');
      const privileged = isAdmin || me.role === 'accounts';
      if (!privileged && existing.created_by !== me.id) throw forbidden('Only the person who made the invoice, Accounts or an administrator can record payments.');
      if (action === 'invoice_payment_remove' && !privileged) throw forbidden('Only Accounts or an administrator can remove a saved payment.');
      const at = nowIso();
      const current = paymentsOf(existing);
      let incoming;
      const attached = new Map();
      if (action === 'invoice_payment_add') {
        const p = body.payment || {};
        if (p.receiptId) {
          const rc = await getOne('crm_receipts', String(p.receiptId));
          const problem = receiptProblem(rc, { invoiceId: existing.id, invoiceCurrency: existing.currency, customerName: existing.customer_name, crmQuery: existing.crm_id || existing.query_code, canSee: Boolean(rc) && (privileged || rc.created_by === me.id) });
          if (problem) throw bad(problem);
          attached.set(String(p.receiptId), rc);
        }
        incoming = [...current, { receiptId: p.receiptId || null, amount: p.amount, date: p.date, note: p.note, method: p.method }];
      } else {
        const pid = String(body.paymentId || '');
        if (!current.some((p) => p.id === pid)) throw notFound('That payment was not found.');
        if (!String(body.remarks || '').trim()) throw bad('Please write why this payment is being removed.');
        incoming = current.filter((p) => p.id !== pid);
      }
      let built;
      try {
        built = buildPayments({ existing: current, incoming, privileged, actor: me, nowIso: at, receipts: attached });
        assertWithinTotal(built.payments, num(existing.total));
      } catch (e) {
        if (e instanceof PaymentError) throw bad(e.message);
        throw e;
      }
      const paid = sumPayments(built.payments);
      const row = { ...existing, payments: built.payments, advance_paid: paid, balance: r2(Math.max(0, num(existing.total) - paid)), updated_at: at };
      await upsert('crm_invoices', row);
      await syncReceiptLinks(row.id, built.added, built.removed);
      const what = action === 'invoice_payment_add' ? built.added[0] : built.removed[0];
      const verb = action === 'invoice_payment_add' ? 'recorded' : `removed (${str(body.remarks, 300)})`;
      await notify([...(await salesStaffIds()), existing.created_by], 'invoice', row.id, `${me.name || 'Someone'} ${verb} a payment of ${existing.currency} ${what ? what.amount : ''} on invoice ${existing.invoice_no}. Balance now ${existing.currency} ${row.balance}.`, me.id);
      return res.status(200).json({ ok: true, invoice: mapInvoice(row) });
    }

    if (action === 'invoice_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete an invoice. You can cancel it instead.');
      const existing = await getOne('crm_invoices', body.id);
      if (!existing) throw notFound('Invoice not found.');
      await supabaseFetch(`/crm_receipts?linked_invoice_id=eq.${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify({ linked_invoice_id: null }) });
      await supabaseFetch(`/crm_invoices?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(`visa-${existing.id}`)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- receipts
    if (action === 'receipt_save') {
      const x = body.receipt || {};
      const existing = x.id ? await getOne('crm_receipts', x.id) : null;
      if (x.id && !existing) throw notFound('Receipt not found.');
      if (existing && !canEditFinancialRecord(me.role, me.id, existing.created_by, 'receipt')) throw forbidden('You can only edit your own receipts.');
      const money = (v, label) => {
        const n = Number(v);
        if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return r2(n);
      };
      const currency = String(x.currency || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose the currency.');
      const items = [...new Set(asArray(x.items).map(String))].filter((i) => RECEIPT_ITEMS.includes(i));
      const otherItem = str(x.otherItem, 120, { name: 'Other item' });
      const paymentType = x.paymentType === 'partial' ? 'partial' : 'full';
      // The form no longer asks what the whole thing was sold for: only the amount received is entered.
      const amountReceived = x.amountReceived !== undefined && x.amountReceived !== null && x.amountReceived !== ''
        ? money(x.amountReceived, 'Amount received')
        : money(x.totalAmount, 'Amount received');
      if (amountReceived <= 0) throw bad('Enter the amount received.');
      // older partial receipts keep the total they were saved with (their balance still shows)
      const totalAmount = x.totalAmount !== undefined && x.totalAmount !== null && x.totalAmount !== '' && num(x.totalAmount) >= amountReceived
        ? money(x.totalAmount, 'Total payment sold for')
        : (existing && num(existing.total_amount) > amountReceived ? num(existing.total_amount) : amountReceived);
      if (existing && existing.linked_invoice_id && (num(existing.amount_received) !== amountReceived || String(existing.currency).toUpperCase() !== currency)) {
        throw bad('This receipt is already counted as a payment on an invoice, so its amount and currency cannot be changed. Remove it from the invoice first.');
      }
      const method = x.method === 'bank' ? 'bank' : 'cash';
      let proof = existing ? existing.proof_image || null : null;
      if (x.removeProof) proof = null;
      if (x.proofImage) {
        const data = String(x.proofImage);
        if (!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(data)) throw bad('The screenshot must be a JPG, JPEG or PNG image.');
        if (data.length > 2_500_000) throw bad('The screenshot is too large. Please upload a smaller image.');
        proof = data;
      }
      const base = {
        query_code: str(x.queryCode, 80, { required: true, name: 'Query code' }), client_name: str(x.clientName, 160, { required: true, name: 'Client name' }),
        items, other_item: otherItem, payment_type: paymentType, currency, total_amount: totalAmount, amount_received: amountReceived, method,
        bank_name: method === 'bank' ? str(x.bankName, 120, { name: 'Bank name' }) : '', reference_no: str(x.referenceNo, 160, { name: 'Reference No / Transaction ID' }),
        proof_image: proof, has_proof: Boolean(proof), purpose: str(x.purpose, 400, { name: 'On account of' }),
      };
      const at = nowIso();
      const describe = (r) => `${r.client_name} (query ${r.query_code}): ${r.currency} ${r.amount_received} received ${r.method === 'bank' ? 'by bank transfer' : 'in cash'}, ${r.payment_type === 'partial' ? `partial payment of ${r.total_amount}` : 'full payment'}.`;
      const accounts = await accountsIds();
      if (existing) {
        const row = { ...existing, ...base, updated_at: at };
        await upsert('crm_receipts', row);
        await notify(accounts, 'receipt', row.id, `${me.name || 'Someone'} updated receipt ${row.receipt_no} - ${describe(row)}`, me.id);
        return res.status(200).json({ ok: true, receipt: mapReceipt(row) });
      }
      const receiptNo = await supabaseFetch('/rpc/crm_next_receipt_no', { method: 'POST', body: '{}' });
      const row = { id: id('rcp'), receipt_no: String(receiptNo), created_by: me.id, created_at: at, updated_at: at, ...base };
      await upsert('crm_receipts', row);
      await notify(accounts, 'receipt', row.id, `${me.name || 'An employee'} created receipt ${row.receipt_no} - ${describe(row)}`, me.id);
      return res.status(200).json({ ok: true, receipt: mapReceipt(row) });
    }

    if (action === 'receipt_proof') {
      const existing = await getOne('crm_receipts', body.id);
      if (!existing) throw notFound('Receipt not found.');
      if (!(isAdmin || me.role === 'accounts' || me.role === 'ceo' || existing.created_by === me.id)) throw forbidden();
      return res.status(200).json({ ok: true, image: existing.proof_image || null });
    }

    if (action === 'receipt_payment_type') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Accounts, Admin, or CEO can change the receipt payment status.');
      const existing = await getOne('crm_receipts', body.id);
      if (!existing) throw notFound('Receipt not found.');
      const paymentType = body.paymentType === 'partial' ? 'partial' : 'full';
      const at = nowIso();
      const row = { ...existing, payment_type: paymentType, updated_at: at };
      await upsert('crm_receipts', row);
      if (existing.created_by !== me.id) {
        await notify([existing.created_by], 'receipt', row.id, `Your receipt ${existing.receipt_no} was marked as ${paymentType === 'full' ? 'FULL PAYMENT' : 'PARTIAL PAYMENT'}.`, me.id);
      }
      return res.status(200).json({ ok: true, receipt: mapReceipt(row) });
    }

    if (action === 'receipt_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a receipt.');
      const existing = await getOne('crm_receipts', body.id);
      if (!existing) throw notFound('Receipt not found.');
      if (existing.linked_invoice_id) throw bad('This receipt is counted as a payment on an invoice. Remove it from that invoice first.');
      await supabaseFetch(`/crm_receipts?id=eq.${encodeURIComponent(existing.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    // ---------------------------------------------------------------- purchases (+Add Vendor)
    if (action === 'purchase_field_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add custom purchase columns.');
      const label = str(body.label, 80, { required: true, name: 'Column name' });
      const { customFields: existingFields, customCategories } = await getPurchaseSchema();
      const validCats = ['all', ...PURCHASE_CATEGORIES, ...customCategories.map((c) => c.id)];
      const category = validCats.includes(body.category) ? body.category : 'all';
      if (!existingFields.some((f) => f.label.toLowerCase() === label.toLowerCase() && f.category === category)) {
        existingFields.push({ id: id('pf'), category, label });
      }
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields: existingFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomFields: existingFields, purchaseCustomCategories: customCategories });
    }

    if (action === 'purchase_field_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove custom purchase columns.');
      const targetId = String(body.fieldId || body.id || '');
      const { customFields, customCategories } = await getPurchaseSchema();
      const existingFields = customFields.filter((f) => f.id !== targetId);
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields: existingFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomFields: existingFields, purchaseCustomCategories: customCategories });
    }

    if (action === 'purchase_category_add') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can add custom purchase categories.');
      const label = str(body.label, 80, { required: true, name: 'Category name' });
      const { customFields, customCategories } = await getPurchaseSchema();
      const builtinLabels = ['ticket purchase', 'hotel purchase', 'visa purchase', 'tours & transfers', 'insurance', 'other service'];
      if (
        !builtinLabels.includes(label.toLowerCase()) &&
        !customCategories.some((c) => c.label.toLowerCase() === label.toLowerCase())
      ) {
        customCategories.push({ id: id('pcat'), label });
      }
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields, customCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomCategories: customCategories, purchaseCustomFields: customFields });
    }

    if (action === 'purchase_category_remove') {
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin or Accounts can remove custom purchase categories.');
      const targetId = String(body.categoryId || body.id || '');
      const { customFields, customCategories } = await getPurchaseSchema();
      const nextCategories = customCategories.filter((c) => c.id !== targetId);
      await upsert('crm_company', { id: 'purchases_schema', data: { customFields, customCategories: nextCategories }, updated_at: nowIso() });
      return res.status(200).json({ ok: true, purchaseCustomCategories: nextCategories, purchaseCustomFields: customFields });
    }

    if (action === 'purchase_save') {
      const x = body.purchase || body;
      const existingRow = x.id ? await getOne('crm_company', x.id) : null;
      const existing = existingRow?.data || null;
      if (x.id && !existing) throw notFound('Purchase record not found.');
      if (existing && !canEditFinancialRecord(me.role, me.id, existing.createdBy, 'purchase')) {
        throw forbidden('You can only edit your own purchase records.');
      }

      const { customCategories } = await getPurchaseSchema();
      const customCatMap = new Map(customCategories.map((c) => [c.id, c.label]));

      const customerName = str(x.customerName, 160, { required: true, name: 'Customer name' });
      const careOf = str(x.careOf, 160, { name: 'C/O' });
      const crmId = str(x.crmId, 80, { name: 'Query Code / CRM ID' });
      const currency = String(x.currency || 'PKR').toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw bad('Choose a valid currency.');
      const purchaseDate = String(x.purchaseDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const notes = str(x.notes, 2000, { name: 'Notes' });

      const moneyOpt = (v, label, { required = false } = {}) => {
        if (v === '' || v === null || v === undefined) {
          if (required) throw bad(`${label} is required.`);
          return null;
        }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 9999999999) throw bad(`${label} is not a valid amount.`);
        return r2(n);
      };

      const rawItems = asArray(x.items);
      if (!rawItems.length) throw bad('Add at least one vendor purchase item.');

      let totalPayable = 0;
      let totalReceivable = 0;
      const items = rawItems.slice(0, 40).map((it, idx) => {
        const rawCat = String(it?.category || 'other');
        const isBuiltin = PURCHASE_CATEGORIES.includes(rawCat);
        const isCustom = customCatMap.has(rawCat);
        const category = isBuiltin || isCustom ? rawCat : 'other';
        const catTitle = isBuiltin
          ? { ticket: 'Ticket', hotel: 'Hotel', visa: 'Visa', tour: 'Tours & Transfers', insurance: 'Insurance', other: 'Other' }[category]
          : (customCatMap.get(category) || it?.categoryLabel || 'Custom Service');
        const vendorName = str(it?.vendorName, 160, { required: true, name: `${catTitle} #${idx + 1} Vendor / Issued By` });
        const quantity = it?.quantity !== '' && it?.quantity !== null && it?.quantity !== undefined ? Math.max(1, Number(it.quantity) || 1) : 1;
        const unitPayable = moneyOpt(it?.unitPayable, `${catTitle} #${idx + 1} Unit Payable`, { required: false });
        const rawPayable = moneyOpt(it?.payable, `${catTitle} #${idx + 1} Payable Price`, { required: unitPayable === null });
        const payable = rawPayable !== null ? rawPayable : r2((unitPayable || 0) * quantity);
        const receivable = moneyOpt(it?.receivable, `${catTitle} #${idx + 1} Receivable`, { required: false });
        const itemCurrency = /^[A-Z]{3}$/.test(String(it?.currency || '').toUpperCase()) ? String(it.currency).toUpperCase() : currency;
        const paymentDueDate = it?.paymentDueDate ? String(it.paymentDueDate).slice(0, 10) : null;

        const VALID_PAID_METHODS = ['unpaid', 'faiq_card', 'ali_card', 'third_party', 'other', 'card', 'cash', 'bank_transfer'];
        const paidByMethod = VALID_PAID_METHODS.includes(it?.paidByMethod) ? it.paidByMethod : 'unpaid';
        const cardOption = ['faiq_card', 'ali_card', 'third_party', 'other', ''].includes(it?.cardOption) ? (it.cardOption || '') : '';
        const cardBank = str(it?.cardBank, 160, { name: 'Card bank' });
        const paidBySpecify = str(it?.paidBySpecify, 200, { name: 'Paid by details' });

        // Category-specific validations
        const ticketNumber = category === 'ticket' ? str(it?.ticketNumber, 120, { required: true, name: `Ticket #${idx + 1} Ticket Number` }) : str(it?.ticketNumber, 120);
        const hotelName = category === 'hotel' ? str(it?.hotelName, 160, { required: true, name: `Hotel #${idx + 1} Hotel Name` }) : str(it?.hotelName, 160);
        const rooms = str(it?.rooms, 80, { name: 'Rooms' });
        const checkInDate = it?.checkInDate ? String(it.checkInDate).slice(0, 10) : null;
        const checkOutDate = it?.checkOutDate ? String(it.checkOutDate).slice(0, 10) : null;
        const countries = category === 'visa' ? str(it?.countries, 200, { required: true, name: `Visa #${idx + 1} Countries` }) : str(it?.countries, 200);
        const visaType = category === 'visa' ? str(it?.visaType, 120, { required: true, name: `Visa #${idx + 1} Visa Type` }) : str(it?.visaType, 120);
        const tourDescription = category === 'tour' ? str(it?.tourDescription, 400, { required: true, name: `Tour #${idx + 1} Description of Tour` }) : str(it?.tourDescription, 400);
        const tourDate = it?.tourDate ? String(it.tourDate).slice(0, 10) : null;
        const persons = it?.persons !== '' && it?.persons !== null && it?.persons !== undefined ? Math.max(0, Math.round(Number(it.persons) || 0)) : null;
        const insuranceType = category === 'insurance' ? str(it?.insuranceType, 160, { required: true, name: `Insurance #${idx + 1} Type` }) : str(it?.insuranceType, 160);
        const insuranceDays = it?.insuranceDays !== '' && it?.insuranceDays !== null && it?.insuranceDays !== undefined ? Math.max(0, Math.round(Number(it.insuranceDays) || 0)) : null;
        const description = str(it?.description, 400);

        const rawCustom = it?.customValues && typeof it.customValues === 'object' ? it.customValues : {};
        const customValues = {};
        for (const [k, v] of Object.entries(rawCustom)) {
          const val = str(v, 300);
          if (val) customValues[String(k).slice(0, 80)] = val;
        }

        totalPayable = r2(totalPayable + payable);
        if (receivable !== null) totalReceivable = r2(totalReceivable + receivable);

        return {
          id: it?.id || id('pit'),
          category,
          categoryLabel: isCustom ? catTitle : undefined,
          vendorName,
          quantity,
          unitPayable: unitPayable ?? payable,
          payable,
          receivable,
          currency: itemCurrency,
          paymentDueDate,
          paidByMethod,
          cardOption,
          cardBank,
          paidBySpecify,
          ticketNumber,
          hotelName,
          rooms,
          checkInDate,
          checkOutDate,
          countries,
          visaType,
          tourDescription,
          tourDate,
          persons,
          insuranceType,
          insuranceDays,
          description,
          customValues,
        };
      });

      const allPaid = items.every((i) => i.paidByMethod !== 'unpaid');
      const somePaid = items.some((i) => i.paidByMethod !== 'unpaid');
      const autoStatus = allPaid ? 'paid' : somePaid ? 'partial' : 'unpaid';
      const status = ['unpaid', 'paid', 'partial'].includes(x.status) ? x.status : (existing?.status || autoStatus);

      const at = nowIso();
      if (existing) {
        const updatedPurchase = {
          ...existing,
          customerName,
          careOf,
          crmId,
          purchaseDate,
          currency,
          items,
          totalPayable,
          totalReceivable,
          notes,
          status,
          updatedAt: at,
        };
        const saved = await updatePurchaseRow(existingRow, updatedPurchase, at);
        const what = changedBits([
          ['customer', existing.customerName, customerName], ['query code', existing.crmId, crmId], ['currency', existing.currency, currency],
          ['payable', existing.totalPayable, totalPayable], ['receivable', existing.totalReceivable, totalReceivable], ['items', asArray(existing.items).length, items.length],
          ['date', existing.purchaseDate, purchaseDate], ['notes', existing.notes, notes],
        ]);
        await notify(await salesStaffIds(), 'invoice', existing.id, `${me.name || 'Someone'} edited vendor purchase ${existing.purchaseNo}${what ? ` (${what})` : ' (details updated)'}.`, me.id);
        return res.status(200).json({ ok: true, purchase: saved });
      }

      const existingPurchases = await getAllPurchases();
      const nextNum = existingPurchases.length + 1;
      const purchaseNo = `PUR-${String(nextNum).padStart(6, '0')}`;
      const rowId = id('pur');
      const newPurchase = {
        id: rowId,
        purchaseNo,
        createdBy: me.id,
        customerName,
        careOf,
        crmId,
        purchaseDate,
        currency,
        items,
        totalPayable,
        totalReceivable,
        notes,
        status: autoStatus,
        createdAt: at,
        updatedAt: at,
      };
      await upsert('crm_company', { id: rowId, data: newPurchase, updated_at: at });
      await notify(await salesStaffIds(), 'invoice', rowId, `${me.name || 'An employee'} added vendor purchase ${purchaseNo} for ${customerName} (${currency} ${totalPayable}).`, me.id);
      return res.status(200).json({ ok: true, purchase: newPurchase });
    }

    if (action === 'purchase_posted') {
      if (!(isAdmin || me.role === 'accounts')) throw forbidden('Only Accounts or Admin can post purchases.');
      if (typeof body.id !== 'string' || !body.id.startsWith('pur-') || typeof body.posted !== 'boolean') throw bad('Choose a valid purchase and posting status.');
      const existingRow = await getOne('crm_company', body.id);
      if (!existingRow?.data?.purchaseNo || existingRow.id !== body.id) throw notFound('Purchase record not found.');
      const at = nowIso();
      const updated = { ...existingRow.data, posted: body.posted, postedAt: body.posted ? at : null, postedBy: body.posted ? me.id : null, updatedAt: at };
      const saved = await updatePurchaseRow(existingRow, updated, at);
      return res.status(200).json({ ok: true, purchase: saved });
    }

    if (action === 'purchase_status') {
      const existingRow = await getOne('crm_company', body.id);
      if (!existingRow?.data) throw notFound('Purchase record not found.');
      if (!isAdmin && me.role !== 'accounts' && existingRow.data.createdBy !== me.id) {
        throw forbidden('Only Admin, Accounts, or the creator can update purchase status.');
      }
      const status = ['unpaid', 'paid', 'partial'].includes(body.status) ? body.status : 'unpaid';
      const at = nowIso();
      const updated = { ...existingRow.data, status, updatedAt: at };
      const saved = await updatePurchaseRow(existingRow, updated, at);
      return res.status(200).json({ ok: true, purchase: saved });
    }

    if (action === 'purchase_delete') {
      if (!isAdmin) throw forbidden('Only an administrator can delete a purchase record.');
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(body.id)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    if (action === 'portal_query_status') {
      if (!hasPortalAccess(me)) throw forbidden('Customer Portal access is only for Admin or employees an admin has allowed.');
      const targetId = str(body.id, 100, { required: true, name: 'Query ID' });
      const existingRow = await getOne('crm_company', targetId);
      const existingData = parseJsonObj(existingRow?.data, null);
      if (!existingData) throw notFound('Portal query not found.');
      const nextStatus = ['new', 'contacted', 'quoted', 'won', 'lost', 'closed'].includes(body.status)
        ? body.status
        : existingData.status || 'new';
      const nextAssigned = body.assignedTo !== undefined ? (body.assignedTo ? String(body.assignedTo) : null) : (existingData.assignedTo || null);
      const at = nowIso();
      const updated = { ...existingData, status: nextStatus, assignedTo: nextAssigned, updatedAt: at };
      await upsert('crm_company', { id: targetId, data: updated, updated_at: at });
      return res.status(200).json({ ok: true, portalQuery: { ...updated, id: targetId } });
    }

    if (action === 'portal_query_delete') {
      if (!hasPortalAccess(me)) throw forbidden('Customer Portal access is only for Admin or employees an admin has allowed.');
      if (!isAdmin && me.role !== 'accounts') throw forbidden('Only Admin, CEO, or Accounts can delete a portal query.');
      const targetId = str(body.id, 100, { required: true, name: 'Query ID' });
      await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action', code: 'BAD_REQUEST' });
  } catch (err) {
    if (!(err instanceof HttpError)) console.error('crm api error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'CRM request failed', code: err.code });
  }
}
