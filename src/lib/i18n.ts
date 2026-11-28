import { useEffect, useState } from 'react';

/** Urdu for the staff app's menus, page titles and phone bar. Content (customers, invoices…) stays as typed. */
const UR: Record<string, string> = {
  'My Workspace': 'میرا کام', CRM: 'سی آر ایم', Office: 'دفتر', 'Admin Management': 'ایڈمن', 'Media Team': 'میڈیا ٹیم',
  'Punch Clock': 'حاضری', 'Live Dashboard': 'لائیو ڈیش بورڈ', 'My Attendance & Stats': 'میری حاضری', 'Team Presence (P/A)': 'ٹیم کی حاضری',
  'Leave Requests': 'چھٹی کی درخواست', Customers: 'کسٹمرز', 'Follow-ups & Tasks': 'فالو اپ اور کام', Meetings: 'میٹنگز', 'Customer Portal': 'کسٹمر پورٹل',
  'Posting Calendar': 'پوسٹنگ کیلنڈر', Sales: 'سیلز', Purchases: 'خریداری', Receipts: 'رسیدیں', Invoices: 'انوائس', 'Payment Tree': 'ادائیگی کا خاکہ',
  'Profit & Commission': 'منافع اور کمیشن', Quotations: 'کوٹیشنز', 'Overdue invoices': 'واجب الادا انوائسز', 'Vendor ledger': 'وینڈر کھاتہ', 'Cash & bank book': 'کیش اور بینک بک', 'Group bookings': 'گروپ بکنگز', 'Customer feedback': 'کسٹمر کی رائے', 'Staff performance': 'عملے کی کارکردگی', 'Add something new': 'نیا شامل کریں', 'New invoice': 'نئی انوائس', 'New receipt': 'نئی رسید', 'New follow-up': 'نیا فالو اپ', 'New customer': 'نیا کسٹمر', 'New quotation': 'نئی کوٹیشن', 'Portal Control': 'پورٹل کنٹرول', Notifications: 'اطلاعات', Inventory: 'سامان',
  'Attendance Verification': 'حاضری کی تصدیق', 'Smart Insights': 'جائزہ', 'Reports & Payroll': 'رپورٹس اور تنخواہ', 'Team Presence & Roster Stats': 'ٹیم کی حاضری',
  'Smart Insights & Graphs': 'جائزہ اور گراف', 'Executive Analytics & Stats': 'ایگزیکٹو جائزہ', 'Team Roster & Logs': 'ٹیم کا ریکارڈ', 'Employees Directory': 'ملازمین',
  'Shift Schedules': 'شفٹیں', 'Office & Server Settings': 'دفتر کی سیٹنگز', 'Super Admin Console': 'سپر ایڈمن',
  Punch: 'حاضری', 'Follow-ups': 'فالو اپ', Alerts: 'اطلاعات', More: 'مزید',
  'My Attendance': 'میری حاضری', 'Team Presence': 'ٹیم کی حاضری', 'Smart Insights ': 'جائزہ', 'Team Roster': 'ٹیم', Shifts: 'شفٹیں', Settings: 'سیٹنگز',
  'My tasks today': 'آج کے کام', 'My week': 'میرا ہفتہ', 'Sign out': 'سائن آؤٹ',
};
const KEY = 'office_lang';
export type Lang = 'en' | 'ur';
export const getLang = (): Lang => { try { return localStorage.getItem(KEY) === 'ur' ? 'ur' : 'en'; } catch { return 'en'; } };
export function setLang(l: Lang): void {
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('office-lang', { detail: l }));
}
export const t = (s: string, lang: Lang = getLang()): string => (lang === 'ur' ? UR[s] || s : s);
/** Re-renders when the language is switched. */
export function useLang(): Lang {
  const [lang, set] = useState<Lang>(getLang());
  useEffect(() => { const on = () => set(getLang()); window.addEventListener('office-lang', on); return () => window.removeEventListener('office-lang', on); }, []);
  return lang;
}
