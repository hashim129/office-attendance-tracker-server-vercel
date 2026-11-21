import crypto from 'node:crypto';
import { isSupabaseConfigured, supabaseFetch } from './_supabase.js';
import { setNoCacheHeaders } from './_cloud.js';

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const QUERY_RE = /^[A-Za-z0-9_\-\/.:#+ ]{2,80}$/;
const HAS_ALNUM_RE = /[A-Za-z0-9]/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_SUPABASE_PATH_LEN = 3500;

const PUBLIC_INVOICE_SELECT =
  'id,kind,crm_id,query_code,invoice_no,customer_name,reference,invoice_date,due_date,currency,sections,discount,advance_paid,subtotal,tax_label,tax_rate,tax_amount,total,balance,status,created_at,updated_at';

const PUBLIC_RECEIPT_SELECT =
  'receipt_no,query_code,payment_type,currency,total_amount,amount_received,items,other_item,created_at';

function parseJsonObj(v, fallback = {}) {
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
}

function parseJsonArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function extractClientIp(req) {
  const firstVal = (val) => {
    const raw = Array.isArray(val) ? val[0] : val;
    return typeof raw === 'string' ? raw.split(',')[0].trim() : '';
  };
  const candidates = [
    firstVal(req.headers?.['x-vercel-forwarded-for']),
    firstVal(req.headers?.['x-real-ip']),
    firstVal(req.headers?.['x-forwarded-for']),
    typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress.trim() : '',
  ]
    .map((x) => String(x || '').trim().replace(/^::ffff:/, ''))
    .filter(Boolean);
  return candidates[0] || 'unknown';
}

function escLike(s) {
  return String(s || '')
    .replace(/["*(),\\]/g, '')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function pgQuote(v) {
  return `"${String(v || '').replace(/"/g, '')}"`;
}

function tokenBoundaryIlikeClauses(col, term) {
  const escaped = escLike(term);
  if (!escaped) return [];
  if (String(term || '').includes('/')) {
    const clauses = new Set([`${col}.ilike.${pgQuote(escaped)}`]);
    const slashParts = String(term)
      .split('/')
      .map((part) => escLike(part.trim()))
      .filter(Boolean);
    if (slashParts.length === 2) {
      const [p0, p1] = slashParts;
      for (const variant of [
        `${p0}/${p1}`,
        `${p0} / ${p1}`,
        `${p0}/ ${p1}`,
        `${p0} /${p1}`,
        `${p0}  /  ${p1}`,
        `${p0}  /${p1}`,
        `${p0}/  ${p1}`,
        `${p0}  / ${p1}`,
        `${p0} /  ${p1}`,
      ]) {
        clauses.add(`${col}.ilike.${pgQuote(variant)}`);
      }
    } else if (slashParts.length >= 3) {
      for (const sep of ['/', ' / ', '/ ', ' /', '  /  ']) {
        clauses.add(`${col}.ilike.${pgQuote(slashParts.join(sep))}`);
      }
    }
    return Array.from(clauses);
  }
  return [
    `${col}.ilike.${pgQuote(escaped)}`,
    `${col}.ilike.${pgQuote(`${escaped} /*`)}`,
    `${col}.ilike.${pgQuote(`${escaped}/*`)}`,
    `${col}.ilike.${pgQuote(`*/ ${escaped}`)}`,
    `${col}.ilike.${pgQuote(`*/${escaped}`)}`,
    `${col}.ilike.${pgQuote(`*/ ${escaped} /*`)}`,
    `${col}.ilike.${pgQuote(`*/${escaped}/*`)}`,
    `${col}.ilike.${pgQuote(`*/ ${escaped}/*`)}`,
    `${col}.ilike.${pgQuote(`*/${escaped} /*`)}`,
  ];
}

function slashFlexIlikeClause(col, term) {
  if (!String(term || '').includes('/')) return null;
  const slashParts = String(term)
    .split('/')
    .map((part) => escLike(part.trim()))
    .filter(Boolean);
  if (slashParts.length < 2) return null;
  return `${col}.ilike.${pgQuote(slashParts.join('*/*'))}`;
}

function chunkItemsByEndpointLength(items, buildEndpoint, maxPathLen = MAX_SUPABASE_PATH_LEN) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const batches = [];
  let current = [];

  for (const item of items) {
    if (!item) continue;
    const candidate = [...current, item];
    if (buildEndpoint(candidate).length <= maxPathLen) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      batches.push(current);
      current = [];
    }
    // Fallback safeguard: skip any single item whose endpoint alone exceeds maxPathLen
    if (buildEndpoint([item]).length <= maxPathLen) {
      current = [item];
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

async function fetchChunkedRows(items, buildEndpoint, maxPathLen = MAX_SUPABASE_PATH_LEN) {
  const batches = chunkItemsByEndpointLength(items, buildEndpoint, maxPathLen);
  if (batches.length === 0) return [];
  const results = await Promise.all(
    batches.map((batch) => supabaseFetch(buildEndpoint(batch)))
  );
  const merged = [];
  for (const rows of results) {
    if (Array.isArray(rows)) merged.push(...rows);
  }
  return merged;
}

function buildInvoiceOrEndpoint(batch) {
  return `/crm_invoices?kind=eq.customer&or=(${encodeURIComponent(batch.join(','))})&select=${PUBLIC_INVOICE_SELECT}&order=invoice_date.desc,created_at.desc&limit=100`;
}

function buildVisaInEndpoint(batch) {
  return `/crm_company?id=in.(${encodeURIComponent(batch.join(','))})&select=id,data,updated_at`;
}

function buildReceiptOrEndpoint(batch) {
  return `/crm_receipts?or=(${encodeURIComponent(batch.join(','))})&select=${PUBLIC_RECEIPT_SELECT}&order=created_at.desc&limit=100`;
}

function norm(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normSlash(s) {
  return norm(s)
    .replace(/(?:\s*\/\s*)+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function splitTokens(s) {
  return norm(s)
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && HAS_ALNUM_RE.test(t));
}

function rawTokens(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split('/')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && HAS_ALNUM_RE.test(t));
}

function crmQueryText(inv) {
  const a = String(inv?.crm_id || '').trim();
  const b = String(inv?.query_code || '').trim();
  return a && b && a !== b ? `${a} / ${b}` : a || b;
}

function invTokenSet(inv) {
  const set = new Set();
  const addVal = (val) => {
    const n = norm(val);
    if (!n || !HAS_ALNUM_RE.test(n)) return;
    set.add(n);
    const ns = normSlash(val);
    if (ns && HAS_ALNUM_RE.test(ns)) set.add(ns);
    for (const tok of splitTokens(val)) set.add(tok);
  };
  addVal(inv?.crm_id);
  addVal(inv?.query_code);
  addVal(crmQueryText(inv));
  return set;
}

function validDateOnly(d) {
  const s = String(d || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) return null;
  return s;
}

function hasVisaKeyword(sections) {
  return parseJsonArr(sections).some((sec) => {
    if (/\bvisa\b/i.test(String(sec?.title || ''))) return true;
    return parseJsonArr(sec?.lines).some((ln) => /\bvisa\b/i.test(String(ln?.description || '')));
  });
}

function sanitizeSections(sections) {
  return parseJsonArr(sections).map((sec) => ({
    title: String(sec?.title || ''),
    lines: parseJsonArr(sec?.lines).map((ln) => {
      const isNote = Boolean(ln?.note);
      return {
        description: String(ln?.description || ''),
        note: isNote,
        unitPrice: isNote || ln?.unitPrice === null || ln?.unitPrice === undefined ? null : Number(ln.unitPrice),
        units: isNote || ln?.units === null || ln?.units === undefined ? null : Number(ln.units),
        currency: ln?.currency ? String(ln.currency) : null,
        rate: ln?.rate !== undefined && ln?.rate !== null ? Number(ln.rate) : null,
        amount: isNote ? null : Number(ln?.amount || 0),
      };
    }),
  }));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseQueryParams(req) {
  const urlParams = new URL(req.url || '/', 'http://localhost').searchParams;
  const hasReqQuery = Boolean(req.query && typeof req.query === 'object');

  const action =
    hasReqQuery && req.query.action !== undefined
      ? Array.isArray(req.query.action)
        ? req.query.action[0]
        : req.query.action
      : urlParams.get('action');

  const hasReqQ =
    hasReqQuery &&
    Object.prototype.hasOwnProperty.call(req.query, 'q') &&
    req.query.q !== undefined;

  const hasQ = hasReqQ || urlParams.has('q');
  const rawQ = hasReqQ
    ? Array.isArray(req.query.q)
      ? req.query.q[0]
      : req.query.q
    : urlParams.get('q');

  return { action, hasQ, rawQ };
}

export default async function handler(req, res) {
  setNoCacheHeaders(res);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    return res.status(405).json({
      ok: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Method not allowed',
    });
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      ok: false,
      available: false,
      error: 'UNAVAILABLE',
      message: 'Service temporarily unavailable',
    });
  }

  try {
    const settingsRows = await supabaseFetch('/settings?id=eq.current&select=data');
    const settingsData = parseJsonObj(settingsRows?.[0]?.data, {});
    if (settingsData.customerPortalBetaEnabled !== true) {
      return res.status(404).json({
        ok: false,
        available: false,
        error: 'Not found',
      });
    }

    const { action, hasQ, rawQ } = parseQueryParams(req);
    if (action === 'status' || !hasQ) {
      return res.status(200).json({
        ok: true,
        available: true,
        brand: {
          name: 'Bahaar Journeys',
          logo: '/bahaar-logo.png',
        },
      });
    }

    const q = String(rawQ ?? '').trim().replace(/\s+/g, ' ');
    const nonSpaceLen = q.replace(/\s+/g, '').length;
    if (q.length < 2 || q.length > 80 || nonSpaceLen < 2) {
      return res.status(400).json({
        ok: false,
        available: true,
        error: 'INVALID_QUERY',
        message: 'Enter between 2 and 80 characters (Query Code, CRM ID, or Invoice Number).',
      });
    }

    if (!QUERY_RE.test(q) || !HAS_ALNUM_RE.test(q)) {
      return res.status(400).json({
        ok: false,
        available: true,
        error: 'INVALID_QUERY',
        message: 'Invalid characters in search query.',
      });
    }

    // Per-IP fixed-window rate limiting in crm_company (20 lookups / 5 min)
    const clientIp = extractClientIp(req);
    const rlId = `rl_pub_${crypto.createHash('sha256').update(clientIp).digest('hex').slice(0, 24)}`;
    const rlRows = await supabaseFetch(`/crm_company?id=eq.${encodeURIComponent(rlId)}&select=data`);
    const existingRl = parseJsonObj(rlRows?.[0]?.data, null);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const existingWindowStart = Number(existingRl?.windowStart);
    const inWindow =
      Number.isFinite(existingWindowStart) &&
      existingWindowStart > 0 &&
      nowMs - existingWindowStart < RATE_LIMIT_WINDOW_MS;
    const windowStart = inWindow ? existingWindowStart : nowMs;
    const count = inWindow ? Math.max(0, Number(existingRl?.count) || 0) : 0;

    if (count >= RATE_LIMIT_MAX) {
      const retryAfterSec = Math.max(1, Math.ceil((windowStart + RATE_LIMIT_WINDOW_MS - nowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({
        ok: false,
        available: true,
        error: 'RATE_LIMITED',
        retryAfterSec,
        message: `Too many lookup requests. Please wait ${retryAfterSec} seconds and try again.`,
      });
    }

    await supabaseFetch('/crm_company?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([
        {
          id: rlId,
          data: {
            count: count + 1,
            windowStart,
            updatedAt: nowIso,
          },
          updated_at: nowIso,
        },
      ]),
    });

    // Step 1: Primary candidate lookup (kind=eq.customer & safe allowlisted select)
    // Run exact-match query and compound *term* query in parallel so exact matches
    // are never truncated by 100+ newer substring decoys (e.g. Q-10 vs Q-1000..Q-1149).
    const qCore = q.replace(/^(?:\s*\/\s*)+|(?:\s*\/\s*)+$/g, '').trim();
    const qSlash = qCore.replace(/(?:\s*\/\s*)+/g, '/');
    const qSpacedSlash = qCore.includes('/') ? qCore.replace(/(?:\s*\/\s*)+/g, ' / ') : '';
    const exactTerms = Array.from(
      new Set([q, qSlash, qSpacedSlash].filter((t) => t && HAS_ALNUM_RE.test(t)))
    );
    const exactClauseSet = new Set();
    const flexClauseSet = new Set();
    for (const term of exactTerms) {
      const escaped = escLike(term);
      if (!escaped) continue;
      exactClauseSet.add(`invoice_no.ilike.${pgQuote(escaped)}`);
      for (const clause of tokenBoundaryIlikeClauses('crm_id', term)) exactClauseSet.add(clause);
      for (const clause of tokenBoundaryIlikeClauses('query_code', term)) exactClauseSet.add(clause);
      const crmFlex = slashFlexIlikeClause('crm_id', term);
      if (crmFlex) flexClauseSet.add(crmFlex);
      const queryFlex = slashFlexIlikeClause('query_code', term);
      if (queryFlex) flexClauseSet.add(queryFlex);
    }
    const slashSegments = qCore
      .split('/')
      .map((t) => t.trim())
      .filter((t) => t.length >= 1 && HAS_ALNUM_RE.test(t));
    if (slashSegments.length >= 2 && slashSegments.length <= 6) {
      for (let i = 1; i < slashSegments.length; i++) {
        const leftParts = slashSegments.slice(0, i).map(escLike).filter(Boolean);
        const rightParts = slashSegments.slice(i).map(escLike).filter(Boolean);
        if (leftParts.length !== i || rightParts.length !== slashSegments.length - i) continue;
        const leftVariants =
          leftParts.length === 1
            ? [leftParts[0]]
            : Array.from(new Set([leftParts.join('/'), leftParts.join(' / ')]));
        const rightVariants =
          rightParts.length === 1
            ? [rightParts[0]]
            : Array.from(new Set([rightParts.join('/'), rightParts.join(' / ')]));
        for (const lv of leftVariants) {
          for (const rv of rightVariants) {
            exactClauseSet.add(`and(crm_id.ilike.${pgQuote(lv)},query_code.ilike.${pgQuote(rv)})`);
            exactClauseSet.add(`and(crm_id.ilike.${pgQuote(rv)},query_code.ilike.${pgQuote(lv)})`);
          }
        }
      }
    }
    const exactClauses = Array.from(exactClauseSet);
    const flexClauses = Array.from(flexClauseSet);

    const searchTerms = Array.from(
      new Set([q, qSlash, qSpacedSlash, ...rawTokens(q)])
    )
      .filter((t) => t && HAS_ALNUM_RE.test(t))
      .slice(0, 6);
    const compoundClauses = [];
    for (const term of searchTerms) {
      const escaped = escLike(term);
      if (!escaped) continue;
      compoundClauses.push(`crm_id.ilike.${pgQuote(`*${escaped}*`)}`);
      compoundClauses.push(`query_code.ilike.${pgQuote(`*${escaped}*`)}`);
    }

    const [exactRows, flexRows, compoundRows] = await Promise.all([
      fetchChunkedRows(exactClauses, buildInvoiceOrEndpoint),
      fetchChunkedRows(flexClauses, buildInvoiceOrEndpoint),
      fetchChunkedRows(compoundClauses, buildInvoiceOrEndpoint),
    ]);

    const primaryCandidateMap = new Map();
    for (const r of [
      ...(Array.isArray(exactRows) ? exactRows : []),
      ...(Array.isArray(flexRows) ? flexRows : []),
      ...(Array.isArray(compoundRows) ? compoundRows : []),
    ]) {
      if (r?.id && !primaryCandidateMap.has(r.id)) {
        primaryCandidateMap.set(r.id, r);
      }
    }
    const primaryRows = Array.from(primaryCandidateMap.values());

    // Step 2: Strict JS primary verification (blocks partial substring false positives)
    const qNorm = norm(q);
    const qNormSlash = normSlash(q);
    const primaryMatched = primaryRows.filter((r) => {
      if (!r || r.kind === 'vendor') return false;
      const invNoNorm = norm(r.invoice_no);
      if (invNoNorm && (invNoNorm === qNorm || normSlash(r.invoice_no) === qNormSlash)) return true;
      const tokens = invTokenSet(r);
      return tokens.has(qNorm) || tokens.has(qNormSlash);
    });

    if (primaryMatched.length === 0) {
      return res.status(404).json({
        ok: false,
        available: true,
        found: false,
      });
    }

    // Step 3: Expand sibling customer invoices sharing matched crm_id / query_code tokens
    const siblingKeys = new Set();
    const siblingDbTerms = [];
    const seenDbTerm = new Set();

    const collectSiblingTokens = (val, keySet, dbTerms, seenTerms) => {
      const trimmed = String(val || '').trim().replace(/\s+/g, ' ');
      if (!trimmed || !HAS_ALNUM_RE.test(trimmed)) return;
      const n = norm(trimmed);
      if (n && HAS_ALNUM_RE.test(n)) keySet.add(n);
      const ns = normSlash(trimmed);
      if (ns && HAS_ALNUM_RE.test(ns)) keySet.add(ns);
      for (const tok of splitTokens(trimmed)) keySet.add(tok);

      const core = trimmed.replace(/^(?:\s*\/\s*)+|(?:\s*\/\s*)+$/g, '').trim();
      const slashTrimmed = core.replace(/(?:\s*\/\s*)+/g, '/');
      const spacedSlash = core.includes('/') ? core.replace(/(?:\s*\/\s*)+/g, ' / ') : '';
      for (const candidate of [trimmed, slashTrimmed, spacedSlash, ...rawTokens(trimmed)]) {
        const clean = candidate.trim().replace(/\s+/g, ' ');
        const lower = clean.toLowerCase();
        if (
          clean.length >= 2 &&
          QUERY_RE.test(clean) &&
          HAS_ALNUM_RE.test(clean) &&
          !seenTerms.has(lower)
        ) {
          seenTerms.add(lower);
          dbTerms.push(clean);
        }
      }
    };

    for (const r of primaryMatched) {
      collectSiblingTokens(r.crm_id, siblingKeys, siblingDbTerms, seenDbTerm);
      collectSiblingTokens(r.query_code, siblingKeys, siblingDbTerms, seenDbTerm);
    }

    const invoiceMap = new Map();
    for (const r of primaryMatched) {
      if (r?.id) invoiceMap.set(r.id, r);
    }

    if (siblingKeys.size > 0 && siblingDbTerms.length > 0) {
      const sibExactClauseSet = new Set();
      const sibCompoundClauseSet = new Set();
      for (const term of siblingDbTerms.slice(0, 12)) {
        const escaped = escLike(term);
        if (!escaped) continue;
        for (const clause of tokenBoundaryIlikeClauses('crm_id', term)) sibExactClauseSet.add(clause);
        for (const clause of tokenBoundaryIlikeClauses('query_code', term)) sibExactClauseSet.add(clause);
        const crmFlex = slashFlexIlikeClause('crm_id', term);
        if (crmFlex) sibCompoundClauseSet.add(crmFlex);
        const queryFlex = slashFlexIlikeClause('query_code', term);
        if (queryFlex) sibCompoundClauseSet.add(queryFlex);
        sibCompoundClauseSet.add(`crm_id.ilike.${pgQuote(`*${escaped}*`)}`);
        sibCompoundClauseSet.add(`query_code.ilike.${pgQuote(`*${escaped}*`)}`);
      }
      const sibExactClauses = Array.from(sibExactClauseSet);
      const sibCompoundClauses = Array.from(sibCompoundClauseSet);
      if (sibExactClauses.length > 0 || sibCompoundClauses.length > 0) {
        const [sibExactRows, sibCompoundRows] = await Promise.all([
          fetchChunkedRows(sibExactClauses, buildInvoiceOrEndpoint),
          fetchChunkedRows(sibCompoundClauses, buildInvoiceOrEndpoint),
        ]);
        for (const r of [
          ...(Array.isArray(sibExactRows) ? sibExactRows : []),
          ...(Array.isArray(sibCompoundRows) ? sibCompoundRows : []),
        ]) {
          if (!r || !r.id || r.kind === 'vendor' || invoiceMap.has(r.id)) continue;
          const tokens = invTokenSet(r);
          if ([...tokens].some((tok) => siblingKeys.has(tok))) {
            invoiceMap.set(r.id, r);
          }
        }
      }
    }

    const matchedInvoices = Array.from(invoiceMap.values()).sort((a, b) => {
      const dateCmp = String(b.invoice_date || '').localeCompare(String(a.invoice_date || ''));
      if (dateCmp !== 0) return dateCmp;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    // Step 4: Fetch crm_company visa-* rows
    const safeIds = Array.from(
      new Set(
        matchedInvoices
          .map((inv) => String(inv.id || ''))
          .filter((id) => SAFE_ID_RE.test(id))
      )
    );

    const visaMap = new Map();
    if (safeIds.length > 0) {
      const visaIdItems = safeIds.map((id) => pgQuote(`visa-${id}`));
      const visaRows = await fetchChunkedRows(visaIdItems, buildVisaInEndpoint);
      for (const row of visaRows) {
        if (typeof row?.id === 'string' && row.id.startsWith('visa-')) {
          visaMap.set(row.id.slice(5), {
            data: parseJsonObj(row.data, null),
            updatedAt: row.updated_at || null,
          });
        }
      }
    }

    const visaStats = {
      total: 0,
      notStarted: 0,
      inProgress: 0,
      issued: 0,
    };

    const publicInvoices = matchedInvoices.map((r) => {
      const visaEntry = visaMap.get(r.id);
      const vp = visaEntry?.data || null;
      const isVisa = Boolean(vp?.enabled) || hasVisaKeyword(r.sections);
      let visaProgress = null;

      if (isVisa) {
        const status = ['not_started', 'in_progress', 'issued'].includes(vp?.status)
          ? vp.status
          : 'not_started';
        visaProgress = {
          enabled: true,
          status,
          inProgressDate: validDateOnly(vp?.inProgressDate),
          issuedDate: validDateOnly(vp?.issuedDate),
          updatedAt: vp?.updatedAt || visaEntry?.updatedAt || null,
        };
        visaStats.total += 1;
        if (status === 'issued') visaStats.issued += 1;
        else if (status === 'in_progress') visaStats.inProgress += 1;
        else visaStats.notStarted += 1;
      }

      return {
        id: r.id,
        invoiceNo: r.invoice_no,
        crmId: r.crm_id || '',
        queryCode: r.query_code || '',
        customerName: r.customer_name || '',
        reference: r.reference || '',
        invoiceDate: r.invoice_date,
        dueDate: r.due_date || null,
        currency: r.currency || 'PKR',
        sections: sanitizeSections(r.sections),
        taxLabel: r.tax_label || 'Tax',
        taxRate: num(r.tax_rate),
        discount: num(r.discount),
        advancePaid: num(r.advance_paid),
        subtotal: num(r.subtotal),
        taxAmount: num(r.tax_amount),
        total: num(r.total),
        balance: num(r.balance),
        status: r.status || 'unpaid',
        isVisa,
        visaProgress,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });

    // Step 5: Sanitized crm_receipts matched by query_code tokens across ALL matched invoices
    const receiptTokenSet = new Set();
    const receiptDbTerms = [];
    const seenReceiptDbTerm = new Set();
    for (const inv of matchedInvoices) {
      collectSiblingTokens(inv.crm_id, receiptTokenSet, receiptDbTerms, seenReceiptDbTerm);
      collectSiblingTokens(inv.query_code, receiptTokenSet, receiptDbTerms, seenReceiptDbTerm);
    }
    for (const inv of matchedInvoices) {
      collectSiblingTokens(crmQueryText(inv), receiptTokenSet, receiptDbTerms, seenReceiptDbTerm);
    }

    let receiptsSummary = [];
    if (receiptTokenSet.size > 0 && receiptDbTerms.length > 0) {
      const rcpExactClauseSet = new Set();
      const rcpCompoundClauseSet = new Set();
      for (const term of receiptDbTerms.slice(0, 24)) {
        const escaped = escLike(term);
        if (!escaped) continue;
        for (const clause of tokenBoundaryIlikeClauses('query_code', term)) rcpExactClauseSet.add(clause);
        const queryFlex = slashFlexIlikeClause('query_code', term);
        if (queryFlex) rcpCompoundClauseSet.add(queryFlex);
        rcpCompoundClauseSet.add(`query_code.ilike.${pgQuote(`*${escaped}*`)}`);
      }
      const rcpExactClauses = Array.from(rcpExactClauseSet);
      const rcpCompoundClauses = Array.from(rcpCompoundClauseSet);
      if (rcpExactClauses.length > 0 || rcpCompoundClauses.length > 0) {
        const [exactReceiptRows, compoundReceiptRows] = await Promise.all([
          fetchChunkedRows(rcpExactClauses, buildReceiptOrEndpoint),
          fetchChunkedRows(rcpCompoundClauses, buildReceiptOrEndpoint),
        ]);
        const receiptRowMap = new Map();
        for (const r of [
          ...(Array.isArray(exactReceiptRows) ? exactReceiptRows : []),
          ...(Array.isArray(compoundReceiptRows) ? compoundReceiptRows : []),
        ]) {
          if (!r) continue;
          const dedupKey =
            r.receipt_no ||
            `${r.query_code || ''}|${r.created_at || ''}|${r.payment_type || ''}|${r.total_amount ?? ''}|${r.amount_received ?? 0}|${r.other_item || ''}`;
          if (!receiptRowMap.has(dedupKey)) {
            receiptRowMap.set(dedupKey, r);
          }
        }
        receiptsSummary = Array.from(receiptRowMap.values())
          .filter((r) => {
            const rTokens = [norm(r.query_code), normSlash(r.query_code), ...splitTokens(r.query_code)]
              .filter((tok) => tok && HAS_ALNUM_RE.test(tok));
            return rTokens.some((tok) => receiptTokenSet.has(tok));
          })
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
          .map((r) => ({
            receiptNo: r.receipt_no,
            queryCode: r.query_code || '',
            paymentType: r.payment_type === 'partial' ? 'partial' : 'full',
            currency: r.currency || 'PKR',
            totalAmount: num(r.total_amount),
            amountReceived: num(r.amount_received),
            items: parseJsonArr(r.items).map((it) => String(it)),
            otherItem: String(r.other_item || ''),
            createdAt: r.created_at,
          }));
      }
    }

    const customerName =
      publicInvoices.find((inv) => String(inv.customerName || '').trim())?.customerName || '';

    return res.status(200).json({
      ok: true,
      available: true,
      found: true,
      query: q,
      customerName,
      invoices: publicInvoices,
      receiptsSummary,
      visaStats,
    });
  } catch (err) {
    console.error('Public customers API error:', err);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to load customer records.',
    });
  }
}
