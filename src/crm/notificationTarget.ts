import type { ActiveDesktopTab } from '../types';
import type { CrmCategory } from './crmApi';

export const notificationTarget: Record<CrmCategory, ActiveDesktopTab> = {
  followup: 'crm-tasks', meeting: 'crm-meetings', inventory: 'crm-inventory', sale: 'crm-sales',
  reminder: 'clock', invoice: 'crm-invoices', receipt: 'crm-receipts', customer: 'crm-customers', media: 'crm-media',
};

/**
 * Where a notification should open. The linked record decides first (a "shared customer with you" notice is
 * filed under follow-ups but points at a customer; a vendor purchase notice is filed under invoices but points
 * at a purchase), then the category. Used by the pop-up alerts, the top-bar bell and the Notifications page.
 */
export function notificationDestination(category: string, refId?: string | null): ActiveDesktopTab {
  const ref = String(refId || '');
  if (ref.startsWith('cus-')) return 'crm-customers';
  if (ref.startsWith('pur-')) return 'crm-purchases';
  if (ref.startsWith('fup-')) return 'crm-tasks';
  if (ref.startsWith('mtg-')) return 'crm-meetings';
  if (ref.startsWith('rcp-')) return 'crm-receipts';
  if (ref.startsWith('sale-')) return 'crm-sales';
  if (ref.startsWith('med-')) return 'crm-media';
  if (ref.startsWith('leave-')) return 'leaves';
  if (ref.startsWith('att-')) return 'clock';
  return (notificationTarget as Record<string, ActiveDesktopTab>)[category] || 'crm-notifications';
}
