import { describe, expect, it } from 'vitest';
import { PART_KEYS } from '../../../../shared/appearance';
import { TRAIT_IDS } from '../../../../shared/world/traits';
import { FAKE_UPLINK, WORLD_UI_ERROR_CODES, type WorldBuildingStatus, type WorldBuildingStop, type WorldMeta } from '../../net/world';
import {
  APPEAL_EMAIL,
  appealMailto,
  EXPORT_FILENAME,
  notifyInactivityOn,
  unverifiedHint,
  unverifiedLabel,
  worldErrorText,
  ackView,
  agentsText,
  buildingState,
  buildingStopView,
  buildingView,
  bytesText,
  floorsText,
  leaveHint,
  nextVisitorAlert,
  VISITOR_ALERT_START,
  prettyUplink,
  themeGoesToWorld,
  UPLINK_REJECT_CODES,
  uplinkRejectText,
  worldChipState,
  characterProblem,
  codeLooksValid,
  draftAppearance,
  emailLooksValid,
  fullParts,
  initialWorldUi,
  nameProblemText,
  normalizeCode,
  passwordProblem,
  screensFor,
  hasCharacter,
  nextWorldPopup,
  parsePopupMemory,
  serializePopupMemory,
  EMPTY_POPUP_MEMORY,
  LAUNCH_MAX_SHOWS,
  LAUNCH_RETURN_MS,
  type WorldPopupMemory,
  toggleTrait,
  traitBlock,
  traitsValid,
  worldReduce,
  worldSectionMode,
  type WorldGate,
  type WorldUi,
} from './world-model';

const LOCAL: WorldGate = { remote: false, local: true, terminal: true, fake: false };
const meta = (state: WorldMeta['state'], extra: Partial<WorldMeta> = {}): WorldMeta => ({ enabled: true, configured: true, state, ...extra });

describe('quando a seção aparece', () => {
  it('sem meta.world ou com enabled:false, nada do World', () => {
    expect(worldSectionMode(undefined, LOCAL)).toBe('hidden');
    expect(worldSectionMode(meta('logged_out', { enabled: false }), LOCAL)).toBe('hidden');
  });

  it('sem servidor configurado (o padrão): nada do World, nem o aviso de desligado', () => {
    expect(worldSectionMode(meta('off', { enabled: false, configured: false }), LOCAL)).toBe('hidden');
    expect(worldSectionMode(meta('off', { configured: false }), LOCAL)).toBe('hidden');
    expect(worldSectionMode(meta('off'), LOCAL)).toBe('hidden');
    expect(worldSectionMode(meta('off', { configured: false }), { ...LOCAL, fake: true })).toBe('hidden');
  });

  it('pela porta remota (celular), some; sem a trava do terminal ou fora do localhost, só o aviso', () => {
    expect(worldSectionMode(meta('logged_out'), { ...LOCAL, remote: true })).toBe('hidden');
    expect(worldSectionMode(meta('logged_out'), { ...LOCAL, terminal: false })).toBe('local_only');
    expect(worldSectionMode(meta('logged_out'), { ...LOCAL, local: false })).toBe('local_only');
    expect(worldSectionMode(meta('waiting'), LOCAL)).toBe('active');
  });

  it('no modo demonstração (falso) as travas não valem, mas a porta remota continua escondendo', () => {
    expect(worldSectionMode(meta('logged_out'), { remote: false, local: false, terminal: false, fake: true })).toBe('active');
    expect(worldSectionMode(meta('logged_out'), { remote: true, local: false, terminal: false, fake: true })).toBe('hidden');
  });
});

