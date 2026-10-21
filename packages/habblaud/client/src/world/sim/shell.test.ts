// Regras puras da espera de shell: estágios da escalada, giros, bocejos, teia, balão e modos.
import { describe, expect, it } from 'vitest';
import type { ShellJob } from '../../../../shared/types';
import { modeFor, shouldRun } from './behavior';
import {
  cobwebScale,
  countShells,
  FOREGROUND_WAIT_MS,
  foregroundWaiting,
  formatShellAge,
  hourglassIcon,
  latestShellDone,
  SHELL_DONE_TOOL,
  oldestShell,
  shellAgeKey,
  shellBubbleAlpha,
  shellBubbleText,
  shellLabel,
  shellStage,
  shellWaitSince,
  SHELL_COBWEB_MS,
  SHELL_NAP_MS,
  SHELL_RESTLESS_MS,
  SPIN_GAP_MAX_MS,
  SPIN_GAP_MIN_MS,
  SPIN_MS,
  spinDir,
  spinPhase,
  yawnPhase,
} from './shell';

const MIN = 60_000;
const NOW = 1_700_000_000_000;

function job(id: string, ageMs: number, extra: Partial<ShellJob> = {}): ShellJob {
  return { id, label: `Comando ${id}`, startedAt: NOW - ageMs, background: true, kind: 'shell', ...extra };
}

describe('escalada da espera', () => {
  it('estágios pela idade: pipoca, inquieto, teia, cochilo', () => {
    expect(shellStage(0)).toBe('popcorn');
    expect(shellStage(3 * MIN - 1)).toBe('popcorn');
    expect(shellStage(3 * MIN)).toBe('restless');
    expect(shellStage(10 * MIN - 1)).toBe('restless');
    expect(shellStage(10 * MIN)).toBe('cobweb');
    expect(shellStage(25 * MIN - 1)).toBe('cobweb');
    expect(shellStage(25 * MIN)).toBe('nap');
    expect(shellStage(5 * 60 * MIN)).toBe('nap');
  });

  it('teia: nenhuma antes de 10 min, 1x até 20 min, 2x depois (escala inteira)', () => {
    expect(cobwebScale(9 * MIN)).toBe(0);
    expect(cobwebScale(10 * MIN)).toBe(1);
    expect(cobwebScale(19.9 * MIN)).toBe(1);
    expect(cobwebScale(20 * MIN)).toBe(2);
    expect(cobwebScale(90 * MIN)).toBe(2);
  });

  it('ampulheta vira a cada 1,2 s', () => {
    expect(hourglassIcon(0)).toBe('hourglass');
    expect(hourglassIcon(1199)).toBe('hourglass');
    expect(hourglassIcon(1200)).toBe('hourglass_flip');
    expect(hourglassIcon(2400)).toBe('hourglass');
  });
});

