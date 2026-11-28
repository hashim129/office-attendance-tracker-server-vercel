import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquare, Star } from 'lucide-react';
import type { Employee } from '../types';
import { crmCall } from './crmApi';
import { cardCls, inputCls } from './ui';

/** What customers said after their trip. Admin / CEO see every response; everyone else sees feedback on their own invoices. */
interface Response { overall: number; visa: number | null; hotel: number | null; flights: number | null; staff: number | null; comment: string; at: string }
interface Item { token: string; invoiceId: string; invoiceNo: string; customerName: string; phone: string; createdBy: string | null; createdByName: string; createdAt: string; response: Response }
type Avg = { avg: number | null; count: number };
interface Data { responses: Item[]; waiting: number; sent: number; averages: Record<'overall' | 'visa' | 'hotel' | 'flights' | 'staff', Avg>; seesAll: boolean }

const PARTS: { key: 'visa' | 'hotel' | 'flights' | 'staff'; label: string }[] = [
  { key: 'visa', label: 'Visa' }, { key: 'hotel', label: 'Hotel' }, { key: 'flights', label: 'Flights' }, { key: 'staff', label: 'Our team' },
];
const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const waNumber = (p: string) => { const d = p.replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? `92${d.slice(1)}` : d; };

const Stars: React.FC<{ n: number; size?: string }> = ({ n, size = 'w-3.5 h-3.5' }) => (
  <span className="inline-flex items-center gap-0.5" aria-label={`${n} of 5 stars`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`${size} ${i <= Math.round(n) ? 'text-amber-500 fill-amber-400' : 'text-slate-300 dark:text-slate-600'}`} />)}
  </span>
);

/**
 * "Ask for feedback" on an invoice: makes (or reuses) the private link and opens WhatsApp with a short message.
 * The WhatsApp window is opened first (before the network call) so phone browsers do not block it.
 */
export async function sendFeedbackRequest(invoice: { id: string; customerName: string; customerPhone?: string }): Promise<string> {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const r = await crmCall<{ url: string; submitted: boolean }>('people_feedback_link', { invoiceId: invoice.id, origin: window.location.origin });
    const first = (invoice.customerName || '').trim().split(/\s+/)[0] || 'there';
    const text = `Assalam o Alaikum ${first}, welcome back! We hope you had a good trip with Bahaar Journeys. Could you spare a minute to tell us how it went? ${r.url}\nThank you.`;
    const phone = waNumber(invoice.customerPhone || '');
    const wa = `https://wa.me/${phone.length >= 10 ? phone : ''}?text=${encodeURIComponent(text)}`;
    if (win) win.location.href = wa; else window.location.href = wa;
    return r.url;
  } catch (e) {
    win?.close();
    throw e;
  }
}

export const FeedbackView: React.FC<{ currentUser: Employee }> = ({ currentUser }) => {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [minStars, setMinStars] = useState(0);
  useEffect(() => {
    crmCall<Data>('people_feedback_list').then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e?.message || 'Could not load the feedback.'));
  }, [currentUser.id]);
  const list = useMemo(() => {
    if (!d) return [];
    const s = q.trim().toLowerCase();
    return d.responses.filter((r) => (!minStars || (minStars < 0 ? r.response.overall <= 3 : r.response.overall >= minStars)) && (!s || `${r.customerName} ${r.invoiceNo} ${r.response.comment} ${r.createdByName}`.toLowerCase().includes(s)));
  }, [d, q, minStars]);

  return (
    <div className="space-y-4" data-feedback-view>
      <div className={`${cardCls} p-4`}>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Customer feedback</h2>
        <p className="text-xs text-slate-500">{d?.seesAll ? 'What every customer said after their trip.' : 'What your customers said after their trip.'} Send the link from an invoice with “Ask for feedback”.</p>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!d && !err && <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Loading">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <div className={`${cardCls} p-3 col-span-2`}>
              <p className="text-[11px] text-slate-500">Overall</p>
              <p className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{d.averages.overall.avg ?? '—'}<span className="text-xs font-normal text-slate-500"> / 5</span></p>
              {d.averages.overall.avg !== null && <Stars n={d.averages.overall.avg} />}
              <p className="text-[11px] text-slate-500 mt-1">{d.responses.length} response{d.responses.length === 1 ? '' : 's'} · {d.waiting} link{d.waiting === 1 ? '' : 's'} not answered yet</p>
            </div>
            {PARTS.map((p) => (
              <div key={p.key} className={`${cardCls} p-3`}>
                <p className="text-[11px] text-slate-500">{p.label}</p>
                <p className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{d.averages[p.key].avg ?? '—'}</p>
                <p className="text-[11px] text-slate-400">{d.averages[p.key].count} rated</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input className={`${inputCls} min-h-10 sm:flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by customer, invoice or comment" />
            <select className={`${inputCls} min-h-10 sm:w-48`} value={minStars} onChange={(e) => setMinStars(Number(e.target.value))}>
              <option value={0}>All ratings</option>
              <option value={5}>5 stars</option>
              <option value={4}>4 stars and up</option>
              <option value={-1}>3 stars or less</option>
            </select>
          </div>

          {d.responses.length === 0 ? (
            <div className={`${cardCls} p-8 text-center`}>
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No feedback yet</p>
              <p className="text-xs text-slate-500 mt-1">A few days after a trip you will get a reminder to ask the customer. Their answers show up here.</p>
            </div>
          ) : list.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-6">Nothing matches this search.</p>
          ) : (
            <ul className="space-y-2">
              {list.map((r) => (
                <li key={r.token} className={`${cardCls} p-3 sm:p-4`}>
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{r.customerName}<span className="font-normal text-slate-500"> · invoice {r.invoiceNo}</span></p>
                      <p className="text-[11px] text-slate-500">{when(r.response.at)}{r.createdByName ? ` · sent by ${r.createdByName}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0"><Stars n={r.response.overall} size="w-4 h-4" /><span className="text-xs font-semibold tabular-nums">{r.response.overall}/5</span></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {PARTS.filter((p) => r.response[p.key]).map((p) => (
                      <span key={p.key} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{p.label} {r.response[p.key]}/5</span>
                    ))}
                  </div>
                  {r.response.comment && <p className="text-xs text-slate-700 dark:text-slate-200 mt-2 whitespace-pre-line break-words">“{r.response.comment}”</p>}
                  {r.phone && r.response.overall <= 3 && (
                    <a className="inline-flex items-center mt-2 text-xs font-semibold text-blue-600 min-h-10 sm:min-h-0" href={`https://wa.me/${waNumber(r.phone)}`} target="_blank" rel="noreferrer">Message {r.customerName.split(' ')[0]} on WhatsApp</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default FeedbackView;
