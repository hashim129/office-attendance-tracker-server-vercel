import React, { useEffect, useState } from 'react';
import { UI_THEMES, getUiTheme, setUiTheme, type UiThemeId } from '../../lib/uiTheme';

/** Pick the app's look. compact = small swatches for the menu; full = labelled cards for My Profile. */
export const ThemePicker: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [cur, setCur] = useState<UiThemeId>(getUiTheme());
  useEffect(() => { const on = () => setCur(getUiTheme()); window.addEventListener('office-ui-theme', on); return () => window.removeEventListener('office-ui-theme', on); }, []);
  if (compact) {
    return (
      <div className="flex items-center gap-1" data-theme-picker role="radiogroup" aria-label="App theme">
        {UI_THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={cur === t.id} title={t.label} onClick={() => setUiTheme(t.id)}
            className={`h-4 w-4 rounded-full border ${cur === t.id ? 'ring-2 ring-offset-1 ring-slate-500 dark:ring-offset-slate-900 border-transparent' : 'border-slate-300 dark:border-slate-600'}`}
            style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" data-theme-picker-full>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">App theme</p>
      <p className="text-xs text-slate-500 mb-3">Changes colours and shapes on this device only. Works with light and dark mode.</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {UI_THEMES.map((t) => (
          <button key={t.id} type="button" onClick={() => setUiTheme(t.id)} aria-pressed={cur === t.id}
            className={`rounded-lg border p-2 text-left text-xs ${cur === t.id ? 'border-slate-900 dark:border-slate-100 ring-1 ring-slate-900 dark:ring-slate-100' : 'border-slate-200 dark:border-slate-700'}`}>
            <span className="flex h-8 overflow-hidden rounded-md" style={{ background: t.swatch[2] }}>
              <span className="w-1/3" style={{ background: t.swatch[0] }} /><span className="w-1/4" style={{ background: t.swatch[1] }} />
            </span>
            <span className="mt-1.5 block font-medium text-slate-800 dark:text-slate-200">{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
export default ThemePicker;
