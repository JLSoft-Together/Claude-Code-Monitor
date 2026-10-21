// Nomes fictícios de projeto do Habblaud World (PLANO.md, seções 4.3 e 6.2): cada andar de um prédio ganha um id
// desta lista ("ipe", "jade", "aurora"...), sorteado pelo servidor a partir do id aleatório do andar, e o
// navegador de quem visita traduz ("Projeto Ipê", "Project Ipê", "Proyecto Ipê", "Projet Ipê"). O rótulo muda
// junto com o id do andar (rotação de 24 h ± 6 h), então não identifica projeto nenhum.
//
// Só ids ASCII, neutros e sem marca: 20 árvores, 20 pedras e 20 constelações (e a aurora). A ordem entra no
// sorteio (índice = hash do id do andar): não reordene nem tire itens; acrescentar no fim só muda o sorteio dos
// andares novos depois da próxima rotação.
//
// Arquivo autossuficiente (sem imports), para ser copiado igual entre os dois repositórios. A fonte é o público
// (shared/world/floor-names.ts, com os rótulos traduzidos por tr() em shared/world/floor-labels.ts); o servidor do
// mundo guarda a cópia exata (protocol/floor-names.ts, com o hash conferido em teste).

export const FLOOR_NAME_IDS = [
  // Árvores
  'ipe', 'jacaranda', 'jatoba', 'peroba', 'cedro', 'aroeira', 'araucaria', 'buriti', 'carnauba', 'figueira',
  'oliveira', 'carvalho', 'salgueiro', 'sequoia', 'baoba', 'acacia', 'magnolia', 'cerejeira', 'pinheiro', 'palmeira',
  // Pedras
  'jade', 'ambar', 'ametista', 'quartzo', 'topazio', 'turmalina', 'agata', 'onix', 'opala', 'safira',
  'rubi', 'esmeralda', 'granada', 'jaspe', 'malaquita', 'obsidiana', 'turquesa', 'citrino', 'peridoto', 'lapislazuli',
  // Constelações (e a aurora)
  'aurora', 'orion', 'lyra', 'cygnus', 'draco', 'andromeda', 'cassiopeia', 'perseus', 'phoenix', 'hydra',
  'aquila', 'carina', 'vela', 'centaurus', 'crux', 'pavo', 'columba', 'auriga', 'lupus', 'tucana',
] as const;

export type FloorNameId = (typeof FLOOR_NAME_IDS)[number];
