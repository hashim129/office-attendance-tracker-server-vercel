export type DestinationRegion =
  | 'Middle East'
  | 'Central Asia & Caucasus'
  | 'Europe'
  | 'Asia Pacific'
  | 'Religious & Heritage';

export type DestinationArtwork =
  | 'kaaba'
  | 'skyline'
  | 'baku'
  | 'balloons'
  | 'atoll'
  | 'alps'
  | 'heritage'
  | 'tropical'
  | 'bridge'
  | 'pagoda';

export interface DestinationPalette {
  from: string;
  via: string;
  to: string;
  accent: string;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  region: DestinationRegion;
  tagline: string;
  highlights: [string, string, string];
  bestSeason: string;
  visaCue: string;
  packageCue: string;
  palette: DestinationPalette;
  artwork: DestinationArtwork;
  keywords: string[];
}

export const DESTINATION_REGIONS: ReadonlyArray<'All' | DestinationRegion> = [
  'All',
  'Religious & Heritage',
  'Middle East',
  'Central Asia & Caucasus',
  'Europe',
  'Asia Pacific',
];

export const CURATED_DESTINATIONS: Destination[] = [
  {
    id: 'makkah-madinah',
    name: 'Makkah & Madinah',
    country: 'Saudi Arabia',
    region: 'Religious & Heritage',
    tagline: 'Sacred Umrah & Ziyarat journeys with Haram-view stays and seamless Haramain rail transfers.',
    highlights: [
      'Proximity hotels steps from Masjid al-Haram & Masjid an-Nabawi',
      'Haramain High-Speed Railway & private VIP coach transfers',
      'Guided historical Ziyarat tours in Makkah and Madinah',
    ],
    bestSeason: 'Oct – Apr (Year-round Umrah)',
    visaCue: 'Saudi Umrah & Tourist E-Visa support',
    packageCue: '7, 10 & 14-night tailored Umrah packages',
    palette: {
      from: '#064e3b',
      via: '#0f766e',
      to: '#134e4a',
      accent: '#fbbf24',
    },
    artwork: 'kaaba',
    keywords: ['makkah', 'mecca', 'madinah', 'medina', 'umrah', 'hajj', 'jeddah', 'saudi', 'ksa'],
  },
  {
    id: 'dubai-abu-dhabi',
    name: 'Dubai & Abu Dhabi',
    country: 'United Arab Emirates',
    region: 'Middle East',
    tagline: 'Futuristic skylines, desert dunes, Yas Island parks, and curated family luxury escapes.',
    highlights: [
      'Burj Khalifa At The Top, Dubai Marina dhow & yacht cruises',
      'Evening desert safari with private camp dining',
      'Sheikh Zayed Grand Mosque & Louvre Abu Dhabi day excursion',
    ],
    bestSeason: 'Nov – Mar',
    visaCue: '30 & 60-day UAE Tourist Visa processing',
    packageCue: '4 to 7-night city, shopping & theme-park itineraries',
    palette: {
      from: '#0c4a6e',
      via: '#0284c7',
      to: '#1e3a8a',
      accent: '#fde047',
    },
    artwork: 'skyline',
    keywords: ['dubai', 'abu dhabi', 'uae', 'sharjah', 'emirates', 'dxb'],
  },
  {
    id: 'doha',
    name: 'Doha',
    country: 'Qatar',
    region: 'Middle East',
    tagline: 'Arabian Gulf elegance blending Souq Waqif heritage, Lusail waterfronts, and world-class museums.',
    highlights: [
      'Museum of Islamic Art & National Museum of Qatar architecture',
      'Souq Waqif evening walk & Pearl-Qatar marina dining',
      'Inland Sea Khor Al Adaid 4x4 dune adventure',
    ],
    bestSeason: 'Nov – Mar',
    visaCue: 'Hayya / Qatar Tourist Visa & stopover clearance',
    packageCue: '3 to 5-night luxury stopover & family getaways',
    palette: {
      from: '#4c1d95',
      via: '#7c2d12',
      to: '#1e293b',
      accent: '#f59e0b',
    },
    artwork: 'skyline',
    keywords: ['doha', 'qatar', 'lusail', 'souq waqif', 'doh'],
  },
  {
    id: 'baku-shahdag',
    name: 'Baku & Shahdag',
    country: 'Azerbaijan',
    region: 'Central Asia & Caucasus',
    tagline: 'Caspian Sea boulevards, Flame Towers, medieval Old City walls, and alpine Caucasus peaks.',
    highlights: [
      'Icherisheher Old City, Maiden Tower & Heydar Aliyev Center',
      'Shahdag & Gabala mountain cable cars and seasonal snow activities',
      'Absheron Peninsula Fire Temple & Yanar Dag excursion',
    ],
    bestSeason: 'Apr – Jun & Sep – Feb',
    visaCue: 'Azerbaijan ASAN E-Visa fast-track handling',
    packageCue: '5 to 7-night Baku, Gabala & Shahdag family tours',
    palette: {
      from: '#0f172a',
      via: '#0369a1',
      to: '#155e75',
      accent: '#38bdf8',
    },
    artwork: 'baku',
    keywords: ['baku', 'azerbaijan', 'shahdag', 'gabala', 'gyd'],
  },
  {
    id: 'tashkent-samarkand',
    name: 'Tashkent & Samarkand',
    country: 'Uzbekistan',
    region: 'Central Asia & Caucasus',
    tagline: 'Turquoise Silk Road domes, Registan Square mosaics, and high-speed Afrosiyob rail journeys.',
    highlights: [
      'Registan Square, Shah-i-Zinda & Amir Timur Mausoleum in Samarkand',
      'Bukhara Po-i-Kalyan complex & Chorsu Bazaar in Tashkent',
      'Chimgan Mountains & Charvak Lake scenic day retreat',
    ],
    bestSeason: 'Apr – Jun & Sep – Oct',
    visaCue: 'Uzbekistan E-Visa & group invitation guidance',
    packageCue: '6 to 8-night Silk Road heritage circuits',
    palette: {
      from: '#1e3a8a',
      via: '#0e7490',
      to: '#065f46',
      accent: '#2dd4bf',
    },
    artwork: 'heritage',
    keywords: ['tashkent', 'samarkand', 'bukhara', 'uzbekistan', 'silk road', 'tas'],
  },
  {
    id: 'almaty',
    name: 'Almaty & Shymbulak',
    country: 'Kazakhstan',
    region: 'Central Asia & Caucasus',
    tagline: 'Snow-capped Tian Shan backdrops, alpine lakes, and vibrant boulevard cafes in Central Asia.',
    highlights: [
      'Medeu ice rink & Shymbulak Mountain Resort gondola ride',
      'Big Almaty Lake, Charyn Canyon & Kolsai Lakes day trips',
      'Kok Tobe panoramic hill & Green Bazaar cultural tour',
    ],
    bestSeason: 'May – Sep & Dec – Feb',
    visaCue: 'Kazakhstan entry check & invitation support',
    packageCue: '5 to 7-night alpine adventure & city packages',
    palette: {
      from: '#1e293b',
      via: '#1d4ed8',
      to: '#0f766e',
      accent: '#93c5fd',
    },
    artwork: 'alps',
    keywords: ['almaty', 'kazakhstan', 'shymbulak', 'medeu', 'astana'],
  },
  {
    id: 'istanbul-cappadocia',
    name: 'Istanbul & Cappadocia',
    country: 'Türkiye',
    region: 'Europe',
    tagline: 'Bosphorus cruises between two continents, Ottoman palaces, and sunrise balloons over fairy chimneys.',
    highlights: [
      'Bosphorus sunset cruise, Hagia Sophia & Topkapi Palace',
      'Cappadocia sunrise hot-air balloon & cave-hotel stays',
      'Antalya coastal retreats or Bursa green mountain cable car',
    ],
    bestSeason: 'Apr – Jun & Sep – Nov',
    visaCue: 'Türkiye Sticker / E-Visa documentation assistance',
    packageCue: '7 to 10-night Istanbul, Cappadocia & Antalya routes',
    palette: {
      from: '#7c2d12',
      via: '#c2410c',
      to: '#1e3a8a',
      accent: '#fcd34d',
    },
    artwork: 'balloons',
    keywords: ['istanbul', 'cappadocia', 'turkey', 'turkiye', 'antalya', 'bursa', 'ist'],
  },
  {
    id: 'london-edinburgh',
    name: 'London & Edinburgh',
    country: 'United Kingdom',
    region: 'Europe',
    tagline: 'Royal landmarks, West End evenings, Thames river views, and historic Scottish Highlands charm.',
    highlights: [
      'Westminster, Tower Bridge, British Museum & Thames cruise',
      'Edinburgh Castle, Royal Mile & Scottish Highlands excursion',
      'Bicester Village & Oxford / Cotswolds countryside day tour',
    ],
    bestSeason: 'May – Sep',
    visaCue: 'UK Standard Visitor Visa file preparation',
    packageCue: '7 to 12-night rail & private-chauffeur UK itineraries',
    palette: {
      from: '#1e293b',
      via: '#334155',
      to: '#1e3a8a',
      accent: '#f87171',
    },
    artwork: 'bridge',
    keywords: ['london', 'edinburgh', 'uk', 'united kingdom', 'britain', 'england', 'scotland', 'manchester', 'lhr'],
  },
  {
    id: 'paris-swiss-alps',
    name: 'Paris & Swiss Alps',
    country: 'France & Switzerland',
    region: 'Europe',
    tagline: 'Iconic Parisian boulevards paired with Interlaken, Mount Titlis glaciers, and scenic Swiss rail.',
    highlights: [
      'Eiffel Tower, Seine evening cruise & Champs-Élysées strolls',
      'Lucerne, Interlaken, Grindelwald First & Mount Titlis snow peaks',
      'GoldenPass & TGV Lyria seamless intercity rail connections',
    ],
    bestSeason: 'May – Sep & Dec – Feb',
    visaCue: 'Schengen Tourist Visa checklist & itinerary dossier',
    packageCue: '8 to 12-night multi-country Schengen grand tours',
    palette: {
      from: '#1e1b4b',
      via: '#3730a3',
      to: '#0369a1',
      accent: '#a5f3fc',
    },
    artwork: 'alps',
    keywords: ['paris', 'swiss', 'switzerland', 'zurich', 'geneva', 'interlaken', 'lucerne', 'schengen', 'france', 'europe', 'italy', 'rome'],
  },
  {
    id: 'kuala-lumpur-langkawi',
    name: 'Kuala Lumpur & Langkawi',
    country: 'Malaysia',
    region: 'Asia Pacific',
    tagline: 'Petronas Twin Towers skyline, Genting Highlands mist, and emerald Andaman island beaches.',
    highlights: [
      'KLCC Petronas Towers, Batu Caves & Genting Highlands SkyWay',
      'Langkawi SkyCab, SkyBridge & sunset archipelago cruise',
      'Halal-friendly culinary streets and family theme resorts',
    ],
    bestSeason: 'Dec – Aug',
    visaCue: 'Malaysia MDAC & Visa entry advisory',
    packageCue: '6 to 9-night twin-center city & island escapes',
    palette: {
      from: '#064e3b',
      via: '#0d9488',
      to: '#1d4ed8',
      accent: '#6ee7b7',
    },
    artwork: 'tropical',
    keywords: ['kuala lumpur', 'langkawi', 'malaysia', 'genting', 'penang', 'kul'],
  },
  {
    id: 'bali',
    name: 'Bali',
    country: 'Indonesia',
    region: 'Asia Pacific',
    tagline: 'Ubud emerald rice terraces, oceanfront Uluwatu cliffs, private pool villas, and island serenity.',
    highlights: [
      'Ubud jungle villas, Tegallalang terraces & Kintamani volcano views',
      'Nusa Penida crystal-cove island day cruise',
      'Seminyak & Jimbaran sunset beachfront dining',
    ],
    bestSeason: 'Apr – Oct',
    visaCue: 'Indonesia Visa on Arrival / E-VOA guidance',
    packageCue: '6 to 8-night honeymoon & private villa retreats',
    palette: {
      from: '#065f46',
      via: '#0f766e',
      to: '#0284c7',
      accent: '#fde68a',
    },
    artwork: 'tropical',
    keywords: ['bali', 'indonesia', 'ubud', 'jakarta', 'dps', 'thailand', 'bangkok', 'phuket'],
  },
  {
    id: 'maldives',
    name: 'Malé & Atolls',
    country: 'Maldives',
    region: 'Asia Pacific',
    tagline: 'Overwater turquoise lagoons, seaplane reef arrivals, and tranquil private island sanctuaries.',
    highlights: [
      'Overwater & beachfront villas with half-board or all-inclusive plans',
      'Speedboat or scenic seaplane transfers from Velana International',
      'Coral reef snorkeling, dolphin cruises & sandbank picnics',
    ],
    bestSeason: 'Nov – Apr',
    visaCue: 'Complimentary 30-day Maldives Arrival Pass & IMUGA form',
    packageCue: '4 to 6-night luxury island & honeymoon stays',
    palette: {
      from: '#0e7490',
      via: '#0284c7',
      to: '#1d4ed8',
      accent: '#5eead4',
    },
    artwork: 'atoll',
    keywords: ['maldives', 'malé', 'male airport', 'atoll', 'mle', 'maafushi'],
  },
  {
    id: 'tokyo',
    name: 'Tokyo & Kyoto',
    country: 'Japan',
    region: 'Asia Pacific',
    tagline: 'Neon cityscapes, Shinkansen bullet trains, Mount Fuji vistas, and timeless bamboo groves.',
    highlights: [
      'Shibuya, Asakusa Senso-ji & Tokyo Bay waterfront views',
      'Mount Fuji Hakone ropeway & Lake Ashi scenic cruise',
      'Kyoto Arashiyama bamboo grove & Shinkansen rail pass',
    ],
    bestSeason: 'Mar – May & Oct – Nov',
    visaCue: 'Japan Tourist Visa / eVISA document compilation',
    packageCue: '7 to 10-night Tokyo, Fuji & Kyoto rail adventures',
    palette: {
      from: '#312e81',
      via: '#be185d',
      to: '#0f172a',
      accent: '#fbcfe8',
    },
    artwork: 'pagoda',
    keywords: ['tokyo', 'kyoto', 'osaka', 'japan', 'fuji', 'nrt', 'hnd'],
  },
];

