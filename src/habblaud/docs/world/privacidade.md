# Habblaud World: o que sai do seu computador

O Habblaud World é uma cidade online onde cada Habblaud vira um prédio: quem passa na rua vê, ao vivo, quantos projetos
e agentes você está rodando e o que cada personagem está fazendo. A regra que guia tudo aqui:

> **Com os dados que saem não dá para saber quem você é nem em que trabalha.**

**Situação hoje:** o World está no ar e vem **ligado por padrão**, apontando para `server.habblaud.com` (ou a
`HABBLAUD_WORLD_URL` que você definir; veja o README). **Nada sai do computador antes de você criar a conta e entrar**;
`HABBLAUD_WORLD=0` desliga tudo. Esta página é a lista completa do que pode sair; qualquer mudança nela entra no código
e nesta página no mesmo pull request.

## O que sai: a conta e o personagem

Ao usar o World, sai do computador, por HTTPS, para o servidor do mundo:

| Sai | Quando | Por quê |
| --- | --- | --- |
| E-mail e senha | No cadastro, ao entrar e ao trocar a senha | Para a conta existir. A senha não fica gravada no computador; no servidor, só um hash (Argon2id) |
| Nome de jogador (nickname) | No cadastro | É o nome do seu personagem (3 a 20 caracteres, único no mundo, sem diferença de maiúsculas ou acentos): fica reservado para você enquanto a conta espera na lista, e o personagem nasce com ele |
| Código de 6 dígitos | Ao confirmar o e-mail ou trocar a senha | Provar que o e-mail é seu |
| Idioma da interface (`pt-BR`, `en`, `es` ou `fr`) | No cadastro | Para os e-mails virem no seu idioma |
| Aceite dos Termos de Uso (só a versão, `v1`) e o código de convite, se você tiver um | No cadastro | Registrar o aceite; o convite põe a conta no próximo lote da lista de espera |
| Solução do desafio anti-robô (ALTCHA) | No cadastro, nos pedidos de e-mail e, se o servidor pedir, ao entrar | É só um número calculado pelo seu Habblaud, no lugar de um captcha |
| Personagem: aparência (cores e estilos), 2 ou 3 traços, a frase de apresentação e, ao trocá-lo, o nome de jogador (ao criar, o nome é o reservado no cadastro: nem vai no pedido) | Ao salvar o personagem | É o que os outros jogadores vão ver |
| Preferências de visibilidade (ao vivo ou discreto, fechado a visitas, esconder o país, mostrar tokens, placar, compactações) e o aviso por e-mail antes de retirar o prédio por inatividade | Ao salvar | Para o mundo respeitar a sua escolha |
| Token do dispositivo | Em cada chamada da conta | Provar que é você, sem mandar a senha de novo |
| Qual dispositivo desconectar | Ao desconectar um | Só o id que o próprio servidor deu ao dispositivo |
| Pausar e retomar o prédio | Ao clicar em Pausar ou Retomar (`POST /v1/me/building/pause` e `/resume`, só com o token) | Para o prédio apagar na hora para todos e voltar quando você quiser |
| Sair do mundo | Ao confirmar "Sair do mundo" (`DELETE /v1/me/building`, só com o token) | Para o prédio sair do mundo na hora e o lote ficar livre; a conta e o personagem continuam |
| Voltar ao mundo | Ao clicar em "Voltar ao mundo" depois de sair (`POST /v1/me/building/join`, só com o token) | Para o servidor aceitar o prédio de novo (um prédio novo, em outro lote) |
| Excluir a conta | Ao pedir a exclusão e ao digitar o código que chegou por e-mail (`POST /v1/me/delete` e `/v1/me/delete/confirm`, com o token e o código) | Para o servidor apagar a conta: o prédio e o perfil somem do mundo na hora; a conta, os likes, os bloqueios, as denúncias feitas e os dispositivos saem do banco em 7 dias e dos backups em até 30. Aqui, o `world.json` é apagado |
| Baixar meus dados | Ao clicar em "Baixar meus dados" (`GET /v1/me/export`, só com o token; uma vez por dia) | O servidor devolve, num arquivo JSON, o que guarda da sua conta (inclusive o nome reservado, o país e os IPs do cadastro e do último login); nada novo sai do computador |
| Versão do Habblaud | Em toda chamada, no cabeçalho `User-Agent` (`Habblaud/1.0.0`) | Compatibilidade e diagnóstico |

Enquanto a conta está na lista de espera, o Habblaud aberto pergunta ao servidor do mundo, a cada 30 minutos, se o
acesso já foi liberado (`GET /v1/me`, só com o token do dispositivo, sem mais nada). Liberado ou fora da conta, para.

