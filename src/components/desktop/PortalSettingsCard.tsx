import React, { useEffect, useState } from 'react';
import { Check, Loader2, MessageCircle } from 'lucide-react';
import { crmCall } from '../../crm/crmApi';

interface PortalConfig {
  whatsappNumber: string;
  whatsappMessage: string;
}

/** Admin controls for the public Customer Portal (starts with the WhatsApp contact; more switches are added here). */
export const PortalSettingsCard: React.FC = () => {
  const [cfg, setCfg] = useState<PortalConfig>({ whatsappNumber: '', whatsappMessage: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    crmCall<{ config: PortalConfig }>('portal_config_get')
      .then((r) => alive && setCfg({ whatsappNumber: r.config.whatsappNumber || '', whatsappMessage: r.config.whatsappMessage || '' }))
      .catch((e) => alive && setError(e?.message || 'Could not load the portal settings.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const r = await crmCall<{ config: PortalConfig }>('portal_config_save', { config: cfg });
      setCfg({ whatsappNumber: r.config.whatsappNumber || '', whatsappMessage: r.config.whatsappMessage || '' });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100';

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
        <MessageCircle className="w-4 h-4 text-emerald-600" />
        <span>Customer Portal · WhatsApp contact</span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Customers see a green “Chat on WhatsApp” button on the portal. Leave the number empty to hide the button. You can change it any time; the change is live straight away.
      </p>
      {loading ? (
        <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">WhatsApp number (with country code)</label>
            <input
              type="text"
              inputMode="tel"
              value={cfg.whatsappNumber}
              onChange={(e) => setCfg({ ...cfg, whatsappNumber: e.target.value })}
              placeholder="e.g. +92 300 1234567"
              maxLength={30}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">First message customers send</label>
            <input
              type="text"
              value={cfg.whatsappMessage}
              onChange={(e) => setCfg({ ...cfg, whatsappMessage: e.target.value })}
              placeholder="Hello Bahaar Journeys, I need help with my booking."
              maxLength={300}
              className={inputCls}
            />
          </div>
        </div>
      )}
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save WhatsApp contact
        </button>
        {saved && <span className="text-xs font-semibold text-emerald-600">Saved — live on the portal.</span>}
      </div>
    </div>
  );
};
