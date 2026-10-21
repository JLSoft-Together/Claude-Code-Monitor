import { describe, expect, it } from 'vitest';
import {
  calendarDayDiff,
  clampPercent,
  compactDuration,
  FIVE_HOURS_MS,
  formatCountdown,
  formatDuration,
  formatElapsed,
  formatInt,
  formatResetAt,
  formatTokens,
  formatUSD,
  normalizeSearch,
  permissionLabel,
  plural,
  prettyModel,
  relativeTime,
  shortPath,
  usageWindowView,
  WEEK_MS,
  usageLevel,
} from './format';

const S = 1_000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('relativeTime', () => {
  const now = new Date(2026, 9, 6, 14, 0, 0).getTime();
  it('usa "agora" para menos de 5 s e para o futuro', () => {
    expect(relativeTime(now, now)).toBe('agora');
    expect(relativeTime(now - 4 * S, now)).toBe('agora');
    expect(relativeTime(now + 10 * S, now)).toBe('agora');
  });
  it('formata segundos, minutos, horas e dias', () => {
    expect(relativeTime(now - 5 * S, now)).toBe('há 5 s');
    expect(relativeTime(now - 59 * S, now)).toBe('há 59 s');
    expect(relativeTime(now - 3 * M, now)).toBe('há 3 min');
    expect(relativeTime(now - 2 * H - 10 * M, now)).toBe('há 2 h');
    expect(relativeTime(now - 3 * D, now)).toBe('há 3 d');
  });
  it('trata valores inválidos como "agora"', () => {
    expect(relativeTime(Number.NaN, now)).toBe('agora');
  });
});

describe('formatDuration / formatCountdown', () => {
  it('formata durações compostas', () => {
    expect(formatDuration(12 * S)).toBe('12 s');
    expect(formatDuration(3 * M + 20 * S)).toBe('3 min');
    expect(formatDuration(2 * H)).toBe('2 h');
    expect(formatDuration(2 * H + 10 * M)).toBe('2 h 10 min');
    expect(formatDuration(3 * D + 4 * H)).toBe('3 d 4 h');
    expect(formatDuration(-5)).toBe('0 s');
  });
  it('formata contagem regressiva', () => {
    const now = 1_000_000;
    expect(formatCountdown(now - 1, now)).toBe('agora');
    expect(formatCountdown(now + 30 * S, now)).toBe('em menos de 1 min');
    expect(formatCountdown(now + 2 * H + 10 * M, now)).toBe('em 2 h 10 min');
  });
});

describe('formatResetAt', () => {
  const now = new Date(2026, 9, 6, 9, 15).getTime(); // terça, 06/10/2026
  it('mesmo dia: "às HH:MM"', () => {
    expect(formatResetAt(new Date(2026, 9, 6, 14, 30).getTime(), now)).toBe('às 14:30');
  });
  it('dia seguinte: "amanhã às HH:MM"', () => {
    expect(formatResetAt(new Date(2026, 9, 7, 1, 30).getTime(), now)).toBe('amanhã às 01:30');
  });
  it('mais adiante: dia da semana abreviado', () => {
    expect(formatResetAt(new Date(2026, 9, 8, 20, 0).getTime(), now)).toBe('qui., 20:00');
  });
  it('conta dias de calendário, não blocos de 24 h', () => {
    expect(calendarDayDiff(new Date(2026, 9, 7, 0, 5).getTime(), new Date(2026, 9, 6, 23, 55).getTime())).toBe(1);
    expect(calendarDayDiff(new Date(2026, 9, 6, 23, 55).getTime(), new Date(2026, 9, 6, 0, 5).getTime())).toBe(0);
  });
});

describe('números', () => {
  it('formatTokens usa k e M com vírgula decimal', () => {
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(12_340)).toBe('12,3 k');
    expect(formatTokens(1_000)).toBe('1 k');
    expect(formatTokens(1_250_000)).toBe('1,3 M');
    expect(formatTokens(-3)).toBe('0');
  });
  it('formatUSD e formatInt em pt-BR', () => {
    expect(formatUSD(1.234)).toBe('US$ 1,23');
    expect(formatUSD(0)).toBe('US$ 0,00');
    expect(formatInt(12345)).toBe('12.345');
  });
  it('plural', () => {
    expect(plural(1, 'agente', 'agentes')).toBe('1 agente');
    expect(plural(0, 'agente', 'agentes')).toBe('0 agentes');
    expect(plural(3, 'agente', 'agentes')).toBe('3 agentes');
  });
});

describe('uso (percentuais)', () => {
  it('clampPercent limita e arredonda', () => {
    expect(clampPercent(undefined)).toBe(0);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(-4)).toBe(0);
    expect(clampPercent(49.6)).toBe(50);
    expect(clampPercent(140)).toBe(100);
  });
  it('usageLevel: verde < 50, âmbar 50–80, vermelho >= 80', () => {
    expect(usageLevel(0)).toBe('ok');
    expect(usageLevel(49)).toBe('ok');
    expect(usageLevel(50)).toBe('warn');
    expect(usageLevel(79)).toBe('warn');
    expect(usageLevel(80)).toBe('crit');
    expect(usageLevel(100)).toBe('crit');
  });
});

