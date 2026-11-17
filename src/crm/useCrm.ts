import { useCallback, useEffect, useRef, useState } from 'react';
import { CRM_ENABLED } from './config';
import { CrmData, CrmBadges, EMPTY_BADGES, crmCall } from './crmApi';

const EMPTY: CrmData = { customers: [], followups: [], meetings: [], unread: [], inventory: [], inventoryItems: [], badges: EMPTY_BADGES };

export interface CrmState {
  data: CrmData;
  badges: CrmBadges;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  markRead: (category: 'followup' | 'meeting' | 'inventory') => Promise<void>;
}

/**
 * Keeps CRM data fresh. On a CRM page it reloads everything every 30 seconds; elsewhere it only
 * checks the small badge counts every 90 seconds. Nothing runs while the browser tab is hidden or the CRM is off.
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
      setData({ customers: r.customers, followups: r.followups, meetings: r.meetings, unread: r.unread, inventory: r.inventory || [], inventoryItems: r.inventoryItems || [], badges: r.badges });
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
      if (document.hidden) return;
      void (onCrmPage ? refresh() : refreshBadges());
    };
    run();
    const t = window.setInterval(run, onCrmPage ? 30000 : 90000);
    const vis = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [signedIn, onCrmPage, refresh, refreshBadges]);

  const markRead = useCallback(async (category: 'followup' | 'meeting' | 'inventory') => {
    try {
      await crmCall('notifications_read', { category });
      setData((d) => ({
        ...d,
        unread: d.unread.filter((u) => u.category !== category),
        badges: { ...d.badges, ...(category === 'followup' ? { tasksNew: 0 } : category === 'meeting' ? { meetingsNew: 0 } : { inventoryNew: 0 }) },
      }));
    } catch {
      // ignore
    }
  }, []);

  return { data, badges: data.badges, loading, error, refresh, markRead };
}