describe('popups de lançamento', () => {
  const gate = { ...LOCAL, replaying: false };
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = 1_760_600_000_000;
  const none = EMPTY_POPUP_MEMORY;
  const mem = (extra: Partial<WorldPopupMemory>): WorldPopupMemory => ({ ...none, ...extra });

  it('sem conta: "Novidade" na primeira vez, contado na memória', () => {
    expect(nextWorldPopup(meta('logged_out'), gate, none, NOW)).toEqual({ show: 'launch', memory: mem({ launch: { shown: 1, last: NOW } }) });
  });

  it('"Agora não": volta só depois de 3 dias, e no máximo 3 vezes no total', () => {
    const once = mem({ launch: { shown: 1, last: NOW } });
    expect(nextWorldPopup(meta('logged_out'), gate, once, NOW + DAY).show).toBeNull();
    expect(nextWorldPopup(meta('logged_out'), gate, once, NOW + LAUNCH_RETURN_MS - 1).show).toBeNull();
    const again = nextWorldPopup(meta('logged_out'), gate, once, NOW + LAUNCH_RETURN_MS);
    expect(again).toEqual({ show: 'launch', memory: mem({ launch: { shown: 2, last: NOW + LAUNCH_RETURN_MS } }) });
    const third = nextWorldPopup(meta('logged_out'), gate, again.memory!, NOW + 2 * LAUNCH_RETURN_MS);
    expect(third.show).toBe('launch');
    expect((third.memory!.launch as { shown: number }).shown).toBe(LAUNCH_MAX_SHOWS);
    expect(nextWorldPopup(meta('logged_out'), gate, third.memory!, NOW + 30 * DAY)).toEqual({ show: null, memory: null });
  });

  it('"Não mostrar de novo" (e a chave antiga em `never`) encerram; a chave antiga em `shown` não bloqueia', () => {
    expect(nextWorldPopup(meta('logged_out'), gate, mem({ launch: 'never' }), NOW)).toEqual({ show: null, memory: null });
    const legacyNever = parsePopupMemory({ launch: null, legacy: 'never', waitlist: null, approved: null });
    expect(legacyNever.launch).toBe('never');
    expect(nextWorldPopup(meta('logged_out'), gate, legacyNever, NOW).show).toBeNull();
    const legacyShown = parsePopupMemory({ launch: null, legacy: 'shown', waitlist: null, approved: null });
    expect(legacyShown).toEqual(none);
    expect(nextWorldPopup(meta('logged_out'), gate, legacyShown, NOW).show).toBe('launch');
  });

  it('com conta (na espera ou liberada) o lançamento nunca mais aparece, mesmo saindo da conta depois', () => {
    const d = nextWorldPopup(meta('waiting'), gate, mem({ waitlistSeen: true }), NOW);
    expect(d).toEqual({ show: null, memory: mem({ launch: 'never', waitlistSeen: true }) });
    expect(nextWorldPopup(meta('logged_out'), gate, d.memory!, NOW + 10 * DAY).show).toBeNull();
    const a = nextWorldPopup(meta('approved', { scene: { available: true } }), gate, mem({ launch: { shown: 1, last: 0 } }), NOW);
    expect(a).toEqual({ show: null, memory: mem({ launch: 'never' }) });
    // já gravado: nada muda
    expect(nextWorldPopup(meta('approved', { scene: { available: true } }), gate, mem({ launch: 'never' }), NOW)).toEqual({ show: null, memory: null });
  });

  it('"Você está na lista de espera": ao entrar na espera (ou abrir já nela), uma vez por navegador', () => {
    expect(nextWorldPopup(meta('waiting'), gate, none, NOW)).toEqual({ show: 'waitlist', memory: mem({ launch: 'never', waitlistSeen: true }) });
    expect(nextWorldPopup(meta('waiting'), gate, mem({ launch: 'never', waitlistSeen: true }), NOW)).toEqual({ show: null, memory: null });
  });

  it('"Acesso liberado!": liberada e sem personagem, uma vez por navegador; com personagem, nunca', () => {
    expect(nextWorldPopup(meta('approved'), gate, none, NOW)).toEqual({ show: 'approved', memory: mem({ launch: 'never', approvedSeen: true }) });
    expect(nextWorldPopup(meta('approved'), gate, mem({ launch: 'never', approvedSeen: true }), NOW)).toEqual({ show: null, memory: null });
    expect(nextWorldPopup(meta('approved', { scene: { available: false } }), gate, none, NOW).show).toBeNull();
    // saiu da espera com a página aberta: a mesma regra (a memória da espera não atrapalha)
    expect(nextWorldPopup(meta('approved'), gate, mem({ launch: 'never', waitlistSeen: true }), NOW).show).toBe('approved');
  });

  it('o personagem existe quando o meta traz a cena ou o prédio', () => {
    expect(hasCharacter(undefined)).toBe(false);
    expect(hasCharacter(meta('approved'))).toBe(false);
    expect(hasCharacter(meta('approved', { scene: { available: false } }))).toBe(true);
    expect(hasCharacter(meta('approved', { building: { state: 'live', floors: 1, agents: 0, idle: 0, working: 0 } as unknown as WorldMeta['building'] }))).toBe(true);
  });

  it('nunca no timelapse, no modo demonstração, pela porta remota, fora do computador ou sem servidor', () => {
    for (const state of ['logged_out', 'waiting', 'approved'] as const) {
      expect(nextWorldPopup(meta(state), { ...gate, replaying: true }, none, NOW).show, `${state} replay`).toBeNull();
      expect(nextWorldPopup(meta(state), { ...gate, fake: true }, none, NOW).show, `${state} fake`).toBeNull();
      expect(nextWorldPopup(meta(state), { ...gate, remote: true }, none, NOW).show, `${state} remote`).toBeNull();
      expect(nextWorldPopup(meta(state), { ...gate, local: false }, none, NOW).show, `${state} local`).toBeNull();
      expect(nextWorldPopup(meta(state), { ...gate, terminal: false }, none, NOW).show, `${state} terminal`).toBeNull();
      expect(nextWorldPopup(meta(state, { configured: false }), gate, none, NOW).show, `${state} configured`).toBeNull();
      expect(nextWorldPopup(meta(state, { enabled: false }), gate, none, NOW).show, `${state} enabled`).toBeNull();
    }
    expect(nextWorldPopup(meta('off'), gate, none, NOW)).toEqual({ show: null, memory: null });
    expect(nextWorldPopup(undefined, gate, none, NOW)).toEqual({ show: null, memory: null });
  });

  it('a memória vai e volta das chaves do localStorage; valor torto conta como nunca', () => {
    const m = mem({ launch: { shown: 2, last: NOW }, waitlistSeen: true });
    const raw = serializePopupMemory(m);
    expect(raw).toEqual({ launch: JSON.stringify({ shown: 2, last: NOW }), waitlist: '1', approved: null });
    expect(parsePopupMemory({ ...raw, legacy: null })).toEqual(m);
    expect(serializePopupMemory(mem({ launch: 'never', approvedSeen: true }))).toEqual({ launch: 'never', waitlist: null, approved: '1' });
    expect(parsePopupMemory({ launch: 'never', legacy: null, waitlist: null, approved: '1' })).toEqual(mem({ launch: 'never', approvedSeen: true }));
    expect(parsePopupMemory({ launch: '{bad', legacy: null, waitlist: null, approved: null })).toEqual(none);
    expect(parsePopupMemory({ launch: '{"shown":"x"}', legacy: null, waitlist: null, approved: null })).toEqual(none);
    expect(parsePopupMemory({ launch: null, legacy: null, waitlist: null, approved: null })).toEqual(none);
  });
});

