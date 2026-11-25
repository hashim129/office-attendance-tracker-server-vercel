// Persist stable option keys so existing avatars survive additions to the catalog.
// Only ever APPEND options: the first entry of each list is the default and saved values must stay valid.
export const wardrobe = {
  model: ['Human', 'Bear', 'Ape'],
  face: ['Oval', 'Round', 'Angular', 'Heart', 'Long'],
  body: ['Classic', 'Broad', 'Slender', 'Petite', 'Tall'],
  skin: ['#f6d2b0','#edbfa4','#dca679','#c68b62','#ad7350','#754c36','#50352c','#ffe0c7','#e8b98f','#8d5a3b','#3b2620'],
  hairStyle: ['Quiff','Waves','Curls','Ponytail','Long','Buzz','Bald','Afro','Bun','Mohawk','Side part','Braids','Bob'],
  hairColor: ['#282027','#201915','#784329','#bd783f','#dab879','#b6b5bc','#922c62','#3a5bc7','#2f8f6f','#d0503c','#f2f0ea'],
  eyes: ['Almond','Round','Narrow','Big','Sleepy'],
  iris: ['#523322','#283548','#468981','#6591af','#827647','#7a4fb5','#2b2b2b'],
  brows: ['Arched','Straight','Thick','Thin','Angry'],
  nose: ['Button','Narrow','Wide','Pointed'],
  mouth: ['Smile','Grin','Relaxed','Open','Smirk'],
  expression: ['Happy','Wink','Surprised','Cool','Sleepy','Laughing','Love'],
  cheeks: ['None','Blush','Freckles','Blush + freckles'],
  beard: ['None','Full','Goatee','Moustache','Stubble'],
  glasses: ['None','Round','Square','Sunglasses','Aviator','Star shades'],
  hat: ['None','Beanie','Fedora','Cap','Hijab','Turban','Headphones','Crown','Party hat'],
  earrings: ['None','Studs','Hoops','Drops'],
  top: ['Hoodie','Varsity','Polo','Tee','Suit','Kurta','Blazer','Sweater','Jersey','Abaya'],
  fabric: ['#313747','#079ba9','#3859b6','#ae3351','#e79a39','#8656a6','#3b796a','#e8ded4','#111111','#ffffff','#1f7a3d','#c9a227'],
  pants: ['#293446','#5c85a7','#665850','#ddd3b9','#30332f','#7a1f2b','#ffffff'],
  shoes: ['#faf4df','#262b33','#c45146','#4479b4','#e2b33c','#2f8f6f'],
  status: ['None','Focus mode 🎧','In a meeting 📅','On a call 📞','Lunch break 🍛','Celebrating 🎉','Travelling ✈️','Need coffee ☕'],
  bg: ['#e3e8fa','#fde2e4','#e2f6ec','#fff2cc','#e6e0ff','#d6f0ff','#ffe5d0','#1e2a44'],
};
export function validAppearance(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length <= 40 &&
    Object.entries(value).every(([key,v])=>Object.hasOwn(wardrobe,key) && wardrobe[key].includes(v));
}
/** Random but tasteful look, used by the 🎲 button. Keeps the user's model unless asked otherwise. */
export function randomAppearance(base = {}) {
  const pick = (key) => wardrobe[key][Math.floor(Math.random() * wardrobe[key].length)];
  const out = {};
  for (const key of Object.keys(wardrobe)) if (!['model','status','bg'].includes(key)) out[key] = pick(key);
  // Most people do not wear a hat or glasses every day; keep it realistic.
  if (Math.random() < .55) out.hat = 'None';
  if (Math.random() < .5) out.glasses = 'None';
  if (Math.random() < .6) out.beard = 'None';
  out.model = base.model || 'Human';
  if (base.status) out.status = base.status;
  if (base.bg) out.bg = base.bg;
  return out;
}
