// A shared catalog: API validation, roster mapping, picker and animation use the same IDs.
export const LEGACY_CHARACTER_IDS = ['astro','fox','tiger','panda','robot','wizard','ranger','dragon','koala','ninja','captain','unicorn'];
const names = ['Atlas','Aisha','Sage','Milo','Nora','Orion','Zara','Finn','Luna','Amir','Ivy','Kai','Maya','Theo','Layla','Ravi','Jade','Noah','Sana','Ezra','Mina','Leon','Aria','Omar','Skye','Sam','Daisy','Juno','Rowan','Mira','Indigo','Niko','Farah','Jules','Kiran','Ruby','Ari','Tariq','Hazel','Remy','Anya','Rayan','Cleo','Dante','Lila','Sol','Avery','Zain','Pearl','Sami','Robin','Nadia','Rio','Ayla'];
const skins = ['#f6d2b0','#dca679','#ad7350','#754c36','#edbfa4','#c68b62'];
const hair = ['#302528','#191b29','#7b422b','#332f50','#b76b30','#55423c','#b5b9c4','#52312c','#222c3d'];
const outfits = ['#0f766e','#4338ca','#be185d','#b45309','#0369a1','#6d28d9','#047857','#be123c','#334155'];
export const HUMAN_CHARACTERS = names.map((name, i) => ({ id: `human-${i+1}`, name, emoji: '', tint: 'from-sky-100 to-violet-200', skin: skins[i % skins.length], hair: hair[Math.floor(i / 6)], outfit: outfits[(i * 5 + Math.floor(i / 6)) % outfits.length], style: i % 6, accessory: Math.floor(i / 6) % 9 }));
export const CHARACTER_IDS = new Set([...LEGACY_CHARACTER_IDS, ...HUMAN_CHARACTERS.map((item) => item.id)]);
export const humanCharacter = (id) => HUMAN_CHARACTERS.find((item) => item.id === id);