describe('giros na cadeira', () => {
  /** Inícios dos giros (ms de idade) amostrando a cada 20 ms. */
  function spinStarts(seed: number, from: number, to: number): number[] {
    const starts: number[] = [];
    let prev = -1;
    for (let t = from; t < to; t += 20) {
      const p = spinPhase(t, seed);
      if (p >= 0 && prev < 0) starts.push(t);
      prev = p;
    }
    return starts;
  }

  it('só no estágio inquieto, a cada 15–25 s, cada um com ~0,8 s', () => {
    for (const seed of [1, 42, 0xdeadbeef, 987654321]) {
      expect(spinStarts(seed, 0, SHELL_RESTLESS_MS)).toEqual([]);
      expect(spinStarts(seed, SHELL_COBWEB_MS, SHELL_COBWEB_MS + 2 * MIN)).toEqual([]);
      const starts = spinStarts(seed, SHELL_RESTLESS_MS, SHELL_COBWEB_MS);
      // 7 min com intervalos de 15–25 s
      expect(starts.length).toBeGreaterThanOrEqual(Math.floor((7 * MIN) / (SPIN_GAP_MAX_MS + SPIN_MS)));
      expect(starts.length).toBeLessThanOrEqual(Math.ceil((7 * MIN) / SPIN_GAP_MIN_MS) + 1);
      // o primeiro giro vem logo depois que a pipoca acaba
      expect(starts[0] - SHELL_RESTLESS_MS).toBeLessThan(5_000);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        expect(gap).toBeGreaterThanOrEqual(SPIN_GAP_MIN_MS - 20);
        expect(gap).toBeLessThanOrEqual(SPIN_GAP_MAX_MS + 20);
      }
      // duração de um giro
      const s0 = starts[0];
      expect(spinPhase(s0 + SPIN_MS - 30, seed)).toBeGreaterThan(0.9);
      expect(spinPhase(s0 + SPIN_MS + 10, seed)).toBe(-1);
    }
  });

  it('determinístico por semente; sementes diferentes giram em momentos diferentes', () => {
    expect(spinStarts(7, SHELL_RESTLESS_MS, SHELL_COBWEB_MS)).toEqual(spinStarts(7, SHELL_RESTLESS_MS, SHELL_COBWEB_MS));
    expect(spinStarts(7, SHELL_RESTLESS_MS, SHELL_COBWEB_MS)).not.toEqual(spinStarts(8, SHELL_RESTLESS_MS, SHELL_COBWEB_MS));
  });

  it('uma volta completa no sentido horário, terminando onde começou', () => {
    const seq = [0, 0.26, 0.51, 0.76, 0.99].map((p) => spinDir(p, 'up'));
    expect(seq).toEqual(['right', 'down', 'left', 'up', 'up']);
    expect([0.1, 0.3, 0.6, 0.9].map((p) => spinDir(p, 'down'))).toEqual(['left', 'up', 'right', 'down']);
    expect(spinDir(-1, 'left')).toBe('left');
  });

  it('bocejos só no estágio da teia', () => {
    let yawns = 0;
    let prev = -1;
    for (let t = 0; t < SHELL_NAP_MS + 5 * MIN; t += 50) {
      const p = yawnPhase(t, 1234);
      if (p >= 0 && prev < 0) {
        yawns++;
        expect(t).toBeGreaterThanOrEqual(SHELL_COBWEB_MS);
        expect(t).toBeLessThan(SHELL_NAP_MS);
      }
      prev = p;
    }
    // 15 min com intervalos de 18–32 s
    expect(yawns).toBeGreaterThan(20);
    expect(yawns).toBeLessThan(55);
  });
});

describe('shells do agente', () => {
  const shells = [job('b1', 5 * MIN), job('b2', 1 * MIN), job('fg', 20_000, { background: false })];

  it('mais antigo e contagem (todos ou só os de primeiro plano)', () => {
    expect(oldestShell(shells, false)?.id).toBe('b1');
    expect(oldestShell(shells, true)?.id).toBe('fg');
    expect(oldestShell(undefined, false)).toBeNull();
    expect(oldestShell([], true)).toBeNull();
    expect(countShells(shells, false)).toBe(3);
    expect(countShells(shells, true)).toBe(1);
    expect(countShells(undefined, false)).toBe(0);
  });

  it('primeiro plano só vira espera depois de 10 s', () => {
    expect(foregroundWaiting([job('fg', FOREGROUND_WAIT_MS - 1, { background: false })], NOW)).toBe(false);
    expect(foregroundWaiting([job('fg', FOREGROUND_WAIT_MS + 1, { background: false })], NOW)).toBe(true);
    // shells em segundo plano não contam como "parado esperando" enquanto o agente trabalha
    expect(foregroundWaiting([job('bg', 30 * MIN)], NOW)).toBe(false);
    expect(foregroundWaiting(undefined, NOW)).toBe(false);
  });

  it('início da espera e rótulo (com textos de reserva)', () => {
    expect(shellWaitSince({ status: 'shell', shells, statusSince: NOW })).toBe(NOW - 5 * MIN);
    expect(shellWaitSince({ status: 'working', shells, statusSince: NOW })).toBe(NOW - 20_000);
    expect(shellWaitSince({ status: 'shell', shells: [], statusSince: NOW - 7 })).toBe(NOW - 7);
    expect(shellLabel({ status: 'shell', shells })).toBe('Comando b1');
    expect(shellLabel({ status: 'shell', shells: [job('x', 1, { label: '  ' })] })).toBe('Comando em segundo plano');
    expect(shellLabel({ status: 'working', shells: [] })).toBe('Comando no terminal');
    expect(shellLabel({ status: 'shell', shells: [job('m', 1, { label: '', kind: 'monitor' })] })).toBe('Monitorando um processo');
  });

  it('modo: status shell e comando longo em primeiro plano viram "shell"; espera de usuário vence', () => {
    expect(modeFor('shell', { kind: 'main' })).toBe('shell');
    expect(modeFor('shell', { kind: 'sub' })).toBe('shell');
    expect(modeFor('working', { kind: 'main', shells, now: NOW })).toBe('shell');
    expect(modeFor('working', { kind: 'main', shells: [job('fg', 2_000, { background: false })], now: NOW })).toBe('work');
    expect(modeFor('working', { kind: 'main', shells })).toBe('work');
    expect(modeFor('waiting', { kind: 'main', shells, now: NOW })).toBe('wait');
    expect(modeFor('shell', { kind: 'main', missing: true })).toBe('leave');
  });

  it('volta à mesa andando; só corre se estiver muito longe', () => {
    expect(shouldRun(10, 'shell')).toBe(false);
    expect(shouldRun(18, 'shell')).toBe(false);
    expect(shouldRun(30, 'shell')).toBe(true);
  });
});

