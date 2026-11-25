// Persist stable option keys so existing avatars survive additions to the catalog.
export const wardrobe = {
  model: ['Human', 'Bear', 'Ape'],
  face: ['Oval', 'Round', 'Angular'],
  body: ['Classic', 'Broad', 'Slender'],
  skin: ['#f6d2b0','#edbfa4','#dca679','#c68b62','#ad7350','#754c36','#50352c'],
  hairStyle: ['Quiff','Waves','Curls','Ponytail','Long','Buzz','Bald'],
  hairColor: ['#282027','#201915','#784329','#bd783f','#dab879','#b6b5bc','#922c62'],
  eyes: ['Almond','Round','Narrow'],
  iris: ['#523322','#283548','#468981','#6591af','#827647'],
  brows: ['Arched','Straight','Thick'],
  nose: ['Button','Narrow','Wide'],
  mouth: ['Smile','Grin','Relaxed'],
  beard: ['None','Full','Goatee','Moustache'],
  glasses: ['None','Round','Square','Sunglasses'],
  hat: ['None','Beanie','Fedora','Cap'],
  top: ['Hoodie','Varsity','Polo','Tee','Suit'],
  fabric: ['#313747','#079ba9','#3859b6','#ae3351','#e79a39','#8656a6','#3b796a','#e8ded4'],
  pants: ['#293446','#5c85a7','#665850','#ddd3b9','#30332f'],
  shoes: ['#faf4df','#262b33','#c45146','#4479b4'],
};
export function validAppearance(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.entries(value).every(([key,v])=>Object.hasOwn(wardrobe,key) && wardrobe[key].includes(v));
}
