import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, Loader2, Plus, Trash2 } from 'lucide-react';
import { Switch } from '../components/common/Switch';
import { PortalSettingsCard } from '../components/desktop/PortalSettingsCard';
import { CURATED_DESTINATIONS } from '../customers/destinations';
import { CrmState } from './useCrm';
import { crmCall } from './crmApi';
import { ErrorNote, Field, Pill, btnGhost, btnPrimary, cardCls, inputCls } from './ui';

interface Offer { id: string; title: string; text: string; expiresAt: string; active: boolean }
interface DestOverride { tagline?: string; bestSeason?: string; fromPrice?: string; photos?: string[] }
interface Config {
  effects: { jet: boolean; confetti: boolean; scene3d: boolean; planeMap: boolean };
  theme?: string;
  announcement: { enabled: boolean; text: string; tone: 'info' | 'success' | 'warning'; expiresAt: string };
  offers: Offer[];
  destinations: { order: string[]; hidden: string[]; overrides: Record<string, DestOverride> };
}
interface Stats { days?: Record<string, Record<string, number>>; dest?: Record<string, number> }
interface ActivityItem { at: string; byName: string; text: string }

type Tab = 'announce' | 'effects' | 'destinations' | 'whatsapp' | 'stats' | 'activity';
const TABS: { id: Tab; label: string }[] = [
  { id: 'announce', label: 'Announcement & offers' },
  { id: 'effects', label: 'Animations' },
  { id: 'destinations', label: 'Destinations' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'stats', label: 'Statistics' },
  { id: 'activity', label: 'Activity log' },
];

