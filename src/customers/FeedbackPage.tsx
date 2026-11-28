import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Star } from 'lucide-react';

/**
 * Public page a customer opens from the WhatsApp link (/?feedback=<token>) to rate their trip.
 * No sign-in; it only talks to /api/public-customers (feedback_get / feedback_submit).
 */
type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; name: string; submitted: boolean };
const PARTS = [
  { key: 'visa', label: 'Visa' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'flights', label: 'Flights' },
  { key: 'staff', label: 'Our team' },
] as const;
type PartKey = (typeof PARTS)[number]['key'];
const WORDS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

const tokenFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get('feedback') || ''; } catch { return ''; }
};

async function call(body: Record<string, unknown>) {
  let res: Response;
  try {
    res = await fetch('/api/public-customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error('No internet connection. Please try again.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data?.ok) {
    const e = new Error(data?.message || 'Something went wrong. Please try again.') as Error & { code?: string };
    e.code = data?.error;
    throw e;
  }
  return data;
}

function StarRow({ value, onChange, big, label }: { value: number; onChange: (n: number) => void; big?: boolean; label: string }) {
  const size = big ? 'w-10 h-10' : 'w-8 h-8';
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
          onClick={() => onChange(value === n && !big ? 0 : n)}
          className={`${big ? 'p-1' : 'p-1.5'} rounded-lg active:scale-90 transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500`}>
          <Star className={`${size} ${n <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
        </button>
      ))}
    </div>
  );
}

export default function FeedbackPage() {
  const [token] = useState(tokenFromUrl);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [overall, setOverall] = useState(0);
  const [parts, setParts] = useState<Record<PartKey, number>>({ visa: 0, hotel: 0, flights: 0, staff: 0 });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    document.title = 'Your trip · Bahaar Journeys';
    document.documentElement.classList.remove('dark');
    if (!token) { setLoad({ state: 'error', message: 'This feedback link is not complete. Please open the link from your WhatsApp message again.' }); return; }
    call({ action: 'feedback_get', token })
      .then((d) => setLoad({ state: 'ready', name: d.customerName || '', submitted: Boolean(d.submitted) }))
      .catch((e) => setLoad({ state: 'error', message: e?.message || 'This feedback link is not valid.' }));
  }, [token]);

  const submit = async () => {
    if (!overall) { setErr('Please choose how many stars for your trip overall.'); return; }
    setBusy(true); setErr('');
    try {
      await call({ action: 'feedback_submit', token, overall, ...parts, comment: comment.trim() });
      setDone(true);
    } catch (e: any) {
      if (e?.code === 'ALREADY_SUBMITTED') setDone(true); else setErr(e?.message || 'Could not send. Please try again.');
    } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 via-white to-white text-slate-900">
      <header className="bg-gradient-to-r from-sky-600 to-blue-700 text-white">
        <div className="max-w-md mx-auto px-5 pt-6 pb-10 flex items-center gap-3">
          <img src="/bahaar-logo-white.png" alt="Bahaar Journeys" className="h-9 w-auto object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
          <span className="text-sm font-semibold tracking-wide">Bahaar Journeys</span>
        </div>
      </header>
      <main className="max-w-md mx-auto px-4 -mt-6 pb-10">{children}</main>
    </div>
  );
  const card = 'bg-white rounded-2xl shadow-lg shadow-sky-900/5 border border-slate-100 p-5';

  if (load.state === 'loading') {
    return shell(<div className={`${card} space-y-3`} role="status" aria-label="Loading"><div className="h-5 w-2/3 rounded bg-slate-100 animate-pulse" /><div className="h-10 rounded bg-slate-100 animate-pulse" /><div className="h-24 rounded bg-slate-100 animate-pulse" /></div>);
  }
  if (load.state === 'error') {
    return shell(<div className={`${card} text-center`}><p className="text-base font-semibold">Sorry, this link does not work</p><p className="text-sm text-slate-500 mt-2">{load.message}</p></div>);
  }
  if (done || load.submitted) {
    return shell(
      <div className={`${card} text-center py-8`}>
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        <p className="text-lg font-semibold mt-3">Thank you{load.name ? `, ${load.name}` : ''}!</p>
        <p className="text-sm text-slate-500 mt-1">{done ? 'Your feedback has reached our team. It really helps us plan better trips.' : 'We already have your feedback for this trip. Thank you for sharing it.'}</p>
      </div>,
    );
  }
  return shell(
    <div className={`${card} space-y-6`}>
      <div>
        <h1 className="text-lg font-semibold">Welcome back{load.name ? `, ${load.name}` : ''}!</h1>
        <p className="text-sm text-slate-500 mt-1">How was your trip with us? It takes less than a minute.</p>
      </div>
      <section>
        <p className="text-sm font-semibold">Your trip overall</p>
        <div className="mt-2 flex flex-col items-start gap-1">
          <StarRow value={overall} onChange={(n) => { setOverall(n); setErr(''); }} big label="Overall rating" />
          <p className="text-xs text-slate-500 h-4">{WORDS[overall]}</p>
        </div>
      </section>
      <section>
        <p className="text-sm font-semibold">Anything in particular? <span className="font-normal text-slate-400">(optional)</span></p>
        <div className="mt-2 divide-y divide-slate-100">
          {PARTS.map((p) => (
            <div key={p.key} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-sm text-slate-700">{p.label}</span>
              <StarRow value={parts[p.key]} onChange={(n) => setParts((s) => ({ ...s, [p.key]: n }))} label={`${p.label} rating`} />
            </div>
          ))}
        </div>
      </section>
      <section>
        <label className="block">
          <span className="text-sm font-semibold">Tell us more <span className="font-normal text-slate-400">(optional)</span></span>
          <textarea className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40" rows={4} maxLength={1000}
            value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What did you like? What could we do better?" />
        </label>
        <p className="text-[11px] text-slate-400 text-right">{comment.length}/1000</p>
      </section>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button type="button" onClick={() => void submit()} disabled={busy}
        className="w-full min-h-12 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 text-white text-base font-semibold shadow-md active:scale-[0.98] transition-transform disabled:opacity-60 cursor-pointer">
        {busy ? 'Sending…' : 'Send feedback'}
      </button>
    </div>,
  );
}
