import React, { useState } from 'react';
import { History } from 'lucide-react';
import { EditLogEntry } from './crmApi';
import { fmtDateTime } from './ui';

/** Folded "Change history" under a record: every change with date, time, who, what changed and the reason. Newest first. */
export const EditHistory: React.FC<{ log?: EditLogEntry[]; nameOf?: (id: string) => string }> = ({ log, nameOf }) => {
  const [open, setOpen] = useState(false);
  const items = [...(log || [])].reverse();
  if (!items.length) return null;
  return (
    <div className="text-[11px]" data-edit-history>
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-blue-600 cursor-pointer">
        <History className="w-3.5 h-3.5" /> {open ? 'Hide' : 'Show'} change history ({items.length})
      </button>
      {open && (
        <ol className="mt-1.5 space-y-1 border-l-2 border-slate-200 dark:border-slate-700 pl-2.5 max-h-56 overflow-y-auto">
          {items.map((e) => (
            <li key={e.id} className="text-slate-600 dark:text-slate-300">
              <span className="text-slate-400">{fmtDateTime(e.at)}</span> · <b>{e.byName || nameOf?.(e.by) || 'Former employee'}</b> — {e.text}
              {e.reason && !/^\s*\d{4,8}\s*$/.test(e.reason) && <span className="block text-slate-500 dark:text-slate-400 italic">Reason: {e.reason}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
};
