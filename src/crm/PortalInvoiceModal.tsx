import React, { useEffect, useState } from 'react';
import { Modal } from '../components/common/Modal';
import { Switch } from '../components/common/Switch';
import { CrmInvoice, PortalInvoiceSettings, crmCall } from './crmApi';
import { ErrorNote, Field, btnGhost, btnPrimary, inputCls } from './ui';

interface Props {
  invoice: CrmInvoice | null;
  settings: PortalInvoiceSettings | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/** What the customer sees on the public portal for one booking: a message, hidden amounts, tracking on/off or expiry. */
export const PortalInvoiceModal: React.FC<Props> = ({ invoice, settings, onClose, onSaved }) => {
  const [note, setNote] = useState('');
  const [hideAmounts, setHideAmounts] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setNote(settings?.note || '');
    setHideAmounts(Boolean(settings?.hideAmounts));
    setDisabled(Boolean(settings?.disabled));
    setExpiresAt(settings?.expiresAt || '');
    setError('');
  }, [invoice?.id, settings]);

  const save = async () => {
    if (!invoice) return;
    setBusy(true);
    setError('');
    try {
      await crmCall('portal_invoice_save', { invoiceId: invoice.id, note, hideAmounts, disabled, expiresAt });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={Boolean(invoice)} onClose={onClose} title={invoice ? `Customer portal · ${invoice.invoiceNo}` : ''} subtitle="Controls what this customer sees when tracking this booking" maxWidth="lg">
      <div className="space-y-4">
        <Field label="Message to the customer" hint="Shows at the top of this booking on the customer's tracking page, e.g. “Documents submitted to the embassy”. Leave empty to remove it.">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={400} className={inputCls} placeholder="e.g. Your documents were submitted to the embassy today." />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-xs">
            <b className="block text-slate-900 dark:text-slate-100">Hide amounts on the portal</b>
            <span className="text-slate-500">Prices, totals, balance and receipt amounts are not shown to the customer.</span>
          </div>
          <Switch checked={hideAmounts} onChange={setHideAmounts} label="Hide amounts on the portal" />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
          <div className="text-xs">
            <b className="block text-slate-900 dark:text-slate-100">Turn tracking off for this booking</b>
            <span className="text-slate-500">The booking disappears from the public portal until you turn it back on.</span>
          </div>
          <Switch checked={disabled} onChange={setDisabled} label="Turn tracking off for this booking" tone="violet" />
        </div>
        <Field label="Tracking expires on (optional)" hint="After this date the booking is no longer shown on the public portal.">
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
        </Field>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="button" onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
};
