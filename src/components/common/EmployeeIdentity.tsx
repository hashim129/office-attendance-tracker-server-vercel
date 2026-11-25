import React from 'react';

export const GAME_CHARACTERS = [
  { id: 'astro', name: 'Nova', emoji: '🧑‍🚀', tint: 'from-sky-400 to-indigo-600' },
  { id: 'fox', name: 'Ember Fox', emoji: '🦊', tint: 'from-orange-400 to-rose-500' },
  { id: 'tiger', name: 'Tiger Ace', emoji: '🐯', tint: 'from-amber-400 to-orange-600' },
  { id: 'panda', name: 'Panda Pal', emoji: '🐼', tint: 'from-slate-400 to-slate-700' },
  { id: 'robot', name: 'Byte Bot', emoji: '🤖', tint: 'from-cyan-400 to-blue-600' },
  { id: 'wizard', name: 'Star Wizard', emoji: '🧙', tint: 'from-violet-500 to-fuchsia-600' },
  { id: 'ranger', name: 'Sky Ranger', emoji: '🦸', tint: 'from-blue-500 to-cyan-500' },
  { id: 'dragon', name: 'Dragon Spark', emoji: '🐲', tint: 'from-emerald-500 to-teal-600' },
  { id: 'koala', name: 'Koala Cloud', emoji: '🐨', tint: 'from-stone-400 to-slate-600' },
  { id: 'ninja', name: 'Shadow Ninja', emoji: '🥷', tint: 'from-slate-600 to-indigo-800' },
  { id: 'captain', name: 'Captain Wave', emoji: '🧑‍✈️', tint: 'from-blue-500 to-sky-600' },
  { id: 'unicorn', name: 'Dream Unicorn', emoji: '🦄', tint: 'from-pink-400 to-violet-600' },
] as const;

export const GAME_PETS = [
  { id: 'none', name: 'No pet', emoji: '➕' },
  { id: 'cat', name: 'Mochi the Cat', emoji: '🐱' },
  { id: 'dog', name: 'Buddy the Dog', emoji: '🐶' },
  { id: 'rabbit', name: 'Clover the Rabbit', emoji: '🐰' },
  { id: 'owl', name: 'Pixel the Owl', emoji: '🦉' },
  { id: 'hamster', name: 'Peanut the Hamster', emoji: '🐹' },
  { id: 'parrot', name: 'Kiwi the Parrot', emoji: '🦜' },
  { id: 'turtle', name: 'Shelly the Turtle', emoji: '🐢' },
] as const;

export function characterFor(id?: string) {
  return GAME_CHARACTERS.find((item) => item.id === id) || null;
}
export function petFor(id?: string) {
  return GAME_PETS.find((item) => item.id === id && item.id !== 'none') || null;
}

