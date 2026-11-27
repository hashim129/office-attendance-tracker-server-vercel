import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Employee } from '../../types';
import { verifyEmployeePin, lookupLogin } from '../../lib/pinAuth';
import './appLogin.css';

/**
 * Phone app sign-in (Android APK only). The Bahaar Journeys logo sits in the middle of
 * a blue gradient page (same spot as the app's opening screen), then moves up as the light sign-in sheet slides up, and after a correct password
 * the screen hands over smoothly to the home page.
 */
interface Props {
  employees: Employee[];
  onLogin: (employee: Employee, keepLoggedIn: boolean) => void;
  companyName: string;
  isSyncing?: boolean;
  siteDisabled?: boolean;
}

const LAST_KEY = 'bahaar_app_last_employee';
const TINTS = [
  ['#e0f2fe', '#0369a1'], ['#ede9fe', '#6d28d9'], ['#dcfce7', '#15803d'], ['#fef3c7', '#b45309'],
  ['#fce7f3', '#be185d'], ['#e0e7ff', '#4338ca'], ['#ccfbf1', '#0f766e'], ['#ffedd5', '#c2410c'],
];
const tintFor = (id: string) => TINTS[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % TINTS.length];
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
const roleLabel = (r: string) => (r === 'ceo' ? 'CEO' : r === 'accounts' ? 'Accounts' : r === 'admin' ? 'Admin' : '');
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function readLast(): string {
  try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; }
}

