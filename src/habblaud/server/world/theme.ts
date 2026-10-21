// Tema do prédio no World: a escolha de Configurações › Aparência (world.json) resolvida para o que vai no pacote. O
// automático segue o calendário do escritório (seasonalThemeFor, client/src/world/api.ts; um teste confere que não se
// separam): Halloween de 1º a 31 de outubro, Natal de 1º de novembro a 26 de dezembro e, no resto do ano, nenhum. A
// data é a local do servidor (no Docker, UTC).
import type { WorldThemeChoice } from '../../shared/world/api';
import type { WorldTheme } from '../../shared/world/protocol';

export function resolveWorldTheme(choice: WorldThemeChoice | undefined, date: Date): WorldTheme {
  if (choice && choice !== 'auto') return choice;
  const month = date.getMonth();
  if (month === 9) return 'halloween';
  if (month === 10 || (month === 11 && date.getDate() <= 26)) return 'christmas';
  return 'none';
}
