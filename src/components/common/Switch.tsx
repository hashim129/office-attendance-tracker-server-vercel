import React from 'react';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: 'emerald' | 'violet' | 'blue';
}

/** A proper on/off toggle switch (accessible: it is a real button with role="switch"). */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, label, disabled, tone = 'emerald' }) => {
  const on = tone === 'violet' ? 'bg-violet-600' : tone === 'blue' ? 'bg-blue-600' : 'bg-emerald-500';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500 ${
        checked ? on : 'bg-slate-300 dark:bg-slate-700'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
};
