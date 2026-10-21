<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Logo do Habblaud: um pequeno prédio em pixel art" />
</p>

<h1 align="center">Habblaud</h1>

<p align="center">
  <b>O escritório virtual dos seus agentes do Claude Code (e do Codex).</b><br />
  Cada projeto vira uma sala, cada agente vira um personagem em pixel art que mostra, em tempo real, o que está fazendo.
</p>

<p align="center"><a href="README.md">English</a> · <b>Português</b> · <a href="README.es.md">Español</a> · <a href="README.fr.md">Français</a></p>

<p align="center">
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%E2%89%A522.12-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-pronto-2496ed?logo=docker&logoColor=white" />
  <img alt="Zero dependências de runtime" src="https://img.shields.io/badge/depend%C3%AAncias%20de%20runtime-0-f08a3c" />
  <img alt="Interface em português, inglês, espanhol e francês" src="https://img.shields.io/badge/interface-PT%20%C2%B7%20EN%20%C2%B7%20ES%20%C2%B7%20FR-4aa8e8" />
</p>

<p align="center">
  <img src="docs/screenshots/office.gif" width="820" alt="Animação de uma sala do Habblaud: personagens digitando nas mesas, subagentes com crachá e balões de atividade" />
</p>

---

Você abre o Claude Code em vários projetos, dispara subagentes, deixa tarefas rodando… e perde a noção de quem está
fazendo o quê. O **Habblaud** transforma isso num escritório que dá para entender de relance: quem está digitando,
quem levantou a mão porque **precisa de você**, quem entregou o trabalho e foi embora, quem foi tomar um café
enquanto espera a próxima instrução — e quanto de cada conta você já gastou na sessão de 5 horas e na semana.