const palette: Record<string, [string, string]> = { astro: ['#e0f2fe','#2563eb'], fox: ['#fb923c','#9a3412'], tiger: ['#fbbf24','#78350f'], panda: ['#f8fafc','#334155'], robot: ['#67e8f9','#164e63'], wizard: ['#c084fc','#581c87'], ranger: ['#60a5fa','#1e3a8a'], dragon: ['#6ee7b7','#047857'], koala: ['#cbd5e1','#475569'], ninja: ['#475569','#111827'], captain: ['#93c5fd','#1e40af'], unicorn: ['#f9a8d4','#a855f7'], cat: ['#fdba74','#9a3412'], dog: ['#d6a478','#78350f'], rabbit: ['#f5d0fe','#be185d'], owl: ['#c4b5fd','#6d28d9'], hamster: ['#fde68a','#92400e'], parrot: ['#86efac','#15803d'], turtle: ['#bef264','#3f6212'] };
export const UniverseIllustration: React.FC<{ id: string; className?: string }> = ({ id, className = 'h-full w-full' }) => {
  const [fur, dark] = palette[id] || ['#e2e8f0','#64748b'];
  const animal = ['fox','tiger','panda','dragon','koala','unicorn','cat','dog','rabbit','owl','hamster','parrot','turtle'].includes(id);
  return <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
    <circle cx="40" cy="40" r="37" fill={fur} opacity=".35"/><ellipse cx="40" cy="72" rx="26" ry="10" fill={dark}/>
    {animal && <><path d={id === 'rabbit' ? 'M24 30Q8 -5 24 3Q39 8 35 29 M45 29Q45 -4 59 4Q72 9 56 31' : ['fox','cat','tiger','dragon','unicorn'].includes(id) ? 'M16 36L13 8L37 24 M43 24L67 8L64 36' : 'M23 35C-2 24 8 4 25 13L35 28 M45 28C56 3 80 12 68 32L58 40'} fill={dark} stroke={fur} strokeWidth="3" strokeLinejoin="round"/></>}
    <rect x="15" y="22" width="50" height="43" rx={id === 'robot' ? 10 : 24} fill={animal ? fur : '#f5d0a9'} stroke={dark} strokeWidth="3"/>
    {!animal && <path d="M14 40V26Q14 9 40 9Q66 9 66 26V40L57 30H23Z" fill={dark}/>}
    {id === 'astro' && <rect x="11" y="10" width="58" height="57" rx="28" fill="#bae6fd" fillOpacity=".6" stroke="#f8fafc" strokeWidth="5"/>}
    {id === 'wizard' && <path d="M11 29L40 0L67 29Z M7 30H73" fill={dark} stroke={fur} strokeWidth="3"/>}
    {id === 'unicorn' && <path d="M34 24L40 1L47 24Z" fill="#fde68a" stroke={dark} strokeWidth="2"/>}
    {id === 'robot' && <path d="M40 10V3M36 3H44" stroke={dark} strokeWidth="4" strokeLinecap="round"/>}
    <ellipse cx="29" cy="43" rx="4" ry="5" fill="#172554"/><ellipse cx="51" cy="43" rx="4" ry="5" fill="#172554"/><circle cx="30" cy="41" r="1.5" fill="white"/><circle cx="52" cy="41" r="1.5" fill="white"/>
    <ellipse cx="22" cy="50" rx="5" ry="3" fill="#fb7185" opacity=".6"/><ellipse cx="58" cy="50" rx="5" ry="3" fill="#fb7185" opacity=".6"/>
    {animal && <path d="M35 50Q40 47 45 50L40 54Z" fill={dark}/>}
    <path d="M34 56Q40 62 46 56" fill="none" stroke={dark} strokeWidth="2.5" strokeLinecap="round"/>
    {id === 'tiger' && <path d="M21 30L31 35M59 30L49 35M40 25V32" stroke={dark} strokeWidth="4" strokeLinecap="round"/>}
    {id === 'panda' && <path d="M22 36L33 34M47 34L58 36" stroke={dark} strokeWidth="5" strokeLinecap="round"/>}
  </svg>;
};

export const EmployeeAvatar: React.FC<{ characterId?: string; petId?: string; name?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }> = ({ characterId, petId, name = '', size = 'md' }) => {
  const character = characterFor(characterId);
  const pet = petFor(petId);
  const dimensions = size === 'xs' ? 'h-7 w-7 text-sm rounded-lg' : size === 'sm' ? 'h-9 w-9 text-lg rounded-xl' : size === 'lg' ? 'h-16 w-16 text-3xl rounded-2xl' : 'h-11 w-11 text-2xl rounded-xl';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br ${character?.tint || 'from-slate-200 to-slate-400'} ${dimensions} shadow-sm ring-2 ring-white/80 dark:ring-slate-800`} title={character ? character.name : name}>
      {character ? <UniverseIllustration id={character.id} /> : <span aria-hidden>{name.trim()[0]?.toUpperCase() || '🙂'}</span>}
      {pet && <span className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white text-[11px] shadow-sm dark:border-slate-800 dark:bg-slate-800 ${size === 'xs' ? 'scale-75' : ''}`} title={pet.name}><UniverseIllustration id={pet.id} /></span>}
    </span>
  );
};

export const EmployeeIdentity: React.FC<{ name: string; characterId?: string; petId?: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }> = ({ name, characterId, petId, size = 'sm', className = '' }) => (
  <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
    <EmployeeAvatar characterId={characterId} petId={petId} name={name} size={size} />
    <span className="truncate">{name}</span>
  </span>
);
