import React from 'react';
import type { AttendanceRecord } from '../../types';
import { mapLink } from '../../lib/phoneLocation';

/** "📍 In" / "📍 Out" links to the map for phone punches that recorded a location. */
export const PunchLocationBadges: React.FC<{ record?: AttendanceRecord | null }> = ({ record }) => {
  const locs = record?.punchLocations;
  if (!locs || (!locs.in && !locs.out)) return null;
  const one = (label: string, p?: NonNullable<AttendanceRecord['punchLocations']>['in']) =>
    p ? (
      <a key={label} href={mapLink(p)} target="_blank" rel="noreferrer" data-punch-loc={label}
        title={`${label} location${p.dist !== undefined ? ` · ${p.dist} m from office` : ''}${p.acc ? ` · accuracy ${p.acc} m` : ''}${p.outside ? ' · outside the office radius' : ''}`}
        className={`ml-1 align-middle inline-block px-1.5 py-0.5 rounded text-[9px] font-sans font-bold border ${p.outside ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-900/40 dark:text-sky-300'}`}>
        📍 {label}{p.dist !== undefined ? ` ${p.dist >= 1000 ? `${(p.dist / 1000).toFixed(1)}km` : `${p.dist}m`}` : ''}
      </a>
    ) : null;
  return <>{one('In', locs.in)}{one('Out', locs.out)}</>;
};