O servidor do mundo vê o IP da conexão (como qualquer site). Dele, guarda o **país** (que dá para esconder) e, em claro,
**dois endereços só**: o IP do cadastro e o IP do último login com senha, para auditoria e prevenção de fraudes. Só a
equipe de administração vê esses IPs; eles saem no "Baixar meus dados" (`signupIp`, `lastLoginIp` e `lastLoginAt`) e
são apagados com a conta. O resumo diário por IP que limita tentativas (cadastro, entrada, códigos) continua como era.
Nenhum outro IP é guardado: nem o da conexão do prédio, nem o dos passeios pela cidade.

## O que sai: o prédio (a lista fechada)

Com a conta liberada e o personagem criado, o seu Habblaud abre uma conexão (WebSocket, por TLS) com o servidor do
mundo e o seu prédio entra na cidade. Pela conexão sai **só** isto:

| Sai | Como | Por quê |
| --- | --- | --- |
| Primeira mensagem da conexão (`hello`) | O `token` do dispositivo, a `version` do Habblaud, o `build` (`commit` do código em uso e `dirty`, a marca de "cópia modificada") e o `locale` da interface (`pt-BR`, `en`, `es` ou `fr`) | Autenticar, saber se é uma versão oficial e mandar os avisos no seu idioma. O token vai só aqui, nunca na URL; o idioma não vai no pacote do prédio. Nunca o caminho da pasta nem nada da máquina |
| O pacote do prédio | Ao conectar e, depois, quando o escritório muda: no máximo um a cada 5 segundos, e nada se o pacote não mudou | É o prédio ao vivo |
| Sinal de vida (`ping`, e o `pong` quando o servidor pergunta) | A cada 30 segundos, sem conteúdo | Para o prédio ficar aceso enquanto o Habblaud está aberto (pausado ou fora do mundo, não acende nada: só mantém a conexão da cena Mundo) |
| Cena Mundo aberta ou fechada (`view` e `view.off`) | Ao abrir e ao fechar a cidade no navegador, sem conteúdo | Para o servidor mandar o pedaço da cidade em volta do seu personagem só enquanto você olha; com a cena fechada, nada desce |
| Os passos do seu personagem (`move`) | Enquanto você anda na cidade (no máximo 5 por segundo): a posição na cidade (`x`, `y`, em tiles), a direção (`dir`: `n`, `s`, `e` ou `w`) e se está andando (`moving`) | É o seu personagem na rua; a posição é na cidade do mundo, nunca nada do escritório. Com a aba em segundo plano, um passo parado a cada 30 s |
| Pedido de área de novo (`resync`) | Quando chega uma mudança de prédio fora de ordem: só o id do pedaço da cidade (`chunk`) ou, dentro de um prédio que você visita, o id desse prédio (`building`) | Para o seu Habblaud mostrar os prédios certos |
| Pedido de perfil (`profile`) | Ao clicar em alguém na rua: só o id (`playerId`) que o próprio mundo deu a essa pessoa | Para mostrar o cartão de quem está perto |
| Entrar e sair de um prédio (`enter` e `leave`) | Ao apertar E na porta (ou em "Ver como os outros veem") e ao sair: só o id do prédio que o mundo deu (`buildingId`). Lá dentro, nenhum passo sai: o seu personagem anda só na sua tela | Para ver o interior do prédio de alguém (salas com nomes fictícios e os agentes no status de agora, sem terminal, mensagens, pedidos de permissão nem nada que age) |
| O social leve, quando você aperta (`like`/`unlike`, `greet`, `block`/`unblock`, `report`, `stamp`, `knock`, `teleport`, `summary.seen`) | Só ids e itens de lista: o prédio (`buildingId`) ou a pessoa (`playerId`) que o mundo deu, o cumprimento (`greetingId`), o carimbo (`stampId`) e o motivo da denúncia (`reason`) das listas fixas, e o código do prédio ("HB-XXXX", como você digitou) no "Ir para". Nenhum texto livre | Curtir, cumprimentar, bloquear, denunciar, deixar um carimbo, bater na porta, ir até um prédio e dizer que viu o "Enquanto você estava fora" |

O pacote do prédio tem estes campos e mais nenhum (o formato exato está em
[`shared/world/schema.json`](../../shared/world/schema.json); um teste confere que cada campo dele está nesta página):

