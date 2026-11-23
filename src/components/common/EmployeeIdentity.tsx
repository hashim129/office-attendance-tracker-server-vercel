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

export const EmployeeAvatar: React.FC<{ characterId?: string; petId?: string; name?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }> = ({ characterId, petId, name = '', size = 'md' }) => {
  const character = characterFor(characterId);
  const pet = petFor(petId);
  const dimensions = size === 'xs' ? 'h-7 w-7 text-sm rounded-lg' : size === 'sm' ? 'h-9 w-9 text-lg rounded-xl' : size === 'lg' ? 'h-16 w-16 text-3xl rounded-2xl' : 'h-11 w-11 text-2xl rounded-xl';
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br ${character?.tint || 'from-slate-200 to-slate-400'} ${dimensions} shadow-sm ring-2 ring-white/80 dark:ring-slate-800`} title={character ? character.name : name}>
      <span aria-hidden>{character?.emoji || (name.trim()[0]?.toUpperCase() || '🙂')}</span>
      {pet && <span className={`absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-white text-[11px] shadow-sm dark:border-slate-800 dark:bg-slate-800 ${size === 'xs' ? 'scale-75' : ''}`} title={pet.name}>{pet.emoji}</span>}
    </span>
  );
};

export const EmployeeIdentity: React.FC<{ name: string; characterId?: string; petId?: string; size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }> = ({ name, characterId, petId, size = 'sm', className = '' }) => (
  <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
    <EmployeeAvatar characterId={characterId} petId={petId} name={name} size={size} />
    <span className="truncate">{name}</span>
  </span>
);
