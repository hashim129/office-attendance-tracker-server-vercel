import React, { useState, useEffect } from 'react';
import { PortalSettingsCard } from './PortalSettingsCard';
import {
  Settings,
  Save,
  Download,
  Upload,
  RefreshCw,
  Server,
  Building,
  ShieldAlert,
  ScanFace,
  CheckCircle2,
  Wifi,
  Plus,
  Trash2,
  Globe,
  ShieldCheck,
  Terminal,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { OfficeSettings } from '../../types';
import { Switch } from '../common/Switch';
import {
  exportDatabaseBackup,
  importDatabaseBackup,
  resetToFactoryDefaults,
} from '../../lib/storage';
import { detectClientNetwork, describeIpRule, doesIpMatchRule, toNetworkRule } from '../../lib/ipSecurity';
import {
  downloadWindowsBatFile,
  generatePortalLauncherBat,
} from '../../lib/autoStartScript';

interface OfficeSettingsTabProps {
  settings: OfficeSettings;
  onUpdateSettings: (newSettings: OfficeSettings) => void;
  onReloadAllData: () => void;
  currentClientIp?: string;
  currentClientIsp?: string;
  previewDeployment?: boolean;
  previewBetaEnabled?: boolean;
  onPreviewBetaChange?: (enabled: boolean) => void;
}

export const OfficeSettingsTab: React.FC<OfficeSettingsTabProps> = ({
  settings,
  onUpdateSettings,
  onReloadAllData,
  currentClientIp,
  currentClientIsp,
  previewDeployment = false,
  previewBetaEnabled = false,
  onPreviewBetaChange,
}) => {
  const [formData, setFormData] = useState<OfficeSettings>({
    ...settings,
    enforceOfficeIpLock: settings.enforceOfficeIpLock ?? false,
    allowedOfficeIps: settings.allowedOfficeIps ?? [],
    allowedOfficeIsps: settings.allowedOfficeIsps ?? [],
    allowAdminBypassIpLock: settings.allowAdminBypassIpLock ?? true,
    customerPortalBetaEnabled: settings.customerPortalBetaEnabled !== false,
  });
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [detectedIp, setDetectedIp] = useState<string>(currentClientIp || 'Detecting...');
  const [detectedIsp, setDetectedIsp] = useState<string>(currentClientIsp || 'Detecting...');
  const [detectedV4, setDetectedV4] = useState<string>('');
  const [detectedV6, setDetectedV6] = useState<string>('');
  const [serverSeen, setServerSeen] = useState<string>('');
  const [ipChanges, setIpChanges] = useState<boolean>(true); // office IP changes on reconnect (typical in Pakistan)
  const [newIpInput, setNewIpInput] = useState<string>('');
  const [newIpLabelInput, setNewIpLabelInput] = useState<string>('');

  useEffect(() => {
    setFormData({
      ...settings,
      enforceOfficeIpLock: settings.enforceOfficeIpLock ?? false,
      allowedOfficeIps: settings.allowedOfficeIps ?? [],
      allowedOfficeIsps: settings.allowedOfficeIsps ?? [],
      allowAdminBypassIpLock: settings.allowAdminBypassIpLock ?? true,
      customerPortalBetaEnabled: settings.customerPortalBetaEnabled !== false,
    });
  }, [settings]);

  useEffect(() => {
    if (currentClientIp && currentClientIp !== 'Detecting...') {
      setDetectedIp(currentClientIp);
      if (currentClientIsp) setDetectedIsp(currentClientIsp);
    }
    // Always look up both address families so an office with IPv6 gets captured too
    void detectClientNetwork().then((net) => {
      setDetectedIp((prev) => (prev && prev !== 'Detecting...' && prev !== 'Unknown' ? prev : net.ip));
      setDetectedIsp(net.isp);
      setDetectedV4(net.ipv4 || '');
      setDetectedV6(net.ipv6 || '');
      setServerSeen(net.serverSeenIp || '');
    });
  }, [currentClientIp, currentClientIsp]);

  // The internet company name is never used to allow access any more - clear any old entries.
  useEffect(() => {
    if ((settings.allowedOfficeIsps || []).length > 0) {
      onUpdateSettings({ ...settings, allowedOfficeIsps: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adds every address this device is using right now: the exact IPv4 and the IPv6 office network (/64).
  const handleCaptureNetwork = () => {
    const found = Array.from(
      new Set([detectedV4, detectedV6, serverSeen].map((x) => (x ? toNetworkRule(x, ipChanges) : null)).filter((x): x is string => Boolean(x)))
    );
    const existing = formData.allowedOfficeIps || [];
    const fresh = found.filter((rule) => !existing.some((e) => e.ip.toLowerCase() === rule.toLowerCase()));
    if (found.length === 0) {
      alert('Could not read this network yet. Check the internet connection and try again.');
      return;
    }
    if (fresh.length === 0) {
      alert('This network is already registered.');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    const added = fresh.map((rule) => ({
      ip: rule,
      label: rule.includes(':')
        ? 'Office IPv6 network'
        : rule.endsWith('.*')
          ? `Office IP block ${rule.replace('*', 'x')} (changes when the router reconnects)`
          : 'Office public IPv4 (exact address)',
      addedAt: today,
    }));
    const updated: OfficeSettings = { ...formData, allowedOfficeIps: [...existing, ...added] };
    setFormData(updated);
    onUpdateSettings(updated);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleAddAllowedIp = (ipToAdd: string, labelToAdd: string) => {
    const cleanIp = ipToAdd.trim();
    if (!cleanIp || cleanIp === 'Detecting...' || cleanIp === 'Unknown') return;

    const scope = describeIpRule(cleanIp);
    if (!scope.valid) {
      alert(`"${cleanIp}" is not a valid IP address or range.`);
      return;
    }
    if (scope.level === 'broad') {
      alert(`"${cleanIp}" is too wide (${scope.note}). Use a block of 256 addresses (like 175.107.239.*) or an exact IP instead.`);
      return;
    }
    if (scope.level === 'block' && !confirm(`"${cleanIp}" allows ${scope.note}. A few other customers of the same internet company may share this block. Add it?`)) {
      return;
    }
    if (scope.level === 'small' && !confirm(`"${cleanIp}" allows ${scope.note}. Only continue if all of them belong to your office. Add it?`)) {
      return;
    }

    const currentList = formData.allowedOfficeIps || [];
    if (currentList.some((item) => item.ip.toLowerCase() === cleanIp.toLowerCase())) {
      alert(`IP / Range "${cleanIp}" is already in the Allowed Office IP list.`);
      return;
    }

    const updatedList = [
      ...currentList,
      {
        ip: cleanIp,
        label: labelToAdd.trim() || 'Office Internet Provider',
        addedAt: new Date().toISOString().split('T')[0],
      },
    ];

    const updatedSettings: OfficeSettings = {
      ...formData,
      allowedOfficeIps: updatedList,
    };
    setFormData(updatedSettings);
    onUpdateSettings(updatedSettings);
    setNewIpInput('');
    setNewIpLabelInput('');
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleRemoveAllowedIp = (ipToRemove: string) => {
    const currentList = formData.allowedOfficeIps || [];
    const updatedList = currentList.filter((item) => item.ip !== ipToRemove);
    const updatedSettings: OfficeSettings = {
      ...formData,
      allowedOfficeIps: updatedList,
    };
    setFormData(updatedSettings);
    onUpdateSettings(updatedSettings);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateSettings(formData);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleBackupDownload = () => {
    const jsonStr = exportDatabaseBackup();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_db_backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const ok = importDatabaseBackup(content);
        if (ok) {
          alert('Database restored successfully from local backup file.');
          onReloadAllData();
        } else {
          alert('Failed to parse backup JSON file. Ensure it is a valid Attendance Tracker database backup.');
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleResetDefaults = () => {
    if (
      confirm(
        'Reset all attendance records, employees, shifts, and settings to original initial sample data?'
      )
    ) {
      resetToFactoryDefaults();
      onReloadAllData();
      alert('System restored to factory default sample data.');
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          <span>Office & Local Server Configuration</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Configure company profile, letterhead headers, overtime calculation rates, and database backup
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="rounded-2xl border border-indigo-300/70 dark:border-indigo-800 bg-gradient-to-br from-indigo-50/80 to-white dark:from-indigo-950/30 dark:to-slate-900 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
                <span>Workspace Redesign</span>
                <span className="rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-300 px-2 py-0.5 text-[10px] font-bold uppercase">Beta</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Preview the refreshed workspace experience. Only an administrator can enable or disable this rollout.</p>
            </div>
            <span className={`text-[11px] font-bold ${(previewDeployment ? previewBetaEnabled : formData.redesignedUiBetaEnabled) ? 'text-emerald-600' : 'text-slate-500'}`}>{(previewDeployment ? previewBetaEnabled : formData.redesignedUiBetaEnabled) ? 'BETA ACTIVE' : 'ORIGINAL UI'}</span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-indigo-200/70 dark:border-indigo-900/60 bg-white/70 dark:bg-slate-950/30 p-3">
            <div className="min-w-0">
              <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">Enable redesigned UI (Beta)</span>
              <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Turn OFF to return to the original interface. Preview changes are stored only in this browser; production approval is saved to workspace settings.</span>
            </div>
            <Switch tone="blue" label="Enable redesigned UI Beta" checked={previewDeployment ? previewBetaEnabled : formData.redesignedUiBetaEnabled === true} onChange={(v) => {
              if (previewDeployment) { onPreviewBetaChange?.(v); setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 3000); return; }
              const updated = { ...formData, redesignedUiBetaEnabled: v };
              setFormData(updated);
              onUpdateSettings(updated);
              setSaveSuccess(true);
              setTimeout(() => setSaveSuccess(false), 3000);
            }} />
          </div>
        </section>
        {/* Customer Portal & Visa Tracking (Beta) — Top of Settings */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border-2 border-blue-500/40 dark:border-blue-500/30 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <Globe className="w-4 h-4 text-blue-600" />
              <span>Bahaar Journeys Customers Page &amp; Visa Tracker (Beta)</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                Beta
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {formData.customerPortalBetaEnabled !== false ? 'Active · Live at /customers' : 'Hidden / Locked'}
            </span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control visibility of the public Bahaar Journeys Customers Page (<code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">/customers</code>), the sidebar shortcut, the public lookup endpoint, and Visa progress controls on customer Visa invoices. Turn this switch <b>OFF (Hide)</b> to completely hide and lock all Customers Page &amp; Visa Tracker features across the entire application.
          </p>

          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/80 dark:border-blue-900/40">
            <div className="text-xs min-w-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                Show Public Customers Page &amp; Invoice Visa Tracking (Beta)
              </span>
              <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                Toggle OFF to immediately hide the Customer Portal link, lock /customers (404), and hide all Visa progress controls in Invoices.
              </span>
            </div>
            <Switch
              tone="blue"
              label="Enable Public Customers Page (Beta)"
              checked={formData.customerPortalBetaEnabled !== false}
              onChange={(v) => {
                const updated: OfficeSettings = {
                  ...formData,
                  customerPortalBetaEnabled: v,
                };
                setFormData(updated);
                onUpdateSettings(updated);
                setSaveSuccess(true);
                setTimeout(() => setSaveSuccess(false), 3000);
              }}
            />
          </div>

          {formData.customerPortalBetaEnabled !== false && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-xs">
              <div className="min-w-0">
                <span className="font-semibold text-emerald-900 dark:text-emerald-200 block">
                  Public Customers Portal is Live
                </span>
                <span className="text-emerald-700 dark:text-emerald-300/90 text-[11px] font-mono">
                  /customers
                </span>
              </div>
              <a
                href="/customers"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors"
              >
                <span>Open Customers Page (/customers)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>

        {formData.customerPortalBetaEnabled !== false && <PortalSettingsCard />}

        {/* Company Profile Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Building className="w-4 h-4 text-blue-600" />
            <span>Company Profile & Report Letterhead</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Company Legal Name
              </label>
              <input
                type="text"
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                required
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Headquarters Address
              </label>
              <input
                type="text"
                value={formData.companyAddress}
                onChange={(e) => setFormData({ ...formData, companyAddress: e.target.value })}
                required
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Office Contact Phone
              </label>
              <input
                type="text"
                value={formData.companyPhone}
                onChange={(e) => setFormData({ ...formData, companyPhone: e.target.value })}
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                HR Email Address
              </label>
              <input
                type="email"
                value={formData.companyEmail}
                onChange={(e) => setFormData({ ...formData, companyEmail: e.target.value })}
                className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* Server & Calculation Rules Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Server className="w-4 h-4 text-emerald-600" />
            <span>Local Server & Policy Rules</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Server Hostname
              </label>
              <input
                type="text"
                value={formData.serverHostName}
                onChange={(e) => setFormData({ ...formData, serverHostName: e.target.value })}
                className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Local Port
              </label>
              <input
                type="number"
                value={formData.serverPort}
                onChange={(e) => setFormData({ ...formData, serverPort: parseInt(e.target.value, 10) || 3000 })}
                className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Overtime Multiplier Rate
              </label>
              <input
                type="number"
                step="0.1"
                min="1.0"
                max="3.0"
                value={formData.overtimeRateMultiplier}
                onChange={(e) => setFormData({ ...formData, overtimeRateMultiplier: parseFloat(e.target.value) || 1.5 })}
                className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Standard overtime is 1.5x regular pay
              </span>
            </div>
          </div>
        </div>

        {/* Office Public IP Address Lock & Dual-ISP Extender Support Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border-2 border-emerald-500/30 dark:border-emerald-500/20 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Wifi className="w-4 h-4 text-emerald-600" />
              <span>Office Network Lock (exact IPv4 + IPv6)</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Detected ISP:</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {detectedIsp}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Public IP:</span>
              <span className="px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-slate-900 text-emerald-400 border border-slate-700">
                {detectedIp}
              </span>
            </div>
          </div>

          {/* How the lock works */}
          <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/50 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
            <div className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
              <Globe className="w-4 h-4 text-blue-600 shrink-0" />
              <span>How the office is recognised</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Only your office&apos;s own <strong>public IP addresses</strong> are allowed: the small block of IPv4 addresses your router gets (the last number changes whenever it reconnects) and, if your line has it, your IPv6 network. The internet company (ISP) name is <strong>never</strong> used, because every customer of that company, including employees at home, shares it. All Wi-Fi extenders and LAN cables behind the same router share these addresses.
            </p>
            <p className="text-[11px] leading-relaxed font-medium text-emerald-700 dark:text-emerald-400">
              ✓ Connect to the office Wi-Fi, then press <strong>Capture this network</strong>. If you have a second internet line, repeat it while connected to that line. The check runs on the server for every punch.
            </p>
            <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
              DNS servers cannot be read by a web page, so they are not part of the check. The IP addresses above are what the server can see reliably.
            </p>
          </div>

          {/* Toggle Switches */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!formData.enforceOfficeIpLock}
                onChange={(e) => {
                  const updated = { ...formData, enforceOfficeIpLock: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
              />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Enforce Office Public IP Restriction
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Block punching unless the employee is on one of the registered office addresses below (checked on the server)
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allowAdminBypassIpLock ?? true}
                onChange={(e) => {
                  const updated = { ...formData, allowAdminBypassIpLock: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <div>
                <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                  Allow Admin Role to Bypass IP Lock
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Lets Admins register a new office IP from anywhere, for example after the router gets a new address
                </p>
              </div>
            </label>
          </div>

          {/* Quick-Add Current Office IP + Subnet + Manual Additional IP Form */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-600" />
                <span>Register your office network</span>
              </label>

              <label className="inline-flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ipChanges}
                  onChange={(e) => setIpChanges(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-emerald-600 cursor-pointer"
                />
                <span>My office IP changes when the router reconnects (recommended)</span>
              </label>

              <button
                type="button"
                onClick={handleCaptureNetwork}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Capture this network</span>
              </button>
            </div>

            {/* What this device is using right now */}
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">This device right now:</span>
              <span className="px-2 py-0.5 rounded font-mono font-bold bg-slate-900 text-emerald-400 border border-slate-700">
                IPv4 {detectedV4 || 'none'}
              </span>
              <span className="px-2 py-0.5 rounded font-mono font-bold bg-slate-900 text-sky-300 border border-slate-700 max-w-full truncate">
                IPv6 {detectedV6 || 'none'}
              </span>
              {serverSeen && (
                <span className="text-slate-500 dark:text-slate-400">Server sees: <span className="font-mono font-semibold">{serverSeen}</span></span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-5">
                <input
                  type="text"
                  value={newIpInput}
                  onChange={(e) => setNewIpInput(e.target.value)}
                  placeholder="Another office IP (e.g. 175.107.239.140 or 2400:adc5:1b5:9f00::/64)"
                  className="w-full text-xs font-mono px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-5">
                <input
                  type="text"
                  value={newIpLabelInput}
                  onChange={(e) => setNewIpLabelInput(e.target.value)}
                  placeholder="Label (e.g. Second internet line)"
                  className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => handleAddAllowedIp(newIpInput, newIpLabelInput)}
                  disabled={!newIpInput.trim()}
                  className="w-full h-full py-2 px-3 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add IP</span>
                </button>
              </div>
            </div>
          </div>

          {/* Whitelisted IPs Table */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="bg-slate-50 dark:bg-slate-800/70 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Authorized office addresses ({(formData.allowedOfficeIps || []).length})
              </span>
              <span className="text-[11px] text-slate-500">
                Covers every Wi-Fi extender & LAN cable behind them
              </span>
            </div>

            {(formData.allowedOfficeIps || []).length === 0 ? (
              <div className="p-5 text-center text-xs text-slate-500 dark:text-slate-400">
                No office address registered yet. While connected to the office Wi-Fi, press <strong>Capture this network</strong>. Until then employees cannot punch in.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {(formData.allowedOfficeIps || []).map((item) => {
                  const isCurrentMatch = [detectedV4, detectedV6, serverSeen].some((x) => x && doesIpMatchRule(x, item.ip));
                  const scope = describeIpRule(item.ip);
                  return (
                    <div
                      key={item.ip}
                      className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/30"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700">
                          {item.ip}
                        </span>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                            <span className="truncate">{item.label}</span>
                            {isCurrentMatch && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                                Active Match
                              </span>
                            )}
                          </div>
                          <div className={`text-[10px] ${scope.level === 'broad' || scope.level === 'invalid' ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>
                            {scope.note} · Added on {item.addedAt}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveAllowedIp(item.ip)}
                        className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                        title="Remove IP Address"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* High security: Face scan punch (separate from the network lock) */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ScanFace className="w-4 h-4 text-violet-600" />
            <span>High Security: Face Scan Punch</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">Optional</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            When on, an employee with an enrolled face must pass a live camera check (blink) before clocking in, out or taking a break. It works on top of the office network lock and can be switched off at any time. Enroll faces from the Employees page.
          </p>
          <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/80 dark:border-violet-900/40">
            <div className="text-xs min-w-0">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">Everyone must set up their own face before punching</span>
              <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                When on, each person is asked to enroll their face through their own login (it takes a few seconds, once). Nobody can punch in until it is done. Only you can change an enrolled face afterwards.
              </span>
            </div>
            <Switch
              tone="violet"
              label="Require every employee to enroll their face"
              checked={formData.faceEnrollRequired === true}
              onChange={(v) => {
                const updated = { ...formData, faceEnrollRequired: v };
                setFormData(updated);
                onUpdateSettings(updated);
              }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/80 dark:border-violet-900/40">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.faceScanPunchEnabled === true}
                onChange={(e) => {
                  const updated = { ...formData, faceScanPunchEnabled: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-0.5 w-4 h-4 rounded text-violet-600 cursor-pointer"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">Require face scan to punch</span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">Off by default. Silent .bat auto check-in is paused for staff while this is on.</span>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.faceScanAllowUnenrolled ?? true}
                disabled={formData.faceScanPunchEnabled !== true}
                onChange={(e) => {
                  const updated = { ...formData, faceScanAllowUnenrolled: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-0.5 w-4 h-4 rounded text-violet-600 cursor-pointer disabled:opacity-50"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">Let staff without an enrolled face punch normally</span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">Turn this off for strict mode: nobody can punch until their face is enrolled.</span>
              </div>
            </label>
          </div>
        </div>

        {/* Windows Auto-Start Check-In Policy */}
        <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ShieldCheck className="w-4 h-4 text-blue-600" />
            <span>Windows Auto-Start Check-In Policy</span>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control whether the downloadable Windows startup (.bat) script checks employees in silently at PC boot or opens the manual PIN portal. Attendance remains protected by Office IP Restriction above.
          </p>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.allowAutoStartPunch === true}
                onChange={(e) => {
                  const updated = { ...formData, allowAutoStartPunch: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-1 w-4 h-4 rounded text-blue-600"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                  Optional: Silent Boot Auto Check-In (.bat)
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                  Off by default — keeps punching manual by selecting Employee ID &amp; PIN when the app auto-starts
                </span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.enableDisconnectStatusTracking !== false}
                onChange={(e) => {
                  const updated = { ...formData, enableDisconnectStatusTracking: e.target.checked };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="mt-1 w-4 h-4 rounded text-amber-600"
              />
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                  Track Device Internet Disconnectivity (&quot;No Internet · In&quot;)
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                  Automatically updates status to &quot;No Internet (In)&quot; if a clocked-in device loses connection (except when set on Break).
                </span>
              </div>
            </label>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs">
                <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                  Auto Logout After Shift End
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                  No idle timeout during the shift. Once Shift End + this window has passed, every open punch is logged out automatically (an Admin can keep a punch open). Overtime up to that moment is counted.
                </span>
              </div>
              <select
                value={String(formData.autoPunchOutOnInactiveHours ?? 2)}
                onChange={(e) => {
                  const updated = {
                    ...formData,
                    autoPunchOutOnInactiveHours: Number(e.target.value),
                  };
                  setFormData(updated);
                  onUpdateSettings(updated);
                }}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-900 dark:text-slate-100 shrink-0"
              >
                <option value="2">Shift End + 2h (Default)</option>
                <option value="1">Shift End + 1h</option>
                <option value="3">Shift End + 3h</option>
                <option value="4">Shift End + 4h</option>
                <option value="0">Disabled</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Confirmation Button */}
        <div className="flex items-center justify-between">
          <div>
            {saveSuccess && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold animate-in fade-in">
                <CheckCircle2 className="w-4 h-4" />
                <span>Configuration saved successfully!</span>
              </span>
            )}
          </div>

          <button
            type="submit"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>

      {/* Automated Windows Boot / Login App Launcher (.bat) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border-2 border-indigo-500/40 dark:border-indigo-500/30 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <Terminal className="w-4 h-4 text-indigo-600" />
            <span>Windows Startup Auto-Start App (.bat)</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 self-start">
            <Zap className="w-3 h-3" />
            <span>Auto-Opens on Windows Boot / Login (Manual ID Punch)</span>
          </span>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Install this lightweight Windows <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">.bat</code> launcher on office Windows 10/11 PCs so the Attendance Tracker opens cleanly in its own app window whenever Windows starts or logs in. Employees simply select their Employee ID &amp; PIN and punch manually — preserving all Device Binding, PIN, and Lobby Kiosk rules.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 flex flex-col justify-between gap-3">
            <div className="space-y-1">
              <h4 className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                1. Universal Windows Auto-Start (.bat) — Recommended
              </h4>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Auto-opens the Attendance Tracker desktop window on Windows boot/login &amp; creates a Desktop shortcut. Works on every PC; staff select their ID and punch manually.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const { filename, content } = generatePortalLauncherBat({
                  appUrl: typeof window !== 'undefined' ? window.location.origin : 'https://office-attendance-tracker-server-ve.vercel.app',
                  companyName: formData.companyName,
                });
                downloadWindowsBatFile(filename, content);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Windows Auto-Start (.bat)</span>
            </button>
          </div>

          <div className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-2">
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200">
              2. Per-Employee Pre-Selected ID (.bat)
            </h4>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              To download a staff member&apos;s own startup <code className="font-mono">.bat</code> with their Employee ID pre-selected for manual PIN login (or optional silent boot punch if enabled above), open <strong>Staff Directory</strong> and click <strong>Auto-Start .bat</strong> on their card.
            </p>
          </div>
        </div>
      </div>

      {/* Database Backup & Disaster Recovery Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <span>Local Server Database Backup & Recovery</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Export your entire local office database (employees, punch logs, shifts, leave requests) into a portable JSON backup file for archiving or transfer to another PC.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleBackupDownload}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-blue-600" />
            <span>Export Full Database Backup (JSON)</span>
          </button>

          <label className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-emerald-600" />
            <span>Restore Backup JSON</span>
            <input
              type="file"
              accept=".json"
              onChange={handleBackupUpload}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer ml-auto"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset to Factory Defaults</span>
          </button>
        </div>
      </div>

      {/* Windows Local Server Deployment Kit Card */}
      <div className="bg-white dark:bg-slate-900 rounded-xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Server className="w-4 h-4 text-blue-600" />
            <span>Standalone Windows Software (.EXE) & Server Deployment</span>
          </div>
          <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
            Zero Dependencies Required · Windows 10 / 11 / Server
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Install or run the self-contained Windows software directly on any PC or Windows Server without installing Node.js or any external runtime. All web assets, server engine, and local database storage are bundled inside the executable.
        </p>

        {/* Primary Standalone .EXE Downloads */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <a
            href="/downloads/OfficeAttendanceTracker-Setup.exe"
            download="OfficeAttendanceTracker-Setup.exe"
            className="p-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors flex items-start gap-3 cursor-pointer"
          >
            <Download className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-bold">
                Download Windows Installer (OfficeAttendanceTracker-Setup.exe)
              </div>
              <p className="text-[11px] text-blue-100 mt-1">
                Guided setup wizard · Installs to Program Files/AppData, creates Desktop & Start Menu shortcuts, configures Firewall & Auto-Start
              </p>
            </div>
          </a>

          <a
            href="/downloads/OfficeAttendanceTracker-Portable.exe"
            download="OfficeAttendanceTracker-Portable.exe"
            className="p-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white border border-slate-700 shadow-sm transition-colors flex items-start gap-3 cursor-pointer"
          >
            <Download className="w-5 h-5 shrink-0 mt-0.5 text-emerald-400" />
            <div>
              <div className="text-xs font-bold">
                Download Single-File Portable App (OfficeAttendanceTracker-Portable.exe)
              </div>
              <p className="text-[11px] text-slate-300 mt-1">
                Zero-install standalone .exe · Copy to any USB or Windows Server folder and double-click to launch GUI Server Control Panel
              </p>
            </div>
          </a>
        </div>

        {/* Auxiliary Scripts Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          {/* 1. Launcher .bat */}
          <button
            type="button"
            onClick={() => {
              const content = `@echo off\r\nsetlocal enabledelayedexpansion\r\ntitle Office Attendance Tracker - Windows Server Host\r\ncolor 0B\r\n\r\necho ======================================================================\r\necho    Office Attendance Tracker - Windows Local Server Launcher\r\necho ======================================================================\r\necho.\r\nwhere node >nul 2>nul\r\nif %ERRORLEVEL% NEQ 0 (\r\n    echo [ERROR] Node.js is not found on this Windows system!\r\n    echo Please install Node.js from https://nodejs.org/\r\n    pause\r\n    exit /b 1\r\n)\r\nif not exist "node_modules\\\\" (\r\n    echo [1/3] Installing dependencies...\r\n    call npm install\r\n)\r\nif not exist "dist\\\\" (\r\n    echo [2/3] Building production assets...\r\n    call npm run build\r\n)\r\necho.\r\necho [3/3] Starting Attendance Tracker Server on port 3000...\r\nstart http://localhost:3000\r\ncall npm start\r\npause\r\n`;
              const blob = new Blob([content], { type: 'application/x-bat' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'start-windows-server.bat';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-3.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-blue-700 dark:text-blue-300">
              <Download className="w-4 h-4 shrink-0" />
              <span>start-windows-server.bat</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Double-click to start local server & open browser on port 3000
            </p>
          </button>

          {/* 2. Service Installer .bat */}
          <button
            type="button"
            onClick={() => {
              const content = `@echo off\r\ntitle Install Attendance Tracker Windows Auto-Start Task\r\ncolor 0A\r\necho Registering Windows Startup Task for Attendance Tracker...\r\nset SCRIPT_DIR=%~dp0\r\nset BATCH_PATH=%SCRIPT_DIR%start-windows-server.bat\r\nschtasks /create /tn "OfficeAttendanceServer" /tr "\\"%BATCH_PATH%\\"" /sc onstart /ru SYSTEM /f\r\necho Done. Check task in Windows Task Scheduler.\r\npause\r\n`;
              const blob = new Blob([content], { type: 'application/x-bat' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'install-windows-service.bat';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <Download className="w-4 h-4 shrink-0" />
              <span>install-windows-service.bat</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Registers Windows auto-start background task on boot
            </p>
          </button>

          {/* 3. Deployment Guide .md */}
          <button
            type="button"
            onClick={() => {
              const content = `# Windows Local Office Server Deployment Guide\r\n\r\n## Quick Start\r\n1. Install Node.js (LTS version) from https://nodejs.org/\r\n2. Run \`start-windows-server.bat\`.\r\n3. Access on http://localhost:3000 or your office LAN IP (http://192.168.1.X:3000).\r\n\r\n## Windows Firewall Rule (Admin Command Prompt):\r\nnetsh advfirewall firewall add rule name="Office Attendance Tracker" dir=in action=allow protocol=TCP localport=3000\r\n\r\n## Running Kiosk on Entrance Tablet\r\nNavigate to http://[SERVER-IP]:3000 and switch to 'Lobby Kiosk' mode.\r\n`;
              const blob = new Blob([content], { type: 'text/markdown' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'WINDOWS_SERVER_DEPLOYMENT.md';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/60 text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Download className="w-4 h-4 shrink-0 text-slate-600" />
              <span>Deployment Manual (.md)</span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Firewall, LAN IP, and Windows Task Scheduler guide
            </p>
          </button>
        </div>

        {/* Windows Firewall Quick Command */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
            Allow Port 3000 in Windows Firewall (run in Administrator Command Prompt):
          </p>
          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono text-emerald-400 overflow-x-auto">
            <span>netsh advfirewall firewall add rule name="Office Attendance Tracker" dir=in action=allow protocol=TCP localport=3000</span>
          </div>
        </div>
      </div>
    </div>
  );
};
