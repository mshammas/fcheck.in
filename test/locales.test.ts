/**
 * Locale-filter tests: the country/language option lists and the language
 * suggestion logic that powers the homepage filter dropdowns. Pure, no DB.
 */
import { describe, it, expect } from 'vitest';
import { COUNTRIES, LANGUAGES, LANGUAGE_COUNTRIES, suggestedLanguages } from '../src/lib/locales';

const LANG_CODES = new Set(LANGUAGES.map((l) => l.code));
const COUNTRY_CODES = new Set(COUNTRIES.map((c) => c.code));

describe('option lists', () => {
  it('use unique codes and non-empty names', () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
    expect([...COUNTRIES, ...LANGUAGES].every((o) => o.code && o.name)).toBe(true);
  });

  it('use ISO-shaped country codes and BCP-47 language subtags', () => {
    expect(COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code))).toBe(true);
    expect(LANGUAGES.every((l) => /^[a-z]{2}$/.test(l.code))).toBe(true);
  });
});

describe('suggestedLanguages', () => {
  it('returns the common languages for a country, ordered', () => {
    const langs = suggestedLanguages(['IN']);
    expect(langs[0]).toBe('hi');
    expect(langs).toContain('en');
    expect(langs.every((l) => LANG_CODES.has(l))).toBe(true);
  });

  it('merges and de-duplicates across several countries', () => {
    const langs = suggestedLanguages(['CA', 'FR']); // en, fr, then fr again
    expect(langs).toEqual(['en', 'fr']);
  });

  it('is case-insensitive and ignores unknown countries', () => {
    expect(suggestedLanguages(['us'])).toContain('en');
    expect(suggestedLanguages(['ZZ'])).toEqual([]);
    expect(suggestedLanguages([])).toEqual([]);
  });
});

describe('LANGUAGE_COUNTRIES reverse map', () => {
  it('is consistent with suggestedLanguages and references only known codes', () => {
    // Every reverse entry points at a real language and real countries.
    for (const [lang, countries] of Object.entries(LANGUAGE_COUNTRIES)) {
      expect(LANG_CODES.has(lang)).toBe(true);
      expect(countries.every((c) => COUNTRY_CODES.has(c))).toBe(true);
    }
    // Hindi is common in India, and India suggests Hindi — the two agree.
    expect(LANGUAGE_COUNTRIES['hi']).toContain('IN');
    expect(suggestedLanguages(['IN'])).toContain('hi');
  });
});
