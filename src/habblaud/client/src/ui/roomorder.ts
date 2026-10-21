// Ordem das salas na lista lateral escolhida pelo usuário (arrastando o cabeçalho da sala), guardada no navegador
// pelo id da sala (a pasta do projeto). Salas que não estão na ordem guardada vão para o fim, na ordem em que vieram.
const ORDER_KEY = 'habblaud.rooms.order';
/** Salas lembradas (as mais recentes da lista). */
const MAX_ROOMS = 100;

export function orderRooms<T>(items: readonly T[], idOf: (item: T) => string): T[] {
  const saved = loadOrder();
  if (!saved.length) return items.slice();
  const rank = new Map(saved.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((x, y) => (x.r ?? Infinity) - (y.r ?? Infinity) || x.i - y.i)
    .map((x) => x.item);
}

/** Põe a sala `from` antes (ou depois) de `to` na lista `shown` (ids na ordem mostrada) e guarda. */
export function moveRoom(shown: readonly string[], from: string, to: string, after: boolean): boolean {
  if (from === to || !shown.includes(from) || !shown.includes(to)) return false;
  const rest = shown.filter((id) => id !== from);
  rest.splice(rest.indexOf(to) + (after ? 1 : 0), 0, from);
  // salas guardadas que não estão na lista agora (fechadas ou filtradas) mantêm a posição relativa no fim
  const old = loadOrder().filter((id) => !rest.includes(id));
  saveOrder([...rest, ...old].slice(0, MAX_ROOMS));
  return true;
}

function loadOrder(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveOrder(ids: string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    // sem armazenamento: a ordem vale só até recarregar
  }
}
