import React from 'react';
import { Employee } from '../types';
import { CrmState } from './useCrm';
import { getSessionToken } from '../lib/storage';
import { CustomersView } from './CustomersView';
import { TasksView } from './TasksView';
import { MeetingsView } from './MeetingsView';
import { InventoryView } from './InventoryView';
import { SalesView } from './SalesView';
import { PurchasesView } from './PurchasesView';
import { InvoicesView } from './InvoicesView';
import { ReceiptsView } from './ReceiptsView';
import { NotificationsView } from './NotificationsView';
import { PortalControlView } from './PortalControlView';
import { ActiveDesktopTab } from '../types';

export type CrmSection = 'crm-customers' | 'crm-tasks' | 'crm-meetings' | 'crm-inventory' | 'crm-sales' | 'crm-purchases' | 'crm-invoices' | 'crm-receipts' | 'crm-portal' | 'crm-notifications';

interface Props {
  section: CrmSection;
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
  onNavigate: (tab: ActiveDesktopTab, refId?: string) => void;
  focusId?: string;
  onClearFocus?: () => void;
  customerPortalBetaEnabled?: boolean;
}

export const CrmPage: React.FC<Props> = ({ section, crm, employees, currentUser, onNavigate, focusId, onClearFocus, customerPortalBetaEnabled = false }) => {
  if (!getSessionToken()) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-600 dark:text-slate-300">
        The CRM needs a fresh sign-in. Please sign out and sign in again with your PIN.
      </div>
    );
  }
  const source = { 'crm-customers': 'customers', 'crm-tasks': 'followups', 'crm-meetings': 'meetings', 'crm-inventory': 'inventory', 'crm-sales': 'sales', 'crm-invoices': 'invoices', 'crm-receipts': 'receipts' } as const;
  const key = source[section as keyof typeof source];
  const found = focusId && key ? crm.data[key].some((item) => item.id === focusId) : false;
  if (focusId && key) {
    if (!found) return <div className="rounded-xl border p-4 text-sm"><p>{crm.loading ? 'Loading record…' : 'This record is unavailable or you no longer have access.'}</p><button className="mt-2 font-bold text-blue-600" onClick={onClearFocus}>Back to all records</button></div>;
    crm = { ...crm, data: { ...crm.data, [key]: crm.data[key].filter((item) => item.id === focusId) } };
  }
  return (
    <div className="space-y-4">
      {focusId && key && <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"><b>Opened exact notification record</b><button className="font-semibold underline" onClick={onClearFocus}>Show all records</button></div>}
      {section === 'crm-customers' && <CustomersView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-tasks' && <TasksView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-inventory' && <InventoryView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-sales' && !(currentUser.salesAccess || ['admin', 'accounts', 'ceo'].includes(currentUser.role)) && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">The Sales section is only available to employees selected by an administrator.</div>
      )}
      {section === 'crm-sales' && (currentUser.salesAccess || ['admin', 'accounts', 'ceo'].includes(currentUser.role)) && <SalesView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-purchases' && <PurchasesView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-invoices' && <InvoicesView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} customerPortalBetaEnabled={Boolean(customerPortalBetaEnabled)} />}
      {section === 'crm-portal' && (['admin', 'ceo'].includes(currentUser.role) ? <PortalControlView crm={crm} /> : <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">Portal Control is only for Admin and the CEO.</div>)}
      {section === 'crm-receipts' && <ReceiptsView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-notifications' && <NotificationsView crm={crm} onOpen={onNavigate} />}
      {section === 'crm-meetings' && <MeetingsView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} />}
    </div>
  );
};