describe('fim do shell', () => {
  const act = (id: string, at: number, tool?: string, error?: boolean) => ({ id, kind: 'run' as const, icon: '✅', text: id, at, tool, error });

  it("acha a 'ShellDone' mais recente, mesmo atrás de outra atividade do mesmo snapshot", () => {
    expect(latestShellDone({ activity: act('x', 5), recent: [] })).toBeNull();
    expect(latestShellDone({ activity: act('d', 5, SHELL_DONE_TOOL) })?.id).toBe('d');
    const recent = [act('d1', 1, SHELL_DONE_TOOL), act('e', 2), act('d2', 3, SHELL_DONE_TOOL, true), act('r', 4)];
    expect(latestShellDone({ activity: act('r', 4), recent })?.id).toBe('d2');
    expect(latestShellDone({ activity: act('r', 4), recent })?.error).toBe(true);
  });
});

describe('balão da espera', () => {
  it('tempo em PT-BR: "45 s", "3 min", "1 h 05"', () => {
    expect(formatShellAge(-500)).toBe('0 s');
    expect(formatShellAge(45_400)).toBe('45 s');
    expect(formatShellAge(59_999)).toBe('59 s');
    expect(formatShellAge(60_000)).toBe('1 min');
    expect(formatShellAge(3 * MIN + 59_000)).toBe('3 min');
    expect(formatShellAge(59 * MIN)).toBe('59 min');
    expect(formatShellAge(65 * MIN)).toBe('1 h 05');
    expect(formatShellAge(130 * MIN)).toBe('2 h 10');
    expect(shellBubbleText('Rodar phpunit', 3 * MIN)).toBe('Rodar phpunit · 3 min');
  });

  it('a chave do texto muda exatamente quando o tempo exibido muda', () => {
    let prevKey = shellAgeKey(0);
    let prevText = formatShellAge(0);
    for (let ms = 0; ms < 3 * 60 * MIN; ms += 250) {
      const k = shellAgeKey(ms);
      const t = formatShellAge(ms);
      expect(k !== prevKey).toBe(t !== prevText);
      prevKey = k;
      prevText = t;
    }
  });

  it("modo 'important': ao entrar, depois 4 s a cada ~30 s", () => {
    expect(shellBubbleAlpha(-1)).toBe(0);
    expect(shellBubbleAlpha(1_000)).toBe(1);
    expect(shellBubbleAlpha(10_000)).toBe(0);
    expect(shellBubbleAlpha(29_000)).toBe(0);
    expect(shellBubbleAlpha(31_000)).toBe(1);
    expect(shellBubbleAlpha(35_000)).toBe(0);
    expect(shellBubbleAlpha(61_000)).toBe(1);
    expect(shellBubbleAlpha(30_000 * 40 + 1_000)).toBe(1);
    // deslocamento por personagem
    expect(shellBubbleAlpha(31_000, 5_000)).toBe(0);
    expect(shellBubbleAlpha(36_000, 5_000)).toBe(1);
    // fração visível ~ (6 s + 4 s a cada 30 s)
    let on = 0;
    for (let t = 0; t < 10 * MIN; t += 100) if (shellBubbleAlpha(t) > 0) on++;
    expect(on / ((10 * MIN) / 100)).toBeGreaterThan(0.12);
    expect(on / ((10 * MIN) / 100)).toBeLessThan(0.16);
  });
});
