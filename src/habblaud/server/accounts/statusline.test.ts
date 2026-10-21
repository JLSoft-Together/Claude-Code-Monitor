import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { detectAccounts, meaningfulOrganization } from './detect';
import { AccountsService } from './service';
import { parseStatuslineFile, StatuslineUsageReader } from './statusline';
import { STALE_AFTER_MS } from './usage';

setQuiet(true);

const NOW = Date.parse('2026-10-06T12:00:00Z');
const SEC = (iso: string) => Date.parse(iso) / 1000;

function record(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountId: '.claude-conta2',
    configDir: '/Users/fulano/.claude-conta2',
    fetchedAt: NOW - 60_000,
    five_hour: { utilization: 42, resets_at: SEC('2026-10-06T14:00:00Z') },
    seven_day: { utilization: 15, resets_at: SEC('2026-10-09T23:00:00Z') },
    ...over,
  };
}

describe('arquivo do tap de statusline', () => {
  it('resets_at em segundos vira ms; fetchedAt no futuro é limitado a agora', () => {
    const p = parseStatuslineFile(JSON.stringify(record()), 'x.json', NOW)!;
    expect(p).toEqual({
      file: 'x.json',
      accountId: '.claude-conta2',
      configDir: '/Users/fulano/.claude-conta2',
      usage: {
        source: 'statusline',
        via: 'tap',
        fetchedAt: NOW - 60_000,
        fiveHour: { utilization: 42, resetsAt: Date.parse('2026-10-06T14:00:00Z') },
        sevenDay: { utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') },
      },
    });
    expect(parseStatuslineFile(JSON.stringify(record({ fetchedAt: NOW + 999_999 })), 'x', NOW)!.usage.fetchedAt).toBe(NOW);
    // Sem fetchedAt: usa a data do arquivo.
    expect(parseStatuslineFile(JSON.stringify(record({ fetchedAt: undefined })), 'x', NOW, NOW - 5_000)!.usage.fetchedAt).toBe(NOW - 5_000);
  });

  it('ignora lixo, JSON sem janelas e campos estranhos', () => {
    expect(parseStatuslineFile('{', 'x', NOW)).toBeUndefined();
    expect(parseStatuslineFile('[]', 'x', NOW)).toBeUndefined();
    expect(parseStatuslineFile(JSON.stringify({ fetchedAt: NOW }), 'x', NOW)).toBeUndefined();
    expect(parseStatuslineFile(JSON.stringify(record({ five_hour: { utilization: 'muito' }, seven_day: null })), 'x', NOW)).toBeUndefined();
    const clamped = parseStatuslineFile(JSON.stringify(record({ five_hour: { utilization: 250 } })), 'x', NOW)!;
    expect(clamped.usage.fiveHour).toEqual({ utilization: 100 });
  });

  it('arquivo do mod do Claude Code: o mesmo formato com "source": "mod", que vira usage.via', () => {
    const fromMod = parseStatuslineFile(JSON.stringify(record({ source: 'mod' })), 'x.json', NOW);
    const fromTap = parseStatuslineFile(JSON.stringify(record()), 'x.json', NOW)!;
    expect(fromMod).toEqual({ ...fromTap, usage: { ...fromTap.usage, via: 'mod' } });
    expect(fromMod?.usage.fiveHour).toEqual({ utilization: 42, resetsAt: Date.parse('2026-10-06T14:00:00Z') });
  });

  it('leitor: leitura pela metade (o $.fs.write do mod não é atômico) mantém o último registro bom e relê depois', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, '.claude-conta2.json');
      const r = new StatuslineUsageReader(tmp.dir);
      const touch = (ms: number) => utimesSync(file, new Date(NOW), new Date(NOW + ms));
      writeFileSync(file, JSON.stringify(record({ source: 'mod' })));
      touch(1_000);
      expect(r.read(NOW)[0].usage.fiveHour?.utilization).toBe(42);
      // truncado (vazio) e depois no meio da escrita: continua o 42
      writeFileSync(file, '');
      touch(2_000);
      expect(r.read(NOW).map((f) => f.usage.fiveHour?.utilization)).toEqual([42]);
      writeFileSync(file, JSON.stringify(record({ five_hour: { utilization: 50 } })).slice(0, 40));
      touch(2_000);
      expect(r.read(NOW).map((f) => f.usage.fiveHour?.utilization)).toEqual([42]);
      // a escrita termina com a MESMA data (resolução do relógio): relido mesmo assim
      writeFileSync(file, JSON.stringify(record({ source: 'mod', five_hour: { utilization: 50 } })));
      touch(2_000);
      expect(r.read(NOW).map((f) => f.usage.fiveHour?.utilization)).toEqual([50]);
      // arquivo que nunca foi bom: nada (e relido a cada ciclo até ficar bom)
      writeFileSync(join(tmp.dir, 'outra.json'), '{"accountId":');
      expect(r.read(NOW)).toHaveLength(1);
      writeFileSync(join(tmp.dir, 'outra.json'), JSON.stringify(record({ accountId: 'outra', configDir: '/x/outra' })));
      expect(r.read(NOW).map((f) => f.accountId).sort()).toEqual(['.claude-conta2', 'outra']);
    } finally {
      tmp.cleanup();
    }
  });

  it('leitor: só *.json, cache por arquivo, some quando o arquivo some', () => {
    const tmp = tempDir();
    try {
      const reader = new StatuslineUsageReader(join(tmp.dir, 'nao-existe'));
      expect(reader.read(NOW)).toEqual([]);
      const dir = join(tmp.dir, 'usage');
      mkdirSync(dir);
      writeFileSync(join(dir, '.claude-conta2.json'), JSON.stringify(record()));
      writeFileSync(join(dir, 'notas.txt'), 'x');
      writeFileSync(join(dir, 'quebrado.json'), '{');
      const r = new StatuslineUsageReader(dir);
      expect(r.read(NOW).map((f) => f.accountId)).toEqual(['.claude-conta2']);
      expect(r.read(NOW)).toHaveLength(1);
      writeFileSync(join(dir, '.claude-conta2.json'), JSON.stringify(record({ five_hour: { utilization: 50, resets_at: SEC('2026-10-06T14:00:00Z') } })));
      utimesSync(join(dir, '.claude-conta2.json'), new Date(NOW), new Date(NOW + 1_000));
      expect(r.read(NOW)[0].usage.fiveHour?.utilization).toBe(50);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('AccountsService com a fonte statusline', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  let usageDir: string;
  let now: number;
  const dirs = () => [join(home, '.claude'), join(home, '.claude-conta2')];

  beforeEach(() => {
    tmp = tempDir();
    home = tmp.dir;
    usageDir = join(home, '.habblaud', 'usage');
    now = NOW;
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-conta2', 'projects'), { recursive: true });
    mkdirSync(usageDir, { recursive: true });
  });
  afterEach(() => tmp.cleanup());

  const service = (onChange = () => {}) =>
    new AccountsService({ dirs: dirs(), home, env: {}, onChange, usageDir, now: () => now });

  it('casa pelo config dir e vira ok; envelhece para stale; arquivo apagado = sem dados', () => {
    writeFileSync(join(usageDir, '.claude-conta2.json'), JSON.stringify(record({ configDir: join(home, '.claude-conta2') })));
    let changes = 0;
    const svc = service(() => changes++);
    const [c, d] = svc.list(new Map());
    expect(c.usageStatus).toBe('disabled');
    expect(d).toMatchObject({ usageStatus: 'ok', usage: { source: 'statusline', fiveHour: { utilization: 42 }, sevenDay: { utilization: 15 } } });

    now = NOW + STALE_AFTER_MS;
    svc.refreshStatusline();
    expect(svc.list(new Map())[1].usageStatus).toBe('stale');
    expect(changes).toBeGreaterThan(0);

    tmp.cleanup();
    mkdirSync(usageDir, { recursive: true });
    svc.refreshStatusline();
    expect(svc.list(new Map())[1]).toMatchObject({ usageStatus: 'disabled' });
    expect(svc.list(new Map())[1].usage).toBeUndefined();
  });

  it('sem configDir, casa pelo accountId; vale a fonte mais recente', () => {
    writeFileSync(join(usageDir, 'x.json'), JSON.stringify(record({ configDir: undefined, accountId: '.claude', fetchedAt: NOW - 120_000 })));
    const svc = service();
    expect(svc.list(new Map())[0]).toMatchObject({ usageStatus: 'ok', usage: { source: 'statusline' } });
    // Cache do /usage mais novo vence; statusline mais novo volta a vencer.
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: NOW - 10_000, utilization: { five_hour: { utilization: 70 } } } }));
    svc.refresh();
    expect(svc.list(new Map())[0].usage).toMatchObject({ source: 'cache', fiveHour: { utilization: 70 } });
    writeFileSync(join(usageDir, 'x.json'), JSON.stringify(record({ configDir: undefined, accountId: '.claude', fetchedAt: NOW - 1_000 })));
    utimesSync(join(usageDir, 'x.json'), new Date(NOW), new Date(NOW + 2_000));
    svc.refreshStatusline();
    expect(svc.list(new Map())[0].usage).toMatchObject({ source: 'statusline', fiveHour: { utilization: 42 } });
  });

  it('no Docker: casa pelo caminho do HOST (HABBLAUD_ACCOUNTS.configDir), não pelo da montagem', () => {
    const env = {
      HABBLAUD_ACCOUNTS: JSON.stringify([{ id: '.claude-conta2', configDir: '/Users/fulano/.claude-conta2', mountDir: join(home, '.claude-conta2') }]),
    };
    writeFileSync(join(usageDir, '.claude-conta2.json'), JSON.stringify(record()));
    const svc = new AccountsService({ dirs: [join(home, '.claude-conta2')], home, env, onChange: () => {}, usageDir, now: () => now });
    expect(svc.list(new Map())[0]).toMatchObject({ id: '.claude-conta2', usageStatus: 'ok', usage: { source: 'statusline' } });
  });

  it('janela que já reiniciou desde a coleta aparece sem dados', () => {
    writeFileSync(join(usageDir, 'c.json'), JSON.stringify(record({ configDir: join(home, '.claude'), accountId: '.claude' })));
    const svc = service();
    now = Date.parse('2026-10-06T14:05:00Z');
    const u = svc.list(new Map())[0].usage!;
    expect(u.fiveHour).toBeUndefined();
    expect(u.sevenDay).toEqual({ utilization: 15, resetsAt: Date.parse('2026-10-09T23:00:00Z') });
  });
});

describe('organização da conta', () => {
  it('omite o nome genérico "<e-mail>\'s Organization"', () => {
    expect(meaningfulOrganization("fulano@x.com's Organization", 'fulano@x.com')).toBeUndefined();
    expect(meaningfulOrganization("FULANO@X.COM’s organization", 'fulano@x.com')).toBeUndefined();
    expect(meaningfulOrganization("outra@x.com's Organization", undefined)).toBeUndefined();
    expect(meaningfulOrganization('Empresa Exemplo', 'fulano@x.com')).toBe('Empresa Exemplo');
    expect(meaningfulOrganization("Maria's Organization", 'fulano@x.com')).toBe("Maria's Organization");
  });

  it('detectAccounts aplica a regra ao .claude.json', () => {
    const tmp = tempDir();
    try {
      const dir = join(tmp.dir, '.claude');
      mkdirSync(join(dir, 'projects'), { recursive: true });
      writeFileSync(join(tmp.dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'eu@x.com', organizationName: "eu@x.com's Organization" } }));
      const [acc] = detectAccounts([dir], { home: tmp.dir, env: {} });
      expect(acc.email).toBe('eu@x.com');
      expect(acc.organization).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });
});
