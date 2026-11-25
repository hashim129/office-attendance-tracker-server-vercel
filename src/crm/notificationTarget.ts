import type { ActiveDesktopTab } from '../types';
import type { CrmCategory } from './crmApi';

export const notificationTarget: Record<CrmCategory, ActiveDesktopTab> = {
  followup: 'crm-tasks', meeting: 'crm-meetings', inventory: 'crm-inventory', sale: 'crm-sales',
  reminder: 'clock', invoice: 'crm-invoices', receipt: 'crm-receipts', customer: 'crm-customers',
};