describe('máquina de estados da seção', () => {
  const at = (server: WorldUi['server'], screen: WorldUi['screen'] = 'welcome'): WorldUi => ({ ...initialWorldUi(), server, screen });

  it('sem conta começa nas boas-vindas; com conta (na espera ou liberada), no início da conta', () => {
    expect(worldReduce(initialWorldUi(), { type: 'server', state: 'logged_out' }).screen).toBe('welcome');
    expect(worldReduce(initialWorldUi(), { type: 'server', state: 'waiting' }).screen).toBe('home');
    expect(worldReduce(initialWorldUi(), { type: 'server', state: 'approved' }).screen).toBe('home');
  });

  it('o cadastro guarda o e-mail e o nome de jogador para a tela do código (e para voltar)', () => {
    const sent = worldReduce(at('logged_out', 'register'), { type: 'code_sent', email: 'ana@exemplo.com', name: 'Ana Pixel' });
    expect(sent).toMatchObject({ screen: 'verify', email: 'ana@exemplo.com', name: 'Ana Pixel', flash: 'code_sent' });
    expect(worldReduce(sent, { type: 'go', screen: 'register' })).toMatchObject({ screen: 'register', email: 'ana@exemplo.com', name: 'Ana Pixel' });
    // O login com e-mail sem confirmar manda o código sem nome: o nome digitado antes fica.
    expect(worldReduce(sent, { type: 'code_sent', email: 'outra@exemplo.com' })).toMatchObject({ email: 'outra@exemplo.com', name: 'Ana Pixel' });
    expect(screensFor('off')).toEqual([]);
  });

  it('cadastro aceito vai para o código, guardando o e-mail', () => {
    const s = worldReduce(at('logged_out', 'register'), { type: 'code_sent', email: 'a@b.co' });
    expect(s).toMatchObject({ screen: 'verify', email: 'a@b.co', flash: 'code_sent' });
  });

  it('código confirmado: o status novo (na espera) leva ao início da conta', () => {
    const s = worldReduce(at('logged_out', 'verify'), { type: 'server', state: 'waiting' });
    expect(s.screen).toBe('home');
  });

  it('esqueci a senha → código e senha nova → login com o aviso', () => {
    let s = worldReduce(at('logged_out', 'login'), { type: 'go', screen: 'forgot' });
    s = worldReduce(s, { type: 'reset_code_sent', email: 'a@b.co' });
    expect(s).toMatchObject({ screen: 'reset', email: 'a@b.co' });
    s = worldReduce(s, { type: 'password_changed' });
    expect(s).toMatchObject({ screen: 'login', flash: 'password_changed', email: 'a@b.co' });
  });

  it('telas da conta não abrem sem conta, e as de entrar não abrem com conta', () => {
    expect(worldReduce(at('logged_out'), { type: 'go', screen: 'character' }).screen).toBe('welcome');
    expect(worldReduce(at('waiting', 'home'), { type: 'go', screen: 'register' }).screen).toBe('home');
    expect(worldReduce(at('waiting', 'home'), { type: 'go', screen: 'character' }).screen).toBe('character');
  });

  it('saiu da conta (ou o dispositivo foi revogado em outro lugar): volta às boas-vindas', () => {
    const s = worldReduce(at('approved', 'devices'), { type: 'server', state: 'logged_out' });
    expect(s.screen).toBe('welcome');
  });

  it('entrar apaga o aviso da tela de entrada ("Senha trocada")', () => {
    const s = worldReduce(at('logged_out', 'login'), { type: 'password_changed' });
    expect(worldReduce(s, { type: 'signed_in' }).flash).toBeNull();
  });

  it('navegar apaga o aviso; um aviso novo não muda a tela', () => {
    let s = worldReduce(at('logged_out', 'verify'), { type: 'flash', flash: 'code_resent' });
    expect(s).toMatchObject({ screen: 'verify', flash: 'code_resent' });
    s = worldReduce(s, { type: 'go', screen: 'welcome' });
    expect(s.flash).toBeNull();
  });
});