| Campo | O que é | Por quê |
| --- | --- | --- |
| `v` | Versão do formato do pacote (`1`) | Compatibilidade |
| `version` | Versão do Habblaud (`1.0.0`) | Compatibilidade do protocolo |
| `theme` | `none`, `halloween` ou `christmas`, já resolvido: o "Automático" vira o tema do calendário (Halloween em outubro, Natal de 1º de novembro a 26 de dezembro), pela data do computador (no Docker, UTC) | O prédio e o interior com o seu tema |
| `floors` | Um andar por sala com alguém presente, em ordem embaralhada | Altura do prédio e as salas do interior |
| `id` (do andar) | Um id aleatório por sala (`f_` e 10 caracteres), que não vem do caminho da pasta, **troca a cada 24 h** (com sorteio de ±6 h) e troca também quando a sala some e volta ou quando o Habblaud reinicia. Sem horário nenhum | Quem visita hoje e amanhã não sabe se é o mesmo projeto |
| `agents` (do andar) | Um por agente principal ou subagente trabalhando, esperando, à toa ou de olho num shell | O personagem fazendo a coisa certa na mesa certa |
| `id` (do agente) | Id aleatório (`a_` e 8 caracteres), com as mesmas trocas do id do andar | Saber quem é quem no pacote |
| `kind` e `parentId` | Principal (`main`) ou subagente (`sub`) e, no subagente, o id **do mundo** do agente que o chamou (ausente se esse agente já saiu) | O subagente perto de quem o chamou |
| `provider` | `claude` ou `codex` | O visual da ferramenta |
| `status` | `working`, `waiting`, `idle` ou `shell`. **Sem** "desde quando" | O que o personagem está fazendo |
| `look` | A dica visual do personagem (`f` ou `m`) | O corpo e o nome combinarem |
| `name` | Um nome sorteado da lista de nomes do Habblaud a partir do id aleatório do mundo (nunca o nome do escritório, editado ou não) | O personagem ter um nome |
| `parts` | As cores e os estilos da aparência (`skin`, `hair`, `hairStyle`, `eyes`, `top`, `topAccent`, `topStyle`, `bottom`, `bottomStyle`, `shoes`, `accessory`, `accessoryColor`, `facialHair`), sorteados a partir do id aleatório do mundo, com as peças que você escolheu no editor por cima | O personagem com a cara certa |
| `tasksDone` | Tarefas concluídas hoje por aquele agente, só a faixa: `0` (nenhuma), `1` (1 ou 2), `2` (3 a 5), `3` (6 ou mais). Nunca o título | O "+1" sobre a cabeça do personagem |
| `compacted` | Só se você ligou "compactações": `true` quando o agente compactou o contexto desde o pacote anterior (o `/clear` não conta) | A lixeira da sala enche |
| `tokens` | Só se "mostrar tokens" estiver ligado (vem ligado; dá para desligar): `day` (hoje) e `week` (hoje e os 6 dias anteriores), o total do prédio (entrada + saída de todos os agentes, do "Meu dia", sem o modo demonstração), arredondado a 2 algarismos (ex.: 1.200.000). Os outros só veem a **faixa** (até 100 mil, 1 milhão, 10 milhões, 100 milhões, acima) | O medidor da fachada |

Mais nada. O pacote de um escritório com 3 projetos e 5 agentes tem uns 2 KB. Os limites são 64 andares, 64 agentes
por andar, 256 no total e 64 KB (na prática, uns 170 agentes); acima disso, o Habblaud corta os últimos e avisa no log.
O servidor confere cada campo (nomes dentro da lista de nomes, cores dentro das paletas, ids no formato) e recusa o
pacote inteiro se aparecer qualquer campo fora da lista.

### Exemplo real de um pacote

```json
{
  "v": 1,
  "version": "1.0.0",
  "theme": "halloween",
  "floors": [
    {
      "id": "f_8c1e5f7a2b",
      "agents": [
        { "id": "a_3f9d2c7e", "kind": "main", "provider": "claude", "status": "working",
          "look": "f", "name": "Marina",
          "parts": { "skin": "#e8b48c", "hair": "#2b1d14", "hairStyle": "bob", "eyes": "#3b5a7a", "top": "#4a6fa5",
                     "topStyle": "hoodie", "bottom": "#2f3542", "bottomStyle": "pants", "shoes": "#ffffff",
                     "accessory": "glasses", "accessoryColor": "#222222", "facialHair": "none" } },
        { "id": "a_71c0b5a9", "kind": "sub", "parentId": "a_3f9d2c7e", "provider": "claude", "status": "working",
          "look": "m", "name": "Caio", "parts": { "...": "..." } }
      ]
    },
    { "id": "f_02aa91c4de",
      "agents": [ { "id": "a_b2e74d10", "kind": "main", "provider": "codex", "status": "idle",
                    "look": "m", "name": "Rafael", "parts": { "...": "..." } } ] }
  ]
}
```

