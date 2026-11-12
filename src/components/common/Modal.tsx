import React, { useEffect } from 'react';
import { ArrowLeft, X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '5xl' | '6xl' | 'full';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
    full: 'max-w-[96vw]',
  }[maxWidth];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-auto animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden max-h-[92vh] my-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 shrink-0 bg-slate-50/80 dark:bg-slate-900">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close and return to panel (Esc)"
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-200/80 hover:bg-rose-100 text-slate-700 hover:text-rose-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-rose-950/60 dark:hover:text-rose-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 sm:hidden" />
            <span className="hidden sm:inline">Back</span>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content (Bidirectional scroll so wide tables never clip) */}
        <div className="p-4 sm:p-6 overflow-auto flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
};
