import React from 'react';
import {
  Clock,
  Moon,
  Sun,
  Minus,
  Square,
  X,
  Server,
} from 'lucide-react';

interface WindowsTitleBarProps {
  isDark: boolean;
  onToggleTheme: () => void;
  serverHost: string;
  serverPort: number;
}

export const WindowsTitleBar: React.FC<WindowsTitleBarProps> = ({
  isDark,
  onToggleTheme,
  serverHost,
  serverPort,
}) => {
  const [isMaximized, setIsMaximized] = React.useState(false);

  const handleMinimize = () => {
    // Simulated Windows minimize animation/feedback
    const el = document.getElementById('windows-window-frame');
    if (el) {
      el.classList.add('scale-95', 'opacity-60');
      setTimeout(() => {
        el.classList.remove('scale-95', 'opacity-60');
      }, 300);
    }
  };

  const handleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  return (
    <header className="h-12 overflow-hidden bg-gradient-to-r from-slate-100 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-3 sm:px-4 select-none text-xs text-slate-700 dark:text-slate-300 z-50 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      {/* Left: App Icon & Brand Title */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm ring-1 ring-blue-700/10">
          <Clock className="w-4 h-4" />
        </div>
        <span className="font-bold text-[13px] tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap hidden min-[430px]:inline">
          Office Attendance Tracker
        </span>
        <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">|</span>
        <div className="hidden md:flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-mono text-[11px]">
          <Server className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          <span>{serverHost}:{serverPort}</span>
        </div>
      </div>

      {/* Right: Theme Toggle & Windows Window Controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors"
          title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
        >
          {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1 hidden sm:block" />

        {/* Windows Standard Title Bar Buttons (not useful on a phone, so hidden there) */}
        <button
          onClick={handleMinimize}
          className="w-8 h-7 hidden sm:flex items-center justify-center rounded hover:bg-slate-300 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={handleMaximize}
          className="w-8 h-7 hidden sm:flex items-center justify-center rounded hover:bg-slate-300 dark:hover:bg-slate-800 transition-colors text-slate-600 dark:text-slate-400"
          title={isMaximized ? 'Restore Down' : 'Maximize'}
        >
          <Square className="w-3 h-3" />
        </button>

        <button
          onClick={() => {
            if (confirm('Exit Attendance Tracker Windows application?')) {
              window.location.reload();
            }
          }}
          className="w-8 h-7 hidden sm:flex items-center justify-center rounded hover:bg-rose-600 hover:text-white transition-colors text-slate-600 dark:text-slate-400"
          title="Close Window"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
