// No navegador, no lugar de locales/all.ts (ver vite.config.ts): o dicionário do idioma ativo chega por import
// dinâmico em client/src/main.ts, para não mandar os três a todo mundo.
import type { Locale } from '../i18n';

export const DICTIONARIES: Partial<Record<Locale, Readonly<Record<string, string>>>> = {};
