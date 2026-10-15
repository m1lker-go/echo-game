// ECHO translation engine: two namespaces (menu, game), Russian and English.
(() => {
  'use strict';

  // Migrate any previous ECHO language preference once, but never clear it during cache reset.
  const STORAGE_KEY = 'echo.language';
  const LEGACY_STORAGE_KEY = 'echo.language';
  const SUPPORTED_LANGUAGES = new Set(['ru', 'en']);
  const DEFAULT_LANGUAGE = 'ru';
  const DICTIONARIES = new Map();
  const listeners = new Set();

  function normalizeKeyPart(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function normalizeDictionary(value) {
    if (Array.isArray(value)) return value.map(normalizeDictionary);
    if (!value || typeof value !== 'object') return value;

    const normalized = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      normalized[normalizeKeyPart(key)] = normalizeDictionary(entry);
    }
    return normalized;
  }

  function getSavedLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
      return SUPPORTED_LANGUAGES.has(saved) ? saved : DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  }

  let currentLanguage = getSavedLanguage();

  async function loadLanguage(language) {
    if (!SUPPORTED_LANGUAGES.has(language)) {
      throw new Error(`[ECHO i18n] Unsupported language: ${language}`);
    }

    if (DICTIONARIES.has(language)) return DICTIONARIES.get(language);

    const url = new URL(`./locales/${language}.json`, import.meta.url);
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`[ECHO i18n] Failed to load ${url.pathname}: HTTP ${response.status}`);
    }

    const raw = await response.json();
    const dictionary = normalizeDictionary(raw);
    for (const section of ['menu', 'game']) {
      if (!dictionary[section] || typeof dictionary[section] !== 'object') {
        throw new Error(`[ECHO i18n] Missing "${section}" section in ${language}.json`);
      }
    }

    DICTIONARIES.set(language, dictionary);
    return dictionary;
  }

  function parseKey(key) {
    const normalized = normalizeKeyPart(key);
    if (!normalized) return { section: '', path: [] };

    const separator = normalized.indexOf(':');
    if (separator === -1) {
      return { section: 'menu', path: normalized.split('.').filter(Boolean) };
    }

    return {
      section: normalizeKeyPart(normalized.slice(0, separator)),
      path: normalized.slice(separator + 1).split('.').filter(Boolean),
    };
  }

  function findValue(dictionary, section, path) {
    let value = dictionary?.[section];
    for (const part of path) {
      if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) {
        return undefined;
      }
      value = value[part];
    }
    return value;
  }

  function interpolate(value, variables) {
    if (!variables || typeof variables !== 'object') return value;
    return value.replace(/\{([^{}]+)\}/g, (match, name) => {
      const key = name.trim();
      return Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match;
    });
  }

  function translate(key, fallback, variables) {
    const parsed = parseKey(key);
    if (!parsed.section || !parsed.path.length || !['menu', 'game'].includes(parsed.section)) {
      return interpolate(String(fallback ?? key ?? ''), variables);
    }

    const dictionary = DICTIONARIES.get(currentLanguage) || DICTIONARIES.get(DEFAULT_LANGUAGE);
    let value = findValue(dictionary, parsed.section, parsed.path);

    if (typeof value !== 'string') {
      const defaultDictionary = DICTIONARIES.get(DEFAULT_LANGUAGE);
      value = findValue(defaultDictionary, parsed.section, parsed.path);
    }

    if (typeof value !== 'string') {
      value = typeof fallback === 'string' ? fallback : String(key ?? '');
      if (typeof fallback !== 'string') {
        console.warn(`[ECHO i18n] Missing translation: ${parsed.section}:${parsed.path.join('.')}`);
      }
    }

    return interpolate(value, variables);
  }

  async function setLanguage(language) {
    const nextLanguage = normalizeKeyPart(language);
    if (!SUPPORTED_LANGUAGES.has(nextLanguage)) {
      console.warn(`[ECHO i18n] Unsupported language: ${language}`);
      return false;
    }

    try {
      await loadLanguage(nextLanguage);
      currentLanguage = nextLanguage;
      try {
        localStorage.setItem(STORAGE_KEY, nextLanguage);
      } catch (error) {
        console.warn('[ECHO i18n] Could not save language preference', error);
      }

      document.documentElement.lang = nextLanguage;
      for (const listener of listeners) {
        try { listener(nextLanguage); } catch (error) {
          console.error('[ECHO i18n] Language change listener failed', error);
        }
      }
      document.dispatchEvent(new CustomEvent('echo:language-changed', {
        detail: { language: nextLanguage },
      }));
      return true;
    } catch (error) {
      console.error('[ECHO i18n] Could not change language', error);
      return false;
    }
  }

  async function init() {
    try {
      await loadLanguage(DEFAULT_LANGUAGE);
      if (currentLanguage !== DEFAULT_LANGUAGE) {
        try {
          await loadLanguage(currentLanguage);
        } catch (error) {
          console.warn('[ECHO i18n] Saved language unavailable; using Russian', error);
          currentLanguage = DEFAULT_LANGUAGE;
        }
      }
      document.documentElement.lang = currentLanguage;
      document.dispatchEvent(new CustomEvent('echo:i18n-ready', {
        detail: { language: currentLanguage },
      }));
      console.info('[ECHO i18n] Ready:', currentLanguage);
      return true;
    } catch (error) {
      console.error('[ECHO i18n] Initialization failed', error);
      return false;
    }
  }

  window.$t = translate;
  window.__ = translate;
  window.ECHOI18n = Object.freeze({
    init,
    loadLanguage,
    setLanguage,
    get language() { return currentLanguage; },
    get languages() { return [...SUPPORTED_LANGUAGES]; },
    onLanguageChanged(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  // Start loading dictionaries before menu/game modules need translations.
  window.ECHO_I18N_READY = init();
})();
