/**
 * Country and language options for the homepage filters.
 *
 * Codes are what the pipeline expects: ISO 3166 alpha-2 for countries (matched
 * against `report.country` and each fact-checker's coverage) and BCP-47 primary
 * subtags for languages (matched against the review language). The list is
 * curated to the regions the fact-checker network covers, not exhaustive.
 *
 * Pure data + one helper, so it renders on the server and is unit-tested.
 */

export interface Option {
  code: string;
  name: string;
}

export const COUNTRIES: Option[] = [
  { code: 'IN', name: 'India' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'NP', name: 'Nepal' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'QA', name: 'Qatar' },
  { code: 'IL', name: 'Israel' },
  { code: 'IR', name: 'Iran' },
  { code: 'TR', name: 'Turkey' },
  { code: 'EG', name: 'Egypt' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CN', name: 'China' },
  { code: 'JP', name: 'Japan' },
  { code: 'KR', name: 'South Korea' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'AU', name: 'Australia' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'PH', name: 'Philippines' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'SG', name: 'Singapore' },
];

export const LANGUAGES: Option[] = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ur', name: 'Urdu' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'fa', name: 'Persian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'sv', name: 'Swedish' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tl', name: 'Filipino' },
  { code: 'ms', name: 'Malay' },
  { code: 'th', name: 'Thai' },
  { code: 'sw', name: 'Swahili' },
];

const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

// Common languages per country, used to surface smart suggestions when a
// country is chosen. Only codes present in LANGUAGES above are listed.
const COUNTRY_LANGUAGES: Record<string, string[]> = {
  IN: ['hi', 'en', 'ta', 'te', 'bn', 'mr', 'pa'],
  PK: ['ur', 'en', 'pa'],
  BD: ['bn', 'en'],
  LK: ['ta', 'en'],
  NP: ['en'],
  AE: ['ar', 'en'],
  SA: ['ar'],
  QA: ['ar', 'en'],
  IL: ['he', 'ar', 'en'],
  IR: ['fa'],
  TR: ['tr'],
  EG: ['ar'],
  NG: ['en'],
  ZA: ['en'],
  KE: ['sw', 'en'],
  ET: ['en'],
  GH: ['en'],
  GB: ['en'],
  FR: ['fr'],
  DE: ['de'],
  ES: ['es'],
  IT: ['it'],
  NL: ['nl'],
  SE: ['sv'],
  US: ['en', 'es'],
  CA: ['en', 'fr'],
  BR: ['pt'],
  MX: ['es'],
  AR: ['es'],
  CN: ['zh'],
  JP: ['ja'],
  KR: ['ko'],
  TW: ['zh'],
  HK: ['zh', 'en'],
  AU: ['en'],
  ID: ['id'],
  PH: ['tl', 'en'],
  MY: ['ms', 'en'],
  TH: ['th'],
  SG: ['en', 'zh', 'ms', 'ta'],
};

/** Reverse of COUNTRY_LANGUAGES: language code → countries where it's common.
 * Emitted as a data attribute so the client can highlight suggestions without
 * shipping the whole map. */
export const LANGUAGE_COUNTRIES: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const [country, langs] of Object.entries(COUNTRY_LANGUAGES)) {
    for (const lang of langs) (map[lang] ??= []).push(country);
  }
  return map;
})();

/**
 * Languages commonly used in the given countries, de-duplicated and in the order
 * first encountered. Unknown countries and unlisted language codes are dropped,
 * so the result is always a valid subset of LANGUAGES.
 */
export function suggestedLanguages(countryCodes: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of countryCodes) {
    for (const lang of COUNTRY_LANGUAGES[code.toUpperCase()] ?? []) {
      if (LANGUAGE_CODES.has(lang) && !seen.has(lang)) {
        seen.add(lang);
        out.push(lang);
      }
    }
  }
  return out;
}