describe('textos', () => {
  it('normalizeSearch remove acentos e caixa', () => {
    expect(normalizeSearch('  João Ávila ')).toBe('joao avila');
  });
  it('prettyModel reconhece os formatos de id', () => {
    expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(prettyModel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4');
    expect(prettyModel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(prettyModel('gpt-x')).toBe('gpt-x');
    // Codex.
    expect(prettyModel('gpt-5.3-codex')).toBe('GPT-5.3 Codex');
    expect(prettyModel('gpt-5.1-codex-mini')).toBe('GPT-5.1 Codex Mini');
    expect(prettyModel('gpt-5-codex')).toBe('GPT-5 Codex');
    expect(prettyModel('gpt-5')).toBe('GPT-5');
    expect(prettyModel('gpt-4o')).toBe('GPT-4o');
    expect(prettyModel(undefined)).toBe('—');
  });
  it('permissionLabel traduz modos conhecidos', () => {
    expect(permissionLabel('acceptEdits')).toBe('Aceita edições');
    expect(permissionLabel('custom')).toBe('custom');
    expect(permissionLabel(undefined)).toBe('—');
  });
  it('shortPath encurta a pasta pessoal', () => {
    expect(shortPath('/Users/ana/projetos/x')).toBe('~/projetos/x');
    expect(shortPath('/home/bob')).toBe('~');
    expect(shortPath('/srv/app')).toBe('/srv/app');
  });
});

describe('reinício das janelas de uso', () => {
  const now = new Date(2026, 9, 6, 9, 15).getTime(); // terça, 06/10/2026
  const H = 3_600_000;
  const D = 24 * H;

  it('formatResetAt nunca mostra um reinício no passado', () => {
    expect(formatResetAt(now - 60_000, now)).toBe('');
    expect(formatResetAt(now, now)).toBe('');
  });

  it('compactDuration', () => {
    expect(compactDuration(45_000)).toBe('45s');
    expect(compactDuration(29 * 60_000)).toBe('29min');
    expect(compactDuration(H + 9 * 60_000)).toBe('1h09');
    expect(compactDuration(2 * H)).toBe('2h');
    expect(compactDuration(3 * D + 4 * H)).toBe('3d4h');
  });

  it('janela vigente: percentual e contagem regressiva (< 24 h) ou dia e hora', () => {
    const five = usageWindowView({ utilization: 35.4, resetsAt: now + H + 29 * 60_000 }, now - 60_000, now, FIVE_HOURS_MS)!;
    expect(five).toMatchObject({ pct: 35, renewed: false, reset: 'em 1 h 29 min', resetShort: '1h29' });
    expect(five.summary).toBe('35% usado · reinicia às 10:44 (em 1 h 29 min)');
    const week = usageWindowView({ utilization: 12, resetsAt: new Date(2026, 9, 8, 13, 49).getTime() }, now, now, WEEK_MS)!;
    expect(week.reset).toBe('qui., 13:49');
    const tomorrow = usageWindowView({ utilization: 12, resetsAt: new Date(2026, 9, 7, 13, 49).getTime() }, now, now, WEEK_MS)!;
    expect(tomorrow.reset).toBe('amanhã, 13:49');
  });

  it('janela que já renovou depois da leitura: sem percentual', () => {
    const v = usageWindowView({ utilization: 35, resetsAt: now - H }, now - 3 * H, now, FIVE_HOURS_MS)!;
    expect(v).toMatchObject({ pct: null, renewed: true, reset: 'renovada' });
    // Sem horário de reinício: números mais velhos que a janela também não valem.
    expect(usageWindowView({ utilization: 10 }, now - 6 * H, now, FIVE_HOURS_MS)!.renewed).toBe(true);
    expect(usageWindowView({ utilization: 10 }, now - 6 * H, now, WEEK_MS)!.pct).toBe(10);
    expect(usageWindowView(undefined, now, now, WEEK_MS)).toBeNull();
  });
});

describe('formatElapsed', () => {
  it('cronômetro m:ss abaixo de 1 hora', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7 * S + 999)).toBe('0:07');
    expect(formatElapsed(59 * S)).toBe('0:59');
    expect(formatElapsed(M)).toBe('1:00');
    expect(formatElapsed(12 * M + 31 * S)).toBe('12:31');
    expect(formatElapsed(H - S)).toBe('59:59');
  });
  it('h:mm:ss a partir de 1 hora e duração legível a partir de 1 dia', () => {
    expect(formatElapsed(H)).toBe('1:00:00');
    expect(formatElapsed(H + 2 * M + 10 * S)).toBe('1:02:10');
    expect(formatElapsed(23 * H + 59 * M + 59 * S)).toBe('23:59:59');
    expect(formatElapsed(D + 2 * H)).toBe('1 d 2 h');
  });
  it('valores negativos ou inválidos viram 0:00', () => {
    expect(formatElapsed(-5 * S)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
  });
});
