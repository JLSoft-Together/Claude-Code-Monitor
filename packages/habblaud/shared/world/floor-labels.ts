// Rótulos traduzidos dos nomes fictícios de projeto (shared/world/floor-names.ts): cada andar de um prédio no mundo
// ganha um id da lista, sorteado pelo servidor a partir do id aleatório do andar, e quem visita vê "Projeto Ipê"
// ("Project Ipê", "Proyecto Ipê", "Projet Ipê"). O rótulo muda junto com o id do andar (24 h ± 6 h).
import { tr } from '../i18n';
import { FLOOR_NAME_IDS, type FloorNameId } from './floor-names';

const LABELS: Record<FloorNameId, () => string> = {
  // Árvores
  ipe: () => tr('Projeto Ipê'),
  jacaranda: () => tr('Projeto Jacarandá'),
  jatoba: () => tr('Projeto Jatobá'),
  peroba: () => tr('Projeto Peroba'),
  cedro: () => tr('Projeto Cedro'),
  aroeira: () => tr('Projeto Aroeira'),
  araucaria: () => tr('Projeto Araucária'),
  buriti: () => tr('Projeto Buriti'),
  carnauba: () => tr('Projeto Carnaúba'),
  figueira: () => tr('Projeto Figueira'),
  oliveira: () => tr('Projeto Oliveira'),
  carvalho: () => tr('Projeto Carvalho'),
  salgueiro: () => tr('Projeto Salgueiro'),
  sequoia: () => tr('Projeto Sequoia'),
  baoba: () => tr('Projeto Baobá'),
  acacia: () => tr('Projeto Acácia'),
  magnolia: () => tr('Projeto Magnólia'),
  cerejeira: () => tr('Projeto Cerejeira'),
  pinheiro: () => tr('Projeto Pinheiro'),
  palmeira: () => tr('Projeto Palmeira'),
  // Pedras
  jade: () => tr('Projeto Jade'),
  ambar: () => tr('Projeto Âmbar'),
  ametista: () => tr('Projeto Ametista'),
  quartzo: () => tr('Projeto Quartzo'),
  topazio: () => tr('Projeto Topázio'),
  turmalina: () => tr('Projeto Turmalina'),
  agata: () => tr('Projeto Ágata'),
  onix: () => tr('Projeto Ônix'),
  opala: () => tr('Projeto Opala'),
  safira: () => tr('Projeto Safira'),
  rubi: () => tr('Projeto Rubi'),
  esmeralda: () => tr('Projeto Esmeralda'),
  granada: () => tr('Projeto Granada'),
  jaspe: () => tr('Projeto Jaspe'),
  malaquita: () => tr('Projeto Malaquita'),
  obsidiana: () => tr('Projeto Obsidiana'),
  turquesa: () => tr('Projeto Turquesa'),
  citrino: () => tr('Projeto Citrino'),
  peridoto: () => tr('Projeto Peridoto'),
  lapislazuli: () => tr('Projeto Lápis-lazúli'),
  // Constelações (e a aurora)
  aurora: () => tr('Projeto Aurora'),
  orion: () => tr('Projeto Órion'),
  lyra: () => tr('Projeto Lira'),
  cygnus: () => tr('Projeto Cisne'),
  draco: () => tr('Projeto Dragão'),
  andromeda: () => tr('Projeto Andrômeda'),
  cassiopeia: () => tr('Projeto Cassiopeia'),
  perseus: () => tr('Projeto Perseu'),
  phoenix: () => tr('Projeto Fênix'),
  hydra: () => tr('Projeto Hidra'),
  aquila: () => tr('Projeto Águia'),
  carina: () => tr('Projeto Quilha'),
  vela: () => tr('Projeto Vela'),
  centaurus: () => tr('Projeto Centauro'),
  crux: () => tr('Projeto Cruzeiro do Sul'),
  pavo: () => tr('Projeto Pavão'),
  columba: () => tr('Projeto Pomba'),
  auriga: () => tr('Projeto Cocheiro'),
  lupus: () => tr('Projeto Lobo'),
  tucana: () => tr('Projeto Tucano'),
};

export function isFloorNameId(v: unknown): v is FloorNameId {
  return typeof v === 'string' && (FLOOR_NAME_IDS as readonly string[]).includes(v);
}

/** "Projeto Ipê" no idioma atual; um id que esta versão não conhece vira só "Projeto". */
export function floorLabel(id: string): string {
  return isFloorNameId(id) ? LABELS[id]() : tr('Projeto');
}
