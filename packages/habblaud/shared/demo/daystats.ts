// Histórico fictício do "Meu dia" para o modo demonstração. Puro (sem Node/DOM): o servidor usa no balde do
// demo e o navegador no ?mock=1. Preenche de ontem (desde a meia-noite) até agora com dias de trabalho plausíveis
// (manhã e tarde movimentadas, almoço mais calmo, noite quase parada) nos projetos e contas do próprio demo, para o
// painel ter o que mostrar assim que o demo liga. Determinístico pela semente; nada aqui vem de dados reais.
// Salas da conta do Codex só somam tokens (o Codex não grava custo).
import { addDays, dayKeyOf, dayStart, HOUR_MS, hourStart, localHourOf, type AgentRef, type StatsBook, type StatsView, type TimedStatus } from '../daystats';
import { hash32, mulberry32 } from '../hash';
import { pickName } from '../names';
import { DEMO_PROJECT_NAMES } from './simulator';
import { tr } from '../i18n';

/** Intensidade do trabalho por hora local (0 = parado, 1 = pico). */
const PROFILE = [0.03, 0.01, 0, 0, 0, 0, 0.02, 0.1, 0.4, 0.75, 0.95, 0.85, 0.4, 0.55, 0.9, 1, 0.95, 0.8, 0.55, 0.35, 0.3, 0.25, 0.15, 0.06];

const REASONS = [tr('aprovar uma permissão'), tr('responder uma pergunta'), tr('escolher uma opção'), tr('aprovar o plano')];

interface FakeRoom {
  id: string;
  name: string;
  account: string;
  accountMeta?: { name: string; short: string; color: string };
  /** Sala da conta do Codex: tokens, sem custo. */
  codex: boolean;
  /** Peso do movimento da sala e o quanto ela costuma esperar por você. */
  weight: number;
  waitiness: number;
  people: string[];
}

/**
 * Semeia `book` com horas fictícias de ontem 00:00 (no fuso `tz`) até `now`, para os projetos do demo (os de
 * `view` e os demais da lista do simulador) e as contas de `view.accounts` (passe só as do demo).
 * `tz` decide o "horário comercial" do perfil (o fuso do servidor, ou o do navegador no ?mock=1).
 */
