import React from 'react';

/**
 * Static profile pictures: bold colour tiles with simple, friendly faces (original artwork).
 * They are plain SVG, so they load instantly anywhere, even on slow phones.
 * Stored as appearance.photo = 'pf-01' ... 'pf-24'. 'None' means "use my avatar / initials".
 */
type Face = 'smile' | 'grin' | 'wink' | 'cool' | 'sleepy' | 'cat' | 'robot' | 'ghost' | 'alien' | 'bear' | 'frog' | 'stars';
const BG = ['#d7263d', '#1f6feb', '#f5b301', '#12a150', '#8b3dff', '#ff6a00', '#00a8b5', '#e0337c'];
const FACES: Face[] = ['smile', 'grin', 'wink', 'cool', 'sleepy', 'cat', 'robot', 'ghost', 'alien', 'bear', 'frog', 'stars'];
export const PROFILE_PICTURES = Array.from({ length: 24 }, (_, i) => ({
  id: `pf-${String(i + 1).padStart(2, '0')}`,
  bg: BG[(i * 3) % BG.length],
  face: FACES[i % FACES.length],
}));
export const PROFILE_PICTURE_IDS = PROFILE_PICTURES.map((p) => p.id);
export const hasProfilePicture = (appearance?: Record<string, string> | null) =>
  Boolean(appearance?.photo && PROFILE_PICTURE_IDS.includes(appearance.photo));

const ink = '#111827';
function FaceArt({ face }: { face: Face }) {
  const W = '#ffffff';
  switch (face) {
    case 'grin': return <><circle cx="28" cy="32" r="5" fill={W} /><circle cx="52" cy="32" r="5" fill={W} /><path d="M22 46 Q40 66 58 46 Z" fill={W} /></>;
    case 'wink': return <><circle cx="28" cy="32" r="5" fill={W} /><path d="M46 32 h12" stroke={W} strokeWidth="5" strokeLinecap="round" /><path d="M26 50 Q40 60 54 50" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /></>;
    case 'cool': return <><rect x="16" y="26" width="20" height="11" rx="5" fill={ink} /><rect x="44" y="26" width="20" height="11" rx="5" fill={ink} /><path d="M36 30 h8" stroke={ink} strokeWidth="3" /><path d="M30 52 Q44 58 52 49" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /></>;
    case 'sleepy': return <><path d="M22 34 q6 5 12 0 M46 34 q6 5 12 0" stroke={W} strokeWidth="4.5" fill="none" strokeLinecap="round" /><circle cx="40" cy="52" r="5" fill={W} /><text x="58" y="22" fontSize="12" fontWeight="900" fill={W}>z</text></>;
    case 'cat': return <><path d="M14 24 L22 8 L32 22 M66 24 L58 8 L48 22" fill={W} /><ellipse cx="29" cy="36" rx="4" ry="6" fill={W} /><ellipse cx="51" cy="36" rx="4" ry="6" fill={W} /><path d="M37 46 h6 l-3 4 z" fill={W} /><path d="M40 50 q-5 6 -10 2 M40 50 q5 6 10 2 M12 44 h14 M54 44 h14" stroke={W} strokeWidth="2.5" fill="none" strokeLinecap="round" /></>;
    case 'robot': return <><path d="M40 8 v8" stroke={W} strokeWidth="4" strokeLinecap="round" /><circle cx="40" cy="7" r="4" fill={W} /><rect x="18" y="20" width="44" height="40" rx="9" fill="none" stroke={W} strokeWidth="4" /><rect x="25" y="31" width="10" height="8" rx="2" fill={W} /><rect x="45" y="31" width="10" height="8" rx="2" fill={W} /><path d="M28 49 h24" stroke={W} strokeWidth="4" strokeDasharray="4 3" /></>;
    case 'ghost': return <><path d="M20 66 V36 a20 20 0 0 1 40 0 V66 l-7 -6 -6 6 -7 -6 -6 6 -7 -6 z" fill={W} /><ellipse cx="33" cy="38" rx="4" ry="6" fill={ink} /><ellipse cx="47" cy="38" rx="4" ry="6" fill={ink} /><ellipse cx="40" cy="52" rx="4" ry="5" fill={ink} /></>;
    case 'alien': return <><ellipse cx="40" cy="42" rx="22" ry="26" fill="#9be15d" /><ellipse cx="31" cy="40" rx="7" ry="10" transform="rotate(-25 31 40)" fill={ink} /><ellipse cx="49" cy="40" rx="7" ry="10" transform="rotate(25 49 40)" fill={ink} /><path d="M35 58 q5 3 10 0" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" /></>;
    case 'bear': return <><circle cx="22" cy="20" r="9" fill={W} /><circle cx="58" cy="20" r="9" fill={W} /><circle cx="40" cy="42" r="24" fill={W} /><circle cx="31" cy="38" r="3.5" fill={ink} /><circle cx="49" cy="38" r="3.5" fill={ink} /><ellipse cx="40" cy="50" rx="9" ry="7" fill="#f3d9c0" /><ellipse cx="40" cy="47" rx="4" ry="3" fill={ink} /></>;
    case 'frog': return <><circle cx="27" cy="26" r="10" fill={W} /><circle cx="53" cy="26" r="10" fill={W} /><circle cx="27" cy="26" r="4.5" fill={ink} /><circle cx="53" cy="26" r="4.5" fill={ink} /><path d="M16 46 Q40 68 64 46" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /></>;
    case 'stars': return <><path d="M28 24 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 z M52 24 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 z" fill="#ffe14d" /><path d="M26 52 Q40 64 54 52" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /></>;
    default: return <><circle cx="28" cy="33" r="5" fill={W} /><circle cx="52" cy="33" r="5" fill={W} /><path d="M24 48 Q40 62 56 48" stroke={W} strokeWidth="5" fill="none" strokeLinecap="round" /></>;
  }
}

export const ProfilePicture: React.FC<{ id: string; className?: string; title?: string }> = ({ id, className = 'h-full w-full', title }) => {
  const pic = PROFILE_PICTURES.find((p) => p.id === id);
  if (!pic) return null;
  return (
    <svg viewBox="0 0 80 80" className={className} role="img" aria-label={title || 'Profile picture'}>
      <rect width="80" height="80" rx="14" fill={pic.bg} />
      <rect width="80" height="40" rx="14" fill="#ffffff" opacity=".08" />
      <FaceArt face={pic.face} />
    </svg>
  );
};

/** Grid picker used on My Profile. */
export const ProfilePicturePicker: React.FC<{ value: string; onChange: (id: string) => void }> = ({ value, onChange }) => (
  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
    <button type="button" onClick={() => onChange('None')} aria-pressed={!value || value === 'None'} className={`flex aspect-square items-center justify-center rounded-2xl border-2 border-dashed text-[10px] font-bold text-slate-500 transition hover:scale-105 ${!value || value === 'None' ? 'border-blue-600 text-blue-700' : 'border-slate-300 dark:border-slate-700'}`}>No picture</button>
    {PROFILE_PICTURES.map((p) => (
      <button key={p.id} type="button" onClick={() => onChange(p.id)} aria-pressed={value === p.id} aria-label={`Profile picture ${p.id.slice(3)}`} className={`aspect-square rounded-2xl transition hover:scale-105 ${value === p.id ? 'ring-4 ring-blue-600 ring-offset-2 dark:ring-offset-slate-900' : ''}`}>
        <ProfilePicture id={p.id} />
      </button>
    ))}
  </div>
);