export interface InvoiceMatchInput {
  reference?: string;
  sections?: Array<{
    title?: string;
    lines?: Array<{ description?: string }>;
  }>;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMatchesKeyword(haystack: string, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  if (/^[a-z0-9]{2,4}$/.test(kw)) {
    const re = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
    return re.test(haystack);
  }
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(kw)}([^a-z0-9]|$)`, 'i');
  return re.test(haystack);
}

export function matchDestinationsForInvoices(invoices: InvoiceMatchInput[]): string[] {
  if (!Array.isArray(invoices) || invoices.length === 0) return [];

  const textParts: string[] = [];
  for (const inv of invoices) {
    if (inv?.reference) textParts.push(String(inv.reference));
    if (Array.isArray(inv?.sections)) {
      for (const sec of inv.sections) {
        if (sec?.title) textParts.push(String(sec.title));
        if (Array.isArray(sec?.lines)) {
          for (const ln of sec.lines) {
            if (ln?.description) textParts.push(String(ln.description));
          }
        }
      }
    }
  }

  const combined = textParts.join(' \n ').toLowerCase();
  if (!combined.trim()) return [];

  const matchedIds: string[] = [];
  for (const dest of CURATED_DESTINATIONS) {
    if (dest.keywords.some((kw) => textMatchesKeyword(combined, kw))) {
      matchedIds.push(dest.id);
    }
  }
  return matchedIds;
}

export const DESTINATIONS: Destination[] = CURATED_DESTINATIONS;
export const WORLD_DESTINATIONS: Destination[] = CURATED_DESTINATIONS;
export default CURATED_DESTINATIONS;
