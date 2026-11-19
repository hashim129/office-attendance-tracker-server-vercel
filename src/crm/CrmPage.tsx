import React from 'react';
import { Employee } from '../types';
import { CrmState } from './useCrm';
import { getSessionToken } from '../lib/storage';
import { CustomersView } from './CustomersView';
import { TasksView } from './TasksView';
import { MeetingsView } from './MeetingsView';
import { InventoryView } from './InventoryView';
import { SalesView } from './SalesView';
import { InvoicesView } from './InvoicesView';
import { ReceiptsView } from './ReceiptsView';
import { NotificationsView } from './NotificationsView';
import { ActiveDesktopTab } from '../types';

export type CrmSection = 'crm-customers' | 'crm-tasks' | 'crm-meetings' | 'crm-inventory' | 'crm-sales' | 'crm-invoices' | 'crm-receipts' | 'crm-notifications';

interface Props {
  section: CrmSection;
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
  onNavigate: (tab: ActiveDesktopTab) => void;
}

export const CrmPage: React.FC<Props> = ({ section, crm, employees, currentUser, onNavigate }) => {
  if (!getSessionToken()) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-600 dark:text-slate-300">
        The CRM needs a fresh sign-in. Please sign out and sign in again with your PIN.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {section === 'crm-customers' && <CustomersView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-tasks' && <TasksView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-inventory' && <InventoryView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-sales' && !(currentUser.salesAccess || ['admin', 'accounts', 'ceo'].includes(currentUser.role)) && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">The Sales section is only available to employees selected by an administrator.</div>
      )}
      {section === 'crm-sales' && (currentUser.salesAccess || ['admin', 'accounts', 'ceo'].includes(currentUser.role)) && <SalesView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-invoices' && <InvoicesView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-receipts' && <ReceiptsView crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-notifications' && <NotificationsView crm={crm} onOpen={onNavigate} />}
      {section === 'crm-meetings' && <MeetingsView crm={crm} employees={employees} currentUser={currentUser} />}
    </div>
  );
};