const newId = () => `offer-${Math.random().toString(36).slice(2, 10)}`;
const fmtWhen = (iso: string) => {
  try { return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
};

export const PortalControlView: React.FC<{ crm: CrmState }> = ({ crm }) => {
  const [tab, setTab] = useState<Tab>('announce');
  const [cfg, setCfg] = useState<Config | null>(null);
  const [stats, setStats] = useState<Stats>({});
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [openDest, setOpenDest] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, o] = await Promise.all([crmCall<{ config: Config }>('portal_config_get'), crmCall<{ stats: Stats; activity: ActivityItem[] }>('portal_overview')]);
      setCfg(c.config);
      setStats(o.stats || {});
      setActivity(o.activity || []);
      setLoadError('');
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the portal settings.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (part: Partial<Config>) => {
    setBusy(true);
    setError('');
    try {
      const r = await crmCall<{ config: Config }>('portal_config_save', { config: part });
      setCfg(r.config);
      setSavedKey(Object.keys(part)[0] || '');
      window.setTimeout(() => setSavedKey(''), 2500);
      void crmCall<{ stats: Stats; activity: ActivityItem[] }>('portal_overview').then((o) => setActivity(o.activity || [])).catch(() => {});
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const SaveBar = ({ onSave, k }: { onSave: () => void; k: string }) => (
    <div className="flex items-center gap-3 pt-1">
      <button type="button" onClick={onSave} disabled={busy} className={btnPrimary}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Save
      </button>
      {savedKey === k && <span className="text-xs font-semibold text-emerald-600">Saved — live on the portal.</span>}
    </div>
  );

  // ---- local edit copies per section
  const [ann, setAnn] = useState<Config['announcement']>({ enabled: false, text: '', tone: 'info', expiresAt: '' });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [effects, setEffects] = useState<Config['effects']>({ jet: true, confetti: true, scene3d: true, planeMap: true });
  const [theme, setTheme] = useState('auto');
  const [order, setOrder] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, DestOverride>>({});

  useEffect(() => {
    if (!cfg) return;
    setAnn(cfg.announcement);
    setOffers(cfg.offers || []);
    setEffects(cfg.effects);
    setTheme(cfg.theme || 'auto');
    const known = CURATED_DESTINATIONS.map((d) => d.id);
    const saved = (cfg.destinations.order || []).filter((id) => known.includes(id));
    setOrder([...saved, ...known.filter((id) => !saved.includes(id))]);
    setHidden(cfg.destinations.hidden || []);
    setOverrides(cfg.destinations.overrides || {});
  }, [cfg]);

  const destById = useMemo(() => new Map(CURATED_DESTINATIONS.map((d) => [d.id, d])), []);
  const move = (id: string, dir: -1 | 1) => {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= o.length) return o;
      const n = o.slice();
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  };
  const setOv = (id: string, patch: DestOverride) => setOverrides((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));

  // ---- stats
  const statDays = useMemo(() => {
    const days = stats.days || {};
    return Object.keys(days).sort().slice(-14).map((d) => ({ d, ...days[d] }));
  }, [stats]);
  const totals = useMemo(() => {
    const t = { searches: 0, found: 0, notFound: 0, phone: 0, desktop: 0, quotes: 0, waClicks: 0 } as Record<string, number>;
    for (const row of Object.values(stats.days || {})) for (const k of Object.keys(t)) t[k] += Number(row[k]) || 0;
    return t;
  }, [stats]);
  const maxSearch = Math.max(1, ...statDays.map((x) => Number(x.searches) || 0));
  const topDest = useMemo(
    () => Object.entries(stats.dest || {}).sort((a, b) => b[1] - a[1]).slice(0, 8),
    [stats],
  );
  const qCount = (s: string) => (crm.data.portalQueries || []).filter((x) => x.status === s).length;

  if (loadError) return <div className={`${cardCls} p-6`}><ErrorNote message={loadError} /></div>;
  if (!cfg) return <div className={`${cardCls} p-6 text-xs text-slate-500 flex items-center gap-2`}><Loader2 className="w-4 h-4 animate-spin" /> Loading portal controls…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${tab === t.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <ErrorNote message={error} />

      {tab === 'announce' && (
        <div className="space-y-4">
          <div className={`${cardCls} p-5 space-y-3`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Announcement banner</h3>
            <p className="text-xs text-slate-500">A colored bar at the very top of the customer portal, e.g. “Office closed for Eid 28–30 March”.</p>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Show the banner</span>
              <Switch checked={ann.enabled} onChange={(v) => setAnn({ ...ann, enabled: v })} label="Show the banner" />
            </div>
            <Field label="Message"><input className={inputCls} maxLength={300} value={ann.text} onChange={(e) => setAnn({ ...ann, text: e.target.value })} placeholder="e.g. Our office is closed for Eid from 28 to 30 March. WhatsApp us for urgent help." /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Color">
                <select className={inputCls} value={ann.tone} onChange={(e) => setAnn({ ...ann, tone: e.target.value as Config['announcement']['tone'] })}>
                  <option value="info">Blue (information)</option>
                  <option value="success">Green (good news / offer)</option>
                  <option value="warning">Amber (notice)</option>
                </select>
              </Field>
              <Field label="Hide automatically after (optional)"><input type="date" className={inputCls} value={ann.expiresAt} onChange={(e) => setAnn({ ...ann, expiresAt: e.target.value })} /></Field>
            </div>
            <SaveBar k="announcement" onSave={() => void save({ announcement: ann })} />
          </div>

          <div className={`${cardCls} p-5 space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Offers <span className="text-slate-400 font-medium">(up to 6)</span></h3>
              <button type="button" disabled={offers.length >= 6} onClick={() => setOffers((o) => [...o, { id: newId(), title: '', text: '', expiresAt: '', active: true }])} className={btnGhost}><Plus className="w-3.5 h-3.5" /> Add offer</button>
            </div>
            <p className="text-xs text-slate-500">Offer cards appear above the destinations. Customers can tap “Ask about this offer” to send you a quote request. Expired offers hide themselves.</p>
            {offers.length === 0 && <p className="text-xs text-slate-400">No offers yet.</p>}
            {offers.map((o, idx) => (
              <div key={o.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Field label="Title"><input className={inputCls} maxLength={80} value={o.title} onChange={(e) => setOffers((a) => a.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)))} placeholder="e.g. Umrah package — March" /></Field>
                  <Field label="Ends on (optional)"><input type="date" className={inputCls} value={o.expiresAt} onChange={(e) => setOffers((a) => a.map((x, i) => (i === idx ? { ...x, expiresAt: e.target.value } : x)))} /></Field>
                </div>
                <Field label="Details"><input className={inputCls} maxLength={240} value={o.text} onChange={(e) => setOffers((a) => a.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))} placeholder="e.g. 10 days, 4-star hotel near Haram, visa included" /></Field>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"><Switch checked={o.active} onChange={(v) => setOffers((a) => a.map((x, i) => (i === idx ? { ...x, active: v } : x)))} label="Offer is active" /> Active</label>
                  <button type="button" onClick={() => setOffers((a) => a.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer" title="Remove offer"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
            <SaveBar k="offers" onSave={() => void save({ offers: offers.filter((o) => o.title.trim()) })} />
          </div>
        </div>
      )}

      {tab === 'effects' && (
        <div className={`${cardCls} p-5 space-y-3`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Animations on the customer portal</h3>
          <p className="text-xs text-slate-500">Turn any effect off if you find it distracting or want the page lighter. Changes are live straight away.</p>
          {([
            ['jet', 'Jet flyover after entering a tracking number'],
            ['confetti', 'Confetti when a visa is issued / box opens'],
            ['scene3d', 'Floating 3D shapes behind the page title'],
            ['planeMap', 'Animated flight-route map next to the search'],
          ] as const).map(([k, label]) => (
            <div key={k} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">{label}</span>
              <Switch checked={effects[k]} onChange={(v) => setEffects({ ...effects, [k]: v })} label={label} />
            </div>
          ))}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-1.5">
            <label className="text-xs font-semibold text-slate-800 dark:text-slate-200" htmlFor="portal-theme">Seasonal look</label>
            <select id="portal-theme" value={theme} onChange={(e) => setTheme(e.target.value)} className={inputCls}>
              <option value="auto">Automatic (Ramadan, Eid, winter, summer)</option>
              <option value="none">Off (always plain)</option>
              <option value="ramadan">Always Ramadan</option>
              <option value="eid">Always Eid</option>
              <option value="winter">Always winter</option>
              <option value="summer">Always summer</option>
            </select>
            <p className="text-[11px] text-slate-500">Lanterns and moon for Ramadan and Eid, falling snow in winter, a warm glow in summer. Ramadan and Eid dates follow the moon, so they can be a day off; pick a fixed look any time.</p>
          </div>
          <SaveBar k="effects" onSave={() => void save({ effects, theme })} />
        </div>
      )}

      {tab === 'destinations' && (
        <div className={`${cardCls} p-5 space-y-3`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Destinations</h3>
          <p className="text-xs text-slate-500">Hide a destination, change the order, or change its text, “from” price and photos. Leave a box empty to keep the original. Photo links must start with https://</p>
          <div className="space-y-2">
            {order.map((id, idx) => {
              const d = destById.get(id);
              if (!d) return null;
              const ov = overrides[id] || {};
              const isHidden = hidden.includes(id);
              const open = openDest === id;
              return (
                <div key={id} className={`rounded-lg border ${isHidden ? 'border-slate-200 dark:border-slate-800 opacity-60' : 'border-slate-200 dark:border-slate-700'} p-3`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <b className="text-xs text-slate-900 dark:text-slate-100">{d.name}</b> <span className="text-[11px] text-slate-500">· {d.country}</span>
                      {ov.fromPrice && <span className="ml-2"><Pill tone="green">{ov.fromPrice}</Pill></span>}
                      {isHidden && <span className="ml-2"><Pill tone="slate">Hidden</Pill></span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => move(id, -1)} disabled={idx === 0} className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-30 cursor-pointer" aria-label="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => move(id, 1)} disabled={idx === order.length - 1} className="p-1.5 rounded-lg border border-slate-300 dark:border-slate-700 disabled:opacity-30 cursor-pointer" aria-label="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
                      <span className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 ml-1"><Switch checked={!isHidden} onChange={(v) => setHidden((h) => (v ? h.filter((x) => x !== id) : [...h, id]))} label={`Show ${d.name}`} /> Show</span>
                      <button type="button" onClick={() => setOpenDest(open ? null : id)} className={btnGhost}>Edit <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></button>
                    </div>
                  </div>
                  {open && (
                    <div className="mt-3 space-y-2">
                      <Field label="Short description" hint={`Original: ${d.tagline}`}><input className={inputCls} maxLength={200} value={ov.tagline || ''} onChange={(e) => setOv(id, { tagline: e.target.value })} /></Field>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Field label="Best season" hint={`Original: ${d.bestSeason}`}><input className={inputCls} maxLength={80} value={ov.bestSeason || ''} onChange={(e) => setOv(id, { bestSeason: e.target.value })} /></Field>
                        <Field label="“From” price shown to customers" hint="e.g. From PKR 185,000 per person"><input className={inputCls} maxLength={80} value={ov.fromPrice || ''} onChange={(e) => setOv(id, { fromPrice: e.target.value })} /></Field>
                      </div>
                      <Field label="Photos (one https link per line, up to 6)" hint="Leave empty to keep the original photos."><textarea rows={3} className={inputCls} value={(ov.photos || []).join('\n')} onChange={(e) => setOv(id, { photos: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6) })} /></Field>
                      <button type="button" className={btnGhost} onClick={() => setOverrides((m) => { const n = { ...m }; delete n[id]; return n; })}>Reset this destination to the original</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <SaveBar k="destinations" onSave={() => void save({ destinations: { order, hidden, overrides } })} />
        </div>
      )}

      {tab === 'whatsapp' && <PortalSettingsCard />}

      {tab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Searches (60 days)', totals.searches],
              ['Bookings found', totals.searches ? `${Math.round((totals.found / totals.searches) * 100)}%` : '—'],
              ['On phones', totals.searches ? `${Math.round((totals.phone / Math.max(1, totals.phone + totals.desktop)) * 100)}%` : '—'],
              ['WhatsApp taps', totals.waClicks],
            ].map(([label, val]) => (
              <div key={String(label)} className={`${cardCls} p-4`}><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="text-2xl font-extrabold text-slate-900 dark:text-slate-100 tabular-nums">{val}</p></div>
            ))}
          </div>
          <div className={`${cardCls} p-5`}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Searches per day (last 14 days with visits)</h3>
            {statDays.length === 0 ? <p className="text-xs text-slate-400">No visits recorded yet.</p> : (
              <div className="flex items-end gap-1.5 h-32">
                {statDays.map((x) => (
                  <div key={x.d} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${x.d}: ${x.searches} searches`}>
                    <span className="text-[10px] text-slate-500 tabular-nums">{x.searches}</span>
                    <div className="w-full rounded-t bg-blue-500" style={{ height: `${Math.max(4, ((Number(x.searches) || 0) / maxSearch) * 88)}px` }} />
                    <span className="text-[9px] text-slate-400">{x.d.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${cardCls} p-5`}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Most-viewed destinations</h3>
              {topDest.length === 0 ? <p className="text-xs text-slate-400">No destination views yet.</p> : (
                <ul className="space-y-1.5">
                  {topDest.map(([id, n]) => (
                    <li key={id} className="flex items-center justify-between text-xs"><span className="text-slate-700 dark:text-slate-300">{destById.get(id)?.name || id}</span><b className="tabular-nums">{n}</b></li>
                  ))}
                </ul>
              )}
            </div>
            <div className={`${cardCls} p-5`}>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Quote requests</h3>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Pill tone="amber">New: {qCount('new')}</Pill>
                <Pill tone="blue">Contacted: {qCount('contacted')}</Pill>
                <Pill tone="green">Quoted: {qCount('quoted')}</Pill>
                <Pill tone="green">Won: {qCount('won')}</Pill>
                <Pill tone="red">Lost: {qCount('lost')}</Pill>
                <Pill tone="slate">Total: {(crm.data.portalQueries || []).length}</Pill>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">Manage them in the Customers page → portal queries. You are notified as soon as a new one arrives.</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className={`${cardCls} p-5`}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Who changed what</h3>
          {activity.length === 0 ? <p className="text-xs text-slate-400">Nothing yet. Changes to portal settings and to a booking's portal controls are listed here.</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {activity.map((a, i) => (
                <li key={i} className="py-2 flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-slate-800 dark:text-slate-200"><b>{a.byName || 'Someone'}</b> — {a.text}</span>
                  <span className="text-slate-400 tabular-nums">{fmtWhen(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
