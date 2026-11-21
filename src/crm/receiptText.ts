import { CrmReceipt } from './crmApi';

export const receiptItemsText = (r: Pick<CrmReceipt, 'items' | 'otherItem'>): string[] => [...r.items, ...(r.otherItem ? [`Other: ${r.otherItem}`] : [])];
