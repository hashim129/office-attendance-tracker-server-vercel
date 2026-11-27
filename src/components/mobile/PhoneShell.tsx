import React, { useEffect, useRef, useState } from 'react';
import { Clock3, FileText, ListChecks, Bell, Menu, WifiOff, RefreshCw, Paperclip, X } from 'lucide-react';
import type { ActiveDesktopTab, Employee, LeaveRequest } from '../../types';
import { pageEnabled } from '../../lib/pageAccess';
import { notificationDestination } from '../../crm/notificationTarget';
import { crmCall } from '../../crm/crmApi';
import { haptic, takeLaunchAction, takeSharedFile, setScreenSecure } from '../../lib/phoneApp';
import './phoneShell.css';

/**
 * Phone layer on top of the normal app (phones and the Android app):
 * bottom tab bar, pull down to refresh, "no internet" banner, notification buttons / home-screen shortcuts,
 * files shared into the app, and the screenshot block on money pages.
 */
interface Props {
  currentUser: Employee;
  activeTab: ActiveDesktopTab;
  onSelectTab: (tab: ActiveDesktopTab) => void;
  onOpenMore: () => void;
  onOpenRecord?: (tab: ActiveDesktopTab, refId?: string) => void;
  unread: number;
  online: boolean;
  onRefresh: () => Promise<unknown> | void;
  leaves: LeaveRequest[];
  employees: Employee[];
  onReviewLeave: (id: string, status: 'approved' | 'rejected') => void | Promise<void>;
  blockScreenshots: boolean;
}

const MONEY_TABS: ActiveDesktopTab[] = ['crm-invoices', 'crm-sales', 'crm-receipts', 'crm-purchases', 'crm-payment-tree'];
const isPhoneWidth = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;