describe('e-mail, código e senha', () => {
  it('e-mail com cara de e-mail', () => {
    expect(emailLooksValid(' voce@exemplo.com ')).toBe(true);
    for (const bad of ['', 'voce', 'voce@', '@exemplo.com', 'voce@exemplo', 'vo ce@exemplo.com']) expect(emailLooksValid(bad), bad).toBe(false);
  });

  it('código: só os 6 dígitos (colar "123 456" vale)', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('12-34-56-78')).toBe('123456');
    expect(codeLooksValid('123 456')).toBe(true);
    expect(codeLooksValid('12345')).toBe(false);
  });

  it('senha: de 12 a 128 caracteres contados em código (não em UTF-16)', () => {
    expect(passwordProblem('curta')).toBe('short');
    expect(passwordProblem('a'.repeat(11) + 'b')).toBeNull();
    expect(passwordProblem('🙂'.repeat(11))).toBe('short');
    expect(passwordProblem('🙂'.repeat(11) + 'x')).toBeNull();
    expect(passwordProblem('x'.repeat(129) + 'y')).toBe('long');
  });

  it('senha: nem o e-mail, nem só repetição', () => {
    expect(passwordProblem('voce.da.silva@exemplo.com', 'Voce.da.Silva@exemplo.com')).toBe('email');
    expect(passwordProblem('voce.da.silva', 'voce.da.silva@exemplo.com')).toBe('email');
    expect(passwordProblem('aaaaaaaaaaaa')).toBe('repeated');
    expect(passwordProblem('abcabcabcabc')).toBe('repeated');
    expect(passwordProblem('cavalo correto bateria grampo')).toBeNull();
  });
});

describe('nome de jogador', () => {
  // As regras ficam em shared/world/names-rules.ts (e no teste de lá); aqui, só o texto de cada motivo.
  it('cada motivo de recusa tem um texto', () => {
    const problems = ['type', 'length', 'invisible', 'chars', 'scripts', 'no_letter', 'reserved'] as const;
    for (const p of problems) expect(nameProblemText(p), p).toBeTruthy();
    expect(new Set(problems.map(nameProblemText)).size).toBe(problems.length - 1); // type e length dizem o mesmo
  });
});

describe('traços', () => {
  it('2 ou 3, sem repetir e sem os pares que não combinam', () => {
    expect(traitsValid(['cafeina'])).toBe(false);
    expect(traitsValid(['cafeina', 'games'])).toBe(true);
    expect(traitsValid(['cafeina', 'games', 'leitura'])).toBe(true);
    expect(traitsValid(['cafeina', 'games', 'leitura', 'calma'])).toBe(false);
    expect(traitsValid(['cafeina', 'cafeina'])).toBe(false);
    expect(traitsValid(['timidez', 'piadas'])).toBe(false);
    expect(traitsValid(['inventado', 'games'])).toBe(false);
  });

  it('os cinco pares do contrato estão bloqueados nos dois sentidos', () => {
    const pairs = [['timidez', 'piadas'], ['timidez', 'fofoca'], ['apostas', 'economia'], ['esporte', 'sonecas'], ['calma', 'competicao']] as const;
    for (const [a, b] of pairs) {
      expect(traitBlock([a], b), `${a}×${b}`).toEqual({ reason: 'clash', with: a });
      expect(traitBlock([b], a), `${b}×${a}`).toEqual({ reason: 'clash', with: b });
    }
  });

  it('com 3 escolhidos, os outros ficam desabilitados; os escolhidos sempre dá para desmarcar', () => {
    const three = ['cafeina', 'games', 'leitura'] as const;
    expect(traitBlock(three, 'series')).toEqual({ reason: 'full' });
    expect(traitBlock(three, 'games')).toBeNull();
    expect(toggleTrait(three, 'series')).toEqual([...three]);
    expect(toggleTrait(three, 'games')).toEqual(['cafeina', 'leitura']);
    expect(toggleTrait(['timidez'], 'piadas')).toEqual(['timidez']);
  });

  it('os 14 traços do escritório', () => {
    expect(TRAIT_IDS).toHaveLength(14);
  });
});