E quando dois ou mais agentes estão à toa, o escritório ganha **vida social**: cada um tem personalidade própria, e
eles veem futebol juntos no lounge, jogam videogame e ping-pong, fofocam na copa, se arrumam no espelho e apostam
moedinhas no jokenpô. Veja em [Vida social](#vida-social).

Tudo roda na sua máquina, lendo os arquivos que o próprio Claude Code já grava (e só as linhas `alias` do seu shell,
para dar a letra de cada conta). Nada sai do computador: o Habblaud não lê credenciais nem faz chamadas externas.

## Sumário

- [Como é](#como-é)
- [Instalação](#instalação)
- [Como usar](#como-usar)
- [Contas e uso (5 horas e semanal)](#contas-e-uso-5-horas-e-semanal)
- [Configuração](#configuração)
- [Habblaud World](#habblaud-world)
- [Como funciona](#como-funciona)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Desenvolvimento](#desenvolvimento)
- [Solução de problemas](#solução-de-problemas)
- [Aviso](#aviso)
- [Licença](#licença)
- [Vida social](#vida-social)

## Como é

**Visão geral.** O prédio tem recepção com elevadores, copa, banheiros e lounge; cada projeto com uma sessão aberta
ganha a sua sala ao longo do corredor. No topo, os contadores e o uso de cada conta; à esquerda, as salas e os
agentes; embaixo, o feed de atividade.

![Visão geral do Habblaud: prédio com recepção, copa, banheiros, lounge e salas de projeto; barra lateral com salas e agentes; uso das contas no topo; feed de atividade embaixo](docs/screenshots/overview.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Gaveta de detalhes de um agente com tarefas, subagentes, linha do tempo e estatísticas" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="O escritório à noite, com postes acesos e salas iluminadas" /></td>
  </tr>
  <tr>
    <td><b>Detalhes do agente:</b> atividade atual, tarefas com progresso, subagentes, linha do tempo e estatísticas.</td>
    <td><b>Dia e noite:</b> o céu nas janelas e a iluminação seguem a hora local.</td>
  </tr>
</table>

<table>
  <tr>
    <td width="42%"><img src="docs/screenshots/collab.png" alt="Subagente entregando o resultado ao agente principal enquanto outra agente pede permissão" /></td>
    <td width="58%">
      <b>Colaboração à vista.</b> Subagentes são colegas com nome próprio e crachá: chegam pelo elevador, trabalham na
      sala do projeto e, ao terminar, vão até o agente que os chamou entregar o resultado (📦) antes de ir embora.<br /><br />
      <b>Precisa de você.</b> Quando um agente espera uma permissão ou resposta no terminal, ele corre para a mesa e
      levanta a mão, com um alerta piscando — e um aviso aparece na tela (opcionalmente com som e notificação do navegador).
      Dá para aprovar, responder a pergunta ou mandar a próxima instrução dali mesmo.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="58%">
      <b>Esperando o shell.</b> Quando o agente termina o turno mas deixa um comando rodando (testes, build,
      deploy…), ele não sai para passear: fica na mesa com uma ampulheta virando sobre a cabeça, o terminal mostrando
      o progresso e um balão com o comando e o tempo. E a espera vira comédia: primeiro ele come pipoca assistindo ao
      terminal; depois de 3 min cruza os braços e gira na cadeira; depois de 10 min junta teia de aranha; depois de
      25 min cochila. Quando o comando termina, levanta e comemora com confete — ou ganha uma nuvem de chuva, se
      falhou. Na lista lateral e nos detalhes, um cronômetro mostra há quanto tempo cada comando está rodando.
    </td>
    <td width="42%"><img src="docs/screenshots/shell-wait.png" alt="Agente comendo pipoca na mesa, com uma ampulheta sobre a cabeça e o balão 'Rodar a suíte de testes · 1 min'; na fileira da frente, uma colega espera há mais tempo, com teia de aranha na cadeira e o terminal mostrando o progresso" /></td>
  </tr>
</table>

**A luz apaga.** Quando você fecha a última sessão de um projeto, o último personagem vai até o interruptor,
apaga a luz, sai pelo elevador — e a sala é desmontada, virando jardim até um novo projeto chegar. Se o jardim
ficou entre duas salas, a sala mais distante se muda para lá: é montada no lugar vago, o pessoal vai andando até
ela, e o endereço antigo apaga e é desmontado. Assim o prédio não fica com buracos e encolhe sozinho.

| 1. A sala é montada, ainda apagada | 2. Alguém acende a luz e todos trabalham | 3. O último sai e apaga a luz | 4. A sala vira jardim |
| --- | --- | --- | --- |
| ![Sala sendo montada, com os móveis aparecendo e a luz apagada](docs/screenshots/lifecycle-1.png) | ![Sala acesa com três agentes trabalhando nas mesas](docs/screenshots/lifecycle-2.png) | ![Sala com a luz apagada e os móveis ainda no lugar, depois que todos saíram](docs/screenshots/lifecycle-3.png) | ![O lote da sala transformado em jardim](docs/screenshots/lifecycle-4.png) |

<table>
  <tr>
    <td width="34%"><img src="docs/screenshots/mobile.png" alt="Habblaud no celular, com o uso das contas no topo" /></td>
    <td>
      <b>Também no celular.</b> A interface se adapta a telas pequenas: o uso das contas fica no topo, a lista de
      salas vira uma gaveta e os detalhes abrem de baixo para cima. Veja como liberar o acesso pela rede local em
      <a href="#abrir-no-celular-opcional">Abrir no celular</a>.
    </td>
  </tr>
</table>

> As imagens acima usam o **modo demonstração** (projetos, pessoas e contas fictícios).

## Instalação

### Requisitos

- **macOS** (testado) ou Linux.
- **[Claude Code](https://code.claude.com)** instalado, com uma ou mais contas (2.1.287 ou mais novo para o mod).
- **Node.js 22.12+** e **npm** (desenvolvido com o Node 24; o Docker já usa o Node 24).
- **Docker Desktop** (ou Docker Engine com Compose v2), se for rodar em container.

### 1. Baixe o projeto

```bash
git clone https://github.com/marmottajr/habblaud.git
cd habblaud
npm install
```

> O `npm install` só baixa ferramentas de compilação (Vite, TypeScript, tsx…). O servidor do Habblaud não tem
> dependências de runtime: usa só módulos nativos do Node.

### 2. Suba o Habblaud

**Opção A — Docker (recomendado para deixar sempre ligado)**

```bash
npm run docker:up
```

O script detecta as suas contas do Claude Code, monta só as pastas necessárias (em modo somente leitura), constrói
a imagem e sobe o container — que reinicia sozinho junto com o Docker. Abra **http://localhost:4747**.

**Opção B — Node, sem Docker**

```bash
npm run build
npm start
```

Abra **http://localhost:4747**. Para desenvolver, use `npm run dev` (servidor + Vite com recarga automática).

Agora abra o Claude Code em qualquer projeto e veja o seu agente chegar pelo elevador. 🎉

### 3. Instale o mod do Habblaud no Claude Code (recomendado)

```bash
npm run mod:install                        # o mod e os plugins de permissões e de mensagens, em cada conta
npm run mod:install -- --sem-permissoes    # sem responder permissões e perguntas pelo escritório
npm run mod:install -- --sem-mensagens     # sem mandar mensagens aos agentes pelo escritório
```

O Habblaud traz um [mod](https://code.claude.com/docs/en/plugins/mods/overview) (um plugin que roda dentro do
Claude Code) e o instala em cada conta, pelo próprio `claude plugin`, a partir desta pasta. Com ele:

- o **uso de 5 horas e semanal** de cada conta aparece ao vivo no Habblaud;
- o terminal mostra uma linha quando **outra sessão precisa de você** (permissão ou resposta);
- o comando **`/habblaud`** passa a existir no Claude Code;
- dá para **aprovar ou recusar pelo escritório** os pedidos de permissão ("Do you want to…") e **responder as
  perguntas** do agente, com o plugin `habblaud-permissoes` (veja [Responder pelo escritório](#responder-pelo-escritório));
- dá para **mandar mensagens** ao agente pelo escritório, como se você digitasse no terminal dele, com o plugin
  `habblaud-mensagens` (veja [Mandar mensagens](#mandar-mensagens)).

Precisa do **Claude Code 2.1.287 ou mais novo** (`claude --version`). O mod roda dentro de cada sessão, com as suas
permissões, e acessa só o que está listado em [`mod/README.md`](mod/README.md); para conferir sem rodar nada,
`claude plugin validate mod/habblaud` mostra os eventos que ele trata e as chamadas que faz. Sessões já abertas
carregam o mod com `/reload-plugins` (ou ao reabrir). Se a conta tinha o jeito antigo (abaixo), o `mod:install` tira o
tap e o hook do `settings.json` (com backup), porque o mod faz o mesmo. Confira com `npm run mod:status`; para
desfazer: `npm run mod:uninstall`.

> O mod é lido desta pasta. Se mover a pasta, rode `npm run mod:install` de novo.

<details>
<summary><b>Claude Code anterior ao 2.1.287: o jeito antigo</b></summary>

Sem mods, o uso ao vivo e o responder pelo escritório vêm de dois instaladores que editam o `settings.json` de cada
conta (com backup antes):

```bash
npm run usage:install    # põe um "tap" na frente do statusline de cada conta, que captura o uso de 5h/semanal
npm run hooks:install    # acrescenta o hook PermissionRequest, para responder permissões pelo escritório
```

O seu statusline continua aparecendo igual. Para desfazer: `npm run usage:uninstall` e `npm run hooks:uninstall`.
Os dois apontam para esta pasta: se mover a pasta, rode-os de novo (até lá, o statusline das contas mostra erro).
Quando atualizar o Claude Code, troque pelo mod: o `npm run mod:install` tira o tap e o hook antigos (com backup) para
não ficarem dois capturando o uso ou respondendo o mesmo pedido.

</details>

### 4. Codex no escritório (opcional)

Se você também usa o **Codex** da OpenAI (a CLI `codex` ou o app), as sessões dele entram no mesmo escritório: cada
projeto é uma sala — a mesma sala do Claude Code, quando os dois estão abertos no mesmo projeto — e cada sessão, um
personagem com o selo **CODEX**. O Habblaud acha sozinho a pasta do Codex (`~/.codex`, `CODEX_HOME` ou `~/.codex*`) e
lê as conversas, sem instalar nada. Para ver o Codex **ao vivo** (o que está fazendo agora, quem precisa de você) e
aprovar comandos pelo escritório, instale os hooks:

```bash
npm run codex:install      # acrescenta os hooks do Habblaud em ~/.codex/hooks.json (backup antes; os outros ficam)
npm run codex:status       # confere
```

Depois, **abra o Codex e aprove os hooks do Habblaud em `/hooks`**: o Codex só roda um hook novo depois que você o
aprova (o Habblaud nunca grava essa aprovação). Com o Habblaud no Docker, para mandar mensagens às sessões do Codex
deixe também `npm run codex:bridge` rodando no Mac (veja [Codex](#codex)).

### Abrir no celular (opcional)

Por padrão o Habblaud só aceita conexões do próprio computador. Para abrir no celular (no mesmo Wi-Fi), com Docker:

```bash
printf 'HABBLAUD_BIND=0.0.0.0\n' > .env
npm run docker:up -- --no-build
```

Depois abra `http://<ip-do-computador>:4747` no celular (no macOS: `ipconfig getifaddr en0`; se vier vazio,
`ipconfig getifaddr en1`). No modo Node, use `HABBLAUD_HOST=0.0.0.0 npm start`.

> ⚠️ Com isso, qualquer aparelho da rede vê a atividade dos agentes (comandos, arquivos, títulos das sessões). Use
> só em redes de confiança. O [terminal](#terminal) (e com ele responder e mandar mensagens pelo escritório) fica
> desligado enquanto a porta estiver exposta. Para voltar: apague o `.env` e rode `npm run docker:up -- --no-build`.

#### Celular com login e HTTPS (aprovando pedidos)

Em vez de expor a porta principal, abra uma **segunda porta com usuário, senha e HTTPS**. A 4747 continua só no
computador (hooks, plugins e o seu navegador seguem sem login); a porta remota vai para a rede e toda requisição nela
exige login. Quem separa as duas é a porta em que a conexão chegou, nunca o cabeçalho Host. Nada disso existe antes do
setup: sem ele, nenhuma porta a mais é publicada.

```bash
npm run remote:setup   # usuário, senha, nome do endereço e (opcional) um endereço próprio
npm run docker:up
```

O `remote:setup` grava no `.env` só o **hash** da senha (scrypt), cria uma CA local e o certificado do servidor em
`~/.habblaud/remote-tls` e deixa um serviço anunciando `<nome>.local` na rede (mDNS; LaunchAgent no macOS, systemd no
Linux). Abra `https://<nome>.local` no celular (com `:4748` se a porta 443 estava ocupada). Na primeira vez, aceite o
aviso, toque em **Instale o certificado do Habblaud** e confie nele (iPhone: Ajustes › Perfil Baixado › Instalar e
depois Ajustes › Geral › Sobre › Ajustes de Confiança de Certificados; Android: Segurança › Criptografia e
credenciais › Instalar certificado › Certificado de CA), conferindo a impressão digital que o setup mostrou.

- **CA restrita:** ela só assina `localhost`, nomes `.local`, o endereço próprio e IPs de rede privada. Mesmo que a
  chave vaze, um certificado para qualquer outro site é recusado pelo celular que confia nela. Trocar o endereço
  próprio cria uma CA nova (instale o certificado de novo no celular). A chave da CA nunca vai para o container.
- **Endereço próprio** (ex.: `meuclaude.home`): entra no certificado, mas o celular só o encontra com uma entrada no
  DNS do roteador apontando para o IP do computador. O `<nome>.local` funciona sem configurar nada.
- **O que o celular pode fazer:** por padrão, aprovar e recusar pedidos de permissão. `HABBLAUD_REMOTE_ALLOW` no
  `.env` aceita `permissions`, `messages`, `terminal` e `spawn`, separados por vírgula, ou `none` (só ver). O
  terminal interativo nunca funciona pelo celular.
- **Entregas** (celular, com `terminal` liberado): o botão da caixinha no topo lista o que cada agente terminou, com
  resumo e anexos (prints, PDFs, arquivos que ele mandou) que abrem com um toque.
- **Novo agente** (botão **+**): começa uma sessão do Claude Code em segundo plano no computador (`claude --bg`, na
  pasta escolhida), que aparece no escritório e recebe mensagens e pedidos de permissão pelo Habblaud. Numa pasta que
  o Claude Code ainda não conhece, abre a tela de sessão nova do app do Claude preenchida, e você aperta Enter lá.
  **Vem desligado:** precisa de `HABBLAUD_PTY=1` (a mesma liberação do
  [terminal interativo](#terminal-interativo-assumir-nova-sessão-e-encerrar); no Docker, ponha no `.env` e deixe o
  `npm run codex:bridge` rodando no computador) e, pelo celular, também de `spawn` no `HABBLAUD_REMOTE_ALLOW`.
- **Ditado** (no Novo agente e na caixa de mensagem): precisa de `whisper-cli` e `ffmpeg` (`brew install whisper-cpp
  ffmpeg`) e de um modelo multilíngue em `~/.local/share/whisper/` (`ggml-small.bin` acerta mais que o
  `ggml-base.bin`; os `.en` só entendem inglês). Sem eles o botão Ditar não aparece. A voz não sai do computador.
  `HABBLAUD_WHISPER_BIN`, `HABBLAUD_FFMPEG_BIN`, `HABBLAUD_WHISPER_MODEL` e `HABBLAUD_DICTATION_LANGS` (padrão
  `pt,en`) ajustam.
- **Fora de casa (Tailscale):** com o Tailscale no computador e no celular, `tailscale serve --bg --https=443
  https+insecure://127.0.0.1:443` publica a porta remota (com login) só para os seus aparelhos, com certificado válido
  em `https://<computador>.<tailnet>.ts.net`; ponha esse nome em `HABBLAUD_ALLOWED_HOSTS`. Aponte sempre para a porta
  remota, nunca para a 4747 (que não pede login).
- **Sessão:** 30 dias; trocar a senha (rodar o setup de novo) derruba todas, e **Configurações › Acesso pelo celular ›
  Sair** encerra a daquele aparelho. Depois de 5 senhas erradas seguidas, cada nova tentativa espera de 1 s até 5 min.
- **IP mudou?** O `docker:up` refaz o certificado do servidor quando falta o IP novo ou quando faltam 30 dias para
  vencer, com a mesma CA (o celular segue confiando); o servidor troca o certificado sem reiniciar.
- **Desligar:** `npm run remote:setup -- --off` e `npm run docker:up`.

Sem HTTPS a porta remota não sobe; `HABBLAUD_REMOTE_INSECURE_HTTP=1` força HTTP puro (senha e cookie à vista na
rede). No modo Node: `HABBLAUD_REMOTE_PORT` e `HABBLAUD_REMOTE_HOST` (padrão `0.0.0.0:4748`) e
`HABBLAUD_REMOTE_TLS_DIR` (padrão `~/.habblaud/remote-tls/server`).

### Atualizar

A versão em uso aparece na barra superior, ao lado de "Conectado", e em **Configurações › Sobre**. A cada 6 horas o
Habblaud confere no GitHub se saiu uma versão nova (as [releases](https://github.com/marmottajr/habblaud/releases)
deste repositório). Quando sai, aparece o selo verde **Nova versão** no lugar do número, com um aviso e um ponto no
botão de configurações. Em **Sobre** ficam o link do que mudou e o botão **Verificar agora** (as notas de cada
versão também estão no [`CHANGELOG.md`](CHANGELOG.md)). Para atualizar:

```bash
git pull
npm install
npm run docker:up        # ou: npm run build && npm start (e depois npm run mod:install)
```

> Se o `git pull` parar com "Your local changes to the following files would be overwritten by merge:
> package-lock.json", rode `git checkout -- package-lock.json` e repita: até a 0.4.0, o `npm install` alterava esse
> arquivo.

O `docker:up` também atualiza o mod nas contas em que ele já está instalado (nunca instala sozinho) e avisa:
"Mod atualizado para 0.3.0 na Conta D; sessões abertas: /reload-plugins". No modo Node, rode `npm run mod:install`
depois de atualizar. Para não consultar o GitHub, use `HABBLAUD_UPDATE_CHECK=0` (no `.env`, para o Docker).

#### Vindo do CodeTown

O Habblaud se chamava **CodeTown** até a 0.3.2. Depois do `git pull`, rode uma vez:

```bash
npm install
npm run mod:install      # troca o marketplace e os plugins codetown pelos habblaud, em cada conta
npm run docker:up        # tira o container codetown e copia os dados do volume antigo para o novo
```

- **Mod:** até o `mod:install`, o Claude Code das contas reclama do marketplace `codetown` (as pastas
  `mod/codetown*` mudaram de nome). O `docker:up` avisa, mas não troca sozinho.
- **Docker:** o volume antigo (`codetown_codetown-data`) fica intacto. Depois de conferir que os nomes dos personagens
  vieram, apague-o com `docker volume rm codetown_codetown-data`, e a imagem antiga com `docker image rm codetown:local`.
- **Pasta local:** `~/.codetown` vira `~/.habblaud` sozinha (no servidor, no `docker:up` e no `mod:install`).
- **Navegador:** preferências e moedinhas passam para as chaves novas na primeira vez que a página abre.
- **Variáveis:** as `CODETOWN_*` não valem mais; renomeie para `HABBLAUD_*` no `.env` (ex.: `HABBLAUD_BIND`). O
  servidor e o `docker:up` avisam quando acham uma antiga.
- **Repositório:** agora é `github.com/marmottajr/habblaud` (o GitHub redireciona o endereço antigo). Para acertar o
  clone: `git remote set-url origin https://github.com/marmottajr/habblaud.git`. A pasta local pode continuar com o
  nome antigo.
- Backups do `settings.json` feitos antes da troca continuam com o nome `settings.json.codetown-backup-<data>`.

### Desinstalar

```bash
npm run mod:uninstall                       # tira o mod, os plugins de permissões e de mensagens e o marketplace
npm run codex:uninstall                     # tira os hooks do Habblaud do Codex (os outros ficam)
npm run docker:down                         # para o container
docker volume rm habblaud_habblaud-data     # apaga os dados do container (nomes, salas, linha do tempo e estatísticas)
docker image rm habblaud:local              # apaga a imagem
rm -rf ~/.habblaud                          # apaga os dados locais (uso capturado, nomes, salas, linha do tempo e estatísticas)
```

Depois é só apagar a pasta do projeto — rode o `mod:uninstall` **antes**, senão o Claude Code das contas passa a
reclamar do marketplace que sumiu. Se você usou o jeito antigo, rode também `npm run usage:uninstall` (devolve o
statusline original) e `npm run hooks:uninstall` (tira o hook de permissão); sem eles, o statusline das contas passa
a dar erro (e o hook, a falhar em silêncio). O `mod:install`, que tira o tap e o hook antigos, e os instaladores e
desinstaladores antigos deixam cópias `settings.json.habblaud-backup-<data>` na pasta de cada conta (ex.:
`~/.claude/`); apague-as se não precisar mais.

## Como usar

### O que cada personagem está fazendo

| Estado | O que você vê |
| --- | --- |
| **Trabalhando** | Na mesa, digitando. O monitor e um balão mostram a atividade: 📖 lendo, ✏️ editando, 💻 terminal, 🧪 testes, 🌐 pesquisando… |
| **Precisa de você** | Corre para a mesa e levanta a mão, com alerta piscando: está esperando uma permissão ou resposta no terminal. |
| **Esperando o shell** | Terminou o turno mas deixou um comando rodando (testes, build, deploy…), então fica na mesa com uma ampulheta virando sobre a cabeça e o terminal em progresso: come pipoca assistindo, depois de 3 min cruza os braços e gira na cadeira, depois de 10 min junta teia de aranha e depois de 25 min cochila; quando o comando termina, levanta e comemora com confete (ou ganha uma nuvem de chuva, se falhou). Depois de 40 s, se houver colegas à toa, pode sair para uma roda — com a ampulheta na cabeça. |
| **Ocioso** | Terminou o turno e passeia: café na copa, bebedouro, banheiro, sofá do lounge, celular no puff, espelho. Com colegas à toa, entra numa roda: TV, videogame, ping-pong, papo na copa, jokenpô (veja [Vida social](#vida-social)). Depois de 10 min parado, cochila — mas um colega pode acordá-lo para uma roda. |
| **Subagente concluído** | Vai até o agente que o chamou, entrega o resultado e sai pelo elevador. |
| **Sessão encerrada** | Vai embora; se era o último da sala, apaga a luz antes de sair. |

Cada personagem tem um **nome brasileiro único** (Marina, Henrique, Luan…) que se mantém enquanto a sessão existir, e
um **chip colorido com a letra da conta** (C, D…).

### Interface

- **Topo:** contadores (salas, agentes, trabalhando, subagentes, shells rodando, precisam de você) e um cartão de
  **uso por conta**. O de shells só aparece enquanto algum comando está rodando; clique nele para ir até quem espera.
  Embaixo do logo ficam a conexão e a versão em uso, que vira o selo **Nova versão** quando sai uma versão nova (veja
  [Atualizar](#atualizar)).
- **Painel lateral:** busca, filtro por conta e a lista de salas com seus agentes e subagentes.
- **Gaveta de detalhes:** clique num personagem (no prédio ou na lista) para ver atividade, tarefas, subagentes,
  linha do tempo e estatísticas (ferramentas, tokens, custo, linhas alteradas, modelo, branch).
- **Feed:** as últimas atividades de todo o escritório.
- **Configurações (⚙):** nomes, balões, quanto os ociosos passeiam, ciclo dia/noite, sons, notificações do navegador,
  modo demonstração e **Sobre** (versão em uso e versão nova). **Ajuda (?):** legenda completa e atalhos.
- **Meu dia (📊):** para onde foi o tempo do dia (veja [Meu dia](#meu-dia)). **Timelapse** e **Histórico** (os relógios
  da barra superior): veja [Timelapse do dia](#timelapse-do-dia) e [Terminal](#terminal).

**Câmera:** arraste para mover, role para dar zoom, clique duplo num personagem para segui-lo.

**Atalhos:** `/` busca · `F` seguir o selecionado · `T` terminal · `L` timelapse · `M` meu dia · `P` próximo pedido
(permissão ou pergunta) · `O` ou `0` visão geral · `Esc` limpar seleção · `[` painel lateral · `]` feed · setas/`WASD` mover ·
`+` `-` zoom · `?` ajuda.

### Temas do escritório

Em **Configurações → Aparência → Tema do escritório**, escolha:

- **Automático** (padrão): segue o calendário, na hora local. Halloween de 1º a 31 de outubro, Natal de 1º de
  novembro a 26 de dezembro e, no resto do ano, o visual original.
- **Nenhum**: sempre o visual original.
- **Natal**: guirlandas, luzes quentes, árvores com presentes, tapetes natalinos, neve nas janelas e gorros nos personagens.
- **Halloween**: abóboras, fantasmas decorativos, teias, morcegos, luzes roxas, tapetes temáticos e acessórios de fantasia.

A troca é imediata e a escolha fica salva neste navegador. Os temas preservam os caminhos,
as atividades e as animações dos agentes. O ciclo dia/noite continua sendo uma opção independente.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/seasonal-christmas.png" alt="Escritório no tema Natal: árvores com presentes nos cantos das salas, guirlandas e luzes nas paredes, tapetes vermelhos e personagens de gorro" /></td>
    <td width="50%"><img src="docs/screenshots/seasonal-halloween.png" alt="Escritório no tema Halloween: abóboras e fantasmas no lugar das plantas, teias e morcegos nas paredes, tapetes roxos e personagens fantasiados" /></td>
  </tr>
</table>

### Idiomas

A interface está em **português, inglês, espanhol e francês**. Ela segue o idioma do navegador; em
**Configurações › Idioma** dá para fixar um (a escolha fica salva neste navegador). Os textos que o servidor monta
(atividades, avisos, terminal, logs e os scripts de instalação) seguem `HABBLAUD_LANG` e, sem ele, o idioma do
sistema, menos o inglês: muita máquina e todo container vêm em inglês por padrão, mesmo para quem usa outra língua.
Para o servidor em inglês, defina `HABBLAUD_LANG=en` (no Docker, no `.env`). Um texto sem tradução aparece em
português.

### Dia, noite e sons

O escritório acompanha a **hora local**: de madrugada e à noite o gramado e a rua ficam azulados e escuros, os postes,
os abajures, as máquinas e os monitores ligados acendem halos de luz, as salas com gente ficam iluminadas (a luz que
apaga quando a sala esvazia continua valendo), os carros passam de farol aceso e aparecem vaga-lumes no jardim. No
amanhecer (~5–7 h) e no entardecer (~17–19 h) tudo ganha um tom quente, e durante o dia o sol entra pelas janelas e
desenha faixas de luz no piso — curtas ao meio-dia, longas e alaranjadas no fim da tarde. Em **Configurações › Ciclo
dia/noite** dá para escolher automático, sempre dia ou sempre noite; para testar um horário, use `?hora=21:30` na URL.

Os **sons** vêm desligados. Ligados em **Configurações › Sons**, são sintetizados no próprio navegador (sem arquivos
de áudio) e baixinhos: o teclado de quem trabalha nas salas à vista, o "ding" do elevador quando alguém chega ou vai
embora, o sino quando alguém precisa de você, o estalo de tarefa concluída e o pingue-pongue e o fliperama das rodas.
Há volume geral e cada categoria liga e desliga à parte. Com a aba oculta, só o sino toca.

### Terminal

Clique num agente e use **Abrir terminal** para ver a conversa da sessão como o Claude Code mostra: os prompts, as
respostas, cada ferramenta chamada (com o comando ou o diff) e o resultado, atualizados ao vivo. Vale para agentes
principais e subagentes; no modo demonstração, a conversa é fictícia.

No rodapé, para agentes principais, dá para **digitar**: `Enter` manda e `Shift+Enter` quebra a linha. O texto entra
na sessão como se você tivesse digitado no terminal dele (veja [Mandar mensagens](#mandar-mensagens)); se o agente
estiver ocupado, entra quando ele terminar o que está fazendo. Subagentes e sessões do histórico continuam só para ler.

- **Busca:** com o terminal em foco, `Ctrl+F` (`⌘F` no Mac) ou a lupa do cabeçalho abre a busca na conversa, sem
  diferenciar maiúsculas nem acentos. O contador mostra a posição ("3/17"); `Enter` e `Shift+Enter` vão para o próximo
  e o anterior, abrindo os blocos recolhidos ("… +N linhas") onde o termo estiver. A busca continua valendo enquanto
  chegam mensagens novas. `Esc` fecha a busca; o seguinte fecha o terminal.
- **Filtro:** **Tudo**, **Só prompts** (os seus prompts e as respostas finais do agente, sem os passos intermediários)
  ou **Sem ferramentas**.
- **Copiar:** passe o mouse (ou o foco) sobre um prompt, uma resposta, um comando ou um resultado para copiá-lo.
- **Histórico:** o relógio da barra superior lista as sessões dos últimos 7 dias de todas as contas (até 150), agrupadas
  por dia, com busca por título, projeto ou conta. Uma sessão encerrada abre no terminal com projeto, título e data no
  cabeçalho e "Sessão encerrada às …" no rodapé; uma sessão ainda aberta abre o terminal ao vivo do agente.

Como o terminal (e o histórico) mostra a conversa inteira, ele só existe quando o Habblaud está acessível **apenas pelo
próprio computador** (o padrão) e só abre por `http://localhost` ou `http://127.0.0.1`. Com a porta liberada para a rede
(`HABBLAUD_BIND=0.0.0.0` ou `HABBLAUD_HOST=0.0.0.0`), ele fica desligado. Detalhes em
[Privacidade e segurança](#privacidade-e-segurança).

### Terminal interativo (assumir, nova sessão e encerrar)

Com `HABBLAUD_PTY=1` e rodando com `npm start` (fora do Docker), a janela de terminal de cada agente principal é
interativa: o botão **Abrir terminal** da gaveta, o atalho ao lado de cada agente na lista lateral ou a tecla `T`
abrem a mesma janela, com abas para os outros agentes do mesmo projeto.

- Sessão aberta aqui: é o Claude Code de verdade (digitar, responder; Esc interrompe o agente, como no terminal).
- Sessão aberta noutro terminal: **Assumir daqui** (no topo da janela) encerra a sessão lá e continua a **mesma
  conversa** aqui (`claude --resume <sessão>`, na mesma pasta e conta). O personagem mantém o nome. No Windows, o
  terminal de onde a sessão saiu volta ao normal (o Habblaud desliga os modos de mouse/teclado que o Claude ligou).
- **Encerrar** fecha a sessão, esteja ela aqui ou noutro terminal (a conversa fica salva).
- **Nova sessão** (na gaveta da sala) abre um Claude Code novo na pasta do projeto.

Assumir e encerrar pedem um segundo clique; fechar a janela não encerra a sessão. A janela (e a gaveta do
agente) pode ser arrastada pela barra e redimensionada pelo canto; duplo clique na barra devolve ao lugar.
**Vem desligado:** ligue com `HABBLAUD_PTY=1` (leia antes o aviso em [Privacidade e segurança](#privacidade-e-segurança)).
Usa o `node-pty`, o `@xterm/headless` (dependências opcionais) e o `claude` do PATH (`HABBLAUD_CLAUDE_BIN` para
outro); só aceita pedidos do próprio computador. Ao iniciar, o Habblaud abre um terminal de teste: se o `node-pty` ou
o `claude` não funcionarem, o recurso fica desligado e o log diz o motivo. **Reiniciar o Habblaud encerra as sessões
abertas por ele.**
O terminal ao vivo continua no histórico de sessões, para subagentes e quando o interativo está desligado.

### Timelapse do dia

O botão **Timelapse** (relógio com a seta de voltar, ou a tecla `L`) reproduz o dia em alta velocidade: salas
acendendo e apagando, agentes chegando, trabalhando, esperando você, indo para as rodas, subagentes entrando e saindo.
A barra de reprodução tem o dia, play/pausa, a velocidade (60×, 180× ou 600×: um dia de 10 h em 10, 3⅓ ou 1 min),
a linha do tempo arrastável com o gráfico de quem estava presente e trabalhando, as marcas dos picos (clique para
pular até lá) e **Voltar ao vivo**. Enquanto isso, o escritório fica levemente sépia, com o selo **REPLAY 14:32**, e o
feed continua mostrando o que acontece agora.

O servidor grava a linha do tempo **a partir do momento em que está ligado** (não dá para reconstruir o passado):
resumos do que o escritório mostra, sem conversas, em `~/.habblaud/timeline/` (no Docker, no volume de dados), com
limite de tamanho por dia e os últimos **7 dias** guardados. Para não gravar: `HABBLAUD_TIMELINE=0`. Detalhes em
[`server/README.md`](server/README.md#linha-do-tempo-timelapse).

Os personagens andam mais rápido no replay, mas nas velocidades altas quem fica pouco tempo no escritório quase não
chega à mesa; pular para outro ponto mostra todos já no lugar.
### Responder pelo escritório

Com o plugin de permissões instalado (`npm run mod:install`, que o instala junto com o mod; no Claude Code anterior
ao 2.1.287, `npm run hooks:install`), quando um agente pede permissão — rodar um comando, editar um arquivo, abrir
uma página — o pedido aparece no escritório: o personagem levanta a mão, um aviso com **Responder**
surge na tela e, nos detalhes do agente, o cartão **Pede permissão** mostra o comando (ou o diff da edição) com os
botões:

- **Aprovar** — e, quando o Claude Code sugere, **Aprovar e não perguntar de novo** (a mesma regra que o terminal
  ofereceria, por exemplo `Bash(npm test:*)` neste projeto);
- **Recusar** — com um motivo opcional, que vai para o agente, e a opção de interrompê-lo;
- **Responder no terminal** — o Habblaud deixa o pedido de lado.

O diálogo continua aparecendo no terminal ao mesmo tempo, e vale o que você responder primeiro: respondeu no
terminal, o pedido some do escritório sozinho. O contador **precisam de você** (e a tecla `P`) leva até cada pedido.

**Perguntas do agente** (`AskUserQuestion`) também: o cartão de perguntas mostra cada pergunta com as
opções e as descrições, como o terminal mostraria. Escolha uma opção (ou várias, quando a pergunta deixa) ou escreva
a sua em **Outro**, e use **Responder**; **Recusar…** diz ao agente que você não quer responder, e **Responder no
terminal** deixa a pergunta lá. A resposta chega ao agente como se você tivesse escolhido no terminal.

- O pedido passa por um hook `PermissionRequest` do Claude Code (o do plugin, ou o do jeito antigo), que só o desvia
  quando há **alguma página do Habblaud aberta** neste computador; com o Habblaud parado ou sem nenhuma página, ele
  sai na hora e o terminal segue normal.
- Sem resposta pelo escritório em 5 minutos (até 24 h com `HABBLAUD_PERMISSION_TIMEOUT=86400` no `env` do
  `settings.json`), o pedido volta a valer só no terminal (as opções do plugin estão em
  [`mod/README.md`](mod/README.md); no jeito antigo, `npm run hooks:install -- --timeout 120` muda o tempo e
  `--port`, a porta). Em **subagentes em segundo plano** o Claude Code só mostra o diálogo no terminal depois que o
  hook termina: responda pelo escritório ou use **Responder no terminal**. Numa espera maior que 5 minutos, se nenhuma
  página que responda ficar aberta por 5 minutos (e nenhum [celular com login](#celular-com-login-e-https-aprovando-pedidos)
  estiver configurado para responder), o pedido volta ao terminal.
- Funciona com a mesma trava do terminal: só com o Habblaud acessível apenas pelo próprio
  computador e aberto por `http://localhost`. Confira com `npm run mod:status` (ou `npm run hooks:status`, no jeito
  antigo). Também funciona pelo [celular com login](#celular-com-login-e-https-aprovando-pedidos) (lá, é o padrão).
- No modo demonstração, os agentes fictícios também pedem permissão e fazem perguntas (de mentira), para
  experimentar.

### Mandar mensagens

Com o plugin de mensagens instalado (`npm run mod:install`, que o instala junto com o mod; precisa do Claude Code
2.1.287 ou mais novo), os detalhes de cada agente principal ganham a seção **Mandar mensagem**, e o rodapé do
[terminal](#terminal) vira uma caixa de digitação. Escreva e aperte `Enter` (`Shift+Enter` quebra a linha): o texto
entra na sessão **como se você tivesse digitado no terminal dela**. Dá para responder quando o agente termina o turno
e espera o próximo pedido, dar uma instrução nova ou corrigir o rumo, sem procurar a janela certa.

- A caixa mostra a situação: **na fila** (a sessão busca as mensagens a cada 2 segundos), **entregue** ou **não
  entregue**, com o motivo. Com o agente ocupado, a mensagem espera e entra quando ele terminar o turno, como um
  prompt digitado com o agente trabalhando.
- O plugin roda dentro de cada sessão e só fala com o Habblaud em `127.0.0.1`. Sem ele (ou numa sessão aberta antes
  da instalação: use `/reload-plugins`), aparece a dica de instalação no lugar da caixa. Subagentes não recebem
  mensagens.
- Funciona com a mesma trava do terminal (só com acesso local) e pode ser desligado com `HABBLAUD_MENSAGENS=0`.
  Leia o aviso em [Privacidade e segurança](#privacidade-e-segurança).
  Pelo [celular com login](#celular-com-login-e-https-aprovando-pedidos), só com `messages` no `HABBLAUD_REMOTE_ALLOW`.
- No modo demonstração, os agentes fictícios também recebem mensagens (de mentira).

### Editar o personagem

Cada sessão chega com um nome e uma aparência sorteados. Para fixar o personagem de um projeto, abra os detalhes do
agente principal e clique no lápis ao lado do nome (**Editar personagem**). No editor:

- **Nome:** até 24 caracteres. Não pode repetir o de alguém que está no escritório nem o escolhido para outro
  projeto.
- **Sortear:** traz outra aparência.
- **Peças:** pele, cabelo, barba, olhos, parte de cima, parte de baixo, sapatos e acessório, com a prévia ao lado.
- **Salvar:** vale para o projeto (a sala). A próxima sessão aberta nele chega com esse personagem. Com duas sessões
  ao mesmo tempo na mesma sala, a segunda recebe um personagem sorteado.
- **Voltar ao sorteio:** desfaz a escolha.

A escolha fica em `~/.habblaud/names.json` e some depois de 60 dias sem uso do projeto. O editor tem a mesma trava do
terminal: o lápis só aparece com o terminal ligado (sem `HABBLAUD_TERMINAL=0`) e o acesso local, isto
é, com o Habblaud acessível apenas pelo próprio computador e aberto por `http://localhost`.

### Codex

As sessões do Codex (CLI ou app) aparecem como as do Claude Code: personagem, sala do projeto, atividade, tarefas,
subagentes, terminal e histórico, uso de 5 horas e semanal e o **Meu dia** (só tokens: o Codex não informa custo). O
chip da conta do Codex é vazado e leva o selo **CODEX**.

- **Sem instalar nada**, o Habblaud lê os arquivos que o próprio Codex grava (as conversas em `~/.codex/sessions` e as
  travas das sessões abertas em `~/.codex/thread-writer-locks`). Só que o Codex grava cada passo **depois** que ele
  termina e nunca grava "esperando você": sem os hooks, o escritório mostra o Codex com atraso e não avisa quando ele
  precisa de você.
- **Com os hooks** (`npm run codex:install` e aprovar em `/hooks`), o Codex avisa o Habblaud a cada passo: a sessão
  aparece na hora, a atividade é a de agora e um pedido de aprovação levanta a mão do personagem.
- **Aprovar pelo escritório:** com alguma página do Habblaud aberta, o pedido de aprovação do Codex espera a sua
  resposta no cartão **Pede permissão** por até **25 segundos** (`npm run codex:install -- --espera <s>`, de 5 a 120):
  **Aprovar** ou **Recusar** (com o motivo). Diferente do Claude Code, o Codex só mostra a aprovação no terminal
  **depois** que o escritório responde ou o prazo acaba — nesse meio-tempo o terminal mostra "Aguardando resposta no
  Habblaud…". Não há "sempre permitir" nem "interromper", e o Codex não deixa responder as perguntas dele por fora.
- **Mandar mensagens:** a caixa **Mandar mensagem** funciona para o Codex também, pelo `codex queue`: a mensagem entra
  na fila da sessão e o Codex a pega quando termina o que está fazendo (até uns 10 segundos depois). No modo Node o
  próprio Habblaud roda o comando; **no Docker**, deixe `npm run codex:bridge` rodando no Mac (o container não
  enxerga o seu Codex).
- **Uso de 5 horas e semanal:** vem dos próprios arquivos do Codex e só se renova enquanto alguma sessão roda; o cartão
  mostra a idade dos números e "sem cota" quando o workspace ficou sem créditos.
- **Quando a sessão entra:** com a primeira mensagem (é quando o Codex grava a pasta do projeto); uma CLI aberta e
  ainda sem conversa não aparece.
- **Quando a sessão sai do escritório:** a CLI do Codex roda as sessões num servidor em segundo plano, que as mantém
  carregadas até um minuto depois de ficarem ociosas e sem ninguém olhando; por isso o personagem pode demorar um
  pouco para ir embora depois que você fecha o terminal.
- Conversas da nuvem do ChatGPT (sem arquivo no computador) não aparecem. `HABBLAUD_CODEX=0` desliga o Codex.

### GitHub no escritório

O que os agentes fazem no GitHub anima a sala do projeto, sem token e sem acessar a internet: o Habblaud lê nos
transcripts as chamadas (`gh pr create`, `gh pr merge`, `git push`, `gh run watch`, `gh pr checks`, `gh run view`,
`gh release create` e as ferramentas do MCP do GitHub) e os resultados delas.

| Evento | O que acontece |
| --- | --- |
| 🎉 **PR aberto ou mergeado, release publicada** | Confete cai na sala, todos comemoram com pulinhos e uma faixa diz o motivo ("PR #12 mergeado!") por ~12 s. |
| 🚨 **CI vermelho** | Giroflex piscando nos cantos da sala, chão avermelhado e um balão "!" sobre quem viu a falha, até um CI verde na sala (que vira festa) ou por 10 min. |
| 🚀 **Push** | Só o aviso e o feed. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/github-party.png" alt="Sala app-mobile em festa: confete caindo, a faixa dourada 'PR #12 mergeado!' e Jéssica de pé com os braços para cima e uma estrela sobre a cabeça" /></td>
    <td width="50%"><img src="docs/screenshots/github-alarm.png" alt="Sala data-pipeline em alarme: chão avermelhado, faixa vermelha 'CI falhou (feat/checkout)', giroflex nos cantos de cima e um balão '!' vermelho ao lado de Ícaro" /></td>
  </tr>
</table>

Cada evento também gera um aviso ("🎉 Danilo abriu o PR #12 em habblaud", "🚨 CI falhou em habblaud (feat/x)") e entra
no feed. Só o que acontece ao vivo anima a sala: o que já estava nos transcripts quando o Habblaud abriu vai só para o
histórico. Com "reduzir movimento" ligado no sistema, nada pisca nem gira. No modo demonstração, PRs, merges e CIs
fictícios aparecem de tempos em tempos.
### Meu dia

O botão **Meu dia** (ou a tecla `M`) mostra para onde foi o dia: quanto tempo os agentes passaram trabalhando e,
em destaque, quanto tempo ficaram **esperando você** (permissão, pergunta ou escolha) — com a maior espera, quem
esperou, onde e quando. Ao lado, sessões, subagentes, pedidos, tokens e custo (quando o Claude Code grava o custo no
transcript), e gráficos por hora, por projeto (do que mais esperou você para o que menos esperou) e por conta, além
do ranking das maiores esperas. Escolha o dia no seletor (o Habblaud guarda os últimos 30); aberto no dia de hoje,
o painel se atualiza a cada 30 s. Cada gráfico tem uma versão em tabela, e a legenda liga e desliga cada status.

O tempo é **tempo de agente**: dois agentes trabalhando por uma hora contam duas horas. O Habblaud só conta o que
acontece enquanto ele está rodando, e o dia segue o fuso do seu navegador. Com o modo demonstração ligado, o painel
mostra números fictícios (com o selo "demonstração") e deixa alternar para os dados reais; os agentes do demo nunca
entram nas estatísticas de verdade.

### Modo demonstração

Quer ver o escritório cheio sem ter sessões abertas?

- Acrescente **`?mock=1`** à URL (ex.: http://localhost:4747/?mock=1) para simular tudo no navegador, sem as suas
  sessões reais. Parâmetros: `&speed=3` acelera o tempo e `&sessions=6` muda o número de sessões simuladas.
- Ou ligue pela interface — **Ver demonstração** (quando o escritório está vazio) ou **Configurações › Modo
  demonstração** —, que coloca agentes fictícios junto com os reais. Com `npm run demo` (ou `HABBLAUD_DEMO=1` no
  `.env` do Docker), esse modo já começa ligado.

## Contas e uso (5 horas e semanal)

> As contas do **Codex** entram sozinhas (cada pasta `~/.codex*` ou `CODEX_HOME` é uma conta; a letra vem de um
> `alias x='CODEX_HOME=… codex'`, se houver) e o uso delas vem dos arquivos do Codex; veja [Codex](#codex). O resto
> desta seção é sobre o Claude Code.

Se você usa mais de uma conta do Claude Code (por exemplo, um atalho `c` com `~/.claude` e um `d` com
`CLAUDE_CONFIG_DIR=~/.claude-conta2`), o Habblaud mostra todas juntas: cada agente leva o chip da sua conta e o topo
mostra, para cada conta, o **percentual usado** da sessão de 5 horas e da semana e **quando cada limite reinicia**.

**Como as contas são reconhecidas.** Cada pasta de configuração do Claude Code é uma conta: `~/.claude` e qualquer
`~/.claude*` com `projects/` ou `sessions/` (além de `CLAUDE_CONFIG_DIR`). Para dar a letra de cada uma, o Habblaud
lê nos arquivos do shell (`~/.zshrc`, `~/.bashrc`…) **somente** as linhas `alias x='... claude ...'`:

```bash
alias c='claude'
alias d='CLAUDE_CONFIG_DIR=~/.claude-conta2 claude'
```

vira **Conta C** e **Conta D**. Só valem atalhos de até 3 letras; contas sem atalho recebem A, B…

**De onde vêm os números.** O jeito recomendado é o mod do Habblaud (`npm run mod:install`, Claude Code 2.1.287+):
dentro de cada sessão, ele recebe do próprio Claude Code os limites do plano e guarda só os percentuais de 5 horas e
da semana (e quando reiniciam) em `~/.habblaud/usage/<conta>.json`. Os números chegam depois da próxima resposta de
cada conta. Confira com `npm run mod:status`. Em versões anteriores do Claude Code, o tap de statusline
(`npm run usage:install`) faz o mesmo pelo comando de statusline, no mesmo arquivo.

<details>
<summary><b>Detalhes do tap e do cache do /usage</b></summary>

- O `usage:install` (jeito antigo) altera, em `<conta>/settings.json`, **só** o campo `statusLine.command`: o comando
  original (ex.: `npx -y ccstatusline`) passa a rodar através de `node "<pasta do Habblaud>/scripts/statusline-tap.mjs" --
  <comando original>` (no Windows, o comando original roda no Git Bash, como o Claude Code o rodaria). Uma cópia do
  arquivo vai antes para `settings.json.habblaud-backup-<data>`. Se a conta não tinha statusline, é criado um que só
  captura o uso. `npm run usage:install -- --dry-run` mostra o que mudaria sem gravar.
- O tap repassa o mesmo JSON ao seu statusline (saída e código de saída continuam os dele) e grava **somente**
  `{accountId, configDir, fetchedAt, five_hour, seven_day}` — nada de prompts, custos ou caminhos de projeto. Qualquer
  falha na captura é ignorada: o statusline nunca quebra por causa do Habblaud.

| Fonte | Como funciona |
| --- | --- |
| **Mod do Habblaud** (recomendado) | Ao vivo, como descrito acima. Substitui o tap: o `mod:install` tira o tap da conta. |
| Tap de statusline (Claude Code anterior ao 2.1.287) | Ao vivo, pelo comando de statusline, no mesmo arquivo. |
| Cache do `/usage` (sempre ligado) | O Claude Code grava o último resultado do comando `/usage`. No modo Node, o Habblaud relê a cada 60 s; no Docker, vale o valor lido no último `npm run docker:up`. Só muda quando alguém roda `/usage`. |

As fontes são arquivos locais: nenhuma lê senhas ou tokens, nem faz chamadas de rede. Vale sempre a fonte com os
números mais recentes. Números com mais de 30 minutos aparecem como **desatualizados**; uma janela que já reiniciou
desde a coleta aparece como **—** até chegarem números novos.

</details>

## Configuração

Tudo funciona sem configurar nada. Se precisar ajustar, use variáveis de ambiente:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | Porta HTTP (no Docker, a porta publicada no host). |
| `HABBLAUD_HOST` | `127.0.0.1` | Interface do servidor no modo Node. Fora de `127.0.0.1`/`localhost`, o terminal (e responder e mandar mensagens pelo escritório) fica desligado. |
| `HABBLAUD_BIND` | `127.0.0.1` | Só Docker (no `.env`): onde a porta é publicada. `0.0.0.0` libera a rede local (e desliga o terminal e o que age sobre as sessões). |
| `HABBLAUD_CLAUDE_DIRS` | detecção automática | Pastas das contas, separadas por vírgula (ex.: `/caminho/conta1,/caminho/conta2`). |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Onde o Habblaud guarda os próprios dados (nomes dos personagens e das salas, linha do tempo do timelapse e estatísticas do Meu dia). |
| `HABBLAUD_TIMELINE` | ligado | `0` desliga a gravação da linha do tempo (os dias já gravados continuam no timelapse). No Docker fica sempre ligado. |
| `HABBLAUD_USAGE_DIR` | `~/.habblaud/usage` | Onde o mod (ou o tap de statusline) grava o uso. |
| `HABBLAUD_DEMO` | desligado | `1` liga o modo demonstração ao iniciar. |
| `HABBLAUD_ALLOWED_HOSTS` | — | Nomes extras aceitos no endereço (ex.: `meu-mac.local`), além de `localhost` e IPs. |
| `HABBLAUD_TERMINAL` | ligado (só com acesso local) | `0` desliga o terminal, responder e mandar mensagens pelo escritório e o editor de personagem. Com a porta exposta eles já ficam desligados, sem opção de ligar. |
| `HABBLAUD_PTY` | desligado | `1` liga o terminal interativo (abrir, assumir e encerrar sessões do Claude Code pelo escritório; só com acesso local e fora do Docker) e o **Novo agente** (também no Docker, pelo `npm run codex:bridge`). Leia o aviso em [Privacidade e segurança](#privacidade-e-segurança). |
| `HABBLAUD_CLAUDE_BIN` | `claude` do PATH | O executável do Claude Code que o terminal interativo e o Novo agente rodam. |
| `HABBLAUD_REMOTE_ALLOW` | `permissions` | O que o [celular com login](#celular-com-login-e-https-aprovando-pedidos) pode fazer: `permissions`, `messages`, `terminal`, `spawn` (separados por vírgula) ou `none`. Os outros `HABBLAUD_REMOTE_*` são escritos pelo `npm run remote:setup`. |
| `HABBLAUD_MENSAGENS` | ligado (com o terminal) | `0` desliga só as mensagens pelo escritório (a caixa no terminal e nos detalhes do agente). |
| `HABBLAUD_CODEX` | ligado | `0` desliga o Codex no escritório. |
| `HABBLAUD_CODEX_DIRS` | detecção automática | Pastas do Codex, separadas por vírgula (no lugar de `~/.codex*` e `CODEX_HOME`). |
| `HABBLAUD_CODEX_BIN` | `codex` do PATH (no Windows, `codex.exe`) | O binário do Codex que entrega as mensagens (`codex queue`), no modo Node ou no `npm run codex:bridge`. |
| `HABBLAUD_UPDATE_CHECK` | ligado | `0` desliga a verificação de versão nova (uma consulta às releases do repositório no GitHub a cada 6 h). |
| `HABBLAUD_LANG` | idioma do sistema (menos inglês), senão `pt-BR` | Idioma dos textos montados pelo servidor (atividades, avisos, logs): `pt-BR`, `en`, `es` ou `fr`. A interface segue o navegador ou a escolha em Configurações › Idioma. Ver [Idiomas](#idiomas). |
| `HABBLAUD_ACCOUNTS` | — | JSON para personalizar nome, letra ou cor, casado pelo nome da pasta da conta. Ex.: `[{"id":".claude-conta2","name":"Trabalho","short":"T","color":"#5cc97b"}]`. |

**No Docker**, valem `HABBLAUD_PORT`, `HABBLAUD_BIND`, `HABBLAUD_ALLOWED_HOSTS`, `HABBLAUD_DEMO`, `HABBLAUD_TERMINAL`,
`HABBLAUD_MENSAGENS`, `HABBLAUD_CODEX`, `HABBLAUD_UPDATE_CHECK`, `HABBLAUD_LANG`, `HABBLAUD_PTY`, os `HABBLAUD_WORLD*` e os
`HABBLAUD_REMOTE_*` (no `.env` ou no ambiente) e `HABBLAUD_CLAUDE_DIRS`, `HABBLAUD_CODEX_DIRS`, `HABBLAUD_USAGE_DIR` e
`HABBLAUD_ACCOUNTS` (lidas pelo `docker:up` no host); as demais ficam fixas dentro do container. Opções: `npm run docker:up -- --no-build` (sobe sem reconstruir),
`npm run docker:down` (para) e `npm run docker:logs` (acompanha os logs).

## Habblaud World

O Habblaud World é uma cidade online em pixel art onde cada Habblaud vira um prédio, aceso ao vivo enquanto os agentes
trabalham, e cada pessoa passeia com um personagem. **Vem ligado por padrão**, apontando para `server.habblaud.com`;
**nada sai do computador até você criar a conta** e entrar, e `HABBLAUD_WORLD=0` desliga tudo. O acesso é liberado por
lista de espera.

**Como configurar.** As variáveis abaixo (no `.env` ou no ambiente) são opcionais: sem elas, o Habblaud aponta para o
servidor oficial. A seção aparece na janela **Habblaud World** (o botão de cidade na barra do topo) e só funciona pelo próprio computador (nunca pela porta do celular); a
conta fica só aqui, em `~/.habblaud/world.json` (permissão 600; no Docker, no volume `/data`).

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `HABBLAUD_WORLD_URL` | `https://server.habblaud.com` | Endereço do servidor do mundo, só `https://` ou `wss://` (sem caminho). |
| `HABBLAUD_WORLD` | ligado | `0` desliga tudo do World (rotas e interface) e nada sai do computador. |
| `HABBLAUD_WORLD_DEV` | desligado | `1` aceita um servidor do mundo local sem TLS: `http://127.0.0.1:<porta>` (o `npm run dev` já aceita) ou, de dentro do Docker, `http://host.docker.internal:<porta>`. |

**Privacidade.** Nada do seu trabalho sai do computador. Do prédio saem só o tema, um andar por sala aberta (com um
código aleatório que muda todo dia) e, de cada agente, se é principal ou subagente, a ferramenta, o status, a
aparência, um nome sorteado e a faixa de tarefas concluídas no dia. Caminhos, nomes de projeto, títulos, comandos,
mensagens, código, custo, modelo, branch e a sua conta do Claude nunca saem. A lista completa, campo a campo:
[docs/world/privacidade.md](docs/world/privacidade.md). **Ver o que foi enviado**, no cartão Seu prédio, mostra o JSON
exato da última remessa, com o tamanho em bytes e a resposta do mundo.

**Conta e lista de espera.** Cadastro com e-mail, **nome de jogador** (3 a 20 caracteres, único no mundo: fica reservado
para você enquanto espera na lista e vira o nome do personagem) e senha (12 caracteres ou mais; senhas que já vazaram
são recusadas), código de 6 dígitos por e-mail e o aceite dos Termos de Uso e da Política de Privacidade. Toda conta
entra numa lista de espera, e o acesso é liberado por lotes: o Habblaud aberto confere sozinho a cada 30 minutos. Até 3
computadores por conta (**Dispositivos**, com revogar).

**Personagem.** O nome de jogador escolhido no cadastro (dá para trocar depois, uma vez a cada 30 dias), o mesmo editor
de aparência dos agentes, 2 ou 3 traços de personalidade e uma frase de apresentação da lista (no mundo não há texto
livre além do nome). Dá para criar ainda na lista de espera.

**Prédio.** Com a conta liberada e o personagem criado, o prédio sobe sozinho (por WebSocket) e acompanha o escritório
ao vivo. O cartão **Seu prédio** mostra a conexão, os andares, os agentes, a última remessa e, quando o mundo recusa uma
remessa ou para o prédio (versão antiga, outro computador, conta suspensa ou banida), o motivo; conta suspensa ou
banida ganha **Recorrer por e-mail**. Um prédio marcado como "não verificado" (números fora do plausível, em revisão)
fica fora de placares e destaques e mostra **Contestar por e-mail**. Quando o mundo está em manutenção, o cartão diz, e
o Habblaud tenta de novo sozinho.

**Visibilidade.** Ao vivo (andares, contadores e o status de cada personagem) ou **modo discreto** (só aceso ou apagado
e o número de andares); fechado a visitas; esconder o país; os **tokens** do prédio só em faixas (até 100 mil, 1
milhão…), nunca o número nem o custo, e dá para desligar; placar e compactações só se você ligar; bater na porta
(**Avisar quando baterem na porta**) também só se você ligar.

**Cidade.** O botão **Mundo**, na barra do topo, troca o escritório pela cidade: anda-se com setas/WASD ou clicando, o
cartão de cada prédio mostra andares, agentes e estado, e o minimapa fica no canto; pausado ou fora do mundo, o seu
prédio fica apagado, mas dá para andar pela cidade. No modo demonstração (`?mock=1&world=approved&scene=city`, só
prédios e pessoas fictícios): [a cidade](docs/screenshots/world-cidade.png) e
[o cartão de um prédio](docs/screenshots/world-cartao.png).

**Visitas.** Perto da porta de um prédio, **Entrar (E)** leva para dentro: o escritório do dono ao vivo, com as salas de
nomes fictícios e os agentes no status de agora, só para ver (nada de terminal, mensagens ou permissões, e nada do
trabalho); prédio fechado a visitas só se vê por fora. No seu, você vê "N visitantes agora" (só a contagem, nunca quem).
No modo demonstração: [a visita](docs/screenshots/world-visita.png) e
[o painel da visita](docs/screenshots/world-visita-painel.png).

**Social.** Na cidade, sem nenhum texto livre: **L** curte o prédio perto da porta, **G** abre a roda de cumprimentos
(frases prontas, traduzidas para quem lê) e **K** bate na porta de quem aceita; o cartão de cada pessoa tem
Cumprimentar, Bloquear e Denunciar, e o minimapa leva a um prédio pelo código ("Ir para HB-XXXX") ou a um prédio aceso
qualquer. Dentro de um prédio, **Curtir** e **Deixar um carimbo** na portaria (um por prédio por dia). Na praça, o
termômetro da meta da semana da cidade e, quando ela bate, fogos. No escritório, o chip "❤️ N hoje" e o cartão "Enquanto
você estava fora" com as visitas, os likes e os carimbos deixados na portaria (nunca quem); quem você bloqueou fica em
**Bloqueados**, com **Desbloquear**. No modo demonstração: [a roda de cumprimentos](docs/screenshots/world-social.png) e
[a praça com os fogos](docs/screenshots/world-praca.png).

**Pausar, sair, excluir.** **Pausar** apaga o prédio na hora e guarda o lote (com 30 dias pausado, ele some do mapa; 30
dias depois, é retirado). **Sair do mundo** retira o prédio e libera o lote; a conta e o personagem continuam, e voltar
cria um prédio novo. **Excluir conta** (em **Conta e dados**, com o código que chega por e-mail) tira o prédio e o
perfil do mundo na hora, apaga a conta, os likes, os bloqueios, as denúncias feitas e os dispositivos do banco em 7 dias
(e dos backups em até 30) e apaga o `world.json` deste computador. Sem notícias do Habblaud por 7 dias, o prédio some do
mapa e, 30 dias depois, é retirado; um e-mail avisa 3 dias antes (desligável em **Conta e dados**).

**Exportar.** **Baixar meus dados** (em **Conta e dados**) salva `habblaud-world-dados.json` com o que o mundo guarda da
sua conta: e-mail, datas, personagem, visibilidade, dispositivos, prédio, likes dados, bloqueios e denúncias feitas. Uma
vez por dia.

**Dados verdadeiros.** O World só funciona se os prédios forem de verdade: mudar o Habblaud para mandar andares,
agentes, status, tokens ou personagens inventados ou inflados quebra os Termos de Uso e bane a conta (o servidor confere
a plausibilidade de cada pacote). Mudar o Habblaud para qualquer outra coisa continua livre (MIT). Como o Habblaud fala
com o World: [shared/world/README.md](shared/world/README.md).

**Testar com um servidor do mundo local.** Para quem desenvolve o World, com o servidor do mundo rodando no próprio
computador (por exemplo, em Docker, publicado na porta 4848):

- Fora do Docker: `HABBLAUD_WORLD_URL=http://127.0.0.1:4848 npm run dev`.
- Com o Habblaud no Docker: no `.env` desta pasta, `HABBLAUD_WORLD_URL=http://host.docker.internal:4848` e
  `HABBLAUD_WORLD_DEV=1`; depois, `npm run docker:up`, que termina com a linha do World
  (`Habblaud World: ligado: http://host.docker.internal:4848`, ou por que ficou desligado). O `docker-compose.yml` já liga
  `host.docker.internal` ao host (`extra_hosts` com `host-gateway`; no Docker Desktop o nome já existe). No Linux, o
  servidor do mundo precisa escutar numa interface que o container alcança (`0.0.0.0` ou o IP da ponte do Docker): uma
  porta publicada só em `127.0.0.1` do host não responde por `host-gateway`.
- Sem TLS, só com `HABBLAUD_WORLD_DEV=1` (ou `--dev`) e só para `127.0.0.1` e `host.docker.internal`; fora disso, só
  `https://` ou `wss://`. O servidor do mundo precisa aceitar o nome usado na URL como o host do jogo (senão responde
  `421`).

Como a seção fica, no modo demonstração (`?mock=1&world=logged_out`, `waiting` ou `approved`):
[sem conta](docs/screenshots/world-sem-conta.png), [lista de espera](docs/screenshots/world-lista-de-espera.png),
[personagem](docs/screenshots/world-personagem.png), [Seu prédio](docs/screenshots/world-predio.png) e
[o que foi enviado](docs/screenshots/world-enviado.png).

## Como funciona

```
 ~/.claude*/sessions/<pid>.json ─────────────────┐
 ~/.claude*/projects/<projeto>/<sessão>.jsonl ───┼──▶ servidor Node ──▶ modelo do escritório ──▶ SSE ──▶ navegador
 .../<sessão>/subagents/**/agent-*.jsonl ────────┘    (polling de 1 s)                                 (canvas + interface)
```

- **Quem está no escritório:** enquanto uma sessão está aberta, o Claude Code mantém `sessions/<pid>.json` com o
  projeto e o status (ocupado, ocioso, esperando você ou esperando um shell em segundo plano). É isso que decide
  quem aparece e o que cada um faz.
- **Shells rodando:** nos transcripts, cada `Bash` em segundo plano (ou comando longo em primeiro plano) vira um
  "shell" com rótulo e cronômetro, até chegar a notificação de que terminou, falhou ou foi interrompido.
- **Vida social:** as rodas, as personalidades e as moedinhas são simulação do navegador (`client/src/world/social/`),
  sem nenhum efeito nos agentes de verdade. A personalidade sai da semente de cada agente (é a mesma em qualquer
  navegador); as carteiras ficam no `localStorage` do navegador.
- **O que cada um está fazendo:** o servidor acompanha o fim dos transcripts (`.jsonl`) das sessões abertas e traduz
  cada chamada de ferramenta numa atividade em português, com ícone. Dali também saem tarefas, título, modelo e
  estatísticas.
- **Subagentes:** os transcripts em `<sessão>/subagents/` (inclusive os de workflows) viram personagens ligados ao
  agente que os chamou.
- **GitHub:** PRs, pushes, CI e releases saem das mesmas linhas do transcript (o comando e a saída dele, ou o
  `gitOperation` que o próprio Claude Code grava); nada é consultado no GitHub.
- **O desenho:** o navegador recebe o estado por SSE e desenha tudo num canvas — personagens, móveis, pisos e paredes
  são pixel art **gerada por código**; já o logotipo, as ilustrações e os quadros das paredes foram gerados com IA.

<details>
<summary><b>Estrutura do código e API</b></summary>

```
shared/   protocolo (types.ts), atividades em PT-BR, nomes, simulador de demonstração
server/   servidor HTTP + SSE: contas e uso, leitura das sessões e transcripts, modelo do escritório
client/   Vite: src/art (pixel art procedural), src/world (o escritório no canvas), src/ui (interface)
scripts/  build do servidor, docker-up, instaladores (mod, tap de statusline e hook de permissão) e screenshots
mod/      o mod do Habblaud e os plugins de permissões e de mensagens (plugins do Claude Code; marketplace em .claude-plugin/)
```

| Rota | Descrição |
| --- | --- |
| `GET /api/stream` | SSE com os eventos `snapshot`, `feed` e `notice` (formato em `shared/types.ts`). |
| `GET /api/snapshot` | Estado atual do escritório. |
| `GET /api/agents/:id` | Detalhes de um agente, com até 200 atividades. |
| `GET /api/agents/:id/terminal` | SSE do terminal (eventos `init` e `append`); só com acesso local. |
| `PUT /api/agents/:id/character` | Editar o personagem: `{name, seed, parts}` grava o nome e a aparência do agente principal como o personagem do projeto (a sala); só com acesso local. |
| `DELETE /api/agents/:id/character` | "Voltar ao sorteio": apaga o personagem do projeto e o agente volta ao nome sorteado; só com acesso local. |
| `GET /api/sessions/recent` | Histórico: sessões dos últimos 7 dias de todas as contas (até 150); só com acesso local. |
| `GET /api/sessions/:conta/:sessionId/terminal` | SSE da conversa de uma sessão do histórico (mesmo protocolo do terminal); só com acesso local. |
| `GET /api/stats?day=AAAA-MM-DD` | Estatísticas do Meu dia (tempo por status, projetos, contas, horas, esperas, tokens e custo). |
| `GET /api/stats/days` | Dias com estatísticas (os últimos 30). |
| `GET /api/timeline/days` | Dias gravados para o timelapse, com tamanho e horário do primeiro e do último registro. |
| `GET /api/timeline/:dia` | Linha do tempo de um dia (`AAAA-MM-DD`), em JSONL (com gzip). |
| `GET /api/health` | Saúde: versão, demonstração, Docker, terminal, responder e mandar mensagens pelo escritório, fontes e status de uso de cada conta. |
| `POST /api/demo` | `{"enabled": true \| false}` liga ou desliga os agentes simulados. |
| `POST /api/rooms/rename` | `{"id": sala, "name": nome}` renomeia a sala (vazio volta ao nome da pasta); o nome fica em `rooms.json`, na pasta de dados. Só com acesso local. |
| `GET /api/mod/summary` | Para o mod do Claude Code: versão, quantos agentes, quantos trabalham e quem precisa de você (sem o demo e, com `?account=&session=`, sem a própria sessão). |
| `/api/permissions…` | Responder pelo escritório: o hook de permissão registra o pedido (permissão ou pergunta) e espera; a página busca o detalhe e decide ou responde. Só com acesso local. |
| `/api/messages…` e `/api/mod/inbox…` | Mandar mensagens: a página deixa a mensagem na fila e acompanha a entrega; o plugin `habblaud-mensagens` a busca, entrega à sessão e confirma. Só com acesso local. |
| `POST /api/codex/events` | Eventos dos hooks do Codex (sessão aberta, ferramenta, aprovação, fim do turno). Só com acesso local. |
| `/api/codex/bridge/poll` e `/ack` | O `npm run codex:bridge` busca as mensagens para o Codex e confirma a entrega. Só com acesso local. |

Mais detalhes do servidor em [`server/README.md`](server/README.md).

</details>

<details>
<summary><b>O que o Docker monta e por quê</b></summary>

| Host | Container | Para quê |
| --- | --- | --- |
| `<conta>/sessions/` | `/claude/<conta>/sessions` (somente leitura) | Sessões abertas e seus status. |
| `<conta>/projects/` | `/claude/<conta>/projects` (somente leitura) | Transcripts das sessões e dos subagentes. |
| `~/.habblaud/usage/` | `/usage` (somente leitura) | Uso capturado pelo mod (ou pelo tap de statusline). |
| volume `habblaud-data` | `/data` | Dados do próprio Habblaud (nomes dos personagens, linha do tempo do timelapse e estatísticas do Meu dia). |
| `~/.habblaud/remote-tls/server/` | `/remote-tls` (somente leitura) | Só depois do `npm run remote:setup`: o certificado e a chave do servidor do [celular com login](#celular-com-login-e-https-aprovando-pedidos) (nunca a chave da CA). |

A pasta da conta **nunca** é montada inteira (lá ficam credenciais e configurações). O container roda como usuário sem
privilégios, com sistema de arquivos somente leitura, sem capabilities extras e com `no-new-privileges`. Os metadados
das contas (letra, e-mail, organização) são lidos no host pelo `docker:up` e passados ao container.

</details>

## Privacidade e segurança

- **Só leitura:** o Habblaud nunca grava nas pastas do Claude Code. As exceções são os instaladores, que você roda:
  o `npm run mod:install` / `mod:uninstall` usa o próprio `claude plugin` (que registra o marketplace e os plugins
  no `settings.json` e em `<conta>/plugins/`) e, na instalação, tira o tap e o hook antigos com backup; no jeito
  antigo, o `npm run usage:install` / `usage:uninstall` muda só o `statusLine.command` do `settings.json` e o
  `npm run hooks:install` / `hooks:uninstall`, só a lista `hooks.PermissionRequest` — sempre com backup antes.
- **O mod:** roda dentro de cada sessão do Claude Code, com as suas permissões (como todo mod), e faz só o que está
  listado em [`mod/README.md`](mod/README.md) — `claude plugin validate mod/habblaud` mostra os eventos e as chamadas,
  sem rodar nada. Grava só os percentuais de uso de 5 horas e da semana (e quando reiniciam) em
  `~/.habblaud/usage/<conta>.json`; para a linha de "precisa de você" e o `/habblaud`, só fala com o Habblaud em
  `127.0.0.1`. Não lê a conversa, não chama o modelo e não envia nada para fora do computador. Ele é lido desta
  pasta: o que estiver nela (inclusive depois de um `git pull`) é o que roda. O plugin de mensagens
  (`habblaud-mensagens`) é separado justamente porque age: digita na sessão o que você mandou pelo escritório.
- **Só local, por padrão:** o servidor só aceita conexões do próprio computador; liberar a rede local é opcional.
  Não há telemetria. A única chamada externa é a verificação de versão nova: a cada 6 horas, uma consulta anônima,
  sem token, à API pública do GitHub (`api.github.com/repos/marmottajr/habblaud/releases/latest`). Ela não envia nada
  sobre as suas sessões; o GitHub vê só o seu IP e a versão em uso, que vai no `User-Agent`.
  `HABBLAUD_UPDATE_CHECK=0` desliga a consulta.
  O [Habblaud World](#habblaud-world) (ligado por padrão) só manda algo ao servidor do mundo depois de você criar a
  conta e entrar, e só o que está em [o que sai](docs/world/privacidade.md); `HABBLAUD_WORLD=0` desliga tudo.
  O [celular com login](#celular-com-login-e-https-aprovando-pedidos) também, e ele só existe depois do `npm run remote:setup`.
- **Sem credenciais:** o Habblaud não lê senhas nem tokens de acesso. Do `.claude.json` de cada conta aproveita só o
  e-mail, a organização e o cache do `/usage`; o uso ao vivo vem do mod (ou do tap de statusline).
- **Segredos mascarados:** tokens e senhas com formato conhecido (`Bearer`, `-u usuário:senha`, `TOKEN=`, chaves
  `sk-…`, `ghp_…`, `AKIA…`, JWTs, senhas em URLs) viram `***` antes de chegar ao navegador.
- **Protegido contra sites maliciosos:** o servidor recusa endereços que não sejam `localhost`/IP (DNS rebinding) e
  `POST` vindos de outras origens (CSRF), e não deixa a página ser embutida em outros sites.
- **Terminal só local:** a conversa completa das sessões (e o histórico das sessões encerradas, com os
  títulos) só sai do servidor com o Habblaud acessível apenas pelo próprio computador (`HABBLAUD_HOST` local no Node;
  `HABBLAUD_BIND` local no Docker) — não há como
  ligá-lo com a porta exposta — e cada pedido precisa vir por `localhost`/`127.0.0.1`: IPs da rede e nomes de
  `HABBLAUD_ALLOWED_HOSTS` (proxies, túneis) são recusados. Segredos são mascarados e textos longos truncados antes
  de chegar ao navegador; no modo demonstração, a conversa é fictícia. `HABBLAUD_TERMINAL=0` desliga de vez.
  A única exceção é o [celular com login](#celular-com-login-e-https-aprovando-pedidos), e só com `terminal` no `HABBLAUD_REMOTE_ALLOW`.
- **Linha do tempo do timelapse:** só os resumos que já aparecem na tela (atividade em uma linha, status, títulos,
  uso das contas, sem e-mails, comandos completos ou conversas), gravados em `~/.habblaud/timeline/` e apagados depois
  de 7 dias. `HABBLAUD_TIMELINE=0` desliga a gravação.
- **Responder pelo escritório, só local:** aprovar ou recusar age sobre as sessões, então segue a mesma trava do
  terminal (bind local, `Host` local, nada de proxies ou túneis) e só existe com o hook de permissão (o do plugin
  `habblaud-permissoes` ou o do jeito antigo) instalado por você. As respostas exigem JSON e origem local (um site
  aberto no navegador não consegue mandá-las), o hook só fala com `127.0.0.1` e, na dúvida — Habblaud fora do ar,
  erro, tempo esgotado —, sai sem decidir: vale o terminal. O comando completo ou o diff só saem do servidor para
  quem abriu a página pelo próprio computador. "Sempre permitir" só aplica uma regra que o próprio Claude Code sugeriu
  para aquele pedido. Atenção: qualquer programa ou pessoa que consiga abrir `http://localhost:4747` nesta máquina
  também consegue responder; em computadores compartilhados com outros usuários, não instale o hook
  (`npm run mod:install -- --sem-permissoes`).
  Exceção: o [celular com login](#celular-com-login-e-https-aprovando-pedidos) também responde (é o padrão dele) e vê o mesmo comando ou diff.
- **Mandar mensagens, só local — e com um aviso:** a mensagem entra na sessão como se você a tivesse digitado, então
  vale o que o agente pode fazer com um pedido seu. Segue a mesma trava (bind local, `Host` local, JSON e origem local,
  então um site aberto no navegador não consegue mandar), mas **qualquer programa desta máquina** que fale com
  `http://localhost:4747` — inclusive um agente rodando um comando — consegue deixar uma mensagem para outra sessão
  que tenha o plugin. Se isso não serve para você (computador compartilhado, agentes rodando sem supervisão), não
  instale o plugin (`npm run mod:install -- --sem-mensagens`) ou desligue com `HABBLAUD_MENSAGENS=0`. O texto das
  mensagens não é gravado: some do servidor assim que é entregue.
  Pelo [celular com login](#celular-com-login-e-https-aprovando-pedidos), só com `messages` no `HABBLAUD_REMOTE_ALLOW`.
- **Terminal interativo, opt-in — e com um aviso:** com `HABBLAUD_PTY=1`, o escritório abre o Claude Code em
  qualquer pasta, digita nele (inclusive `!comando`, que roda no shell) e encerra ou assume sessões abertas noutros
  terminais. Segue a mesma trava do terminal (bind local, `Host` local, nada de proxies ou túneis) e cada pedido
  precisa vir do próprio computador, com origem local (um site aberto no navegador não consegue mandar). Mesmo assim,
  **qualquer programa desta máquina** que fale com `http://localhost:4747` — inclusive um agente rodando um comando —
  ganha esse poder. Antes de encerrar um processo de fora, o Habblaud confere no registro de sessões e no sistema que
  aquele PID ainda é aquele Claude Code (mesmo início e executável). Em computadores compartilhados ou com agentes
  rodando sem supervisão, deixe desligado.
- **Celular com login, opt-in:** só existe depois do `npm run remote:setup`. Uma segunda porta com HTTPS (uma CA local
  que só assina nomes `.local`, `localhost`, o endereço próprio e IPs privados), usuário e senha (só o hash scrypt fica
  guardado); a sessão é um cookie `HttpOnly`, `SameSite=Strict` e `Secure` assinado com HMAC. Nessa porta, o que vale
  vem do `HABBLAUD_REMOTE_ALLOW` (por padrão, só responder pedidos de permissão), nunca do cabeçalho Host; as rotas
  dos hooks, dos plugins e do auxiliar do host, o terminal interativo, o editor de personagem e renomear salas nunca
  valem por ela. Quem tem a senha ganha o que você liberou: escolha uma forte e libere só o que precisa. A chave da CA
  fica em `~/.habblaud/remote-tls/ca` e nunca vai para o container.
- **Novo agente, opt-in:** com `HABBLAUD_PTY=1`, o escritório começa sessões do Claude Code com o pedido que você
  escreveu, na pasta que você escolher — vale o mesmo aviso do terminal interativo. Os anexos são gravados em
  `~/.habblaud/attachments/` (pasta 700, arquivos 600). No Docker, quem começa as sessões é o auxiliar do host
  (`npm run codex:bridge`), que também só lê os arquivos das entregas de pastas de projeto conhecidas (as que o Claude
  Code tem em `<conta>/projects`), da pasta temporária e dos anexos.
- **Editor de personagem, só local:** salvar ou voltar ao sorteio muda o escritório e grava em `names.json`, então
  segue a mesma trava do terminal (bind local, `Host` local, nada de proxies ou túneis): sem ela, o lápis não aparece
  e o servidor responde `403`. As mudanças exigem JSON e origem local. `HABBLAUD_TERMINAL=0` desliga junto.
- **Estatísticas do Meu dia:** só números agregados (tempo por status, contagens, tokens, custo) com nomes de projeto,
  conta e agente, guardados em `HABBLAUD_DATA_DIR/stats/` por 30 dias — nada da conversa.
- **Codex:** o Habblaud lê só as conversas (`sessions/`, `archived_sessions/`) e as travas das sessões abertas
  (`thread-writer-locks/`); no Docker, só essas três pastas são montadas, somente leitura. Nunca lê o `auth.json`, o
  `config.toml`, o ambiente do shell (`shell_snapshots/`), o histórico de prompts, os logs nem os bancos do Codex, e não
  mostra os ids da conta ChatGPT. O `npm run codex:install` só acrescenta grupos no `hooks.json` (com backup; os de
  outros apps ficam no mesmo lugar) e grava `~/.habblaud/codex-hook.json`; a aprovação dos hooks é sempre sua, em
  `/hooks`. Os hooks só falam com `127.0.0.1`. As mensagens ao Codex têm o mesmo aviso das do Claude Code: qualquer
  programa desta máquina que fale com o Habblaud consegue deixar uma mensagem na fila de uma sessão.
- **O que aparece na tela:** resumos das atividades (ferramenta, arquivo, comando ou consulta), títulos das sessões,
  tarefas e estatísticas (e, no terminal, a conversa). Não exponha a porta em redes em que você não
  confia.

## Desenvolvimento

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor + Vite em http://localhost:4747, com recarga automática. |
| `npm run dev:client` | Só o Vite, em http://localhost:5173 (abra com `?mock=1`; `/api` é repassado para a porta 4747). |
| `npm run demo` | `npm run dev` com o modo demonstração ligado. |
| `npm run build` / `npm start` | Compila e roda a versão de produção. |
| `npm test` | Testes (Vitest). |
| `npm run typecheck` | Verificação de tipos de cliente, servidor e scripts. |
| `claude plugin test mod/habblaud` | Testes do mod (sem sessão, conta nem rede); idem para `mod/habblaud-mensagens`. |
| `claude plugin validate .` | Valida o marketplace (`.claude-plugin/marketplace.json`); com `mod/habblaud`, `mod/habblaud-permissoes` ou `mod/habblaud-mensagens`, valida o plugin e lista os eventos e as chamadas do mod. |
| `claude --plugin-dir mod/habblaud` | Abre uma sessão com o mod desta pasta, sem instalar (edite e rode `/reload-plugins`). |
| `npm run mod:status` | Mostra, por conta, o marketplace, os plugins e as versões instaladas. |
| `npm run demo:timeline` | Gera uma linha do tempo fictícia (simulador do modo demonstração) para o timelapse. |
| `npm run release` | Publica a versão do `package.json` no GitHub (tag e release com as notas do `CHANGELOG.md`). |

Para tirar screenshots sem abrir o seu navegador, `scripts/shot.mjs` usa um Chromium headless isolado (Playwright).
Na primeira vez, baixe o navegador (uma vez só): `npx playwright-core install chromium-headless-shell`.

```bash
node scripts/shot.mjs 'http://localhost:4747/?mock=1&speed=3' /tmp/habblaud.png --size 1400x900 --wait 4000
```

No console do navegador, `habblaud.world.debug` tem ferramentas para testar cenas (ex.:
`habblaud.world.debug.setHour(21)` para ver a noite). Para fixar a hora já ao abrir, use `?hora=21:30` na URL.

**Timelapse só com dados fictícios** (ex.: para gravar um GIF): `npm run demo:timeline` roda o simulador do modo
demonstração offline e grava um dia inteiro (por padrão, ontem das 9h às 19h, com manhã cheia, almoço mais vazio e
pico à tarde) em `<tmp>/habblaud-demo/timeline/`. Depois suba um Habblaud que só leia essa pasta e não mostre as suas
sessões, e abra o Timelapse:

```bash
npm run demo:timeline -- --data-dir /tmp/habblaud-demo        # opções: --date, --start 8:30, --hours, --sessions, --seed
mkdir -p /tmp/habblaud-demo/vazio
HABBLAUD_DATA_DIR=/tmp/habblaud-demo HABBLAUD_TIMELINE=0 HABBLAUD_CLAUDE_DIRS=/tmp/habblaud-demo/vazio \
  HABBLAUD_PORT=4848 npm start                                 # depois de npm run build; abra http://localhost:4848
```

`HABBLAUD_TIMELINE=0` evita gravar nessa pasta; com a gravação ligada, dias com mais de 7 dias são apagados.

**Publicar uma versão:** toda versão tem a sua seção no [`CHANGELOG.md`](CHANGELOG.md), com o que entrou. Durante o
trabalho, anote as mudanças em "Não lançado". Para lançar:

1. Suba o número com `npm version minor --no-git-tag-version` (ou `patch`, numa versão só de correções).
2. Troque "Não lançado" pela versão e a data (`## [0.3.0] - AAAA-MM-DD`), deixe um "Não lançado" vazio em cima e
   atualize os links do fim. O `npm test` falha se a versão do `package.json` não tiver seção.
3. Faça o merge na `main` e rode `npm run release` (precisa do [`gh`](https://cli.github.com/) autenticado; `-- --dry-run`
   só mostra as notas). O script cria a tag `v0.3.0` e a release com o texto da seção. A partir daí, quem usa o
   Habblaud vê o selo **Nova versão**.

## Solução de problemas

<details>
<summary><b>O escritório está vazio</b></summary>

Só aparecem sessões **abertas** do Claude Code. Confira se há alguma rodando e se a conta foi detectada em
`http://localhost:4747/api/health`. Se as pastas das contas estiverem em outro lugar, use
`HABBLAUD_CLAUDE_DIRS=/caminho/conta1,/caminho/conta2`.

</details>

<details>
<summary><b>O uso aparece como "sem dados" ou "desatualizado"</b></summary>

Rode `npm run mod:install` (ou, no Claude Code anterior ao 2.1.287, `npm run usage:install`) e confira com
`npm run mod:status` (ou `npm run usage:status`). Os números chegam depois da próxima resposta numa sessão aberta
daquela conta; numa sessão aberta antes da instalação, rode `/reload-plugins` ou reabra a sessão. Um **—** no lugar
do percentual quer dizer que a janela reiniciou desde a última coleta.

</details>

<details>
<summary><b>O mod não carrega numa sessão</b></summary>

Rode `npm run mod:status`: ele mostra a versão do Claude Code (o mod precisa da 2.1.287 ou mais nova) e, por conta,
se o marketplace aponta para esta pasta e se os plugins estão instalados e ligados. Numa sessão aberta antes da
instalação, rode `/reload-plugins`; o `/plugin` mostra, embaixo das abas, os mods carregados (ex.:
`1 mod active · habblaud`). Mods não rodam com `"disableAllHooks": true` no `settings.json` da conta nem com
`claude --safe-mode`.

</details>

<details>
<summary><b>"A porta 4747 já está em uso"</b></summary>

Outro Habblaud (Node ou Docker) já está rodando. Pare-o (`npm run docker:down`, ou Ctrl+C no terminal do
`npm start`) ou use outra porta: `HABBLAUD_PORT=4848 npm run docker:up` (Docker) ou `HABBLAUD_PORT=4848 npm start`
(Node).

</details>

<details>
<summary><b>Não abre no celular</b></summary>

Confira se criou o `.env` com `HABBLAUD_BIND=0.0.0.0` e recriou o container (`npm run docker:up -- --no-build`), se
o celular está no mesmo Wi-Fi e se o firewall do computador permite conexões na porta 4747. Por IP funciona direto;
para abrir por um nome (ex.: `meu-mac.local`), acrescente `HABBLAUD_ALLOWED_HOSTS=meu-mac.local` (no Docker, no mesmo
`.env`).

</details>

<details>
<summary><b>O terminal não abre</b></summary>

O terminal só existe com o Habblaud acessível apenas pelo próprio computador. Confira se o `.env` não tem
`HABBLAUD_BIND=0.0.0.0` (ou, no modo Node, se não usou `HABBLAUD_HOST=0.0.0.0`) nem `HABBLAUD_TERMINAL=0`, e abra por
`http://localhost:4747` (pelo IP da rede ou por um nome de `HABBLAUD_ALLOWED_HOSTS` ele é recusado). No Docker, um container
criado antes desse recurso precisa ser recriado: `npm run docker:up`. O log de inicialização (`npm run docker:logs`)
diz se o terminal está ligado e, se não estiver, por quê.

</details>

<details>
<summary><b>O pedido de permissão (ou a pergunta) não aparece no escritório</b></summary>

Rode `npm run mod:status`: ele diz, por conta, se o plugin `habblaud-permissoes` está instalado e ligado (e se
sobrou o hook antigo junto, o que faria dois responderem) e se o Habblaud está respondendo pedidos. No jeito antigo,
`npm run hooks:status` diz se o hook está instalado e apontando para esta pasta. O pedido só é desviado com alguma
página do Habblaud aberta por `http://localhost` (ou `127.0.0.1`) e com o terminal ligado (mesma trava). Sessões
abertas antes da instalação carregam o plugin com `/reload-plugins` (ou ao reabrir). No jeito antigo, se o Habblaud
usa outra porta, reinstale com `npm run hooks:install -- --port <porta>`. Para as perguntas do agente, o plugin
precisa ser o da 0.6.0 ou mais novo: rode `npm run mod:install` depois de atualizar.

</details>

<details>
<summary><b>O Codex não aparece no escritório (ou aparece com atraso)</b></summary>

O log de inicialização (`npm run docker:logs`) diz quantas contas do Codex o Habblaud achou; se for nenhuma, aponte a
pasta com `HABBLAUD_CODEX_DIRS` (e rode `npm run docker:up` de novo: no Docker, só as pastas que existiam no
`docker:up` são montadas). Sem os hooks, o Codex aparece pelos arquivos dele, que só são gravados depois de cada passo:
rode `npm run codex:install`, **aprove os hooks em `/hooks` no Codex** e confira com `npm run codex:status`. O Codex roda
os hooks pelo shell de login, que pode ter um Node antigo; o `codex:install` escolhe um Node 22+ e diz qual (ou use
`--node <caminho>`). Uma sessão da CLI recém-aberta só aparece com a **primeira mensagem**: antes disso o Codex não
diz em que pasta ela está (só cria a trava da sessão), e sem a pasta não há sala.

</details>

<details>
<summary><b>A caixa de mensagem não aparece (ou fica na fila)</b></summary>

A caixa só aparece para agentes principais cuja sessão tem o plugin `habblaud-mensagens` conectado: rode
`npm run mod:status` (diz, por conta, se o plugin está instalado e se o Habblaud está com as mensagens ligadas) e, nas
sessões abertas antes da instalação, `/reload-plugins`. Sem o plugin, os detalhes do agente mostram a dica de
instalação. As mensagens seguem a trava do terminal e `HABBLAUD_MENSAGENS=0` as desliga; o log de inicialização
(`npm run docker:logs`) diz se estão ligadas e, se não estiverem, por quê. Uma mensagem que fica **na fila** e falha
com "a sessão não buscou a mensagem" quer dizer que a sessão parou de perguntar ao Habblaud (fechou, ou o plugin foi
desligado).

</details>

<details>
<summary><b>No Docker, uma sessão fechada continua no escritório</b></summary>

Acontece se o Claude Code foi encerrado à força sem apagar o próprio registro em `sessions/` (no Docker não dá para
conferir se o processo ainda existe). Rodando com Node (`npm start`), o Habblaud confere os processos e isso não
acontece.

</details>

<details>
<summary><b>No Docker, uma conta fora de /Users não aparece</b></summary>

O Docker Desktop só compartilha algumas pastas do Mac com os containers (por padrão `/Users`, `/Volumes`, `/private` e
`/tmp`). Adicione a pasta em *Settings › Resources › File sharing*.

</details>

<details>
<summary><b>Quero começar do zero</b></summary>

`npm run docker:down`, depois `docker volume rm habblaud_habblaud-data` (apaga os nomes guardados) e
`npm run docker:up`.

</details>

## Aviso

O Habblaud é um projeto independente, **não afiliado, patrocinado nem endossado pela Anthropic**. "Claude" e
"Claude Code" são marcas da Anthropic, usadas aqui só para descrever com o que o projeto funciona.

Para mostrar os agentes, o Habblaud lê apenas arquivos locais que o próprio Claude Code grava na sua máquina
(registros das sessões abertas, transcripts e configurações das contas). Esse formato não é documentado e pode mudar entre versões do Claude Code:
depois de uma atualização, o Habblaud pode deixar de funcionar, total ou parcialmente, até ser ajustado.

## Licença

[MIT](LICENSE). As imagens em `client/public/assets` (logotipo, ilustrações, quadros e pôsteres) foram geradas com
IA para este projeto e convertidas em pixel art pelos scripts de `scripts/assets/`.

## Vida social

Quando dois ou mais agentes estão à toa — ociosos, ou esperando um shell há mais de 40 segundos —, eles param de
passear sozinhos e se juntam. Ninguém combina nada: cada personagem tem uma **personalidade**, **amigos** e
**rivais**, e isso decide o que ele prefere fazer, com quem e o que fala. Quem está esperando um shell só sai da mesa
para uma roda (sozinho, continua na pipoca) e leva a ampulheta junto; quando o comando termina — ou quando você manda
um pedido novo para alguém —, ele avisa a turma ("Opa, me chamaram! 🏃") e corre de volta para a mesa.

<p align="center">
  <img src="docs/screenshots/social-lounge.gif" width="816" alt="Lounge do Habblaud com três rodas ao mesmo tempo: três colegas no sofá vendo futebol na TV (a tela pisca GOL), uma partida de pingue-pongue com torcida e um duelo nos fliperamas com provocações nos balões" />
</p>

### As rodas

| | Roda | O que acontece |
| --- | --- | --- |
| 📺 | **TV no lounge** | Futebol, novela ou desenho, com pipoca no sofá. No futebol a torcida comemora junto com o "GOL" que pisca na tela (ou lamenta o gol do adversário); na novela, coraçõezinhos e "Não acredito! 😱". Quem é de sonecas acaba dormindo no sofá. |
| 🎮 | **Videogame** | Dois no sofá com o controle, a TV em tela dividida (corrida ou luta), melhor de 3, provocações ("Que lag é esse?!") e torcida. |
| 👾 | **Fliperama** | Duelo nas duas máquinas do lounge, uma partida só. |
| 🏓 | **Pingue-pongue** | Até 5 pontos, com a bolinha indo e voltando, placar nos balões ("3 × 2 🏓") e torcida atrás da mesa. |
| ☕ | **Papo na copa** | Cada um pega um café (ou água) e senta à mesa: fofoca com o nome dos colegas ("Viram o commit de Rafaela? 👀"), piada (a roda gargalha), trabalho ("Deploy na sexta? 😈") e assuntos do dia e da hora ("Sextou! 🎉"). |
| 💬 | **Conversa** | Dois colegas em pé num canto da recepção, da copa ou do lounge. |
| ✊ | **Jokenpô valendo** | "Jo… ken… pô!", os gestos aparecem sobre a cabeça, quem ganha comemora e as moedinhas voam de um para o outro; quem perde fica chateado e, se for competitivo, pede revanche. Empate repete. Quem está passando pode parar para assistir. |
| 💄 | **Espelho do banheiro** | Batom ou pente, com o rosto refletido no espelho e um brilho no final. Vale sozinho ou em dupla ("Empresta o pente?"). |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/social-rps.png" alt="Jokenpô na recepção: Lia comemora com uma moeda sobre a cabeça e o balão 'Ganhei!', moedinhas voam de Bruna (chateada, com o ícone de pedra) para ela, '+20' e '−20' flutuando, e Iara assiste atrás" /></td>
    <td width="50%"><img src="docs/screenshots/social-kitchen.png" alt="Papo na copa: quatro colegas sentados à mesa comprida com café, com os balões 'Vai dar certo!' e 'Hahaha'" /></td>
  </tr>
  <tr>
    <td><b>Jokenpô valendo moedinhas.</b> A aposta sai da personalidade (quem é de apostas aposta alto, quem é pão-duro aposta pouco) e nunca passa do saldo de quem tem menos.</td>
    <td><b>Papo na copa.</b> Quem fala mais é quem é mais sociável; as reações dependem do assunto (gargalhada na piada, 👀 na fofoca).</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/social-mirror.png" alt="Duas colegas diante das pias do banheiro se arrumando, com os rostos refletidos nos espelhos e o balão 'Tá arrasando!'" /></td>
    <td><img src="docs/screenshots/social-drawer.png" alt="Seção Vida social nos detalhes do agente: 'Vendo novela na TV com Bruna e Iara', 115 moedinhas, 1 vitória e 0 derrotas, os traços Vaidade e Economia, o bordão, amizades, rivalidades com o placar e o extrato" /></td>
  </tr>
  <tr>
    <td><b>No espelho.</b> Quem é de vaidade passa no banheiro sempre que pode — e aparece refletido.</td>
    <td><b>Nos detalhes do agente.</b> O que está fazendo, a carteira, o placar, a personalidade, amizades e rivalidades (com o retrospecto) e o extrato.</td>
  </tr>
</table>

### Personalidades

Cada agente tem 2 ou 3 traços, sorteados pela semente dele (é sempre a mesma pessoa, em qualquer navegador):

🏆 Competição · 🎲 Apostas · 🎮 Games · 📺 Séries e TV · 🗣️ Fofoca · 💄 Vaidade · ☕ Cafeína · 😂 Piadas · 🏓 Esporte ·
🙈 Timidez · 💰 Economia · 😴 Sonecas · 🧘 Calma · 📚 Leitura

Os traços mudam o que cada um escolhe (quem é de séries liga a TV, quem é de esporte chama para o ping-pong), quem
chama (amigos se procuram; rivais se desafiam nos jogos), o que fala e até quem joga melhor. Cada um também tem um
bordão ("Tá pago!", "Bora codar!"). Passe o mouse sobre um traço nos detalhes do agente para ver o que ele faz.

### Moedinhas

Moedinhas fictícias (🪙), só para dar graça às apostas:

| | |
| --- | --- |
| **Chegou ao escritório** | 🪙100 (subagentes, 🪙30) |
| **Tarefa concluída** (item da lista de tarefas) | +🪙10 |
| **Pedido atendido** (fim de turno) | +🪙5 |
| **Subagente entregou o resultado** | +🪙15 |
| **Apostas** (jokenpô; partidas entre rivais ou com quem é de apostas) | o que perder vai para quem ganhar |

Cada ganho aparece como "+🪙10" sobre a cabeça; as partidas e apostas entram no feed de atividade. O saldo, o placar
e o extrato ficam salvos no navegador (cada navegador tem a sua economia: as apostas são sorteadas ali) e são
esquecidos três dias depois de o agente sair.

> Tudo isso é encenação do Habblaud: nada muda nos agentes do Claude Code, que continuam trabalhando normalmente.

---

<p align="center">
  Feito com ☕ e muitos agentes do <a href="https://code.claude.com">Claude Code</a>.
</p>