export const AppLoginView: React.FC<Props> = ({ employees, onLogin, companyName, isSyncing = false, siteDisabled = false }) => {
  const people = useMemo(
    () => employees.filter((e) => e.isActive !== false && !e.isSuperAdmin).sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  // intro → form → leaving (success)
  const [phase, setPhase] = useState<'intro' | 'form' | 'leaving'>(() => (reducedMotion() ? 'form' : 'intro'));
  const [selectedId, setSelectedId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [phoneWait, setPhoneWait] = useState(false);
  useEffect(() => { const on = (e: Event) => setPhoneWait(Boolean((e as CustomEvent).detail?.waiting)); window.addEventListener('bahaar-login-pending', on); return () => window.removeEventListener('bahaar-login-pending', on); }, []);
  const pinRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (phase !== 'intro') return;
    const t = window.setTimeout(() => setPhase('form'), 900);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Pre-select the last person who signed in on this phone (or ?emp=CODE from a link).
  const preselected = useRef(false);
  useEffect(() => {
    if (preselected.current || people.length === 0) return;
    preselected.current = true;
    const code = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('emp') : null;
    const byCode = code ? people.find((p) => p.employeeCode.toLowerCase() === code.trim().toLowerCase()) : undefined;
    const last = people.find((p) => p.id === readLast());
    const pick = byCode || last;
    if (pick) setSelectedId(pick.id);
  }, [people]);

  const selected = people.find((p) => p.id === selectedId) || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) =>
      p.name.toLowerCase().includes(q) || p.employeeCode.toLowerCase().includes(q) || (p.designation || '').toLowerCase().includes(q));
  }, [people, query]);

  const choose = (p: Employee) => {
    setSelectedId(p.id);
    setQuery('');
    setListOpen(false);
    setError('');
    setPin('');
    window.setTimeout(() => pinRef.current?.focus(), 60);
  };

  const fail = (msg: string) => {
    setError(msg);
    setShake(false);
    window.requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => setShake(false), 520);
    try { navigator.vibrate?.(60); } catch { /* not supported */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!pin.trim()) { fail('Please enter your password.'); pinRef.current?.focus(); return; }
    let who: Employee | null = selected;
    setBusy(true);
    setError('');
    try {
      if (who) {
        const r = await verifyEmployeePin(who, pin);
        if (!r.ok) { setBusy(false); fail(r.error || 'Incorrect password. Please try again.'); return; }
      } else if (query.trim()) {
        // typed an employee code or work email instead of picking a name
        const r = await lookupLogin(query, pin, people);
        if (!r.ok || !r.employee) { setBusy(false); fail(r.error || 'Incorrect name or password.'); return; }
        who = r.employee;
      } else {
        setBusy(false);
        fail('Please choose your name first.');
        setListOpen(true);
        nameRef.current?.focus();
        return;
      }
    } catch {
      setBusy(false);
      fail('Could not sign in. Check your internet and try again.');
      return;
    }
    if (!who) return;
    try { if (!who.isSuperAdmin) localStorage.setItem(LAST_KEY, who.id); } catch { /* private mode */ }
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (reducedMotion()) { onLogin(who, keep); return; }
    setPhase('leaving');
    const done = who;
    window.setTimeout(() => onLogin(done, keep), 720);
  };

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className={`al-root al-${phase}`} data-app-login>
      <div className="al-glow al-glow-a" aria-hidden />
      <div className="al-glow al-glow-b" aria-hidden />

      <div className="al-stage">
        <div className="al-brand">
          <img className="al-logo" src="/bahaar-logo-white.png" alt={companyName || 'Bahaar Journeys'} draggable={false} />
          <div className="al-hello">
            <p className="al-hello-sub">{greet}</p>
            <h1 className="al-hello-title">Welcome to the office</h1>
          </div>
        </div>
      </div>

      <form className={`al-sheet ${shake ? 'al-shake' : ''}`} onSubmit={submit} autoComplete="off" noValidate>
        <div className="al-grip" aria-hidden />
        <h2 className="al-title">Sign in</h2>
        <p className="al-sub">Choose your name, then enter your password.</p>

        {siteDisabled && <p className="al-note al-note-warn">The office portal is switched off by the Super Admin for now. The Super Admin can still sign in by typing their ID.</p>}
        {isSyncing && people.length === 0 && <p className="al-note"><span className="al-spin al-spin-blue" /> Loading the team list…</p>}

        <label className="al-label" htmlFor="al-name">Your name</label>
        {selected && !listOpen ? (
          <button type="button" className="al-chosen" onClick={() => { setListOpen(true); window.setTimeout(() => nameRef.current?.focus(), 40); }}>
            <span className="al-avatar" style={{ background: tintFor(selected.id)[0], color: tintFor(selected.id)[1] }}>{initials(selected.name)}</span>
            <span className="al-chosen-text">
              <b>{selected.name}</b>
              <small>{[selected.designation, roleLabel(selected.role)].filter(Boolean).join(' · ') || selected.employeeCode}</small>
            </span>
            <span className="al-change">Change</span>
          </button>
        ) : (
          <div className="al-picker">
            <div className="al-input-wrap">
              <svg className="al-icon" viewBox="0 0 24 24" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                id="al-name"
                ref={nameRef}
                className="al-input"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelectedId(''); setListOpen(true); setError(''); }}
                onFocus={() => setListOpen(true)}
                placeholder="Type your name or employee ID"
                autoCapitalize="words"
                enterKeyHint="next"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (filtered.length === 1) choose(filtered[0]); else pinRef.current?.focus(); }
                }}
              />
              {selected && <button type="button" className="al-close" onClick={() => setListOpen(false)}>Done</button>}
            </div>
            <ul className="al-list" role="listbox" aria-label="Team members">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={p.id === selectedId} className={`al-person ${p.id === selectedId ? 'is-on' : ''}`} onClick={() => choose(p)}>
                    <span className="al-avatar" style={{ background: tintFor(p.id)[0], color: tintFor(p.id)[1] }}>{initials(p.name)}</span>
                    <span className="al-person-text"><b>{p.name}</b><small>{p.designation || p.employeeCode}</small></span>
                    {roleLabel(p.role) && <span className="al-badge">{roleLabel(p.role)}</span>}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="al-empty">{query.trim() ? 'No name matches. You can sign in with your employee ID or work email as typed.' : 'The team list is still loading…'}</li>
              )}
            </ul>
          </div>
        )}

        <label className="al-label" htmlFor="al-pin">Password</label>
        <div className="al-input-wrap">
          <svg className="al-icon" viewBox="0 0 24 24" aria-hidden><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <input
            id="al-pin"
            ref={pinRef}
            className="al-input al-input-pin"
            type={showPin ? 'text' : 'password'}
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(''); }}
            onFocus={() => setListOpen(false)}
            placeholder="Enter your PIN or password"
            maxLength={32}
            autoComplete="current-password"
            enterKeyHint="go"
          />
          <button type="button" className="al-eye" onClick={() => setShowPin((v) => !v)} aria-label={showPin ? 'Hide password' : 'Show password'}>
            {showPin
              ? <svg viewBox="0 0 24 24" aria-hidden><path d="M3 3l18 18" /><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.7M6.3 7.6C4.2 9.1 3 12 3 12s4 6 9 6a8.8 8.8 0 0 0 4-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
              : <svg viewBox="0 0 24 24" aria-hidden><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        </div>

        <label className="al-keep">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span className="al-toggle" aria-hidden />
          <span>Keep me signed in on this phone</span>
        </label>

        {phoneWait && <p className="al-note" data-phone-wait><span className="al-spin al-spin-blue" /> Approve this sign-in on your phone (Bahaar Office app)…</p>}
        {error && <p className="al-error" role="alert">{error}</p>}

        <button type="submit" className={`al-submit ${phase === 'leaving' ? 'is-done' : ''}`} disabled={busy}>
          {phase === 'leaving'
            ? <><svg viewBox="0 0 24 24" className="al-tick" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg> Welcome{selected ? `, ${selected.name.split(' ')[0]}` : ''}!</>
            : busy ? <><span className="al-spin" /> Checking…</> : <>Sign in <svg viewBox="0 0 24 24" className="al-arrow" aria-hidden><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}
        </button>
        <p className="al-foot">{companyName || 'Bahaar Journeys'} · Office app</p>
      </form>

      <div className="al-curtain" aria-hidden />
    </div>
  );
};

export default AppLoginView;
