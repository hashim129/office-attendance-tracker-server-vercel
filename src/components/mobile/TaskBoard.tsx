import React, { useEffect, useState } from 'react';
import { crmCall } from '../../crm/crmApi';

/** Personal task board for the day: To do → Doing → Done (unfinished tasks carry over to the next day). */
type Item = { id: string; text: string; state: 'todo' | 'doing' | 'done'; date: string | null; doneAt?: string | null };
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const COLS: [Item['state'], string][] = [['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done']];

export const TaskBoard: React.FC = () => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [text, setText] = useState('');
  useEffect(() => { crmCall<{ items: Item[] }>('board_get').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  const save = (next: Item[]) => { setItems(next); void crmCall('board_save', { items: next }).catch(() => null); };
  if (!items) return null;
  // done tasks from earlier days drop off; unfinished ones stay
  const shown = items.filter((i) => i.state !== 'done' || (i.doneAt || '').slice(0, 10) >= new Date(Date.now() - 86400e3).toISOString().slice(0, 10));
  const move = (i: Item, dir: 1 | -1) => { const order: Item['state'][] = ['todo', 'doing', 'done']; const s = order[Math.min(2, Math.max(0, order.indexOf(i.state) + dir))]; save(items.map((x) => (x.id === i.id ? { ...x, state: s, doneAt: s === 'done' ? new Date().toISOString() : null } : x))); };
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4" data-task-board>
      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">My tasks today</p>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return; save([...items, { id: `tsk-${Date.now()}`, text: t.slice(0, 200), state: 'todo', date: today() }]); setText(''); }}>
        <input className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs" placeholder="Add a task, e.g. Call Ali about visa docs" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
        <button className="rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white" type="submit">Add</button>
      </form>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {COLS.map(([state, label]) => {
          const list = shown.filter((i) => i.state === state);
          return (
            <div key={state} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-2 min-h-[60px]">
              <p className="px-1 pb-1 text-[11px] font-semibold text-slate-500">{label} · {list.length}</p>
              {list.map((i) => (
                <div key={i.id} className="mb-1.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs">
                  <p className={i.state === 'done' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}>{i.text}</p>
                  <div className="mt-1 flex gap-2 text-[11px]">
                    {i.state !== 'todo' && <button className="text-slate-500" onClick={() => move(i, -1)}>← Back</button>}
                    {i.state !== 'done' && <button className="font-semibold text-blue-600" onClick={() => move(i, 1)}>{i.state === 'todo' ? 'Start →' : 'Done ✓'}</button>}
                    <button className="ml-auto text-slate-400" onClick={() => save(items.filter((x) => x.id !== i.id))} aria-label="Delete task">×</button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};
export default TaskBoard;
