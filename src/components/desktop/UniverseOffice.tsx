import React, { useEffect, useRef, useState } from 'react';
import type { Employee } from '../../types';
import { UniverseIllustration } from '../common/EmployeeIdentity';
import { humanCharacter } from '../../lib/universeCharacters.js';
import './universeOffice.css';

type Phase = 'away' | 'walking-in' | 'working' | 'closing' | 'walking-out';
type Worker = { e: Employee; state: string };

function Desk({ worker }: { worker: Worker }) {
  const active = worker.state === 'in';
  const [phase, setPhase] = useState<Phase>(active ? 'working' : 'away');
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    let second: ReturnType<typeof setTimeout> | undefined;
    if (active) {
      setPhase('walking-in');
      second = setTimeout(() => setPhase('working'), 1700);
      return () => clearTimeout(second);
    }
    setPhase('closing');
    const first = setTimeout(() => { setPhase('walking-out'); second = setTimeout(() => setPhase('away'), 1700); }, 650);
    return () => { clearTimeout(first); if (second) clearTimeout(second); };
  }, [active]);
  const id = worker.e.gameCharacterId || `human-${1 + [...worker.e.id].reduce((n,c) => n + c.charCodeAt(0),0) % 54}`;
  const outfit = humanCharacter(id)?.outfit || '#4f46e5';
  const skin = humanCharacter(id)?.skin || '#e7b690';
  const walking = phase === 'walking-in' || phase === 'walking-out';
  const seated = phase === 'working' || phase === 'closing';
  const head = <foreignObject x="-20" y="-22" width="40" height="40"><UniverseIllustration id={id}/></foreignObject>;
  return <div className="rounded-2xl border border-violet-200/70 bg-white/80 overflow-hidden dark:bg-slate-900 dark:border-slate-700 min-w-0" data-phase={phase}>
    <svg viewBox="0 0 200 125" role="img" aria-label={`${worker.e.name}: ${phase === 'working' ? 'working at laptop' : phase === 'closing' ? 'closing laptop' : walking ? 'walking through the office' : 'away from desk'}`} className="w-full">
      <rect width="200" height="125" fill="#e0e7ff"/><path d="M0 92H200V125H0Z" fill="#c7d2fe"/><path d="M0 109H200" stroke="#a5b4fc" strokeWidth="5" strokeDasharray="12 4"/><rect x="15" y="11" width="42" height="32" rx="4" fill="#fff"/><path d="M36 11V43M15 27H57" stroke="#c7d2fe" strokeWidth="2"/><path d="M150 16H184V44H150Z" fill="#fff"/><path d="M156 34L166 22L175 34" stroke="#7c3aed" fill="none" strokeWidth="3"/>
      <path d="M116 76V97H147V76" stroke="#64748b" strokeWidth="5" fill="none"/><path d="M121 94V105M142 94V105" stroke="#64748b" strokeWidth="3"/>
      {seated && <g transform="translate(126 47)">{head}<path d="M-10 18Q0 13 10 18L14 42H-13Z" fill={outfit}/><path d="M-8 40L-12 59L-27 59M8 40L5 59H-10" stroke="#334155" strokeWidth="7" fill="none" strokeLinecap="round"/><path d="M-8 22L-17 30L-31 29M8 22L14 33L-6 34" stroke={skin} strokeWidth="6" fill="none" strokeLinecap="round"/></g>}
      <path d="M78 78H156V84H78Z" fill="#a16207"/><path d="M84 84V104M150 84V104" stroke="#854d0e" strokeWidth="4"/>
      <path d="M89 76H120" stroke="#475569" strokeWidth="4" strokeLinecap="round"/>
      {seated && <path className={phase === 'closing' ? 'universe-lid-close' : ''} d="M91 76L85 57H113L119 76Z" fill="#334155" stroke="#475569" strokeWidth="1.5"/>}
      {walking && <g className={phase === 'walking-in' ? 'universe-walk-in' : 'universe-walk-out'}><g transform="translate(0 42)">{head}<path d="M-11 18Q0 13 11 18L13 46H-13Z" fill={outfit}/><path className="universe-leg-a" d="M-7 44L-10 67L-19 67" stroke="#334155" strokeWidth="7" fill="none" strokeLinecap="round"/><path className="universe-leg-b" d="M7 44L10 67L18 67" stroke="#334155" strokeWidth="7" fill="none" strokeLinecap="round"/><path className="universe-arm" d="M-10 20L-16 37M10 20L16 37" stroke={skin} strokeWidth="6" strokeLinecap="round"/></g></g>}
      {!seated && !walking && <text x="100" y="65" textAnchor="middle" fill="#64748b" fontSize="10">Desk available</text>}
      {seated && worker.e.gamePetId && worker.e.gamePetId !== 'none' && <foreignObject x="159" y="84" width="25" height="25"><UniverseIllustration id={worker.e.gamePetId}/></foreignObject>}
    </svg>
    <div className="flex items-center justify-between gap-1 px-2.5 py-2"><b className="text-[11px] truncate">{worker.e.name}</b><span className={`text-[9px] shrink-0 ${active ? 'text-emerald-600' : 'text-slate-500'}`}>{phase === 'walking-in' ? 'Arriving' : phase === 'walking-out' || phase === 'closing' ? 'Leaving' : active ? 'Working' : worker.state === 'out' ? 'Clocked out' : 'Away'}</span></div>
  </div>;
}

export function UniverseOffice({ workers }: { workers: Worker[] }) {
  return <section className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-sky-50 p-4 dark:bg-slate-900 dark:from-slate-900 dark:to-slate-800 dark:border-slate-700"><div className="flex items-center justify-between mb-3"><div><h2 className="font-black text-violet-800 dark:text-violet-200">✦ Employee Universe · Live Office</h2><p className="text-xs text-slate-500">Your crew arrives, works at their desks, and heads home as attendance updates arrive.</p></div><span className="rounded-full bg-emerald-100 text-emerald-700 px-3 py-1 font-bold text-xs">● Live</span></div><div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">{workers.map((worker) => <Desk key={worker.e.id} worker={worker}/>)}</div></section>;
}
