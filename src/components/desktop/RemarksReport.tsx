import React, { useMemo, useState } from 'react';
import { Download, MessageSquare } from 'lucide-react';
import { AttendanceRecord, Employee } from '../../types';
import { getPunchNotes, punchNoteLabel } from '../../lib/punchNotes';
import { exportRemarksToCsv } from '../../lib/exportUtils';

interface Props {
  employees: Employee[];
  records: AttendanceRecord[];
}

const pktToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const monthStart = () => `${pktToday().slice(0, 8)}01`;
const fmtWritten = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
};

/** Every remark staff wrote when punching in / out, for any dates and any employee, with a download. */
export const RemarksReport: React.FC<Props> = ({ employees, records }) => {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(pktToday());
  const [empId, setEmpId] = useState('all');
  const empMap = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => {
    const out: { key: string; date: string; code: string; name: string; department: string; timeIn: string; timeOut: string; type: string; written: string; text: string }[] = [];
    [...records]
      .filter((r) => (!from || r.date >= from) && (!to || r.date <= to) && (empId === 'all' || r.employeeId === empId))
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .forEach((r) => {
        const e = empMap.get(r.employeeId);
        getPunchNotes(r).forEach((n, i) => out.push({
          key: `${r.id}-${n.id}-${i}`, date: r.date, code: e?.employeeCode || '', name: e?.name || 'Former employee', department: e?.department || '',
          timeIn: r.timeIn || '', timeOut: r.timeOut || '', type: punchNoteLabel({ ...n, at: '' }), written: fmtWritten(n.at), text: n.text,
        }));
      });
    return out;
  }, [records, from, to, empId, empMap]);

  const inputCls = 'px-2.5 py-1.5 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-100';
  const download = () => {
    const who = empId === 'all' ? 'all-employees' : (empMap.get(empId)?.name || 'employee').replace(/[^A-Za-z0-9]+/g, '-');
    exportRemarksToCsv(rows, `attendance-remarks_${who}_${from || 'start'}_to_${to || 'today'}.csv`);
  };

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-blue-600" /> Attendance remarks</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Every remark written at punch in, punch out or later is saved permanently. Pick dates and an employee, then download.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">From<input type="date" className={`${inputCls} block mt-0.5`} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">To<input type="date" className={`${inputCls} block mt-0.5`} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Employee
            <select className={`${inputCls} block mt-0.5`} value={empId} onChange={(e) => setEmpId(e.target.value)}>
              <option value="all">All employees</option>
              {[...employees].sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={download} disabled={rows.length === 0} className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Download remarks (CSV)
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">No remarks for these dates.</p>
      ) : (
        <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-slate-100 dark:border-slate-800">
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">In / Out</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Remark</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{r.date}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><b className="text-slate-800 dark:text-slate-100">{r.name}</b>{r.code && <span className="block text-[10px] text-slate-400">{r.code}</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{r.timeIn || '—'} / {r.timeOut || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.type}{r.written && <span className="block text-[10px] text-slate-400">{r.written}</span>}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words min-w-[14rem]">{r.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-400">{rows.length} remark{rows.length === 1 ? '' : 's'} shown</p>
    </div>
  );
};
