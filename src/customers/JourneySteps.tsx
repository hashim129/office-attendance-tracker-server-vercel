import { useEffect, useRef, useState } from 'react';
import { BedDouble, Car, CreditCard, Plane, ShieldCheck, Luggage } from 'lucide-react';

const STEPS = [
  { icon: CreditCard, title: 'Payment', text: 'Your payment is confirmed by our accounts team.' },
  { icon: ShieldCheck, title: 'Visa progress', text: 'From documents received to visa issued.' },
  { icon: BedDouble, title: 'Hotel booking', text: 'Hotel name and stay dates, once confirmed.' },
  { icon: Plane, title: 'Air tickets', text: 'Your flights are issued and shared with you.' },
  { icon: Car, title: 'Tours & transfers', text: 'Airport pickups and tours arranged.' },
  { icon: Luggage, title: 'Travel ready', text: 'Everything is in place. Safe travels.' },
];

/**
 * Explains, in the portal's own look, the stages a booking moves through. The stages light up one by one
 * (and a small plane follows along) the first time the section scrolls into view.
 */
export default function JourneySteps() {
  const ref = useRef<HTMLElement>(null);
  const [lit, setLit] = useState(0);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setLit(STEPS.length); return; }
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      let n = 0;
      const tick = () => { n += 1; setLit(n); if (n < STEPS.length) timer = window.setTimeout(tick, 420); };
      timer = window.setTimeout(tick, 250);
    }, { threshold: 0.35 });
    io.observe(el);
    return () => { io.disconnect(); window.clearTimeout(timer); };
  }, []);

  const pct = lit <= 1 ? 0 : ((lit - 1) / (STEPS.length - 1)) * 100;

  return (
    <section ref={ref} className="no-print rounded-3xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-sky-700">How tracking works</span>
      <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 mt-1">Every stage of your booking, in one place</h2>
      <p className="text-sm text-slate-600 mt-1 max-w-2xl">Enter your Query Code, CRM ID or Invoice Number above and see exactly where your trip stands.</p>

      {/* desktop: horizontal line with a plane that moves to the latest stage */}
      <div className="hidden lg:block relative mt-8">
        <div className="absolute left-[8.33%] right-[8.33%] top-6 h-1 rounded-full bg-slate-200" />
        <div className="absolute left-[8.33%] top-6 h-1 rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-all duration-500 ease-out" style={{ width: `${pct * 0.8333}%` }} />
        <Plane className="absolute top-[14px] w-5 h-5 -ml-2.5 text-blue-600 rotate-45 fill-sky-100 transition-all duration-500 ease-out" style={{ left: `calc(8.33% + ${pct * 0.8333}%)`, opacity: lit ? 1 : 0, transform: 'translateY(-14px) rotate(45deg)' }} aria-hidden="true" />
        <ol className="relative grid grid-cols-6 gap-3">
          {STEPS.map((s, i) => {
            const on = i < lit; const Icon = s.icon;
            return (
              <li key={s.title} className="flex flex-col items-center text-center">
                <span className={`flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all duration-500 ${on ? 'bg-gradient-to-br from-sky-500 to-blue-600 border-white text-white shadow-lg shadow-sky-500/30 scale-100' : 'bg-white border-slate-200 text-slate-400 scale-95'}`}>
                  <Icon className="w-5 h-5" />
                </span>
                <p className={`mt-3 text-sm font-bold transition-colors ${on ? 'text-slate-900' : 'text-slate-400'}`}>{s.title}</p>
                <p className="mt-1 text-xs leading-snug text-slate-500 max-w-[11rem]">{s.text}</p>
              </li>
            );
          })}
        </ol>
      </div>

      {/* phones / tablets: vertical list */}
      <ol className="lg:hidden mt-6 relative space-y-4">
        <span className="absolute left-6 top-3 bottom-3 w-0.5 bg-slate-200" aria-hidden="true" />
        {STEPS.map((s, i) => {
          const on = i < lit; const Icon = s.icon;
          return (
            <li key={s.title} className="relative flex items-start gap-4">
              <span className={`relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2 transition-all duration-500 ${on ? 'bg-gradient-to-br from-sky-500 to-blue-600 border-white text-white shadow-lg shadow-sky-500/30' : 'bg-white border-slate-200 text-slate-400'}`}>
                <Icon className="w-5 h-5" />
              </span>
              <div className="pt-1">
                <p className={`text-sm font-bold transition-colors ${on ? 'text-slate-900' : 'text-slate-400'}`}>{s.title}</p>
                <p className="text-xs leading-snug text-slate-500">{s.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
