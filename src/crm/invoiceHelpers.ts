import { CompanyProfile, CrmInvoice } from './crmApi';

/** The single "CRM ID / Query Code" value (older invoices may have kept the two separately). */
export const crmQueryOf = (inv: Pick<CrmInvoice, 'crmId' | 'queryCode'>): string => {
  const a = (inv.crmId || '').trim();
  const b = (inv.queryCode || '').trim();
  return a && b && a !== b ? `${a} / ${b}` : a || b;
};

/** The NTN to print on the invoice, or '' when it is switched off or empty (the PDF then simply leaves that row out). */
export const ntnShown = (inv: Pick<CrmInvoice, 'kind' | 'ntn' | 'showNtn'>, company: CompanyProfile): string => {
  if (inv.kind === 'vendor' || inv.showNtn === false) return '';
  return (inv.ntn === null || inv.ntn === undefined ? company.ntn : inv.ntn).trim();
};
