import React, { useEffect, useState } from 'react';
import { Switch } from '../common/Switch';
import { biometricAvailable, biometricEnabled, setBiometric, officeRemindersEnabled, setOfficeReminders, inPhoneApp, hasBridge } from '../../lib/phoneApp';

/** Phone app only: fingerprint unlock and office arrive / leave reminders (on the My Profile page). */
export const PhoneAppSettings: React.FC = () => {
  const [bio, setBio] = useState(false);
  const [geo, setGeo] = useState(false);
  const read = () => { setBio(biometricEnabled()); setGeo(officeRemindersEnabled()); };
  useEffect(() => {
    read();
    const on = () => { if (document.visibilityState === 'visible') window.setTimeout(read, 300); };
    document.addEventListener('visibilitychange', on);
    window.addEventListener('focus', on);
    return () => { document.removeEventListener('visibilitychange', on); window.removeEventListener('focus', on); };
  }, []);
  if (!inPhoneApp()) return null;
  const bioOk = biometricAvailable();
  const later = () => { window.setTimeout(read, 1500); window.setTimeout(read, 5000); };
  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4" data-phone-settings>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Phone app</p>
      <div className="flex items-start justify-between gap-4">
        <div className="text-xs">
          <p className="font-semibold text-slate-900 dark:text-slate-100">Unlock with fingerprint or face</p>
          <p className="text-slate-500 mt-0.5">{bioOk ? 'Opening the app asks for your fingerprint, face or screen lock instead of showing your data straight away.' : 'This phone has no fingerprint or screen lock set up (or Android is too old).'}</p>
        </div>
        <Switch label="Unlock with fingerprint" tone="blue" checked={bio} disabled={!bioOk} onChange={(v) => { setBiometric(v); later(); }} />
      </div>
      {hasBridge('setOfficeReminders') && (
        <div className="flex items-start justify-between gap-4">
          <div className="text-xs">
            <p className="font-semibold text-slate-900 dark:text-slate-100">Remind me at the office door</p>
            <p className="text-slate-500 mt-0.5">A reminder when you reach the office and have not punched in, or leave while still punched in. Android asks to allow location “all the time”.</p>
          </div>
          <Switch label="Office arrive and leave reminders" tone="blue" checked={geo} onChange={(v) => { setOfficeReminders(v); later(); }} />
        </div>
      )}
    </div>
  );
};
export default PhoneAppSettings;