(`"...": "..."` abrevia peças iguais às da Marina. Um teste confere este exemplo contra o
[`schema.json`](../../shared/world/schema.json).)

## O que nunca sai

| Nunca sai | Exemplos |
| --- | --- |
| Caminho e nome do projeto, nome que você deu à sala | `/Users/voce/projetos/cliente-x`, "Projeto secreto" |
| Título da sessão, branch, modo de permissão, modelo | "Corrigir o login", `feat/pagamentos`, `opus` |
| O que os agentes fazem | Atividades, tarefas, comandos, shells, pedidos de permissão, perguntas, mensagens, o terminal |
| Custo e números de trabalho | Dinheiro gasto, linhas de código, chamadas de ferramenta, tokens por agente (tokens saem só como o total do prédio, arredondado) |
| A sua conta do Claude ou do Codex | E-mail, organização, plano, uso de 5 horas e semanal |
| O nome que você deu a um personagem | Pode ser o seu nome real: no mundo, o personagem ganha outro nome sorteado |
| A semente do personagem | A aparência no mundo é sorteada a partir de um id aleatório; só as peças escolhidas no editor sobem iguais |
| Horários | Quando a sessão começou, quando o status mudou, quando a sala nasceu: o pacote não tem tempo nenhum |
| Coisas da máquina | Nome do computador, usuário do sistema, fuso horário. O dispositivo aparece só como "Dispositivo 1/2/3" |
| O seu histórico | Estatísticas do Meu dia, a linha do tempo do timelapse, o histórico de sessões |
| Agentes do modo demonstração | Ficam de fora antes de montar o pacote |

## Ao vivo, sem identificar ninguém

O que aparece para quem visita: **quem visita o mundo vê, ao vivo, quantos projetos e agentes você está rodando e o
que cada personagem está fazendo (trabalhando, esperando, à toa). Ninguém vê quais projetos são, o que os agentes
fazem, nem quem você é: só o nickname e o avatar que você escolheu.**

- **Ninguém é identificado:** só o nickname (escolhido no cadastro) e o avatar que você escolheu e o país do IP (dá para
  esconder). Sem e-mail, nome real, nome de conta ou máquina. Os IPs do cadastro e do último login ficam só com a
  administração, nunca aparecem no mundo.
- **Nenhum projeto é identificável:** os ids dos andares são aleatórios e trocam a cada 24 h (±6 h), com a ordem das
  salas embaralhada.
- **Nenhum horário do escritório sai:** o pacote não tem "desde quando" nem nada de tempo. A visita mostra o status,
  nunca "há quanto tempo".
- **Nenhum histórico do prédio fica:** do prédio, o servidor guarda só o dia do último sinal e o mês em que entrou no
  mundo. Não existe linha do tempo de prédio nem "visto por último".
- **Sem feed global:** cada pessoa só recebe o pedaço da cidade em volta do personagem dela; nenhuma rota lista
  prédios ou jogadores.
- **Nada prova que você está no computador:** os agentes trabalham sozinhos. O cartão diz "aceso" ou "apagado" sobre o
  prédio, nunca "online" sobre a pessoa.
- **Modo discreto:** só aceso ou apagado e o número de andares, sem contadores nem status. **Fechado a visitas:**
  ninguém entra.
- **Visitas:** quem entra no seu prédio vê as salas com os nomes fictícios e os agentes no status de agora; no modo
  discreto, as salas vazias com a luz acesa; pausado, tudo apagado. Você vê só "N visitantes agora", nunca quem. E o
  que você vê lá dentro do prédio dos outros fica na sua tela: nada do interior sobe, nem a posição do seu personagem.