export const PhoneShell: React.FC<Props> = ({ currentUser, activeTab, onSelectTab, onOpenMore, onOpenRecord, unread, online, onRefresh, leaves, employees, onReviewLeave, blockScreenshots }) => {
  const [phone, setPhone] = useState(isPhoneWidth);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [shared, setShared] = useState<{ name: string; file: File } | null>(null);
  const startY = useRef<number | null>(null);
  const leavesRef = useRef(leaves); leavesRef.current = leaves;
  const empRef = useRef(employees); empRef.current = employees;

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('has-tabbar', phone);
    return () => document.documentElement.classList.remove('has-tabbar');
  }, [phone]);

  // screenshots off on money pages when Admin turned that on (Android app only)
  useEffect(() => {
    setScreenSecure(blockScreenshots && MONEY_TABS.includes(activeTab));
  }, [blockScreenshots, activeTab]);
  useEffect(() => () => setScreenSecure(false), []);

  // ------------------------------------------------ notification buttons, shortcuts, widget
  useEffect(() => {
    const clickWhenReady = (selector: string, tries = 12) => {
      const el = document.querySelector<HTMLButtonElement>(selector);
      if (el && !el.disabled) { el.click(); return; }
      if (tries > 0) window.setTimeout(() => clickWhenReady(selector, tries - 1), 250);
    };
    const run = async (raw: string) => {
      if (!raw) return;
      const [kind, a = '', b = ''] = raw.split(':');
      if (kind === 'punch-in' || kind === 'punch-out') {
        onSelectTab('clock');
        window.setTimeout(() => clickWhenReady(kind === 'punch-in' ? '[data-punch-in]' : '[data-punch-out]'), 350);
      } else if (kind === 'work-confirm') {
        try { await crmCall('work_confirm', {}); haptic('success'); } catch { onSelectTab('clock'); }
      } else if (kind === 'leave-approve' || kind === 'leave-decline') {
        onSelectTab('leaves');
        const lv = leavesRef.current.find((l) => l.id === a);
        const who = lv ? empRef.current.find((e) => e.id === lv.employeeId)?.name || 'this employee' : 'this employee';
        if (lv && lv.status === 'pending' && window.confirm(`${kind === 'leave-approve' ? 'Approve' : 'Decline'} the leave request of ${who}?`)) {
          await onReviewLeave(a, kind === 'leave-approve' ? 'approved' : 'rejected');
          haptic('success');
        }
      } else if (kind === 'open') {
        const tab = notificationDestination(a, b);
        if (onOpenRecord) onOpenRecord(tab, b || undefined); else onSelectTab(tab);
      } else if (kind === 'new-invoice' || kind === 'new-receipt') {
        try { sessionStorage.setItem('bahaar_open_new', kind === 'new-invoice' ? 'invoice' : 'receipt'); } catch { /* ignore */ }
        onSelectTab(kind === 'new-invoice' ? 'crm-invoices' : 'crm-receipts');
      } else if (kind === 'calendar') {
        onSelectTab('crm-media');
      } else if (kind === 'clock') {
        onSelectTab('clock');
      }
    };
    const checkShared = () => {
      const f = takeSharedFile();
      if (!f) return;
      try {
        const bin = atob(f.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        setShared({ name: f.name || 'Shared file', file: new File([bytes], f.name || 'shared', { type: f.type || 'application/octet-stream' }) });
      } catch { /* bad file */ }
    };
    const onAction = (e: Event) => { void run(String((e as CustomEvent).detail || '')); checkShared(); };
    const onResume = () => { if (document.visibilityState === 'visible') { void run(takeLaunchAction()); checkShared(); } };
    void run(takeLaunchAction());
    checkShared();
    window.addEventListener('bahaar-action', onAction);
    document.addEventListener('visibilitychange', onResume);
    return () => { window.removeEventListener('bahaar-action', onAction); document.removeEventListener('visibilitychange', onResume); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------ pull down to refresh (phones)
  useEffect(() => {
    if (!phone) return;
    const blocked = () => Boolean(document.querySelector('[data-app-modal], [data-universe-chat], [data-notif-panel]'));
    const down = (e: TouchEvent) => { startY.current = window.scrollY <= 0 && !blocked() ? e.touches[0].clientY : null; };
    const move = (e: TouchEvent) => {
      if (startY.current === null) return;
      const d = e.touches[0].clientY - startY.current;
      if (d > 0 && window.scrollY <= 0) setPull(Math.min(110, d * 0.5)); else setPull(0);
    };
    const up = async () => {
      const go = pull >= 64;
      startY.current = null;
      if (!go) { setPull(0); return; }
      setRefreshing(true); setPull(56); haptic('tap');
      try { await onRefresh(); } finally { setRefreshing(false); setPull(0); }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); };
  }, [phone, pull, onRefresh]);

  const tabs: { tab: ActiveDesktopTab; label: string; Icon: typeof Clock3; badge?: number }[] = ([
    { tab: 'clock' as ActiveDesktopTab, label: 'Punch', Icon: Clock3 },
    { tab: 'crm-invoices' as ActiveDesktopTab, label: 'Invoices', Icon: FileText },
    { tab: 'crm-tasks' as ActiveDesktopTab, label: 'Follow-ups', Icon: ListChecks },
    { tab: 'crm-notifications' as ActiveDesktopTab, label: 'Alerts', Icon: Bell, badge: unread },
  ]).filter((t) => pageEnabled(currentUser, t.tab));

  return (
    <>
      {!online && (
        <div className="phone-offline" role="status" data-offline-banner>
          <WifiOff className="w-3.5 h-3.5" /> No internet. Your changes are kept and will be sent when you are back online.
        </div>
      )}
      {phone && (pull > 0 || refreshing) && (
        <div className="phone-pull" style={{ transform: `translate(-50%, ${pull - 44}px)` }} aria-hidden>
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} style={{ transform: refreshing ? undefined : `rotate(${pull * 3}deg)` }} />
        </div>
      )}
      {phone && (
        <nav className="phone-tabbar" aria-label="Main" data-tabbar>
          {tabs.map(({ tab, label, Icon, badge }) => (
            <button key={tab} type="button" className={activeTab === tab ? 'is-on' : ''} onClick={() => { if (activeTab !== tab) haptic('tap'); onSelectTab(tab); window.scrollTo({ top: 0 }); }} aria-current={activeTab === tab ? 'page' : undefined}>
              <span className="phone-tab-icon"><Icon className="w-5 h-5" />{badge ? <i>{badge > 99 ? '99+' : badge}</i> : null}</span>
              <span>{label}</span>
            </button>
          ))}
          <button type="button" onClick={() => { haptic('tap'); onOpenMore(); }}>
            <span className="phone-tab-icon"><Menu className="w-5 h-5" /></span>
            <span>More</span>
          </button>
        </nav>
      )}
      {shared && (
        <div className="phone-sheet-backdrop" onClick={() => setShared(null)}>
          <div className="phone-sheet" role="dialog" aria-label="Shared file" onClick={(e) => e.stopPropagation()} data-shared-sheet>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">File received</p>
                <p className="text-xs text-slate-500 truncate inline-flex items-center gap-1"><Paperclip className="w-3 h-3" /> {shared.name}</p>
              </div>
              <button type="button" className="p-1 text-slate-400" aria-label="Close" onClick={() => setShared(null)}><X className="w-4 h-4" /></button>
            </div>
            <button type="button" className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!/^image\//.test(shared.file.type)}
              onClick={() => {
                (window as any).__bahaarSharedFile = shared.file;
                try { sessionStorage.setItem('bahaar_open_new', 'receipt'); } catch { /* ignore */ }
                setShared(null);
                if (activeTab === 'crm-receipts') onSelectTab('clock');
                window.setTimeout(() => onSelectTab('crm-receipts'), 30);
              }}>
              Attach to a new receipt
            </button>
            {!/^image\//.test(shared.file.type) && <p className="mt-2 text-[11px] text-slate-500">Receipts take a JPG or PNG screenshot. Share a picture to attach it.</p>}
          </div>
        </div>
      )}
    </>
  );
};

export default PhoneShell;
