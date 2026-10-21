import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot } from '../../../shared/types';
import {
  accountChipLabel,
  accountProvider,
  codexApprovalLabel,
  emptyOfficeHint,
  fallbackShort,
  hasCodexPermission,
  isCodex,
  looksLikeCodexId,
  providerOf,
  showsProviderTag,
} from './provider';

describe('ferramenta (Claude Code ou Codex)', () => {
  it('provider ausente = Claude Code', () => {
    expect(providerOf(undefined)).toBe('claude');
    expect(providerOf({})).toBe('claude');
    expect(providerOf({ provider: 'codex' })).toBe('codex');
    expect(isCodex({ provider: 'codex' })).toBe(true);
    expect(isCodex({ provider: 'claude' })).toBe(false);
    expect(isCodex(null)).toBe(false);
  });

  it('id com cara de pasta do Codex (só quando a conta já não está no snapshot)', () => {
    for (const id of ['.codex', 'demo:.codex', '.codex-trabalho', '.codex~2', '/Users/ana/.codex', 'codex']) expect(looksLikeCodexId(id), id).toBe(true);
    for (const id of ['.claude', '.claude-conta2', 'demo:.claude', 'meucodex', '.codexy', '']) expect(looksLikeCodexId(id), id).toBe(false);
    // Com a conta à mão, vale o provider dela; sem ela, a dica de quem chamou e, por fim, o id.
    expect(accountProvider({ provider: 'codex' }, '.claude')).toBe('codex');
    expect(accountProvider({}, '.codex')).toBe('claude');
    expect(accountProvider(undefined, '.claude', 'codex')).toBe('codex');
    expect(accountProvider(undefined, '.codex')).toBe('codex');
    expect(accountProvider(undefined, 'x')).toBe('claude');
  });

  it('letra do chip sem a conta no snapshot: nunca "." nem vazio', () => {
    expect(fallbackShort('.claude-conta2')).toBe('C');
    expect(fallbackShort('.claude')).toBe('?');
    expect(fallbackShort('.codex')).toBe('X');
    expect(fallbackShort('.codex-trabalho')).toBe('T');
    expect(fallbackShort('.codex~2')).toBe('X');
    expect(fallbackShort('demo:.codex')).toBe('X');
    expect(fallbackShort('minha-conta')).toBe('M');
    expect(fallbackShort('')).toBe('?');
    expect(fallbackShort('...', 'codex')).toBe('X');
  });

  it('selo "Codex": só no Codex, e sem repetir o nome da conta', () => {
    expect(showsProviderTag('codex', 'Conta X')).toBe(true);
    expect(showsProviderTag('codex', 'Codex')).toBe(false);
    expect(showsProviderTag('codex', 'Demo Codex')).toBe(false);
    expect(showsProviderTag('claude', 'Conta C')).toBe(false);
  });

  it('rótulo do chip: e-mail no Claude Code; ferramenta e plano no Codex', () => {
    expect(accountChipLabel({ name: 'Conta C', email: 'a@b.c' }, '.claude', 'claude')).toBe('Conta C (a@b.c)');
    expect(accountChipLabel({ name: 'Conta X', plan: 'Team', provider: 'codex' }, '.codex', 'codex')).toBe('Conta X · Codex · plano Team');
    expect(accountChipLabel({ name: 'Codex', plan: 'Team', provider: 'codex' }, '.codex', 'codex')).toBe('Codex · plano Team');
    expect(accountChipLabel(undefined, '.codex', 'codex')).toBe('.codex · Codex');
    expect(accountChipLabel(undefined, '', 'claude')).toBe('Conta desconhecida');
  });

  it('escritório vazio: atalhos só das contas do Claude Code; o Codex entra quando há conta dele', () => {
    const c = { short: 'C' };
    const d = { short: 'D' };
    const x = { short: 'X', provider: 'codex' as const };
    expect(emptyOfficeHint([c, d])).toBe('Abra o Claude Code em qualquer projeto (atalhos c ou d) e veja seu agente chegar.');
    expect(emptyOfficeHint([c, d, x])).toBe('Abra o Claude Code (atalhos c ou d) ou o Codex em qualquer projeto e veja seu agente chegar.');
    expect(emptyOfficeHint([x])).toBe('Abra o Claude Code ou o Codex em qualquer projeto e veja seu agente chegar.');
    expect(emptyOfficeHint([])).toBe('Abra o Claude Code em qualquer projeto e veja seu agente chegar.');
  });

  it('relógio de 1 s enquanto há pedido do Codex esperando', () => {
    const agent = (permission?: AgentInfo['permission'], status: AgentInfo['status'] = 'waiting') => ({ status, permission }) as AgentInfo;
    const p = { id: 'p', tool: 'Bash', title: 'Bash(ls)', text: 'Listando', icon: '💻', createdAt: 0, expiresAt: 25_000 };
    const snap = (agents: AgentInfo[]) => ({ agents }) as Pick<OfficeSnapshot, 'agents'>;
    expect(hasCodexPermission(snap([agent({ ...p, provider: 'codex' })]))).toBe(true);
    expect(hasCodexPermission(snap([agent(p)]))).toBe(false);
    expect(hasCodexPermission(snap([agent({ ...p, provider: 'codex' }, 'offline')]))).toBe(false);
    expect(hasCodexPermission(null)).toBe(false);
  });

  it('aprovações do Codex em português (valor desconhecido passa como veio)', () => {
    expect(codexApprovalLabel('on-request')).toBe('Pergunta quando precisa');
    expect(codexApprovalLabel('never')).toBe('Nunca pergunta');
    expect(codexApprovalLabel('outra')).toBe('outra');
    expect(codexApprovalLabel(undefined)).toBe('—');
  });
});
