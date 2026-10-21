// Os cartões de uso cabem na mesma linha dos outros itens da barra superior (marca, contadores, botões)?
// Puro (sem DOM): testado em ui/usage-row.test.ts. Quem mede o DOM e aplica o resultado é o UsageCards (ui/usage.ts):
// quando não cabem, a barra ganha uma segunda linha só para eles.

export interface UsageRowInput {
  /** Largura útil da barra (sem o padding). */
  barWidth: number;
  /** Larguras dos outros itens visíveis da barra. */
  others: number[];
  /** Espaço entre os itens da barra. */
  gap: number;
  /** Espaço entre os cartões. */
  cardGap: number;
  /** Largura mínima de cada cartão (a menor que ele aceita antes de perder conteúdo). */
  cards: number[];
}

export function usageRowFits(i: UsageRowInput): boolean {
  if (i.cards.length === 0) return true;
  // Um espaço entre cada item da barra: os outros itens mais a fila dos cartões.
  const used = i.others.reduce((sum, w) => sum + w, 0) + i.gap * i.others.length;
  const need = i.cards.reduce((sum, w) => sum + w, 0) + i.cardGap * (i.cards.length - 1);
  return need <= i.barWidth - used;
}
