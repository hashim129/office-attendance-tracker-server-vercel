import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { ActiveDesktopTab, Employee } from '../../types';

interface QuickJumpProps {
  currentUser: Employee;
  crmEnabled: boolean;
  onSelectTab: (tab: ActiveDesktopTab) => void;
}

interface Page {
  tab: ActiveDesktopTab;
  label: string;
  hint: string;
}

/** Press Ctrl+K (or ⌘K) anywhere to jump straight to a page by typing a few letters. */
export const QuickJump: React.FC<QuickJumpProps> = ({ currentUser, crmEnabled, onSelectTab }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pages = useMemo<Page[]>(() => {
    const role = currentUser.role;
    const staff = role === 'admin' || role === 'accounts' || role === 'ceo';
    const list: Page[] = [
      { tab: 'clock', label: 'Punch Clock', hint: 'Time in, breaks, time out' },
      { tab: 'my-attendance', label: 'My Attendance & Stats', hint: 'Your hours and history' },
      { tab: 'team-attendance', label: 'Team Presence', hint: 'Who is online, offline or absent' },
      { tab: 'leaves', label: 'Leave Requests', hint: 'Apply for or review leave' },
    ];
    if (crmEnabled) {
      list.push(
        { tab: 'crm-customers', label: 'Customers', hint: 'Your customer list' },
        { tab: 'crm-tasks', label: 'Follow-ups & Tasks', hint: 'Things to do next' },
        { tab: 'crm-meetings', label: 'Meetings', hint: 'Book and see meetings' },
      );
      if (staff || currentUser.salesAccess) list.push({ tab: 'crm-sales', label: 'Sales', hint: 'Sales requests' });
      list.push(
        { tab: 'crm-receipts', label: 'Receipts', hint: 'Payment receipts' },
        { tab: 'crm-invoices', label: 'Invoices', hint: 'Customer invoices and vendor payables' },
        { tab: 'crm-notifications', label: 'Notifications', hint: 'Your alerts' },
        { tab: 'crm-inventory', label: 'Inventory', hint: 'Office stock and requests' },
      );
    }
    if (staff) {
      list.push(
        { tab: 'insights', label: 'Smart Insights & Graphs', hint: 'Charts and trends' },
        { tab: 'reports', label: 'Reports & Payroll', hint: 'Export and print' },
      );
    }
    if (role === 'admin') {
      list.push(
        { tab: 'employees', label: 'Staff Directory', hint: 'Profiles, face set-up, on/off switches' },
        { tab: 'shifts', label: 'Shifts', hint: 'Work timings' },
        { tab: 'settings', label: 'Office Settings', hint: 'Security and switches' },
      );
    }
    return list;
  }, [currentUser.role, currentUser.salesAccess, crmEnabled]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pages.filter((p) => `${p.label} ${p.hint}`.toLowerCase().includes(q)) : pages;
  }, [pages, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setIndex(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const go = (p?: Page) => {
    if (!p) return;
    onSelectTab(p.tab);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4 bg-slate-900/50 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Jump to a page"
        className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, shown.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); go(shown[index]); }
            }}
            placeholder="Where do you want to go?"
            className="flex-1 bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-500">Esc</kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1.5">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-xs text-slate-500">Nothing matches. Try another word.</li>}
          {shown.map((p, i) => (
            <li key={p.tab}>
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(p)}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left cursor-pointer ${i === index ? 'bg-blue-50 dark:bg-blue-950/50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{p.label}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{p.hint}</span>
                </span>
                {i === index && <CornerDownLeft className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-200 dark:border-slate-800">Tip: press Ctrl+K any time to open this.</p>
      </div>
    </div>
  );
};
