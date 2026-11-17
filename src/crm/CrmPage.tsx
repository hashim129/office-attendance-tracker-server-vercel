import React from 'react';
import { Employee } from '../types';
import { CrmState } from './useCrm';
import { getSessionToken } from '../lib/storage';
import { CustomersView } from './CustomersView';
import { TasksView } from './TasksView';
import { MeetingsView } from './MeetingsView';
import { InventoryView } from './InventoryView';

export type CrmSection = 'crm-customers' | 'crm-tasks' | 'crm-meetings' | 'crm-inventory';

interface Props {
  section: CrmSection;
  crm: CrmState;
  employees: Employee[];
  currentUser: Employee;
}

export const CrmPage: React.FC<Props> = ({ section, crm, employees, currentUser }) => {
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
      {section === 'crm-meetings' && <MeetingsView crm={crm} employees={employees} currentUser={currentUser} />}
    </div>
  );
};
