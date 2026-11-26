import { useCallback, useEffect, useRef, useState } from 'react';
import { CRM_ENABLED } from './config';
import { CrmData, CrmBadges, CrmCategory, EMPTY_BADGES, EMPTY_COMPANY, crmCall } from './crmApi';

const EMPTY: CrmData = { customers: [], followups: [], meetings: [], bookedSlots: [], unread: [], inventory: [], inventoryItems: [], sales: [], purchases: [], portalQueries: [], portalInvoices: {}, purchaseCustomFields: [], purchaseCustomCategories: [], invoices: [], receipts: [], company: EMPTY_COMPANY, history: [], saleTypes: {}, currencies: [], badges: EMPTY_BADGES };

export interface CrmState {
  data: CrmData;
  badges: CrmBadges;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  markRead: (category: CrmCategory | 'all') => Promise<void>;
}

/**
 * Keeps CRM data fresh. On a CRM page it reloads everything every 30 seconds; elsewhere it only
 * checks the small badge counts (and upcoming deadlines) every 30 seconds. Nothing runs while the browser tab is hidden or the CRM is off.
 */
export function useCrm(signedIn: boolean, onCrmPage: boolean): CrmState {
  const [data, setData] = useState<CrmData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!CRM_ENABLED || !signedIn || busy.current) return;
    busy.current = true;
    if (!loaded.current) setLoading(true);
    try {
      const r = await crmCall<CrmData & { ok: boolean }>('list');
      setData({ customers: r.customers, followups: r.followups, meetings: r.meetings, bookedSlots: r.bookedSlots || [], unread: r.unread, inventory: r.inventory || [], inventoryItems: r.inventoryItems || [], sales: r.sales || [], purchases: r.purchases || [], portalQueries: r.portalQueries || [], portalInvoices: r.portalInvoices || {}, purchaseCustomFields: r.purchaseCustomFields || [], purchaseCustomCategories: r.purchaseCustomCategories || [], invoices: r.invoices || [], receipts: r.receipts || [], company: r.company || EMPTY_COMPANY, history: r.history || [], saleTypes: r.saleTypes || {}, currencies: r.currencies || [], badges: r.badges, business: r.business || null, dashboardLayout: r.dashboardLayout || null, acks: r.acks || {}, me: r.me || null });
      loaded.current = true;
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Could not load the CRM.');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [signedIn]);

  const refreshBadges = useCallback(async () => {
    if (!CRM_ENABLED || !signedIn || busy.current) return;
    try {
      const r = await crmCall<{ badges: CrmBadges }>('badges');
      setData((d) => ({ ...d, badges: r.badges }));
    } catch {
      // badges are a convenience; stay quiet
    }
  }, [signedIn]);

  useEffect(() => {
    if (!CRM_ENABLED || !signedIn) return;
    const run = () => {
      // Hidden tabs still check the small badge call, so alerts and sounds reach people who switched windows.
      void (onCrmPage && !document.hidden ? refresh() : refreshBadges());
    };
    run();
    const t = window.setInterval(run, 20000);
    const vis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [signedIn, onCrmPage, refresh, refreshBadges]);

  const markRead = useCallback(async (category: CrmCategory | 'all') => {
    try {
      await crmCall('notifications_read', category === 'all' ? {} : { category });
      setData((d) => {
        const all = category === 'all';
        const gone = d.unread.filter((u) => all || u.category === category).length;
        const b = { ...d.badges, unreadTotal: Math.max(0, d.badges.unreadTotal - gone) };
        if (all || category === 'followup') b.tasksNew = 0;
        if (all || category === 'meeting') b.meetingsNew = 0;
        if (all || category === 'inventory') b.inventoryNew = 0;
        if (all || category === 'sale') b.salesNew = 0;
        if (all || category === 'invoice') b.invoiceNew = 0;
        if (all || category === 'receipt') b.receiptNew = 0;
        if (all || category === 'customer') b.customersNew = 0;
        return {
          ...d,
          unread: d.unread.filter((u) => !all && u.category !== category),
          history: d.history.map((h) => (all || h.category === category ? { ...h, read: true } : h)),
          badges: b,
        };
      });
    } catch {
      // ignore
    }
  }, []);

  return { data, badges: data.badges, loading, error, refresh, markRead };
}
