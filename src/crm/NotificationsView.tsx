import React, { useEffect } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { ActiveDesktopTab } from '../types';
import { CrmCategory } from './crmApi';
import { CrmState } from './useCrm';
import { Pill, btnGhost, cardCls, fmtDateTime } from './ui';

const LABEL: Record<CrmCategory, string> = { followup: 'Follow-up / Task', meeting: 'Meeting', inventory: 'Inventory', sale: 'Sales' };
const TARGET: Record<CrmCategory, ActiveDesktopTab> = { followup: 'crm-tasks', meeting: 'crm-meetings', inventory: 'crm-inventory', sale: 'crm-sales' };

interface Props {
  crm: CrmState;
  onOpen: (tab: ActiveDesktopTab) => void;
}

/** Full notification history (read and unread). Opening one takes you to the page it is about. */
export const NotificationsView: React.FC<Props> = ({ crm, onOpen }) => {
  const { history } = crm.data;
  useEffect(() => { void crm.refresh(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unread = history.filter((h) => !h.read).length;
  return (
    <div className="space-y-3">
      <div className={`${cardCls} p-4 flex items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><Bell className="w-4 h-4 text-blue-600" /> Notifications</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Everything that happened to you — kept as history. {unread > 0 ? `${unread} unread.` : 'You are all caught up.'}</p>
        </div>
        {unread > 0 && <button className={btnGhost} onClick={() => void crm.markRead('all')}><CheckCheck className="w-3.5 h-3.5" /> Mark all as read</button>}
      </div>
      {history.length === 0 ? (
        <div className={`${cardCls} p-8 text-center text-xs text-slate-500`}>No notifications yet.</div>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id}>
              <button
                onClick={() => onOpen(TARGET[h.category])}
                className={`${cardCls} w-full text-left p-3 flex items-start gap-3 cursor-pointer hover:border-blue-400 transition-colors ${h.read ? '' : 'border-l-4 border-l-blue-500'}`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-xs break-words ${h.read ? 'text-slate-600 dark:text-slate-400' : 'font-semibold text-slate-900 dark:text-slate-100'}`}>{h.message}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{fmtDateTime(h.createdAt)}</p>
                </div>
                <Pill tone={h.read ? 'slate' : 'blue'}>{LABEL[h.category]}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