- **Bloqueio nos dois sentidos:** quem você bloqueia some para você e você some para essa pessoa, inclusive o prédio.
- **O social leve não conta quem foi:** o dono vê quantas visitas, likes e carimbos recebeu ("Enquanto você estava
  fora") e quantos likes ganhou hoje, nunca de quem; bater na porta chega sem nome, e só se o dono ligou "Avisar quando
  baterem na porta". Os agregados da cidade (a meta da semana, o total de tokens em faixa) só aparecem com 10 prédios
  ou mais.

Dito com clareza: quem observar o mesmo prédio por muito tempo pode notar padrões (mais agentes em dias úteis, por
exemplo). Quem não quiser nem isso usa o modo discreto ou pausa.

## Neste computador

- A conta do World fica em `~/.habblaud/world.json` (no Docker, no volume `/data`), com permissão só para o seu
  usuário. O token do dispositivo sai dali só para o servidor do mundo, por HTTPS e na primeira mensagem da conexão
  do prédio, e nunca vai para o navegador, para os logs ou para a URL. O mesmo arquivo guarda o tema escolhido para o
  prédio (que fica mesmo depois de sair da conta) e se o prédio está pausado ou fora do mundo.
- A última remessa do prédio (o pacote exato, a hora, o tamanho e a resposta do servidor) fica em
  `~/.habblaud/world-last-uplink.json`, também só para o seu usuário, e some ao sair da conta.
- Os ids aleatórios do mundo vivem só na memória do Habblaud: reiniciar o Habblaud gera ids novos.
- O que o mundo manda ao dono (os likes de hoje, o "Enquanto você estava fora", as batidas na porta e a lista de quem
  você bloqueou) fica só na memória do Habblaud; no snapshot (que também vai ao celular) entram só os likes de hoje,
  quantas batidas houve e se há um resumo não visto. O carimbo que você deixou hoje num prédio fica no navegador
  (`localStorage`), para o botão saber que já foi.
- A seção do World só funciona pelo próprio computador (`http://localhost`), nunca pelo celular, e só com o Habblaud
  acessível apenas pelo próprio computador. Como acontece com as mensagens pelo escritório, qualquer programa deste
  computador que alcance o `localhost` consegue agir pela conta.
- **Pausar** para o envio do pacote do prédio antes de responder e avisa o servidor do mundo: o prédio apaga na hora
  para todos e o lote fica guardado. **Retomar** volta a enviar (sem resposta do servidor, o Habblaud tenta avisar de
  novo).
- **Pausado: seu prédio está apagado, mas você pode andar pela cidade.** Com a cena Mundo aberta, a conexão continua
  (ou abre) levando só a primeira mensagem (`hello`), o sinal de vida (`ping`/`pong`) e os comandos da cena (`view`,
  `view.off`, `move`, `profile`, `resync`, `enter`, `leave`): nenhum pacote do prédio sai, e o sinal de vida não acende o prédio. Fechada a cena, a conexão
  fecha e nada sai. Fora do mundo vale o mesmo.
- **Sair do mundo** para o envio do pacote e só responde depois que o servidor do mundo retira o prédio e libera o
  lote. A conta e o personagem continuam (dá para andar pela cidade, como pausado); nenhum pacote do prédio sai até
  você clicar em **Voltar ao mundo**, que pede a volta ao servidor do mundo e cria um prédio novo, em outro lote. Se a
  conta sair do mundo em outro computador, este também fica fora do mundo, sem enviar pacote, até **Voltar ao
  mundo**.
- **A cidade** (a cena Mundo) só desce com ela aberta no navegador: os prédios e as pessoas por perto que o servidor
  do mundo manda ficam na memória do Habblaud e vão à página pelo `localhost`, nunca para o disco nem para os logs, e
  são esquecidos ao fechar a cena ou cair a conexão. A cena só abre pela própria página do Habblaud, nunca por outro
  site.
- Tarefas concluídas e compactações são contadas na memória do Habblaud também com o prédio pausado ou sem conexão;
  só a faixa do dia (e o "compactou desde o pacote anterior") sai, na remessa seguinte.
- **Sair** apaga o token deste computador e o desconecta no servidor. A lista de dispositivos mostra onde a conta está
  conectada (até 3) e desconecta um por um.

## Como a garantia é mantida

1. **O protocolo é público e fechado:** [`shared/world/protocol.ts`](../../shared/world/protocol.ts) e
   [`schema.json`](../../shared/world/schema.json) definem cada campo; o servidor recusa qualquer outro.
2. **Um arquivo só monta o pacote do prédio:** [`shared/world/projection.ts`](../../shared/world/projection.ts), que
   recebe das salas só o id e nunca recebe contas, uso nem estatísticas. Os testes conferem cada chave do pacote
   contra a lista do `schema.json`, que nenhum texto do escritório (caminhos, nomes de sala, títulos, atividades,
   comandos, tarefas, branch, modelo, conta, e-mail, nomes editados) aparece nele e que nenhum número parece um horário.
3. **Você vê o que foi enviado:** Habblaud World › Ver o que foi enviado (o botão de cidade na barra do topo) mostra o JSON exato da última
   remessa, a hora, o tamanho e a resposta do servidor (aceito, ou o motivo da recusa). É o mesmo objeto que foi para
   o fio.
4. **Código aberto:** quem revisa um pull request que mexe em `shared/world/` ou `server/world/` confere esta lista
   contra o que o código manda ([`CONTRIBUTING.md`](../../CONTRIBUTING.md)).