export function seedDemoHistory(book: StatsBook, view: StatsView, now: number, tz: string, seed = hash32(`meu-dia:${hourStart(now)}`)): void {
  const rng = mulberry32(seed);
  const between = (a: number, b: number) => a + rng() * (b - a);
  const accounts = view.accounts.map((a) => ({ id: a.id, codex: 'provider' in a && a.provider === 'codex', meta: { name: a.name, short: a.short, color: a.color } }));
  // Os outros projetos: metade na primeira conta do Claude Code, 30% na última e 20% na do Codex (quando há).
  const claude = accounts.filter((a) => !a.codex);
  const codex = accounts.find((a) => a.codex);
  const accountFor = (r: number) => (codex && claude.length ? (r < 0.5 ? claude[0] : r < 0.8 ? claude[claude.length - 1] : codex) : accounts[r < 0.6 ? 0 : accounts.length - 1]);
  const roomNames = new Map(view.rooms.map((r) => [r.id, r.name]));
  const usedNames = new Set(view.agents.map((a) => a.name));

  // Salas com agentes agora (na conta mais comum entre eles) e, ao lado delas, os outros projetos do demo.
  const byRoom = new Map<string, Map<string, number>>();
  for (const a of view.agents) {
    const accs = byRoom.get(a.roomId) ?? new Map<string, number>();
    accs.set(a.account, (accs.get(a.account) ?? 0) + 1);
    byRoom.set(a.roomId, accs);
  }
  const first = [...byRoom.keys()][0];
  if (!first || !accounts.length) return;
  const base = first.slice(0, first.lastIndexOf('/'));
  const extra: string[] = [];
  for (const name of DEMO_PROJECT_NAMES) {
    const id = `${base}/${name}`;
    if (byRoom.has(id)) continue;
    byRoom.set(id, new Map([[accountFor(rng()).id, 1]]));
    extra.push(id);
  }
  // O Codex sempre tem algum projeto no histórico (o painel mostra os tokens dele, sem custo).
  const extraCodex = extra.some((id) => byRoom.get(id)!.has(codex?.id ?? ''));
  if (codex && extra.length && !extraCodex) byRoom.set(extra[extra.length - 1], new Map([[codex.id, 1]]));
  const rooms: FakeRoom[] = [...byRoom].map(([id, accs]) => {
    const account = [...accs].sort((x, y) => y[1] - x[1])[0]?.[0] ?? accounts[0].id;
    const people = [0, 1, 2].map((k) => {
      const p = pickName(`${id}:${k}:${seed}`, usedNames);
      usedNames.add(p.name);
      return p.name;
    });
    const room: FakeRoom = {
      id,
      name: roomNames.get(id) ?? id.split('/').pop() ?? id,
      account,
      codex: !!accounts.find((a) => a.id === account)?.codex,
      weight: between(0.35, 1.1),
      waitiness: between(0.05, 0.3),
      people,
    };
    const meta = accounts.find((a) => a.id === account)?.meta;
    if (meta) room.accountMeta = meta;
    return room;
  });

  const current = hourStart(now);
  const from = hourStart(dayStart(addDays(dayKeyOf(now, tz), -1), tz));
  for (let hs = from; hs <= current; hs += HOUR_MS) {
    const span = Math.min(HOUR_MS, now - hs);
    if (span <= 0) continue;
    const frac = span / HOUR_MS;
    const base = PROFILE[localHourOf(hs, tz)] ?? 0;
    let wall = 0;
    rooms.forEach((room, ri) => {
      const level = base * room.weight * between(0.7, 1.3);
      if (level < 0.04) return;
      const mains = level > 0.6 ? 2 : 1;
      const ref = (key: string): AgentRef => {
        const r: AgentRef = { key, room: room.id, roomName: room.name, account: room.account };
        if (room.accountMeta) r.accountMeta = room.accountMeta;
        return r;
      };
      const mainRefs = Array.from({ length: mains }, (_, k) => ref(`m:demo-dia-${ri}-${k}`));
      const working = Math.min(0.92, level * between(0.55, 0.85)) * HOUR_MS * frac;
      const waiting = working * room.waitiness * between(0.5, 1.4);
      const shell = working * between(0, 0.12);
      const idle = Math.max(0, mains * HOUR_MS * frac * 0.9 - working - waiting - shell) * between(0.3, 0.7);
      const parts: Array<[TimedStatus, number]> = [
        ['working', working],
        ['waiting', waiting],
        ['shell', shell],
        ['idle', idle],
      ];
      for (const [status, ms] of parts) for (const r of mainRefs) book.addMsAt(r, status, hs, ms / mains, Math.min(now, hs + span));
      // Subagentes: um pouco de trabalho extra, em horas movimentadas.
      const subs = Math.round(level * between(0, 2.2));
      for (let j = 0; j < subs; j++) book.addMsAt(ref(`s:demo-dia-${ri}-${hs}-${j}`), 'working', hs, working * between(0.15, 0.45), Math.min(now, hs + span));

      const workMin = working / 60_000;
      const at = hs + span / 2;
      const r0 = mainRefs[0];
      book.addCount(r0, 'prompts', Math.round((workMin / 7) * between(0.6, 1.4)), at);
      book.addCount(r0, 'toolCalls', Math.round(workMin * between(1.5, 3)), at);
      book.addCount(r0, 'tasksDone', Math.round((workMin / 12) * between(0.4, 1.2)), at);
      const tokensIn = Math.round(workMin * between(90_000, 160_000));
      const tokensOut = Math.round(workMin * between(1_000, 2_200));
      book.addCount(r0, 'tokensIn', tokensIn, at);
      book.addCount(r0, 'tokensOut', tokensOut, at);
      if (!room.codex) book.addCount(r0, 'costUSD', Math.round((tokensIn * 0.3e-6 + tokensOut * 15e-6) * 10_000) / 10_000, at);

      // As esperas da hora viram 1 a 3 episódios de quem estava na sala.
      if (waiting >= 30_000) {
        const n = 1 + Math.floor(rng() * Math.min(3, waiting / 60_000));
        let left = waiting;
        for (let k = 0; k < n && left >= 5_000; k++) {
          const dur = k === n - 1 ? left : left * between(0.3, 0.7);
          left -= dur;
          const start = hs + rng() * Math.max(0, span - dur);
          const who = room.people[Math.floor(rng() * room.people.length)];
          // O Codex só espera para aprovar (o sorteio acontece igual, para não mudar o resto).
          const reason = REASONS[Math.floor(rng() * REASONS.length)];
          book.addWait({
            agentId: `demo-dia:${ri}:${who}`,
            agentName: who,
            roomId: room.id,
            account: room.account,
            start: Math.round(start),
            end: Math.round(start + dur),
            reason: room.codex ? tr('aprovar um comando') : reason,
          });
        }
        wall += waiting * between(0.75, 0.95);
      }
    });
    book.addWaitWallAt(hs, Math.min(wall, span), Math.min(now, hs + span));
  }
}