describe('personagem', () => {
  it('manda as 13 peças (o jogador não tem semente)', () => {
    for (const look of ['f', 'm'] as const) {
      const parts = fullParts(draftAppearance(look));
      expect(Object.keys(parts)).toEqual([...PART_KEYS]);
      expect(Object.values(parts).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    }
  });

  it('as peças salvas voltam iguais ao editor', () => {
    const parts = fullParts(draftAppearance('m', undefined, 77));
    expect(fullParts(draftAppearance('m', parts))).toEqual(parts);
  });

  it('o primeiro problema: nome, depois traços, depois a frase', () => {
    expect(characterProblem({ name: 'x', traits: [], intro: null })).toEqual({ field: 'name', problem: 'length' });
    expect(characterProblem({ name: 'Pixel', traits: ['games'], intro: null })).toEqual({ field: 'traits' });
    expect(characterProblem({ name: 'Pixel', traits: ['games', 'cafeina'], intro: null })).toEqual({ field: 'intro' });
    expect(characterProblem({ name: 'Pixel', traits: ['games', 'cafeina'], intro: 'coffee' })).toBeNull();
  });
});

describe('erros', () => {
  it('todo código tem texto próprio (nenhum cai no genérico, menos os que não dizem nada)', () => {
    const generic = worldErrorText('qualquer-coisa', 'status');
    const vague = ['unknown', 'world_error'];
    for (const code of WORLD_UI_ERROR_CODES) {
      const text = worldErrorText(code, 'register');
      expect(text, code).toBeTruthy();
      if (!vague.includes(code)) expect(text, code).not.toBe(generic);
    }
  });

  it('os códigos extras do servidor do mundo têm texto', () => {
    expect(worldErrorText('device_limit', 'login')).toBe('Esta conta já tem 3 computadores; revogue um em Dispositivos.');
    expect(worldErrorText('name_cooldown', 'character')).toMatch(/30 dias/);
    expect(worldErrorText('no_player', 'visibility')).toMatch(/personagem/);
    expect(worldErrorText('unavailable', 'status')).toMatch(/manutenção/);
    expect(worldErrorText('internal', 'character')).toBe('O servidor do mundo teve um erro; tente de novo.');
    for (const c of ['invalid_json', 'too_large', 'unsupported_media_type', 'method_not_allowed']) expect(worldErrorText(c, 'login')).toMatch(/formato/);
  });

  it('"invalid" diz o que foi recusado, conforme a ação', () => {
    const texts = new Set((['register', 'character', 'visibility', 'revoke'] as const).map((a) => worldErrorText('invalid', a)));
    expect(texts.size).toBe(4);
  });
});

// ------------------------------------------------------------------ Fase 2: prédio no mundo

describe('cartão "Seu prédio"', () => {
  const NOW = 1_760_000_000_000;
  const live: WorldBuildingStatus = { connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: NOW - 12_000, lastAck: { ok: true } };

  it('estado: sem personagem, pausado (vale mais que a conexão), conectado ou reconectando', () => {
    expect(buildingState(live, false)).toBe('no_player');
    expect(buildingState({ ...live, paused: true }, true)).toBe('paused');
    expect(buildingState({ ...live, paused: true, connected: true }, true)).toBe('paused');
    expect(buildingState(live, true)).toBe('connected');
    expect(buildingState({ ...live, connected: false }, true)).toBe('reconnecting');
    expect(buildingState(undefined, true)).toBe('reconnecting');
  });

  it('conectado: contagens, última remessa e o botão Pausar com a explicação', () => {
    const v = buildingView(live, true, NOW);
    expect(v.label).toBe('Conectado');
    expect(v.stats).toEqual(['2 andares', '3 agentes', 'Última remessa: há 12 s']);
    expect(v.rejected).toBeNull();
    expect(v.toggle?.action).toBe('pause');
    expect(v.toggle?.text).toBe('Pausar');
    expect(v.toggle?.hint).toMatch(/^Pausar interrompe o envio na hora e apaga o prédio no mundo\. Pausado por 30 dias/);
  });

  it('sem conexão: "Conectando…" antes da primeira remessa, "Reconectando…" depois', () => {
    expect(buildingView({ ...live, connected: false, lastUplinkAt: undefined }, true, NOW)).toMatchObject({ label: 'Conectando…', stats: ['2 andares', '3 agentes', 'Nenhuma remessa ainda'] });
    expect(buildingView({ ...live, connected: false }, true, NOW).label).toBe('Reconectando…');
  });

  it('pausado: botão Retomar; sem personagem: nem contagens nem botões', () => {
    expect(buildingView({ ...live, paused: true, connected: false }, true, NOW).toggle).toMatchObject({ action: 'resume', text: 'Retomar' });
    expect(buildingView(live, false, NOW)).toMatchObject({ state: 'no_player', label: 'Sem personagem', stats: [], toggle: null, rejected: null });
  });

  it('singular e plural das contagens', () => {
    expect([floorsText(1), floorsText(0), agentsText(1), agentsText(1200)]).toEqual(['1 andar', '0 andares', '1 agente', '1.200 agentes']);
  });

  it('remessa recusada: o motivo traduzido aparece no cartão', () => {
    expect(buildingView({ ...live, lastAck: { ok: false, error: 'rate' } }, true, NOW).rejected).toBe(uplinkRejectText('rate'));
  });

  it('fora do mundo vale mais que tudo; pausado vale mais que a parada; a parada vale mais que a conexão', () => {
    expect(buildingState({ ...live, left: true, paused: true }, true)).toBe('left');
    expect(buildingState({ ...live, paused: true, stopped: 'update' }, true)).toBe('paused');
    expect(buildingState({ ...live, connected: false, stopped: 'update' }, true)).toBe('stopped');
    expect(buildingState({ ...live, left: true }, false)).toBe('no_player');
  });

  it('parado pelo servidor do mundo: cada motivo com o seu texto; "Atualize o Habblaud" e "Conectado em outro computador"', () => {
    const stopped = (reason: WorldBuildingStop) => buildingView({ ...live, connected: false, stopped: reason }, true, NOW);
    expect(stopped('update')).toMatchObject({ state: 'stopped', label: 'Atualize o Habblaud', toggle: null, leave: true, rejected: null });
    expect(stopped('other-device')).toMatchObject({ label: 'Conectado em outro computador', toggle: { action: 'resume', text: 'Trazer para este computador' }, leave: true });
    expect(stopped('suspended').toggle).toMatchObject({ action: 'resume', text: 'Tentar de novo' });
    expect(stopped('banned')).toMatchObject({ label: 'Conta banida', toggle: null, leave: false });
    for (const r of ['waiting', 'no_player', 'unauthorized'] as const) expect(stopped(r)).toMatchObject({ toggle: null, leave: false });
    const reasons: WorldBuildingStop[] = ['banned', 'suspended', 'update', 'other-device', 'waiting', 'no_player', 'unauthorized', 'deleted'];
    const descs = reasons.map((r) => buildingStopView(r).desc);
    expect(new Set(descs).size).toBe(reasons.length);
    // As contagens da última remessa continuam.
    expect(stopped('update').stats).toEqual(['2 andares', '3 agentes', 'Última remessa: há 12 s']);
  });

  it('fora do mundo: sem contagens, "Voltar ao mundo" e sem "Sair do mundo"; os outros estados com prédio mostram "Sair do mundo"', () => {
    expect(buildingView({ ...live, connected: false, paused: true, left: true }, true, NOW)).toMatchObject({
      state: 'left',
      label: 'Fora do mundo',
      stats: [],
      toggle: { action: 'join', text: 'Voltar ao mundo' },
      leave: false,
    });
    expect(buildingView(live, true, NOW).leave).toBe(true);
    expect(buildingView({ ...live, connected: false }, true, NOW).leave).toBe(true);
    expect(buildingView({ ...live, paused: true }, true, NOW).leave).toBe(true);
    expect(buildingView(live, false, NOW).leave).toBe(false);
    // A explicação diz a diferença entre pausar e sair (PLANO.md, 2.6).
    expect(leaveHint()).toMatch(/^Pausar apaga o prédio e guarda o lote.*Sair do mundo retira o prédio na hora e libera o lote/);
  });
});

describe('motivos de recusa de uma remessa', () => {
  it('cada motivo tem o seu texto; um código desconhecido leva o genérico', () => {
    const generic = uplinkRejectText('nao_existe');
    expect(uplinkRejectText(undefined)).toBe(generic);
    expect(uplinkRejectText('unknown')).toBe(generic);
    const texts = UPLINK_REJECT_CODES.map((c) => uplinkRejectText(c));
    expect(new Set([...texts, generic]).size).toBe(UPLINK_REJECT_CODES.length + 1);
    expect(UPLINK_REJECT_CODES).toEqual(['schema', 'limits', 'name_pool', 'parts', 'ids', 'rate', 'internal', 'left', 'implausible']);
  });

  it('janela "Ver o que foi enviado": aceita, recusada com motivo ou sem resposta', () => {
    expect(ackView({ ok: true, at: 1 })).toEqual({ kind: 'accepted', label: 'Aceita pelo mundo.', reason: null });
    // Com os bytes que o mundo contou: iguais aos enviados, ou o número dele.
    expect(ackView({ ok: true, at: 1, bytes: 1174 }, 1174).reason).toBe('O mundo recebeu os mesmos 1.174 bytes.');
    expect(ackView({ ok: true, at: 1, bytes: 1 }, 2).reason).toBe('O mundo contou 1 byte.');
    expect(bytesText(0)).toBe('0 bytes');
    expect(ackView({ ok: false, error: 'name_pool', at: 1 })).toEqual({ kind: 'rejected', label: 'Recusada pelo mundo.', reason: uplinkRejectText('name_pool') });
    expect(ackView(undefined).kind).toBe('pending');
  });

  it('o JSON da janela é o mesmo objeto, com recuo de 2 espaços', () => {
    const text = prettyUplink(FAKE_UPLINK);
    expect(JSON.parse(text)).toEqual(FAKE_UPLINK);
    expect(text.split('\n')[1]).toBe('  "v": 1,');
  });
});

describe('tema e chip do topo', () => {
  const building = { connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: 1 };

  it('o tema vai para o prédio só com a conta aprovada e a página que mexe na conta', () => {
    expect(themeGoesToWorld(meta('approved'), LOCAL)).toBe(true);
    expect(themeGoesToWorld(meta('waiting'), LOCAL)).toBe(false);
    expect(themeGoesToWorld(meta('approved', { enabled: false }), LOCAL)).toBe(false);
    expect(themeGoesToWorld(meta('approved'), { ...LOCAL, terminal: false })).toBe(false);
    expect(themeGoesToWorld(meta('approved'), { ...LOCAL, remote: true })).toBe(false);
    expect(themeGoesToWorld(meta('approved'), { remote: false, local: false, terminal: false, fake: true })).toBe(true);
    expect(themeGoesToWorld(undefined, LOCAL)).toBe(false);
  });

  it('chip: só com o prédio; pausado, no mundo ou reconectando; nunca pela porta do celular', () => {
    expect(worldChipState(meta('approved'), LOCAL)).toBeNull();
    expect(worldChipState(meta('approved', { building }), LOCAL)).toBe('live');
    expect(worldChipState(meta('approved', { building: { ...building, paused: true, connected: false } }), LOCAL)).toBe('paused');
    expect(worldChipState(meta('approved', { building: { ...building, connected: false } }), LOCAL)).toBe('reconnecting');
    // Parado pelo servidor do mundo: "parado" (o motivo fica no cartão); fora do mundo: nada.
    expect(worldChipState(meta('approved', { building: { ...building, connected: false, stopped: true } }), LOCAL)).toBe('stopped');
    expect(worldChipState(meta('approved', { building: { ...building, connected: false, paused: true, left: true } }), LOCAL)).toBeNull();
    // Sem conexão e sem remessa nenhuma, o prédio ainda não está no mundo.
    expect(worldChipState(meta('approved', { building: { ...building, connected: false, lastUplinkAt: undefined } }), LOCAL)).toBeNull();
    expect(worldChipState(meta('approved', { building }), { ...LOCAL, remote: true })).toBeNull();
    expect(worldChipState(meta('waiting', { building }), LOCAL)).toBeNull();
    // Aberto por outro endereço (sem a trava), o chip informa; a seção explica que a conta só mexe pelo computador.
    expect(worldChipState(meta('approved', { building }), { ...LOCAL, local: false })).toBe('live');
  });
});

describe('visitantes no seu prédio (Fase 4)', () => {
  it('o cartão "Seu prédio" mostra "N visitantes agora" só com alguém lá dentro', () => {
    const b: WorldBuildingStatus = { connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: 1 };
    expect(buildingView({ ...b, visitors: 3 }, true, 2).stats).toContain('👀 3 visitantes agora');
    expect(buildingView({ ...b, visitors: 1 }, true, 2).stats).toContain('👀 1 visitante agora');
    expect(buildingView({ ...b, visitors: 0 }, true, 2).stats.some((t) => t.includes('visitante'))).toBe(false);
    expect(buildingView(b, true, 2).stats.some((t) => t.includes('visitante'))).toBe(false);
  });

  it('o aviso: uma vez por conexão, quando passa de nenhum a algum; a primeira contagem da página não avisa; desligado, nunca', () => {
    let s = VISITOR_ALERT_START;
    const step = (v: number | undefined, enabled = true) => {
      const r = nextVisitorAlert(s, v, enabled);
      s = r.state;
      return r.notify;
    };
    // a página abriu com gente lá dentro: sem aviso
    expect(step(2)).toBe(false);
    expect(step(0)).toBe(false);
    // o primeiro desta conexão já foi (estava lá ao abrir): o próximo não avisa
    expect(step(1)).toBe(false);
    // a conexão caiu e voltou: rearma
    expect(step(undefined)).toBe(false);
    expect(step(0)).toBe(false);
    expect(step(1)).toBe(true);
    expect(step(2)).toBe(false);
    expect(step(0)).toBe(false);
    expect(step(1)).toBe(false);
    // desligado em Configurações
    s = VISITOR_ALERT_START;
    expect(step(0, false)).toBe(false);
    expect(step(1, false)).toBe(false);
    // página aberta sem ninguém, depois alguém entra
    s = VISITOR_ALERT_START;
    expect(step(undefined)).toBe(false);
    expect(step(0)).toBe(false);
    expect(step(3)).toBe(true);
  });
});

describe('conta e dados (Fase 6)', () => {
  const NOW = 1_760_000_000_000;
  const live: WorldBuildingStatus = { connected: true, paused: false, floors: 2, agents: 3, lastUplinkAt: NOW - 12_000, lastAck: { ok: true } };

  it('"Conta e dados" é uma tela de quem tem conta', () => {
    expect(screensFor('approved')).toContain('account');
    expect(screensFor('waiting')).toContain('account');
    expect(screensFor('logged_out')).not.toContain('account');
  });

  it('recurso por e-mail: mailto com o assunto fixo e o id da conta quando se sabe (só um id limpo)', () => {
    expect(APPEAL_EMAIL).toBe('privacidade@habblaud.com');
    expect(appealMailto()).toBe('mailto:privacidade@habblaud.com?subject=Recurso%20Habblaud%20World');
    expect(appealMailto('acc_1')).toBe('mailto:privacidade@habblaud.com?subject=Recurso%20Habblaud%20World%20acc_1');
    expect(appealMailto('x&cc=a@b.co')).toBe(appealMailto());
  });

  it('conta suspensa ou banida: "Recorrer por e-mail"; as outras paradas, não', () => {
    const stopped = (reason: WorldBuildingStop) => buildingView({ ...live, connected: false, stopped: reason }, true, NOW);
    for (const r of ['banned', 'suspended'] as const) expect(stopped(r).appeal).toMatchObject({ text: 'Recorrer por e-mail', hint: expect.stringContaining(APPEAL_EMAIL) });
    for (const r of ['update', 'other-device', 'waiting', 'no_player', 'unauthorized', 'deleted'] as const) expect(stopped(r).appeal, r).toBeNull();
    expect(stopped('deleted')).toMatchObject({ label: 'Conta excluída', toggle: null, leave: false });
    expect(buildingView(live, true, NOW)).toMatchObject({ appeal: null, unverified: null });
  });

  it('não verificado: o selo com "Contestar por e-mail" enquanto o prédio está no mundo; o rótulo da cidade', () => {
    const v = buildingView({ ...live, unverified: true }, true, NOW);
    expect(v.unverified).toMatch(/não verificado/);
    expect(v.appeal).toMatchObject({ text: 'Contestar por e-mail' });
    expect(buildingView({ ...live, unverified: true, paused: true }, true, NOW).appeal?.text).toBe('Contestar por e-mail');
    expect(buildingView({ ...live, unverified: true, left: true }, true, NOW)).toMatchObject({ unverified: null, appeal: null });
    // Suspensa vale mais que o selo: o recurso é da suspensão.
    expect(buildingView({ ...live, connected: false, unverified: true, stopped: 'suspended' }, true, NOW)).toMatchObject({ unverified: null, appeal: { text: 'Recorrer por e-mail' } });
    expect(unverifiedLabel()).toBe('Não verificado');
    expect(unverifiedHint()).toMatch(/revisão/);
  });

  it('manutenção: sem conexão, o cartão diz que o mundo está em manutenção; conectado, não', () => {
    const down = { ...live, connected: false };
    expect(buildingView(down, true, NOW, { maintenance: true })).toMatchObject({ state: 'reconnecting', label: 'Em manutenção', desc: 'O mundo está em manutenção; tentamos de novo em instantes.' });
    expect(buildingView(down, true, NOW).label).toBe('Reconectando…');
    expect(buildingView(live, true, NOW, { maintenance: true }).label).toBe('Conectado');
    expect(worldErrorText('maintenance', 'status')).toBe('O mundo está em manutenção; tentamos de novo em instantes.');
  });

  it('textos: exportar uma vez por dia, conta excluída, aviso de inatividade ligado por padrão', () => {
    expect(worldErrorText('rate_limited', 'export')).toMatch(/uma vez por dia/);
    expect(worldErrorText('rate_limited', 'login')).toMatch(/alguns minutos/);
    expect(worldErrorText('account_deleted', 'status')).toMatch(/7 dias.*30/);
    expect(worldErrorText('invalid', 'inactivity')).toBe(worldErrorText('invalid', 'visibility'));
    expect(notifyInactivityOn(undefined)).toBe(true);
    expect(notifyInactivityOn({})).toBe(true);
    expect(notifyInactivityOn({ notifyInactivity: false })).toBe(false);
    expect(EXPORT_FILENAME).toBe('habblaud-world-dados.json');
  });
});
