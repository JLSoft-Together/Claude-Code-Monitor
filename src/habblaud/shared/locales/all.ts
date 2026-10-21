// Todos os dicionários de uma vez: o servidor, os scripts e os testes usam este módulo. No navegador, o vite.config.ts
// o troca por locales/none.ts, e o cliente carrega só o dicionário do idioma ativo (client/src/main.ts).
import type { Locale } from '../i18n';
import { EN } from './en';
import { ES } from './es';
import { FR } from './fr';

export const DICTIONARIES: Partial<Record<Locale, Readonly<Record<string, string>>>> = { en: EN, es: ES, fr: FR };
