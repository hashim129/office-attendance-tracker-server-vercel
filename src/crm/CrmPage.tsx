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
import { PaymentTreeView } from './PaymentTreeView';
import { MediaCalendarView } from './MediaCalendarView';
import { ProfitView } from './ProfitView';
import { QuotesView } from './QuotesView';
import { VendorLedgerView } from './VendorLedgerView';
import { CashBookView } from './CashBookView';
import { OverdueView } from './OverdueView';
import { GroupsView } from './GroupsView';
import { FeedbackView } from './FeedbackView';
import { AnnouncementsAdmin } from '../components/common/Announcements';
import { ActiveDesktopTab } from '../types';

export type CrmSection = 'crm-customers' | 'crm-tasks' | 'crm-meetings' | 'crm-inventory' | 'crm-sales' | 'crm-purchases' | 'crm-invoices' | 'crm-receipts' | 'crm-portal' | 'crm-notifications' | 'crm-payment-tree' | 'crm-media' | 'crm-profit' | 'crm-quotes' | 'crm-vendors' | 'crm-cashbook' | 'crm-overdue' | 'crm-groups' | 'crm-feedback';

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
  const source = { 'crm-customers': 'customers', 'crm-tasks': 'followups', 'crm-meetings': 'meetings', 'crm-inventory': 'inventory', 'crm-sales': 'sales', 'crm-invoices': 'invoices', 'crm-receipts': 'receipts', 'crm-purchases': 'purchases' } as const;
  const key = source[section as keyof typeof source];
  const list: { id: string }[] = (key && (crm.data as any)[key]) || [];
  const found = focusId && key ? list.some((item) => item.id === focusId) : false;
  if (focusId && key) {
    if (!found) return <div className="rounded-xl border p-4 text-sm"><p>{crm.loading ? 'Loading record…' : 'This record is unavailable or you no longer have access.'}</p><button className="mt-2 font-bold text-blue-600" onClick={onClearFocus}>Back to all records</button></div>;
    crm = { ...crm, data: { ...crm.data, [key]: list.filter((item) => item.id === focusId) } };
  }
  // first load: grey placeholders instead of an empty page
  if (crm.loading && key && list.length === 0 && !(crm as any).loadedOnce && !crm.data.company?.name) {
    return <div className="space-y-3" role="status" aria-label="Loading"><div className="skeleton h-14 rounded-xl" /><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-24 rounded-xl" /></div>;
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
      {section === 'crm-sales' && (currentUser.salesAccess || ['admin', 'accounts', 'ceo'].includes(currentUser.role)) && <SalesView portalEnabled={Boolean(customerPortalBetaEnabled)} crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-purchases' && <PurchasesView portalEnabled={Boolean(customerPortalBetaEnabled)} crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-invoices' && <InvoicesView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} customerPortalBetaEnabled={Boolean(customerPortalBetaEnabled)} />}
      {section === 'crm-portal' && (['admin', 'ceo'].includes(currentUser.role) ? <PortalControlView crm={crm} /> : <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">Portal Control is only for Admin and the CEO.</div>)}
      {section === 'crm-receipts' && <ReceiptsView portalEnabled={Boolean(customerPortalBetaEnabled)} key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} />}
      {section === 'crm-quotes' && <QuotesView currentUser={currentUser} onMakeInvoice={(prefill) => {
        try { sessionStorage.setItem('bahaar_quote_prefill', JSON.stringify(prefill)); sessionStorage.setItem('bahaar_open_new', 'invoice'); } catch { /* ignore */ }
        onNavigate('crm-invoices');
      }} />}
      {section === 'crm-vendors' && <VendorLedgerView currentUser={currentUser} />}
      {section === 'crm-cashbook' && <CashBookView currentUser={currentUser} />}
      {section === 'crm-overdue' && <OverdueView currentUser={currentUser} onOpenInvoice={(id) => onNavigate('crm-invoices', id)} />}
      {section === 'crm-groups' && <GroupsView currentUser={currentUser} />}
      {section === 'crm-feedback' && <FeedbackView currentUser={currentUser} />}
      {section === 'crm-profit' && <ProfitView currentUser={currentUser} companyName={crm.data.company.name} />}
      {section === 'crm-media' && (['admin', 'ceo'].includes(currentUser.role) || currentUser.mediaTeam ? <MediaCalendarView currentUser={currentUser} /> : <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">The Posting Calendar is for the Media Team. Ask Admin to switch it on for you.</div>)}
      {section === 'crm-payment-tree' && (['admin', 'ceo', 'accounts'].includes(currentUser.role) ? <PaymentTreeView crm={crm} employees={employees} onNavigate={onNavigate} /> : <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">The Payment Tree is only for Admin, the CEO and Accounts.</div>)}
      {section === 'crm-notifications' && ['admin', 'ceo'].includes(currentUser.role) && <AnnouncementsAdmin />}
      {section === 'crm-notifications' && <NotificationsView crm={crm} onOpen={onNavigate} />}
      {section === 'crm-meetings' && <MeetingsView key={focusId || 'all'} focusId={focusId} crm={crm} employees={employees} currentUser={currentUser} />}
    </div>
  );
};
