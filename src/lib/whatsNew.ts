import type { ActiveDesktopTab, Employee } from '../types';

/**
 * Release notes shown as a must-see walkthrough after every update (newest first).
 * RULE: every update, fix or new feature adds an entry here, explaining what changed and how to use it.
 */
export type Who = 'all' | 'admin' | 'money' | 'sales' | 'media' | 'phone';
export interface WhatsNewStep { title: string; text: string; where?: string; tab?: ActiveDesktopTab; who?: Who }
export interface WhatsNewRelease { id: string; date: string; title: string; steps: WhatsNewStep[] }

export const WHATS_NEW: WhatsNewRelease[] = [
  {
    id: '2026-11-28b',
    date: '28 November 2026',
    title: 'Quotations, books, search and a new app icon',
    steps: [
      { title: 'Search everything', text: 'Press Ctrl+K (or the search box under the + button on phones) and type a name, phone number, invoice or receipt number. Pick a result to open that exact record.', where: 'Ctrl+K anywhere' },
      { title: 'Quotations', text: 'Make a quotation, send it on WhatsApp or as a PDF, and mark it Approved when the customer agrees. Then press “Turn into invoice”: the invoice opens already filled in. Approved quotes not yet invoiced show on the Sales page.', where: 'Menu → Office → Quotations', tab: 'crm-quotes', who: 'sales' },
      { title: 'Overdue invoices', text: 'Invoices past their due date with a balance still to be received, oldest first, with a one-tap WhatsApp reminder. You also get a morning notice for your own overdue invoices.', where: 'Menu → Office → Overdue invoices', tab: 'crm-overdue' },
      { title: 'Vendor ledger and Cash & bank book', text: 'Vendor ledger shows what we booked with each vendor, what is paid and what is still owed, with a PDF statement. Cash & bank book shows money received and paid out day by day, with the closing balance.', where: 'Menu → Office', tab: 'crm-vendors', who: 'money' },
      { title: 'Customer documents', text: 'Open a customer’s History to add passport, visa or CNIC copies with expiry dates. Red means expired, amber means it expires within 60 days; the customer’s owner is reminded 60, 30 and 7 days before.', where: 'Customers → History', tab: 'crm-customers' },
      { title: 'Group bookings', text: 'Put customers travelling together in one group (e.g. “Umrah Dec batch”) and see all their invoices, amounts received and balances in one place. “Copy WhatsApp numbers” copies everyone’s number.', where: 'Menu → Office → Group bookings', tab: 'crm-groups', who: 'sales' },
      { title: 'Feedback after travel', text: 'After the travel date, invoices show “Ask for feedback”. It sends the customer a short WhatsApp link to rate their trip. Ratings appear on the Customer feedback page.', where: 'Invoices · Menu → Office → Customer feedback', tab: 'crm-feedback' },
      { title: 'Short leave and shift swap', text: 'Leaving early, coming late, or swapping a shift with a colleague? Ask on the Leave Requests page. For a swap your colleague accepts first, then Admin approves.', where: 'Leave Requests → Short leave & shift swap', tab: 'leaves' },
      { title: 'Daily target nudge', text: 'If you have a sales target, a morning message tells you how much more you need this month. You can turn it off under My Profile.', where: 'My Profile', tab: 'employee-profile', who: 'sales' },
      { title: 'Staff performance', text: 'One card per person for any month: days present, late days, hours, sales, profit, target reached and follow-up speed, with a PDF.', where: 'Menu → Staff performance', tab: 'staff-performance', who: 'admin' },
      { title: 'Media: post performance', text: 'For posted posts, enter likes, views, comments and enquiries. Charts show which platform and type of post bring the most leads.', where: 'Posting Calendar → Performance', tab: 'crm-media', who: 'media' },
      { title: 'Phones: + button and Back', text: 'The round + button above the bottom bar adds a new invoice, receipt, follow-up, customer or quotation. The phone’s Back button now returns to the previous page, and tables turn into easy-to-read cards.', who: 'phone' },
      { title: 'Wide screens and a new icon', text: 'On laptops and tablets, an invoice, receipt or follow-up opens on the right while the list stays on the left. The phone app has a new icon, and on Android 13+ it matches your wallpaper colours (install the new app version).' },
    ],
  },
  {
    id: '2026-11-28',
    date: '28 November 2026',
    title: 'New in the office app',
    steps: [
      { title: 'Invoices: “Sale done by”', text: 'Entering an invoice for a colleague? Pick their name in “Sale done by”. The sale, profit and target then count for them, and they are told.', where: 'Invoices → New invoice → under Travel date', tab: 'crm-invoices' },
      { title: 'Your invoice work is never lost', text: 'Every invoice you type (new or an edit) is kept on your device. If you are signed out or the internet drops, a yellow box at the top of Invoices lets you Continue or Discard it.', where: 'Invoices page, top', tab: 'crm-invoices' },
      { title: 'Payment reminder on WhatsApp', text: 'Unpaid customer invoices have a green “Payment reminder” button. One tap opens WhatsApp with a polite message showing the balance, due date and travel date.', where: 'Invoices → on each unpaid invoice', tab: 'crm-invoices' },
      { title: 'Sales are automatic', text: 'You no longer make sales by hand. Every invoice becomes a sale by itself and counts towards your monthly target.', where: 'Sales page', tab: 'crm-sales' },
      { title: 'New Sales figures', text: 'Sales = all invoices. Cost of sales = purchases locked against an invoice. Current receivable = balances still to come in. Current payables = unpaid purchases. Profit only counts invoices that have their purchase linked, so link a purchase to every invoice.', where: 'Sales page', tab: 'crm-sales', who: 'money' },
      { title: 'Profit & Commission', text: 'Profit per person for any month in PKR, commission on received profit, and a Profit & Loss PDF.', where: 'Menu → Office → Profit & Commission', tab: 'crm-profit', who: 'money' },
      { title: 'Punch page: My week, tasks and Team Pulse', text: 'Right under the punch buttons: your hours this week, your to-do board (To do → Doing → Done), and Team Pulse showing everyone once, e.g. “Arrived late at 11:03 AM”.', where: 'Punch Clock', tab: 'clock' },
      { title: 'Customers', text: 'Each customer has Call and WhatsApp buttons (logged automatically), a History button showing all their invoices, receipts and calls, and optional Birthday / Passport expiry with reminders. Adding a phone number twice gives a warning.', where: 'Customers page', tab: 'crm-customers' },
      { title: 'Leave balance and monthly summary', text: 'Leave Requests shows how many leave days you have left this year. My Attendance has a “Monthly summary (PDF)” with your days, hours, late days and overtime.', where: 'Leave Requests · My Attendance', tab: 'leaves' },
      { title: 'Media Team: Posting Calendar', text: 'Plan each post by day and platform. Paste the live link(s) of the post (add several with “+ Add another link”); adding a link marks it posted. Missed posts are flagged and Admin gets a weekly and monthly report.', where: 'Menu → Media Team → Posting Calendar', tab: 'crm-media', who: 'media' },
      { title: 'Themes and Urdu', text: 'Pick a look with the coloured dots at the top of the menu (Classic, Ocean Breeze, Desert Sand, Forest, Graphite). The اردو button switches the menus to Urdu.', where: 'Top of the menu · My Profile → App theme' },
      { title: 'Phone app', text: 'On phones: bottom bar (Punch, Invoices, Follow-ups, Alerts, More), pull down to refresh, notification buttons (Punch in / Punch out / Approve), home-screen widget, fingerprint unlock under My Profile.', where: 'Bahaar Office phone app', who: 'phone' },
      { title: 'Safer sign-in', text: 'Admin, CEO and Accounts approve computer sign-ins on their phone and need a password of at least 6 characters. Computers stay signed in for 7 days.', who: 'money' },
      { title: 'Admin tools', text: 'Announcements (Notifications page), activity log and backup/timer health (Office Settings), “Sign out of all devices” for a lost phone (Employee Directory).', where: 'Notifications · Office Settings · Employee Directory', tab: 'settings', who: 'admin' },
    ],
  },
];

export function stepFor(step: WhatsNewStep, u: Employee, inPhoneApp: boolean): boolean {
  const role = u.role;
  switch (step.who || 'all') {
    case 'admin': return role === 'admin' || role === 'ceo' || u.isSuperAdmin === true;
    case 'money': return role === 'admin' || role === 'ceo' || role === 'accounts' || u.isSuperAdmin === true;
    case 'media': return role === 'admin' || role === 'ceo' || u.mediaTeam === true;
    case 'sales': return role === 'admin' || role === 'ceo' || role === 'accounts' || u.salesAccess === true || u.isSuperAdmin === true;
    case 'phone': return true || inPhoneApp;
    default: return true;
  }
}
