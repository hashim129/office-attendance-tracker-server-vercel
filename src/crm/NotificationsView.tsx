import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, Volume2, VolumeX } from 'lucide-react';
import { isSoundOn, playAlertSound, setSoundOn } from './sound';
import { ActiveDesktopTab } from '../types';
import { CrmCategory, crmCall } from './crmApi';
import { CrmState } from './useCrm';
import { Pill, btnGhost, cardCls, fmtDateTime } from './ui';

const LABEL: Record<CrmCategory, string> = { followup: 'Follow-up / Task', meeting: 'Meeting', inventory: 'Inventory', sale: 'Sales', reminder: 'Reminder', invoice: 'Invoice', receipt: 'Receipt' };
const TARGET: Record<CrmCategory, ActiveDesktopTab> = { followup: 'crm-tasks', meeting: 'crm-meetings', inventory: 'crm-inventory', sale: 'crm-sales', reminder: 'clock', invoice: 'crm-invoices', receipt: 'crm-receipts' };

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
  const newestAsk = history.find((h) => !h.read && String(h.id).includes('-ask-'))?.id;
  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState('');
  const confirmWorking = async () => {
    setConfirming(true);
    setConfirmErr('');
    try {
      await crmCall('work_confirm');
      await crm.refresh();
    } catch (e) {
      setConfirmErr(e instanceof Error ? e.message : 'Could not confirm. Please try again.');
    } finally {
      setConfirming(false);
    }
  };
  const [sound, setSound] = useState(isSoundOn());
  const [perm, setPerm] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const toggleSound = () => {
    const next = !sound;
    setSoundOn(next);
    setSound(next);
    if (next) playAlertSound('notice');
  };
  const askDesktop = async () => {
    try {
      setPerm(await Notification.requestPermission());
    } catch {
      // not supported in this browser
    }
  };
  return (
    <div className="space-y-3">
      <div className={`${cardCls} p-4 flex items-center justify-between gap-3`}>
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2"><Bell className="w-4 h-4 text-blue-600" /> Notifications</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Everything that happened to you — kept as history. {unread > 0 ? `${unread} unread.` : 'You are all caught up.'}</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button className={btnGhost} onClick={toggleSound} aria-pressed={sound}>{sound ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />} Sound {sound ? 'on' : 'off'}</button>
          {perm === 'default' && <button className={btnGhost} onClick={() => void askDesktop()}><Bell className="w-3.5 h-3.5" /> Alerts when this tab is in the background</button>}
          {unread > 0 && <button className={btnGhost} onClick={() => void crm.markRead('all')}><CheckCheck className="w-3.5 h-3.5" /> Mark all as read</button>}
        </div>
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
              {h.id === newestAsk && (
                <div className="mt-1.5 flex items-center gap-2">
                  <button disabled={confirming} onClick={() => void confirmWorking()} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 cursor-pointer disabled:opacity-60">
                    {confirming ? 'Confirming…' : "Yes, I'm still working"}
                  </button>
                  {confirmErr && <span className="text-[11px] text-red-600">{confirmErr}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
