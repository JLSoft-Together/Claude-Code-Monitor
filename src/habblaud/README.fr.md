<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Logo de Habblaud : un petit immeuble en pixel art" />
</p>

<h1 align="center">Habblaud</h1>

<p align="center">
  <b>Le bureau virtuel de vos agents Claude Code (et Codex).</b><br />
  Chaque projet devient une salle, chaque agent un personnage en pixel art qui montre, en temps réel, ce qu'il est en train de faire.
</p>

<p align="center"><a href="README.md">English</a> · <a href="README.pt-BR.md">Português</a> · <a href="README.es.md">Español</a> · <b>Français</b></p>

<p align="center">
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%E2%89%A522.12-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-pr%C3%AAt-2496ed?logo=docker&logoColor=white" />
  <img alt="Zéro dépendance d'exécution" src="https://img.shields.io/badge/d%C3%A9pendances%20runtime-0-f08a3c" />
  <img alt="Interface en portugais, anglais, espagnol et français" src="https://img.shields.io/badge/interface-PT%20%C2%B7%20EN%20%C2%B7%20ES%20%C2%B7%20FR-4aa8e8" />
</p>

<p align="center">
  <img src="docs/screenshots/office.gif" width="820" alt="Animation d'une salle de Habblaud : des personnages qui tapent à leur bureau, des sous-agents avec un badge et des bulles d'activité" />
</p>

---

Vous ouvrez Claude Code dans plusieurs projets, lancez des sous-agents, laissez des tâches tourner… et vous ne savez plus
qui fait quoi. **Habblaud** transforme tout ça en un bureau qu'on comprend d'un coup d'œil : qui est en train de taper,
qui a levé la main parce qu'il **a besoin de vous**, qui a rendu son travail et est parti, qui est allé prendre un café
en attendant la prochaine instruction — et combien vous avez déjà consommé de chaque compte sur la session de 5 heures
et sur la semaine.

Et quand deux agents ou plus n'ont rien à faire, le bureau s'anime d'une **vie sociale** : chacun a sa propre
personnalité, et ils regardent le foot ensemble au salon, jouent aux jeux vidéo et au ping-pong, papotent à la cuisine,
se recoiffent devant le miroir et parient des pièces au chifoumi. Voir [Vie sociale](#vie-sociale).

Tout tourne sur votre machine, en lisant les fichiers que Claude Code écrit déjà lui-même (et seulement les lignes
`alias` de votre shell, pour attribuer une lettre à chaque compte). Rien ne quitte l'ordinateur : Habblaud ne lit
aucun identifiant et ne fait aucun appel externe.

## Sommaire

- [À quoi ça ressemble](#à-quoi-ça-ressemble)
- [Installation](#installation)
- [Mode d'emploi](#mode-demploi)
- [Comptes et utilisation (5 heures et semaine)](#comptes-et-utilisation-5-heures-et-semaine)
- [Configuration](#configuration)
- [Habblaud World](#habblaud-world)
- [Comment ça marche](#comment-ça-marche)
- [Confidentialité et sécurité](#confidentialité-et-sécurité)
- [Développement](#développement)
- [Dépannage](#dépannage)
- [Avertissement](#avertissement)
- [Licence](#licence)
- [Vie sociale](#vie-sociale)

## À quoi ça ressemble

**Vue d'ensemble.** L'immeuble a un accueil avec des ascenseurs, une cuisine, des toilettes et un salon ; chaque projet
qui a une session ouverte reçoit sa salle le long du couloir. En haut, les compteurs et l'utilisation de chaque compte ;
à gauche, les salles et les agents ; en bas, le fil d'activité.

![Vue d'ensemble de Habblaud : immeuble avec accueil, cuisine, toilettes, salon et salles de projet ; barre latérale avec les salles et les agents ; utilisation des comptes en haut ; fil d'activité en bas](docs/screenshots/overview.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Panneau de détails d'un agent avec ses tâches, ses sous-agents, sa chronologie et ses statistiques" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="Le bureau la nuit, avec les lampadaires allumés et les salles éclairées" /></td>
  </tr>
  <tr>
    <td><b>Détails de l'agent :</b> activité en cours, tâches avec leur progression, sous-agents, chronologie et statistiques.</td>
    <td><b>Jour et nuit :</b> le ciel aux fenêtres et l'éclairage suivent l'heure locale.</td>
  </tr>
</table>

<table>
  <tr>
    <td width="42%"><img src="docs/screenshots/collab.png" alt="Un sous-agent remet son résultat à l'agent principal pendant qu'une autre agente demande la permission" /></td>
    <td width="58%">
      <b>La collaboration bien visible.</b> Les sous-agents sont des collègues avec leur propre nom et un badge : ils
      arrivent par l'ascenseur, travaillent dans la salle du projet et, une fois leur travail terminé, vont remettre le
      résultat (📦) à l'agent qui les a appelés avant de partir.<br /><br />
      <b>A besoin de vous.</b> Quand un agent attend une permission ou une réponse dans le terminal, il court à son bureau
      et lève la main, avec un signal qui clignote — et une alerte s'affiche à l'écran (en option avec un son et une
      notification du navigateur). Vous pouvez valider, répondre à la question ou envoyer la prochaine instruction
      directement depuis là.
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="58%">
      <b>En attente du shell.</b> Quand l'agent finit son tour mais laisse une commande tourner (tests, build,
      déploiement…), il ne part pas se promener : il reste à son bureau avec un sablier qui tourne au-dessus de la
      tête, le terminal qui affiche la progression et une bulle avec la commande et le temps écoulé. Et l'attente tourne
      à la comédie : d'abord il mange du pop-corn en regardant le terminal ; après 3 min, il croise les bras et tourne
      sur sa chaise ; après 10 min, il se couvre de toiles d'araignée ; après 25 min, il pique un somme. Quand la
      commande se termine, il se lève et fête ça avec des confettis — ou récolte un nuage de pluie si elle a échoué.
      Dans la liste latérale et dans les détails, un chronomètre indique depuis combien de temps chaque commande tourne.
    </td>
    <td width="42%"><img src="docs/screenshots/shell-wait.png" alt="Un agent mange du pop-corn à son bureau, avec un sablier au-dessus de la tête et la bulle « Lancer la suite de tests · 1 min » ; au rang de devant, une collègue attend depuis plus longtemps, avec une toile d'araignée sur sa chaise et le terminal qui affiche la progression" /></td>
  </tr>
</table>

**La lumière s'éteint.** Quand vous fermez la dernière session d'un projet, le dernier personnage va jusqu'à
l'interrupteur, éteint la lumière et sort par l'ascenseur — puis la salle est démontée et devient un jardin jusqu'à
l'arrivée d'un nouveau projet. Si le jardin se retrouve entre deux salles, la salle la plus éloignée déménage : elle est
montée à l'emplacement libre, l'équipe s'y rend à pied, et l'ancienne adresse s'éteint et est démontée. Ainsi,
l'immeuble ne garde pas de trous et rétrécit tout seul.

| 1. La salle est montée, encore éteinte | 2. Quelqu'un allume la lumière et tout le monde travaille | 3. Le dernier sort et éteint la lumière | 4. La salle devient un jardin |
| --- | --- | --- | --- |
| ![Salle en cours de montage : les meubles apparaissent et la lumière est éteinte](docs/screenshots/lifecycle-1.png) | ![Salle éclairée avec trois agents qui travaillent à leur bureau](docs/screenshots/lifecycle-2.png) | ![Salle avec la lumière éteinte et les meubles encore en place, après le départ de tout le monde](docs/screenshots/lifecycle-3.png) | ![Le terrain de la salle transformé en jardin](docs/screenshots/lifecycle-4.png) |

<table>
  <tr>
    <td width="34%"><img src="docs/screenshots/mobile.png" alt="Habblaud sur un téléphone, avec l'utilisation des comptes en haut" /></td>
    <td>
      <b>Aussi sur téléphone.</b> L'interface s'adapte aux petits écrans : l'utilisation des comptes reste en haut, la
      liste des salles devient un panneau coulissant et les détails s'ouvrent de bas en haut. Pour autoriser l'accès
      depuis le réseau local, voir <a href="#ouvrir-sur-le-téléphone-facultatif">Ouvrir sur le téléphone</a>.
    </td>
  </tr>
</table>

> Les images ci-dessus utilisent le **mode démonstration** (projets, personnes et comptes fictifs).

## Installation

### Prérequis

- **macOS** (testé) ou Linux.
- **[Claude Code](https://code.claude.com)** installé, avec un ou plusieurs comptes (2.1.287 ou plus récent pour le mod).
- **Node.js 22.12+** et **npm** (développé avec Node 24 ; l'image Docker utilise déjà Node 24).
- **Docker Desktop** (ou Docker Engine avec Compose v2), si vous voulez le faire tourner dans un conteneur.

### 1. Téléchargez le projet

```bash
git clone https://github.com/marmottajr/habblaud.git
cd habblaud
npm install
```

> `npm install` ne télécharge que des outils de compilation (Vite, TypeScript, tsx…). Le serveur de Habblaud n'a
> aucune dépendance d'exécution : il n'utilise que les modules natifs de Node.

### 2. Lancez Habblaud

**Option A — Docker (recommandé pour le laisser toujours allumé)**

```bash
npm run docker:up
```

Le script détecte vos comptes Claude Code, ne monte que les dossiers nécessaires (en lecture seule), construit l'image
et démarre le conteneur — qui redémarre tout seul avec Docker. Ouvrez **http://localhost:4747**.

**Option B — Node, sans Docker**

```bash
npm run build
npm start
```

Ouvrez **http://localhost:4747**. Pour développer, utilisez `npm run dev` (serveur + Vite avec rechargement automatique).

Ouvrez maintenant Claude Code dans n'importe quel projet et regardez votre agent arriver par l'ascenseur. 🎉

### 3. Installez le mod Habblaud dans Claude Code (recommandé)

```bash
npm run mod:install                        # o mod e os plugins de permissões e de mensagens, em cada conta
npm run mod:install -- --sem-permissoes    # sem responder permissões e perguntas pelo escritório
npm run mod:install -- --sem-mensagens     # sem mandar mensagens aos agentes pelo escritório
```

Habblaud fournit un [mod](https://code.claude.com/docs/en/plugins/mods/overview) (un plugin qui tourne à l'intérieur de
Claude Code) et l'installe dans chaque compte, via `claude plugin` lui-même, à partir de ce dossier. Avec lui :

- l'**utilisation sur 5 heures et sur la semaine** de chaque compte s'affiche en direct dans Habblaud ;
- le terminal affiche une ligne quand **une autre session a besoin de vous** (permission ou réponse) ;
- la commande **`/habblaud`** devient disponible dans Claude Code ;
- vous pouvez **valider ou refuser depuis le bureau** les demandes de permission (« Do you want to… ») et **répondre aux
  questions** de l'agent, avec le plugin `habblaud-permissoes` (voir [Répondre depuis le bureau](#répondre-depuis-le-bureau)) ;
- vous pouvez **envoyer des messages** à l'agent depuis le bureau, comme si vous tapiez dans son terminal, avec le plugin
  `habblaud-mensagens` (voir [Envoyer des messages](#envoyer-des-messages)).

Il faut **Claude Code 2.1.287 ou plus récent** (`claude --version`). Le mod tourne dans chaque session, avec vos
permissions, et n'accède qu'à ce qui est listé dans [`mod/README.md`](mod/README.md) ; pour vérifier sans rien exécuter,
`claude plugin validate mod/habblaud` affiche les événements qu'il traite et les appels qu'il fait. Les sessions déjà
ouvertes chargent le mod avec `/reload-plugins` (ou à leur réouverture). Si le compte utilisait l'ancienne méthode
(ci-dessous), `mod:install` retire la dérivation (tap) et le hook du `settings.json` (avec sauvegarde), puisque le mod
fait la même chose. Vérifiez avec `npm run mod:status` ; pour revenir en arrière : `npm run mod:uninstall`.

> Le mod est lu depuis ce dossier. Si vous déplacez le dossier, relancez `npm run mod:install`.

<details>
<summary><b>Claude Code antérieur à 2.1.287 : l'ancienne méthode</b></summary>

Sans les mods, l'utilisation en direct et la réponse depuis le bureau passent par deux installateurs qui modifient le
`settings.json` de chaque compte (avec une sauvegarde préalable) :

```bash
npm run usage:install    # põe um "tap" na frente do statusline de cada conta, que captura o uso de 5h/semanal
npm run hooks:install    # acrescenta o hook PermissionRequest, para responder permissões pelo escritório
```

Votre statusline continue de s'afficher comme avant. Pour revenir en arrière : `npm run usage:uninstall` et
`npm run hooks:uninstall`. Les deux pointent vers ce dossier : si vous déplacez le dossier, relancez-les (en attendant,
la statusline des comptes affiche une erreur). Quand vous mettrez à jour Claude Code, passez au mod :
`npm run mod:install` retire l'ancienne dérivation et l'ancien hook (avec sauvegarde) pour éviter que deux mécanismes
capturent l'utilisation ou répondent à la même demande.

</details>

### 4. Codex dans le bureau (facultatif)

Si vous utilisez aussi **Codex** d'OpenAI (la CLI `codex` ou l'app), ses sessions entrent dans le même bureau : chaque
projet est une salle — la même que celle de Claude Code, quand les deux sont ouverts sur le même projet — et chaque
session, un personnage avec le badge **CODEX**. Habblaud trouve tout seul le dossier de Codex (`~/.codex`, `CODEX_HOME`
ou `~/.codex*`) et lit les conversations, sans rien installer. Pour voir Codex **en direct** (ce qu'il fait en ce
moment, qui a besoin de vous) et valider des commandes depuis le bureau, installez les hooks :

```bash
npm run codex:install      # acrescenta os hooks do Habblaud em ~/.codex/hooks.json (backup antes; os outros ficam)
npm run codex:status       # confere
```

Ensuite, **ouvrez Codex et validez les hooks de Habblaud dans `/hooks`** : Codex n'exécute un nouveau hook qu'après
votre validation (Habblaud n'enregistre jamais cette validation à votre place). Avec Habblaud dans Docker, pour envoyer
des messages aux sessions Codex, laissez aussi tourner `npm run codex:bridge` sur le Mac (voir [Codex](#codex)).

### Ouvrir sur le téléphone (facultatif)

Par défaut, Habblaud n'accepte que les connexions venant de l'ordinateur lui-même. Pour l'ouvrir sur le téléphone (sur
le même Wi-Fi), avec Docker :

```bash
printf 'HABBLAUD_BIND=0.0.0.0\n' > .env
npm run docker:up -- --no-build
```

Ouvrez ensuite `http://<ip-do-computador>:4747` sur le téléphone (sur macOS : `ipconfig getifaddr en0` ; si le
résultat est vide, `ipconfig getifaddr en1`). En mode Node, utilisez `HABBLAUD_HOST=0.0.0.0 npm start`.

> ⚠️ Dans ce cas, n'importe quel appareil du réseau voit l'activité des agents (commandes, fichiers, titres des
> sessions). À n'utiliser que sur des réseaux de confiance. Le [terminal](#terminal) (et avec lui la réponse et l'envoi
> de messages depuis le bureau) reste désactivé tant que le port est exposé. Pour revenir en arrière : supprimez le
> `.env` et lancez `npm run docker:up -- --no-build`.

#### Téléphone avec connexion et HTTPS (valider les demandes)

Au lieu d'exposer le port principal, ouvrez un **second port avec identifiant, mot de passe et HTTPS**. Le port 4747
reste limité à l'ordinateur (les hooks, les plugins et votre navigateur continuent de fonctionner sans connexion) ; le
port distant s'ouvre au réseau et chaque requête qui y arrive exige une connexion. Ce qui distingue les deux, c'est le
port par lequel la connexion est arrivée, jamais l'en-tête Host. Rien de tout cela n'existe avant le setup : sans lui,
aucun port supplémentaire n'est publié.

```bash
npm run remote:setup   # usuário, senha, nome do endereço e (opcional) um endereço próprio
npm run docker:up
```

`remote:setup` n'écrit dans le `.env` que le **hash** du mot de passe (scrypt), crée une CA locale et le certificat du
serveur dans `~/.habblaud/remote-tls`, et laisse un service qui annonce `<nome>.local` sur le réseau (mDNS ;
LaunchAgent sous macOS, systemd sous Linux). Ouvrez `https://<nome>.local` sur le téléphone (avec `:4748` si le port
443 était occupé). La première fois, acceptez l'avertissement, touchez **Installez le certificat Habblaud** et
faites-lui confiance (iPhone : Réglages › Profil téléchargé › Installer, puis Réglages › Général › Informations ›
Réglages des certificats ; Android : Sécurité › Chiffrement et identifiants › Installer un certificat › Certificat CA),
en vérifiant l'empreinte que le setup a affichée.

- **CA restreinte :** elle ne signe que `localhost`, les noms `.local`, votre propre adresse et les IP de réseau privé.
  Même si sa clé fuitait, un certificat pour n'importe quel autre site serait refusé par le téléphone qui lui fait
  confiance. Changer votre propre adresse crée une nouvelle CA (réinstallez le certificat sur le téléphone). La clé de
  la CA n'entre jamais dans le conteneur.
- **Adresse propre** (ex. : `meuclaude.home`) : elle figure dans le certificat, mais le téléphone ne la trouve qu'avec
  une entrée dans le DNS du routeur pointant vers l'IP de l'ordinateur. `<nome>.local` fonctionne sans rien configurer.
- **Ce que le téléphone peut faire :** par défaut, valider et refuser les demandes de permission.
  `HABBLAUD_REMOTE_ALLOW` dans le `.env` accepte `permissions`, `messages`, `terminal` et `spawn`, séparés par des
  virgules, ou `none` (consultation seule). Le terminal interactif ne fonctionne jamais depuis le téléphone.
- **Livraisons** (téléphone, avec `terminal` autorisé) : le bouton en forme de boîte dans la barre du haut liste ce que
  chaque agent a terminé, avec un résumé et des pièces jointes (captures d'écran, PDF, fichiers qu'il a envoyés) qui
  s'ouvrent d'un simple toucher.
- **Nouvel agent** (le bouton **+**) : lance une session Claude Code en arrière-plan sur l'ordinateur (`claude --bg`,
  dans le dossier choisi), qui apparaît dans le bureau et reçoit les messages et les demandes de permission via
  Habblaud. Dans un dossier auquel Claude Code ne fait pas encore confiance, il ouvre, déjà rempli, l'écran de nouvelle
  session de l'appli Claude, et vous appuyez sur Enter là-bas. **Désactivé par défaut :** il faut `HABBLAUD_PTY=1` (la
  même activation que le [terminal interactif](#terminal-interactif-prendre-le-contrôle-nouvelle-session-et-fermer) ;
  dans Docker, mettez-la dans le `.env` et laissez tourner `npm run codex:bridge` sur l'ordinateur) et, depuis le
  téléphone, `spawn` dans `HABBLAUD_REMOTE_ALLOW` aussi.
- **Dictée** (dans Nouvel agent et dans la zone de message) : nécessite `whisper-cli` et `ffmpeg` (`brew install
  whisper-cpp ffmpeg`) et un modèle multilingue dans `~/.local/share/whisper/` (`ggml-small.bin` se trompe moins que
  `ggml-base.bin` ; les `.en` ne comprennent que l'anglais). Sans eux, le bouton Dicter n'apparaît pas. La voix ne
  quitte jamais l'ordinateur. `HABBLAUD_WHISPER_BIN`, `HABBLAUD_FFMPEG_BIN`, `HABBLAUD_WHISPER_MODEL` et
  `HABBLAUD_DICTATION_LANGS` (par défaut `pt,en`) permettent de l'ajuster.
- **Hors de chez vous (Tailscale) :** avec Tailscale sur l'ordinateur et sur le téléphone, `tailscale serve --bg
  --https=443 https+insecure://127.0.0.1:443` publie le port distant (avec connexion) uniquement pour vos appareils,
  avec un certificat valide sur `https://<computador>.<tailnet>.ts.net` ; ajoutez ce nom à `HABBLAUD_ALLOWED_HOSTS`.
  Pointez toujours vers le port distant, jamais vers le 4747 (qui ne demande pas de connexion).
- **Session :** 30 jours ; changer le mot de passe (relancer le setup) les ferme toutes, et **Réglages › Accès
  depuis le téléphone › Se déconnecter** ferme celle de cet appareil. Après 5 mauvais mots de passe d'affilée, chaque nouvelle tentative attend
  de 1 s à 5 min.
- **L'IP a changé ?** `docker:up` réémet le certificat du serveur quand la nouvelle IP n'y figure pas ou quand il
  expire dans moins de 30 jours, avec la même CA (le téléphone continue de lui faire confiance) ; le serveur remplace le
  certificat sans redémarrer.
- **Désactiver :** `npm run remote:setup -- --off` et `npm run docker:up`.

Sans HTTPS, le port distant ne démarre pas ; `HABBLAUD_REMOTE_INSECURE_HTTP=1` force le HTTP simple (mot de passe et
cookie en clair sur le réseau). En mode Node : `HABBLAUD_REMOTE_PORT` et `HABBLAUD_REMOTE_HOST` (par défaut
`0.0.0.0:4748`) et `HABBLAUD_REMOTE_TLS_DIR` (par défaut `~/.habblaud/remote-tls/server`).

### Mettre à jour

La version utilisée apparaît dans la barre du haut, à côté de « Connecté », et dans **Réglages › À propos**. Toutes les
6 heures, Habblaud vérifie sur GitHub si une nouvelle version est sortie (les [releases](https://github.com/marmottajr/habblaud/releases)
de ce dépôt). Si c'est le cas, le badge vert **Nouvelle version** remplace le numéro, avec une alerte et un point sur
le bouton des réglages. Dans **À propos**, vous trouverez le lien vers ce qui a changé et le bouton **Vérifier
maintenant** (les notes de chaque version sont aussi dans [`CHANGELOG.md`](CHANGELOG.md)). Pour mettre à jour :

```bash
git pull
npm install
npm run docker:up        # ou: npm run build && npm start (e depois npm run mod:install)
```

> Si `git pull` s'arrête avec « Your local changes to the following files would be overwritten by merge:
> package-lock.json », lancez `git checkout -- package-lock.json` et recommencez : jusqu'à la 0.4.0, `npm install`
> modifiait ce fichier.

`docker:up` met aussi à jour le mod dans les comptes où il est déjà installé (il ne l'installe jamais tout seul) et
vous prévient : « Mod mis à jour en 0.3.0 pour Compte D ; sessions ouvertes : /reload-plugins ». En mode Node, lancez
`npm run mod:install` après la mise à jour. Pour ne pas interroger GitHub, utilisez `HABBLAUD_UPDATE_CHECK=0` (dans le
`.env`, pour Docker).

#### Migrer depuis CodeTown

Habblaud s'appelait **CodeTown** jusqu'à la 0.3.2. Après le `git pull`, lancez une fois :

```bash
npm install
npm run mod:install      # troca o marketplace e os plugins codetown pelos habblaud, em cada conta
npm run docker:up        # tira o container codetown e copia os dados do volume antigo para o novo
```

- **Mod :** tant que `mod:install` n'a pas été lancé, Claude Code se plaint, dans les comptes, du marketplace `codetown`
  (les dossiers `mod/codetown*` ont changé de nom). `docker:up` vous prévient, mais ne fait pas le remplacement tout seul.
- **Docker :** l'ancien volume (`codetown_codetown-data`) reste intact. Après avoir vérifié que les noms des personnages
  ont bien été repris, supprimez-le avec `docker volume rm codetown_codetown-data`, et l'ancienne image avec `docker image rm codetown:local`.
- **Dossier local :** `~/.codetown` devient `~/.habblaud` tout seul (dans le serveur, dans `docker:up` et dans `mod:install`).
- **Navigateur :** les préférences et les pièces passent aux nouvelles clés la première fois que la page s'ouvre.
- **Variables :** les `CODETOWN_*` ne sont plus prises en compte ; renommez-les en `HABBLAUD_*` dans le `.env` (ex. : `HABBLAUD_BIND`). Le
  serveur et `docker:up` vous préviennent quand ils en trouvent une ancienne.
- **Dépôt :** c'est désormais `github.com/marmottajr/habblaud` (GitHub redirige l'ancienne adresse). Pour mettre à jour le
  clone : `git remote set-url origin https://github.com/marmottajr/habblaud.git`. Le dossier local peut garder son
  ancien nom.
- Les sauvegardes du `settings.json` faites avant le changement de nom gardent le nom `settings.json.codetown-backup-<data>`.

### Désinstaller

```bash
npm run mod:uninstall                       # tira o mod, os plugins de permissões e de mensagens e o marketplace
npm run codex:uninstall                     # tira os hooks do Habblaud do Codex (os outros ficam)
npm run docker:down                         # para o container
docker volume rm habblaud_habblaud-data     # apaga os dados do container (nomes, salas, linha do tempo e estatísticas)
docker image rm habblaud:local              # apaga a imagem
rm -rf ~/.habblaud                          # apaga os dados locais (uso capturado, nomes, salas, linha do tempo e estatísticas)
```

Il ne reste plus qu'à supprimer le dossier du projet — lancez `mod:uninstall` **avant**, sinon Claude Code se plaindra,
dans les comptes, du marketplace disparu. Si vous avez utilisé l'ancienne méthode, lancez aussi `npm run usage:uninstall`
(qui rétablit la statusline d'origine) et `npm run hooks:uninstall` (qui retire le hook de permission) ; sans eux, la
statusline des comptes se met à afficher une erreur (et le hook, à échouer en silence). `mod:install`, qui retire
l'ancienne dérivation et l'ancien hook, ainsi que les anciens installateurs et désinstallateurs, laissent des copies
`settings.json.habblaud-backup-<data>` dans le dossier de chaque compte (ex. : `~/.claude/`) ; supprimez-les si vous
n'en avez plus besoin.

## Mode d'emploi

### Ce que fait chaque personnage

| État | Ce que vous voyez |
| --- | --- |
| **Au travail** | À son bureau, en train de taper. L'écran et une bulle montrent l'activité : 📖 lecture, ✏️ modification, 💻 terminal, 🧪 tests, 🌐 recherche… |
| **A besoin de vous** | Court à son bureau et lève la main, avec un signal qui clignote : il attend une permission ou une réponse dans le terminal. |
| **Attend le shell** | A fini son tour mais a laissé une commande tourner (tests, build, déploiement…) ; il reste donc à son bureau avec un sablier qui tourne au-dessus de la tête et le terminal en pleine progression : il mange du pop-corn en regardant, après 3 min il croise les bras et tourne sur sa chaise, après 10 min il se couvre de toiles d'araignée et après 25 min il pique un somme ; quand la commande se termine, il se lève et fête ça avec des confettis (ou récolte un nuage de pluie si elle a échoué). Au bout de 40 s, s'il y a des collègues sans rien à faire, il peut rejoindre un groupe — sablier sur la tête. |
| **Inactif** | A fini son tour et se promène : café à la cuisine, fontaine à eau, toilettes, canapé du salon, téléphone sur le pouf, miroir. Avec des collègues sans rien à faire, il rejoint un groupe : télé, jeux vidéo, ping-pong, pause à la cuisine, chifoumi (voir [Vie sociale](#vie-sociale)). Après 10 min sans bouger, il pique un somme — mais un collègue peut le réveiller pour rejoindre un groupe. |
| **Sous-agent terminé** | Va jusqu'à l'agent qui l'a appelé, lui remet le résultat et sort par l'ascenseur. |
| **Session terminée** | S'en va ; si c'était le dernier de la salle, il éteint la lumière avant de sortir. |

Chaque personnage a un **prénom brésilien unique** (Marina, Henrique, Luan…) qu'il garde tant que la session existe, et
une **pastille colorée avec la lettre du compte** (C, D…).

### Interface

- **En haut :** les compteurs (salles, agents, au travail, sous-agents, shells en cours, ont besoin de vous) et une carte
  d'**utilisation par compte**. Celui des shells n'apparaît que lorsqu'une commande tourne ; cliquez dessus pour aller
  jusqu'à celui qui attend. Sous le logo se trouvent la connexion et la version utilisée, qui devient le badge
  **Nouvelle version** quand une nouvelle version sort (voir [Mettre à jour](#mettre-à-jour)).
- **Panneau latéral :** recherche, filtre par compte et liste des salles avec leurs agents et sous-agents.
- **Panneau de détails :** cliquez sur un personnage (dans l'immeuble ou dans la liste) pour voir son activité, ses
  tâches, ses sous-agents, sa chronologie et ses statistiques (outils, tokens, coût, lignes modifiées, modèle, branche).
- **Fil d'activité :** les dernières activités de tout le bureau.
- **Réglages (⚙) :** noms, bulles, à quel point les inactifs se promènent, cycle jour/nuit, sons, notifications du
  navigateur, mode démonstration et **À propos** (version utilisée et nouvelle version). **Aide (?) :** légende complète
  et raccourcis.
- **Ma journée (📊) :** où est passé le temps de la journée (voir [Ma journée](#ma-journée)). **Timelapse** et
  **Historique** (les horloges de la barre du haut) : voir [Timelapse de la journée](#timelapse-de-la-journée) et [Terminal](#terminal).

**Caméra :** faites glisser pour la déplacer, utilisez la molette pour zoomer, double-cliquez sur un personnage pour le suivre.

**Raccourcis :** `/` recherche · `F` suivre la sélection · `T` terminal · `L` timelapse · `M` ma journée · `P` demande
suivante (permission ou question) · `O` ou `0` vue d'ensemble · `Esc` effacer la sélection · `[` panneau latéral · `]` fil d'activité · flèches/`WASD` déplacer ·
`+` `-` zoom · `?` aide.

### Thèmes du bureau

Dans **Réglages → Apparence → Thème du bureau**, choisissez :

- **Automatique** (par défaut) : suit le calendrier, à l'heure locale. Halloween du 1er au 31 octobre, Noël du
  1er novembre au 26 décembre et, le reste de l'année, l'apparence d'origine.
- **Aucun** : toujours l'apparence d'origine.
- **Noël** : guirlandes, lumières chaudes, sapins avec des cadeaux, tapis de Noël, neige aux fenêtres et bonnets sur les personnages.
- **Halloween** : citrouilles, fantômes décoratifs, toiles d'araignée, chauves-souris, lumières violettes, tapis thématiques et accessoires de déguisement.

Le changement est immédiat et le choix est enregistré dans ce navigateur. Les thèmes conservent les trajets,
les activités et les animations des agents. Le cycle jour/nuit reste une option indépendante.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/seasonal-christmas.png" alt="Le bureau avec le thème Noël : sapins avec des cadeaux dans les coins des salles, guirlandes et lumières aux murs, tapis rouges et personnages en bonnet" /></td>
    <td width="50%"><img src="docs/screenshots/seasonal-halloween.png" alt="Le bureau avec le thème Halloween : citrouilles et fantômes à la place des plantes, toiles d'araignée et chauves-souris aux murs, tapis violets et personnages déguisés" /></td>
  </tr>
</table>

### Langues

L'interface est disponible en **portugais, anglais, espagnol et français**. Elle suit la langue du navigateur ; dans
**Réglages › Langue**, vous pouvez en fixer une (le choix est enregistré dans ce navigateur). Les textes générés par le
serveur (activités, alertes, terminal, journaux et scripts d'installation) suivent `HABBLAUD_LANG` et, à défaut, la
langue du système, sauf l'anglais : beaucoup de machines et tous les conteneurs sont en anglais par défaut, même chez
ceux qui utilisent une autre langue. Pour avoir le serveur en anglais, définissez `HABBLAUD_LANG=en` (dans Docker, dans
le `.env`). Un texte sans traduction s'affiche en portugais.

### Jour, nuit et sons

Le bureau suit l'**heure locale** : tard dans la nuit et le soir, la pelouse et la rue deviennent bleutées et sombres,
les lampadaires, les lampes, les machines et les écrans allumés projettent des halos de lumière, les salles occupées
sont éclairées (la lumière qui s'éteint quand la salle se vide reste de mise), les voitures passent phares allumés et
des lucioles apparaissent dans le jardin. À l'aube (~5–7 h) et au crépuscule (~17–19 h), tout prend une teinte chaude,
et pendant la journée le soleil entre par les fenêtres et dessine des bandes de lumière sur le sol — courtes à midi,
longues et orangées en fin d'après-midi. Dans **Réglages › Cycle jour/nuit**, vous pouvez choisir automatique, toujours
jour ou toujours nuit ; pour tester une heure, utilisez `?hora=21:30` dans l'URL.

Les **sons** sont désactivés par défaut. Une fois activés dans **Réglages › Sons**, ils sont synthétisés par le
navigateur lui-même (sans fichiers audio) et discrets : le clavier de ceux qui travaillent dans les salles visibles, le
« ding » de l'ascenseur quand quelqu'un arrive ou s'en va, la cloche quand quelqu'un a besoin de vous, le petit
claquement d'une tâche terminée, et le ping-pong et l'arcade des groupes. Il y a un volume général, et chaque catégorie
s'active et se désactive séparément. Quand l'onglet est masqué, seule la cloche sonne.

### Terminal

Cliquez sur un agent et utilisez **Ouvrir le terminal** pour voir la conversation de la session telle que Claude Code
l'affiche : les prompts, les réponses, chaque outil appelé (avec la commande ou le diff) et le résultat, mis à jour en
direct. Cela vaut pour les agents principaux et les sous-agents ; en mode démonstration, la conversation est fictive.

En bas, pour les agents principaux, vous pouvez **taper** : `Enter` envoie et `Shift+Enter` va à la ligne. Le texte
entre dans la session comme si vous l'aviez tapé dans son terminal (voir [Envoyer des messages](#envoyer-des-messages)) ;
si l'agent est occupé, il entre quand l'agent a fini ce qu'il est en train de faire. Les sous-agents et les sessions de
l'historique restent en lecture seule.

- **Recherche :** quand le terminal a le focus, `Ctrl+F` (`⌘F` sur Mac) ou la loupe de l'en-tête ouvre la recherche
  dans la conversation, sans tenir compte des majuscules ni des accents. Le compteur indique la position (« 3/17 ») ;
  `Enter` et `Shift+Enter` passent au résultat suivant et au précédent, en dépliant les blocs repliés (« … +N lignes »)
  où se trouve le terme. La recherche reste active pendant que de nouveaux messages arrivent. `Esc` ferme la recherche ;
  l'appui suivant ferme le terminal.
- **Filtre :** **Tout**, **Prompts seuls** (vos prompts et les réponses finales de l'agent, sans les étapes
  intermédiaires) ou **Sans outils**.
- **Copier :** survolez (ou mettez le focus sur) un prompt, une réponse, une commande ou un résultat pour le copier.
- **Historique :** l'horloge de la barre du haut liste les sessions des 7 derniers jours de tous les comptes (jusqu'à
  150), regroupées par jour, avec une recherche par titre, projet ou compte. Une session terminée s'ouvre dans le
  terminal avec le projet, le titre et la date dans l'en-tête et « Session terminée à … » en bas ; une session encore
  ouverte ouvre le terminal en direct de l'agent.

Comme le terminal (et l'historique) affiche toute la conversation, il n'existe que lorsque Habblaud est accessible
**uniquement depuis l'ordinateur lui-même** (par défaut) et ne s'ouvre que via `http://localhost` ou `http://127.0.0.1`.
Avec le port ouvert au réseau (`HABBLAUD_BIND=0.0.0.0` ou `HABBLAUD_HOST=0.0.0.0`), il est désactivé. Détails dans
[Confidentialité et sécurité](#confidentialité-et-sécurité).

### Terminal interactif (prendre le contrôle, nouvelle session et fermer)

Avec `HABBLAUD_PTY=1` et en lançant avec `npm start` (hors Docker), la fenêtre de terminal de chaque agent principal
est interactive : le bouton **Ouvrir le terminal** du panneau de détails, le raccourci à côté de chaque agent dans la
liste latérale ou la touche `T` ouvrent la même fenêtre, avec des onglets pour les autres agents du même projet.

- Session ouverte ici : c'est le vrai Claude Code (taper, répondre ; Esc interrompt l'agent, comme dans le terminal).
- Session ouverte dans un autre terminal : **Prendre le contrôle ici** (en haut de la fenêtre) ferme la session là-bas
  et poursuit la **même conversation** ici (`claude --resume <sessão>`, dans le même dossier et avec le même compte).
  Le personnage garde son nom. Sous Windows, le terminal d'où la session est partie revient à la normale (Habblaud
  désactive les modes souris/clavier que Claude avait activés).
- **Fermer** met fin à la session, qu'elle soit ici ou dans un autre terminal (la conversation reste enregistrée).
- **Nouvelle session** (dans le panneau de la salle) ouvre un nouveau Claude Code dans le dossier du projet.

Prendre le contrôle et fermer demandent un second clic ; fermer la fenêtre ne met pas fin à la session. La fenêtre (et
le panneau de l'agent) peut être déplacée par sa barre et redimensionnée par le coin ; un double clic sur la barre la
remet à sa place.
**Désactivé par défaut :** activez-le avec `HABBLAUD_PTY=1` (lisez d'abord l'avertissement dans [Confidentialité et sécurité](#confidentialité-et-sécurité)).
Utilise `node-pty`, `@xterm/headless` (dépendances optionnelles) et le `claude` du PATH (`HABBLAUD_CLAUDE_BIN` pour
un autre) ; n'accepte que les requêtes venant de l'ordinateur lui-même. Au démarrage, Habblaud ouvre un terminal de
test : si `node-pty` ou `claude` ne fonctionnent pas, la fonction reste désactivée et le journal en donne la raison.
**Redémarrer Habblaud met fin aux sessions qu'il a ouvertes.**
Le terminal en direct reste disponible dans l'historique des sessions, pour les sous-agents et quand le mode interactif est désactivé.

### Timelapse de la journée

Le bouton **Timelapse** (une horloge avec une flèche de retour, ou la touche `L`) rejoue la journée en accéléré : les
salles qui s'allument et s'éteignent, les agents qui arrivent, travaillent, vous attendent, rejoignent les groupes, les
sous-agents qui entrent et sortent. La barre de lecture contient le jour, lecture/pause, la vitesse (60×, 180× ou
600× : une journée de 10 h en 10, 3⅓ ou 1 min), la chronologie déplaçable avec le graphique de qui était présent et au
travail, les repères des pics (cliquez pour y sauter) et **Revenir au direct**. Pendant ce temps, le bureau prend une
légère teinte sépia, avec le badge **REPLAY 14:32**, et le fil d'activité continue de montrer ce qui se passe maintenant.

Le serveur enregistre la chronologie **à partir du moment où il est allumé** (impossible de reconstituer le passé) :
des résumés de ce que le bureau affiche, sans les conversations, dans `~/.habblaud/timeline/` (dans Docker, dans le
volume de données), avec une taille limite par jour et les **7 derniers jours** conservés. Pour ne pas enregistrer :
`HABBLAUD_TIMELINE=0`. Détails dans [`server/README.md`](server/README.md#linha-do-tempo-timelapse).

Les personnages marchent plus vite pendant le replay, mais aux vitesses élevées, ceux qui restent peu de temps au
bureau atteignent à peine leur poste ; sauter à un autre moment montre tout le monde déjà en place.
### Répondre depuis le bureau

Avec le plugin de permissions installé (`npm run mod:install`, qui l'installe en même temps que le mod ; avec Claude Code
antérieur à 2.1.287, `npm run hooks:install`), quand un agent demande une permission — exécuter une commande, modifier
un fichier, ouvrir une page — la demande apparaît dans le bureau : le personnage lève la main, une alerte avec
**Répondre** s'affiche à l'écran et, dans les détails de l'agent, la carte **Demande la permission** montre la commande
(ou le diff de la modification) avec les boutons :

- **Valider** — et, quand Claude Code le propose, **Valider et ne plus demander** (la même règle que le terminal
  proposerait, par exemple `Bash(npm test:*)` dans ce projet) ;
- **Refuser** — avec un motif facultatif, transmis à l'agent, et la possibilité de l'interrompre ;
- **Répondre dans le terminal** — Habblaud laisse la demande de côté.

Le dialogue continue de s'afficher dans le terminal en même temps, et c'est la première réponse qui compte : si vous
répondez dans le terminal, la demande disparaît toute seule du bureau. Le compteur **ont besoin de vous** (et la touche
`P`) vous emmène à chaque demande.

Les **questions de l'agent** (`AskUserQuestion`) aussi : la carte de questions montre chaque question avec ses
options et leurs descriptions, comme le terminal les afficherait. Choisissez une option (ou plusieurs, quand la question
le permet) ou écrivez la vôtre dans **Autre**, puis utilisez **Répondre** ; **Refuser…** indique à l'agent que vous ne
voulez pas répondre, et **Répondre dans le terminal** laisse la question là-bas. La réponse arrive à l'agent comme si
vous l'aviez choisie dans le terminal.

- La demande passe par un hook `PermissionRequest` de Claude Code (celui du plugin, ou celui de l'ancienne méthode), qui
  ne la détourne que lorsqu'**une page de Habblaud est ouverte** sur cet ordinateur ; si Habblaud est arrêté ou
  qu'aucune page n'est ouverte, il se termine aussitôt et le terminal fonctionne normalement.
- Sans réponse depuis le bureau au bout de 5 minutes (jusqu'à 24 h avec `HABBLAUD_PERMISSION_TIMEOUT=86400` dans le
  bloc `env` du `settings.json`), la demande ne vaut plus que dans le terminal (les options du plugin sont dans
  [`mod/README.md`](mod/README.md) ; avec l'ancienne méthode, `npm run hooks:install -- --timeout 120` change le délai
  et `--port`, le port). Pour les **sous-agents en arrière-plan**, Claude Code n'affiche le dialogue dans le terminal
  qu'une fois le hook terminé : répondez depuis le bureau ou utilisez **Répondre dans le terminal**. Avec une attente
  de plus de 5 minutes, si 5 minutes passent sans aucune page ouverte capable de répondre (et sans
  [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) configuré pour répondre), la
  demande revient au terminal.
- Cela fonctionne avec le même verrou que le terminal : uniquement avec Habblaud accessible seulement depuis l'ordinateur
  lui-même et ouvert via `http://localhost`. Vérifiez avec `npm run mod:status` (ou `npm run hooks:status`, avec
  l'ancienne méthode).
  Cela fonctionne aussi depuis le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) (c'est le réglage par défaut là-bas).
- En mode démonstration, les agents fictifs demandent aussi des permissions et posent des questions (pour de faux),
  pour que vous puissiez essayer.

### Envoyer des messages

Avec le plugin de messages installé (`npm run mod:install`, qui l'installe en même temps que le mod ; nécessite Claude
Code 2.1.287 ou plus récent), les détails de chaque agent principal gagnent la section **Envoyer un message**, et le bas
du [terminal](#terminal) devient une zone de saisie. Écrivez et appuyez sur `Enter` (`Shift+Enter` va à la ligne) : le
texte entre dans la session **comme si vous l'aviez tapé dans son terminal**. Vous pouvez répondre quand l'agent finit
son tour et attend la demande suivante, donner une nouvelle instruction ou corriger le cap, sans chercher la bonne fenêtre.

- La zone indique l'état : **en file** (la session récupère les messages toutes les 2 secondes), **remis** ou **non
  remis**, avec la raison. Si l'agent est occupé, le message attend et entre quand il finit son tour, comme un
  prompt tapé pendant que l'agent travaille.
- Le plugin tourne dans chaque session et ne parle à Habblaud que sur `127.0.0.1`. Sans lui (ou dans une session ouverte
  avant l'installation : utilisez `/reload-plugins`), l'astuce d'installation apparaît à la place de la zone. Les
  sous-agents ne reçoivent pas de messages.
- Cela fonctionne avec le même verrou que le terminal (accès local uniquement) et peut être désactivé avec `HABBLAUD_MENSAGENS=0`.
  Lisez l'avertissement dans [Confidentialité et sécurité](#confidentialité-et-sécurité).
  Depuis le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes), seulement avec `messages` dans `HABBLAUD_REMOTE_ALLOW`.
- En mode démonstration, les agents fictifs reçoivent aussi des messages (pour de faux).

### Modifier le personnage

Chaque session arrive avec un nom et une apparence tirés au sort. Pour fixer le personnage d'un projet, ouvrez les
détails de l'agent principal et cliquez sur le crayon à côté du nom (**Modifier le personnage**). Dans l'éditeur :

- **Nom :** jusqu'à 24 caractères. Il ne peut pas reprendre celui de quelqu'un qui est dans le bureau ni celui choisi
  pour un autre projet.
- **Tirer au sort :** propose une autre apparence.
- **Éléments :** peau, cheveux, barbe, yeux, haut, bas, chaussures et accessoire, avec l'aperçu à côté.
- **Enregistrer :** s'applique au projet (la salle). La prochaine session ouverte dans ce projet arrive avec ce
  personnage. Avec deux sessions en même temps dans la même salle, la seconde reçoit un personnage tiré au sort.
- **Revenir au tirage au sort :** annule le choix.

Le choix est enregistré dans `~/.habblaud/names.json` et disparaît après 60 jours sans utilisation du projet. L'éditeur
a le même verrou que le terminal : le crayon n'apparaît qu'avec le terminal activé (sans `HABBLAUD_TERMINAL=0`) et
l'accès local, c'est-à-dire avec Habblaud accessible uniquement depuis l'ordinateur lui-même et ouvert via `http://localhost`.

### Codex

Les sessions Codex (CLI ou app) apparaissent comme celles de Claude Code : personnage, salle du projet, activité,
tâches, sous-agents, terminal et historique, utilisation sur 5 heures et sur la semaine, et **Ma journée** (tokens
seulement : Codex n'indique pas le coût). La pastille du compte Codex est évidée et porte le badge **CODEX**.

- **Sans rien installer**, Habblaud lit les fichiers que Codex écrit lui-même (les conversations dans `~/.codex/sessions`
  et les verrous des sessions ouvertes dans `~/.codex/thread-writer-locks`). Mais Codex n'écrit chaque étape **qu'une
  fois** qu'elle est terminée et n'écrit jamais « vous attend » : sans les hooks, le bureau montre Codex avec du retard
  et ne prévient pas quand il a besoin de vous.
- **Avec les hooks** (`npm run codex:install` puis validation dans `/hooks`), Codex prévient Habblaud à chaque étape :
  la session apparaît immédiatement, l'activité affichée est celle du moment et une demande de validation fait lever la
  main au personnage.
- **Valider depuis le bureau :** avec une page de Habblaud ouverte, la demande de validation de Codex attend votre
  réponse dans la carte **Demande la permission** jusqu'à **25 secondes** (`npm run codex:install -- --espera <s>`, de 5 à 120) :
  **Valider** ou **Refuser** (avec le motif). Contrairement à Claude Code, Codex n'affiche la validation dans le terminal
  **qu'après** la réponse du bureau ou la fin du délai — en attendant, le terminal affiche « En attente de réponse dans
  Habblaud… ». Il n'y a ni « toujours autoriser » ni « interrompre », et Codex ne permet pas de répondre à ses questions
  depuis l'extérieur.
- **Envoyer des messages :** la zone **Envoyer un message** fonctionne aussi pour Codex, via `codex queue` : le message
  entre dans la file de la session et Codex le prend quand il a fini ce qu'il est en train de faire (jusqu'à une dizaine
  de secondes plus tard). En mode Node, Habblaud lance lui-même la commande ; **dans Docker**, laissez tourner
  `npm run codex:bridge` sur le Mac (le conteneur ne voit pas votre Codex).
- **Utilisation sur 5 heures et sur la semaine :** elle provient des fichiers de Codex eux-mêmes et ne se met à jour que
  pendant qu'une session tourne ; la carte affiche l'âge des chiffres et « sans quota » quand l'espace de travail n'a
  plus de crédits.
- **Quand la session entre :** au premier message (c'est à ce moment que Codex enregistre le dossier du projet) ; une
  CLI ouverte mais encore sans conversation n'apparaît pas.
- **Quand la session quitte le bureau :** la CLI de Codex fait tourner les sessions sur un serveur en arrière-plan, qui
  les garde chargées jusqu'à une minute après qu'elles sont devenues inactives et que plus personne ne les regarde ; le
  personnage peut donc mettre un peu de temps à partir après la fermeture du terminal.
- Les conversations du cloud de ChatGPT (sans fichier sur l'ordinateur) n'apparaissent pas. `HABBLAUD_CODEX=0` désactive Codex.

### GitHub dans le bureau

Ce que les agents font sur GitHub anime la salle du projet, sans token et sans accès à Internet : Habblaud lit dans les
transcripts les appels (`gh pr create`, `gh pr merge`, `git push`, `gh run watch`, `gh pr checks`, `gh run view`,
`gh release create` et les outils du MCP de GitHub) et leurs résultats.

| Événement | Ce qui se passe |
| --- | --- |
| 🎉 **PR ouverte ou mergée, release publiée** | Des confettis tombent dans la salle, tout le monde fête ça en sautillant et une banderole en donne la raison (« PR #12 mergée ! ») pendant ~12 s. |
| 🚨 **CI au rouge** | Des gyrophares clignotent dans les coins de la salle, le sol devient rougeâtre et une bulle « ! » apparaît au-dessus de celui qui a vu l'échec, jusqu'à une CI au vert dans la salle (qui tourne à la fête) ou pendant 10 min. |
| 🚀 **Push** | Seulement l'alerte et le fil d'activité. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/github-party.png" alt="La salle app-mobile en fête : des confettis tombent, la banderole dorée « PR #12 mergée ! » et Jéssica debout, les bras levés, avec une étoile au-dessus de la tête" /></td>
    <td width="50%"><img src="docs/screenshots/github-alarm.png" alt="La salle data-pipeline en alarme : sol rougeâtre, banderole rouge « CI en échec (feat/checkout) », gyrophares dans les coins du haut et une bulle « ! » rouge à côté d'Ícaro" /></td>
  </tr>
</table>

Chaque événement génère aussi une alerte (« 🎉 Danilo a ouvert la PR #12 dans habblaud », « 🚨 CI en échec dans habblaud (feat/x) ») et entre
dans le fil d'activité. Seul ce qui se passe en direct anime la salle : ce qui était déjà dans les transcripts à
l'ouverture de Habblaud ne va que dans l'historique. Avec « réduire les animations » activé dans le système, rien ne
clignote ni ne tourne. En mode démonstration, des PR, des merges et des CI fictifs apparaissent de temps en temps.
### Ma journée

Le bouton **Ma journée** (ou la touche `M`) montre où est passée la journée : combien de temps les agents ont passé à
travailler et, mis en avant, combien de temps ils sont restés **à vous attendre** (permission, question ou choix) — avec
la plus longue attente, qui a attendu, où et quand. À côté : sessions, sous-agents, demandes, tokens et coût (quand
Claude Code enregistre le coût dans le transcript), ainsi que des graphiques par heure, par projet (de celui qui vous a
le plus attendu à celui qui vous a le moins attendu) et par compte, et le classement des plus longues attentes.
Choisissez le jour dans le sélecteur (Habblaud garde les 30 derniers) ; ouvert sur la journée en cours, le panneau se
met à jour toutes les 30 s. Chaque graphique a une version en tableau, et la légende active et désactive chaque statut.

Le temps compté est du **temps d'agent** : deux agents qui travaillent pendant une heure comptent pour deux heures.
Habblaud ne compte que ce qui se passe pendant qu'il tourne, et la journée suit le fuseau horaire de votre navigateur.
Avec le mode démonstration activé, le panneau affiche des chiffres fictifs (avec le badge « démonstration ») et permet
de basculer vers les données réelles ; les agents de la démo n'entrent jamais dans les vraies statistiques.

### Mode démonstration

Vous voulez voir le bureau plein sans avoir de sessions ouvertes ?

- Ajoutez **`?mock=1`** à l'URL (ex. : http://localhost:4747/?mock=1) pour tout simuler dans le navigateur, sans vos
  vraies sessions. Paramètres : `&speed=3` accélère le temps et `&sessions=6` change le nombre de sessions simulées.
- Ou activez-le depuis l'interface — **Voir la démonstration** (quand le bureau est vide) ou **Réglages › Mode
  démonstration** —, ce qui ajoute des agents fictifs à côté des vrais. Avec `npm run demo` (ou `HABBLAUD_DEMO=1` dans
  le `.env` de Docker), ce mode est activé dès le démarrage.

## Comptes et utilisation (5 heures et semaine)

> Les comptes **Codex** sont pris en compte automatiquement (chaque dossier `~/.codex*` ou `CODEX_HOME` est un compte ; la
> lettre vient d'un `alias x='CODEX_HOME=… codex'`, s'il y en a un) et leur utilisation provient des fichiers de Codex ;
> voir [Codex](#codex). Le reste de cette section concerne Claude Code.

Si vous utilisez plus d'un compte Claude Code (par exemple, un raccourci `c` avec `~/.claude` et un `d` avec
`CLAUDE_CONFIG_DIR=~/.claude-conta2`), Habblaud les affiche tous ensemble : chaque agent porte la pastille de son compte
et le haut de l'écran montre, pour chaque compte, le **pourcentage utilisé** de la session de 5 heures et de la semaine,
et **quand chaque limite se réinitialise**.

**Comment les comptes sont reconnus.** Chaque dossier de configuration de Claude Code est un compte : `~/.claude` et
tout `~/.claude*` contenant `projects/` ou `sessions/` (en plus de `CLAUDE_CONFIG_DIR`). Pour attribuer une lettre à
chacun, Habblaud lit dans les fichiers du shell (`~/.zshrc`, `~/.bashrc`…) **uniquement** les lignes `alias x='... claude ...'` :

```bash
alias c='claude'
alias d='CLAUDE_CONFIG_DIR=~/.claude-conta2 claude'
```

devient **Compte C** et **Compte D**. Seuls les raccourcis de 3 lettres maximum sont pris en compte ; les comptes sans
raccourci reçoivent A, B…

**D'où viennent les chiffres.** La méthode recommandée est le mod Habblaud (`npm run mod:install`, Claude Code 2.1.287+) :
dans chaque session, il reçoit de Claude Code lui-même les limites du forfait et ne garde que les pourcentages sur
5 heures et sur la semaine (et le moment où ils se réinitialisent) dans `~/.habblaud/usage/<conta>.json`. Les chiffres
arrivent après la prochaine réponse de chaque compte. Vérifiez avec `npm run mod:status`. Avec les versions antérieures
de Claude Code, la dérivation de statusline (`npm run usage:install`) fait la même chose via la commande de statusline,
dans le même fichier.

<details>
<summary><b>Détails de la dérivation et du cache de /usage</b></summary>

- `usage:install` (ancienne méthode) modifie, dans `<conta>/settings.json`, **seulement** le champ `statusLine.command` :
  la commande d'origine (ex. : `npx -y ccstatusline`) passe désormais par `node "<pasta do Habblaud>/scripts/statusline-tap.mjs" --
  <comando original>` (sous Windows, la commande d'origine tourne dans Git Bash, comme Claude Code la lancerait). Une
  copie du fichier est d'abord enregistrée dans `settings.json.habblaud-backup-<data>`. Si le compte n'avait pas de
  statusline, il en crée une qui ne fait que capturer l'utilisation. `npm run usage:install -- --dry-run` montre ce qui
  changerait sans rien écrire.
- La dérivation transmet le même JSON à votre statusline (sa sortie et son code de sortie restent inchangés) et
  n'enregistre **que** `{accountId, configDir, fetchedAt, five_hour, seven_day}` — ni prompts, ni coûts, ni chemins de
  projet. Tout échec de capture est ignoré : la statusline ne casse jamais à cause de Habblaud.

| Source | Fonctionnement |
| --- | --- |
| **Mod Habblaud** (recommandé) | En direct, comme décrit ci-dessus. Remplace la dérivation : `mod:install` retire la dérivation du compte. |
| Dérivation de statusline (Claude Code antérieur à 2.1.287) | En direct, via la commande de statusline, dans le même fichier. |
| Cache de `/usage` (toujours actif) | Claude Code enregistre le dernier résultat de la commande `/usage`. En mode Node, Habblaud le relit toutes les 60 s ; dans Docker, c'est la valeur lue lors du dernier `npm run docker:up` qui compte. Ne change que lorsque quelqu'un lance `/usage`. |

Les sources sont des fichiers locaux : aucune ne lit de mots de passe ou de tokens, ni ne fait d'appels réseau. C'est
toujours la source aux chiffres les plus récents qui l'emporte. Les chiffres de plus de 30 minutes apparaissent comme
**pas à jour** ; une fenêtre qui s'est réinitialisée depuis la collecte apparaît comme **—** jusqu'à l'arrivée de
nouveaux chiffres.

</details>

## Configuration

Tout fonctionne sans rien configurer. Si vous avez besoin d'ajuster quelque chose, utilisez des variables d'environnement :

| Variable | Par défaut | À quoi ça sert |
| --- | --- | --- |
| `HABBLAUD_PORT` | `4747` | Port HTTP (dans Docker, le port publié sur l'hôte). |
| `HABBLAUD_HOST` | `127.0.0.1` | Interface du serveur en mode Node. En dehors de `127.0.0.1`/`localhost`, le terminal (ainsi que la réponse et l'envoi de messages depuis le bureau) est désactivé. |
| `HABBLAUD_BIND` | `127.0.0.1` | Docker uniquement (dans le `.env`) : où le port est publié. `0.0.0.0` ouvre l'accès au réseau local (et désactive le terminal et tout ce qui agit sur les sessions). |
| `HABBLAUD_CLAUDE_DIRS` | détection automatique | Dossiers des comptes, séparés par des virgules (ex. : `/caminho/conta1,/caminho/conta2`). |
| `HABBLAUD_DATA_DIR` | `~/.habblaud` | Où Habblaud garde ses propres données (noms des personnages et des salles, chronologie du timelapse et statistiques de Ma journée). |
| `HABBLAUD_TIMELINE` | activé | `0` désactive l'enregistrement de la chronologie (les jours déjà enregistrés restent dans le timelapse). Dans Docker, il est toujours activé. |
| `HABBLAUD_USAGE_DIR` | `~/.habblaud/usage` | Où le mod (ou la dérivation de statusline) enregistre l'utilisation. |
| `HABBLAUD_DEMO` | désactivé | `1` active le mode démonstration au démarrage. |
| `HABBLAUD_ALLOWED_HOSTS` | — | Noms supplémentaires acceptés dans l'adresse (ex. : `meu-mac.local`), en plus de `localhost` et des IP. |
| `HABBLAUD_TERMINAL` | activé (en accès local uniquement) | `0` désactive le terminal, la réponse et l'envoi de messages depuis le bureau, et l'éditeur de personnage. Avec le port exposé, ils sont déjà désactivés, sans possibilité de les activer. |
| `HABBLAUD_PTY` | désactivé | `1` active le terminal interactif (ouvrir, reprendre et fermer des sessions Claude Code depuis le bureau ; uniquement en accès local et hors Docker) et **Nouvel agent** (aussi dans Docker, via `npm run codex:bridge`). Lisez l'avertissement dans [Confidentialité et sécurité](#confidentialité-et-sécurité). |
| `HABBLAUD_CLAUDE_BIN` | `claude` du PATH | L'exécutable de Claude Code que lancent le terminal interactif et Nouvel agent. |
| `HABBLAUD_REMOTE_ALLOW` | `permissions` | Ce que peut faire le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) : `permissions`, `messages`, `terminal`, `spawn` (séparés par des virgules) ou `none`. Les autres `HABBLAUD_REMOTE_*` sont écrites par `npm run remote:setup`. |
| `HABBLAUD_MENSAGENS` | activé (avec le terminal) | `0` désactive seulement les messages depuis le bureau (la zone dans le terminal et dans les détails de l'agent). |
| `HABBLAUD_CODEX` | activé | `0` désactive Codex dans le bureau. |
| `HABBLAUD_CODEX_DIRS` | détection automatique | Dossiers de Codex, séparés par des virgules (à la place de `~/.codex*` et `CODEX_HOME`). |
| `HABBLAUD_CODEX_BIN` | `codex` du PATH (sous Windows, `codex.exe`) | Le binaire de Codex qui remet les messages (`codex queue`), en mode Node ou dans `npm run codex:bridge`. |
| `HABBLAUD_UPDATE_CHECK` | activé | `0` désactive la vérification de nouvelle version (une requête aux releases du dépôt sur GitHub toutes les 6 h). |
| `HABBLAUD_LANG` | langue du système (sauf l'anglais), sinon `pt-BR` | Langue des textes générés par le serveur (activités, alertes, journaux) : `pt-BR`, `en`, `es` ou `fr`. L'interface suit le navigateur ou le choix fait dans Réglages › Langue. Voir [Langues](#langues). |
| `HABBLAUD_ACCOUNTS` | — | JSON pour personnaliser le nom, la lettre ou la couleur, associé par le nom du dossier du compte. Ex. : `[{"id":".claude-conta2","name":"Trabalho","short":"T","color":"#5cc97b"}]`. |

**Dans Docker**, sont prises en compte `HABBLAUD_PORT`, `HABBLAUD_BIND`, `HABBLAUD_ALLOWED_HOSTS`, `HABBLAUD_DEMO`, `HABBLAUD_TERMINAL`,
`HABBLAUD_MENSAGENS`, `HABBLAUD_CODEX`, `HABBLAUD_UPDATE_CHECK`, `HABBLAUD_LANG`, `HABBLAUD_PTY`, les `HABBLAUD_WORLD*` et les
`HABBLAUD_REMOTE_*` (dans le `.env` ou dans l'environnement) ainsi que `HABBLAUD_CLAUDE_DIRS`, `HABBLAUD_CODEX_DIRS`, `HABBLAUD_USAGE_DIR` et
`HABBLAUD_ACCOUNTS` (lues par `docker:up` sur l'hôte) ; les autres sont fixées à l'intérieur du conteneur. Options : `npm run docker:up -- --no-build` (démarre sans reconstruire),
`npm run docker:down` (arrête) et `npm run docker:logs` (suit les journaux).

## Habblaud World

Habblaud World est une ville en ligne en pixel art où chaque Habblaud devient un immeuble, allumé en direct pendant que
les agents travaillent, et où chacun se promène avec un personnage. **Il est activé par défaut**, pointant vers
`server.habblaud.com` ; **rien ne sort de l'ordinateur tant que vous n'avez pas créé de compte** et ouvert une session,
et `HABBLAUD_WORLD=0` désactive tout. L'accès est accordé par liste d'attente.

**Comment le configurer.** Les variables ci-dessous (dans le `.env` ou dans l'environnement) sont facultatives : sans
elles, Habblaud pointe vers le serveur officiel. La section apparaît dans la fenêtre **Habblaud World** (le bouton ville de la barre du haut) et ne fonctionne que depuis l'ordinateur
lui-même (jamais par le port du téléphone) ; le compte reste ici seulement, dans `~/.habblaud/world.json` (permission
600 ; dans Docker, dans le volume `/data`).

| Variable | Par défaut | À quoi ça sert |
| --- | --- | --- |
| `HABBLAUD_WORLD_URL` | `https://server.habblaud.com` | Adresse du serveur du monde, uniquement `https://` ou `wss://` (sans chemin). |
| `HABBLAUD_WORLD` | activé | `0` désactive tout le World (routes et interface) et rien ne sort de l'ordinateur. |
| `HABBLAUD_WORLD_DEV` | désactivé | `1` accepte un serveur du monde local sans TLS : `http://127.0.0.1:<port>` (`npm run dev` l'accepte déjà) ou, depuis Docker, `http://host.docker.internal:<port>`. |

**Confidentialité.** Rien de votre travail ne sort de l'ordinateur. De l'immeuble ne sortent que le thème, un étage par
salle ouverte (avec un code aléatoire qui change chaque jour) et, pour chaque agent, principal ou sous-agent, l'outil,
le statut, l'apparence, un nom tiré au sort et la tranche de tâches terminées dans la journée. Chemins, noms de
projets, titres, commandes, messages, code, coût, modèle, branche et votre compte Claude ne sortent jamais. La liste
complète, champ par champ (en portugais) : [docs/world/privacidade.md](docs/world/privacidade.md). **Voir ce qui a été
envoyé**, sur la carte Votre immeuble, montre le JSON exact du dernier envoi, avec sa taille en octets et la réponse du
monde.

**Compte et liste d'attente.** Inscription avec e-mail, **nom de joueur** (3 à 20 caractères, unique dans le monde :
il vous est réservé pendant l'attente sur la liste et devient le nom du personnage) et mot de passe (12 caractères ou
plus ; les mots de passe ayant fuité sont refusés), code à 6 chiffres par e-mail et acceptation des Conditions
d'utilisation et de la Politique de confidentialité. Chaque compte entre dans une liste d'attente, et l'accès est ouvert
par lots : le Habblaud ouvert vérifie tout seul toutes les 30 minutes. Jusqu'à 3 ordinateurs par compte (**Appareils**,
avec révocation).

**Personnage.** Le nom de joueur choisi à l'inscription (modifiable ensuite, une fois tous les 30 jours), le même éditeur
d'apparence que les agents, 2 ou 3 traits de personnalité et une phrase de présentation de la liste (dans le monde, pas
de texte libre en dehors du nom). On peut le créer dès la liste d'attente.

**Immeuble.** Avec le compte validé et le personnage créé, l'immeuble monte tout seul (par WebSocket) et suit le bureau
en direct. La carte **Votre immeuble** montre la connexion, les étages, les agents, le dernier envoi et, quand le monde
refuse un envoi ou arrête l'immeuble (ancienne version, autre ordinateur, compte suspendu ou banni), la raison ; un
compte suspendu ou banni reçoit **Faire appel par e-mail**. Un immeuble marqué « non vérifié » (chiffres hors du
plausible, en cours d'examen) reste hors des classements et des mises en avant et affiche **Contester par e-mail**.
Quand le monde est en maintenance, la carte le dit, et Habblaud réessaie tout seul.

**Visibilité.** En direct (étages, compteurs et statut de chaque personnage) ou **mode discret** (seulement allumé ou
éteint et le nombre d'étages) ; fermé aux visites ; cacher le pays ; les **tokens** de l'immeuble seulement par tranches
(jusqu'à 100 000, 1 million…), jamais le nombre ni le coût, et désactivables ; classement et compactages seulement si
vous les activez ; frapper à la porte (**Me prévenir quand on frappe à la porte**) aussi seulement si vous l'activez.

**Ville.** Le bouton **Monde**, dans la barre du haut, remplace le bureau par la ville : on marche avec les flèches/WASD
ou en cliquant, la carte de chaque immeuble montre étages, agents et état, et la minicarte est dans le coin ; en pause
ou hors du monde, votre immeuble reste éteint, mais vous pouvez vous promener dans la ville. En mode démonstration
(`?mock=1&world=approved&scene=city`, seulement des immeubles et des personnes fictifs) :
[la ville](docs/screenshots/world-cidade.png) et [la carte d'un immeuble](docs/screenshots/world-cartao.png).

**Visites.** Près de la porte d'un immeuble, **Entrer (E)** vous fait entrer : le bureau du propriétaire en direct, avec
des salles aux noms fictifs et les agents dans leur statut du moment, en lecture seule (ni terminal, ni messages, ni
permissions, et rien du travail) ; un immeuble fermé aux visites ne se voit que de l'extérieur. Sur le vôtre, vous voyez
« N visiteurs en ce moment » (seulement le nombre, jamais qui). En mode démonstration :
[la visite](docs/screenshots/world-visita.png) et [le panneau de la visite](docs/screenshots/world-visita-painel.png).

**Social.** Dans la ville, sans aucun texte libre : **L** aime l'immeuble près de la porte, **G** ouvre la roue des
salutations (phrases toutes faites, traduites pour qui les lit) et **K** frappe à la porte de ceux qui l'acceptent ; la
carte de chaque personne propose Saluer, Bloquer et Signaler, et la minicarte mène à un immeuble par son code (« Aller à
HB-XXXX ») ou à n'importe quel immeuble allumé. À l'intérieur d'un immeuble, **J'aime** et **Laisser un tampon** à
l'accueil (un par immeuble et par jour). Sur la place, le thermomètre de l'objectif hebdomadaire de la ville et, quand
il est atteint, un feu d'artifice. Au bureau, la puce « ❤️ N aujourd'hui » et la carte « Pendant votre absence » avec
les visites, les j'aime et les tampons laissés à l'accueil (jamais qui) ; les personnes bloquées sont dans **Bloqués**,
avec **Débloquer**. En mode démonstration : [la roue des salutations](docs/screenshots/world-social.png) et
[la place avec le feu d'artifice](docs/screenshots/world-praca.png).

**Pause, quitter, supprimer.** **Pause** éteint l'immeuble tout de suite et garde le lot (après 30 jours en pause, il
disparaît de la carte ; 30 jours plus tard, il est retiré). **Quitter le monde** retire l'immeuble et libère le lot ; le
compte et le personnage restent, et revenir crée un nouvel immeuble. **Supprimer le compte** (dans **Compte et
données**, avec le code reçu par e-mail) retire l'immeuble et le profil du monde tout de suite, efface le compte, les
likes, les blocages, les signalements faits et les appareils de la base de données sous 7 jours (et des sauvegardes sous
30 jours au plus) et efface le `world.json` de cet ordinateur. Sans nouvelles de Habblaud pendant 7 jours, l'immeuble
disparaît de la carte et, 30 jours plus tard, il est retiré ; un e-mail prévient 3 jours avant (désactivable dans
**Compte et données**).

**Exporter.** **Télécharger mes données** (dans **Compte et données**) enregistre `habblaud-world-dados.json` avec ce
que le monde garde de votre compte : e-mail, dates, personnage, visibilité, appareils, immeuble, likes donnés, blocages
et signalements faits. Une fois par jour.

**Données véridiques.** Le World ne fonctionne que si les immeubles sont vrais : modifier Habblaud pour envoyer des
étages, agents, statuts, tokens ou personnages inventés ou gonflés enfreint les Conditions d'utilisation et fait bannir
le compte (le serveur vérifie la plausibilité de chaque paquet). Modifier Habblaud pour autre chose reste libre (MIT).
Comment Habblaud parle au World (en portugais) : [shared/world/README.md](shared/world/README.md).

**Tester avec un serveur du monde local.** Pour qui développe le World, avec le serveur du monde qui tourne sur le même
ordinateur (par exemple, dans Docker, publié sur le port 4848) :

- Hors de Docker : `HABBLAUD_WORLD_URL=http://127.0.0.1:4848 npm run dev`.
- Avec Habblaud dans Docker : dans le `.env` de ce dossier, `HABBLAUD_WORLD_URL=http://host.docker.internal:4848` et
  `HABBLAUD_WORLD_DEV=1` ; ensuite, `npm run docker:up`, qui se termine par la ligne du World
  (`Habblaud World : activé : http://host.docker.internal:4848`, ou pourquoi il est resté désactivé). Le
  `docker-compose.yml` relie déjà `host.docker.internal` à l'hôte (`extra_hosts` avec `host-gateway` ; Docker Desktop a
  déjà ce nom). Sous Linux, le serveur du monde doit écouter sur une interface que le conteneur atteint (`0.0.0.0` ou
  l'IP du pont Docker) : un port publié seulement sur le `127.0.0.1` de l'hôte ne répond pas par `host-gateway`.
- Sans TLS, seulement avec `HABBLAUD_WORLD_DEV=1` (ou `--dev`) et seulement pour `127.0.0.1` et `host.docker.internal` ;
  sinon, uniquement `https://` ou `wss://`. Le serveur du monde doit accepter le nom utilisé dans l'URL comme hôte du
  jeu (sinon il répond `421`).

À quoi ressemble la section, en mode démonstration (`?mock=1&world=logged_out`, `waiting` ou `approved` ; en
portugais) : [sans compte](docs/screenshots/world-sem-conta.png), [liste d'attente](docs/screenshots/world-lista-de-espera.png),
[personnage](docs/screenshots/world-personagem.png), [Votre immeuble](docs/screenshots/world-predio.png) et
[ce qui a été envoyé](docs/screenshots/world-enviado.png).

## Comment ça marche

```
 ~/.claude*/sessions/<pid>.json ─────────────────┐
 ~/.claude*/projects/<projeto>/<sessão>.jsonl ───┼──▶ servidor Node ──▶ modelo do escritório ──▶ SSE ──▶ navegador
 .../<sessão>/subagents/**/agent-*.jsonl ────────┘    (polling de 1 s)                                 (canvas + interface)
```

- **Qui est dans le bureau :** tant qu'une session est ouverte, Claude Code tient à jour `sessions/<pid>.json` avec le
  projet et le statut (occupé, inactif, en attente de vous ou en attente d'un shell en arrière-plan). C'est ce qui
  décide qui apparaît et ce que fait chacun.
- **Shells en cours :** dans les transcripts, chaque `Bash` en arrière-plan (ou commande longue au premier plan) devient
  un « shell » avec un libellé et un chronomètre, jusqu'à l'arrivée de la notification indiquant qu'il s'est terminé, a
  échoué ou a été interrompu.
- **Vie sociale :** les groupes, les personnalités et les pièces sont une simulation du navigateur (`client/src/world/social/`),
  sans aucun effet sur les vrais agents. La personnalité découle de la graine de chaque agent (elle est la même dans
  n'importe quel navigateur) ; les porte-monnaie sont stockés dans le `localStorage` du navigateur.
- **Ce que fait chacun :** le serveur suit la fin des transcripts (`.jsonl`) des sessions ouvertes et traduit chaque
  appel d'outil en une activité, avec une icône, dans la langue du serveur (voir [Langues](#langues)). Il en tire aussi
  les tâches, le titre, le modèle et les statistiques.
- **Sous-agents :** les transcripts dans `<sessão>/subagents/` (y compris ceux des workflows) deviennent des personnages
  liés à l'agent qui les a appelés.
- **GitHub :** les PR, les pushs, la CI et les releases proviennent des mêmes lignes du transcript (la commande et sa
  sortie, ou le `gitOperation` que Claude Code enregistre lui-même) ; rien n'est demandé à GitHub.
- **Le dessin :** le navigateur reçoit l'état par SSE et dessine tout sur un canvas — personnages, meubles, sols et murs
  sont du pixel art **généré par code** ; en revanche, le logo, les illustrations et les tableaux aux murs ont été générés par IA.

<details>
<summary><b>Structure du code et API</b></summary>

```
shared/   protocolo (types.ts), atividades em PT-BR, nomes, simulador de demonstração
server/   servidor HTTP + SSE: contas e uso, leitura das sessões e transcripts, modelo do escritório
client/   Vite: src/art (pixel art procedural), src/world (o escritório no canvas), src/ui (interface)
scripts/  build do servidor, docker-up, instaladores (mod, tap de statusline e hook de permissão) e screenshots
mod/      o mod do Habblaud e os plugins de permissões e de mensagens (plugins do Claude Code; marketplace em .claude-plugin/)
```

| Route | Description |
| --- | --- |
| `GET /api/stream` | SSE avec les événements `snapshot`, `feed` et `notice` (format dans `shared/types.ts`). |
| `GET /api/snapshot` | État actuel du bureau. |
| `GET /api/agents/:id` | Détails d'un agent, avec jusqu'à 200 activités. |
| `GET /api/agents/:id/terminal` | SSE du terminal (événements `init` et `append`) ; en accès local uniquement. |
| `PUT /api/agents/:id/character` | Modifier le personnage : `{name, seed, parts}` enregistre le nom et l'apparence de l'agent principal comme personnage du projet (la salle) ; en accès local uniquement. |
| `DELETE /api/agents/:id/character` | « Revenir au tirage au sort » : supprime le personnage du projet et l'agent reprend le nom tiré au sort ; en accès local uniquement. |
| `GET /api/sessions/recent` | Historique : sessions des 7 derniers jours de tous les comptes (jusqu'à 150) ; en accès local uniquement. |
| `GET /api/sessions/:conta/:sessionId/terminal` | SSE de la conversation d'une session de l'historique (même protocole que le terminal) ; en accès local uniquement. |
| `GET /api/stats?day=AAAA-MM-DD` | Statistiques de Ma journée (temps par statut, projets, comptes, heures, attentes, tokens et coût). |
| `GET /api/stats/days` | Jours avec des statistiques (les 30 derniers). |
| `GET /api/timeline/days` | Jours enregistrés pour le timelapse, avec la taille et l'heure du premier et du dernier enregistrement. |
| `GET /api/timeline/:dia` | Chronologie d'un jour (`AAAA-MM-DD`), en JSONL (avec gzip). |
| `GET /api/health` | Santé : version, démonstration, Docker, terminal, réponse et envoi de messages depuis le bureau, sources et statut de l'utilisation de chaque compte. |
| `POST /api/demo` | `{"enabled": true \| false}` active ou désactive les agents simulés. |
| `POST /api/rooms/rename` | `{"id": sala, "name": nome}` renomme la salle (vide = retour au nom du dossier) ; le nom est enregistré dans `rooms.json`, dans le dossier de données. En accès local uniquement. |
| `GET /api/mod/summary` | Pour le mod de Claude Code : version, nombre d'agents, combien travaillent et qui a besoin de vous (sans la démo et, avec `?account=&session=`, sans la session elle-même). |
| `/api/permissions…` | Répondre depuis le bureau : le hook de permission enregistre la demande (permission ou question) et attend ; la page récupère le détail et décide ou répond. En accès local uniquement. |
| `/api/messages…` et `/api/mod/inbox…` | Envoyer des messages : la page met le message en file et suit sa remise ; le plugin `habblaud-mensagens` le récupère, le remet à la session et confirme. En accès local uniquement. |
| `POST /api/codex/events` | Événements des hooks de Codex (session ouverte, outil, validation, fin du tour). En accès local uniquement. |
| `/api/codex/bridge/poll` et `/ack` | `npm run codex:bridge` récupère les messages pour Codex et confirme leur remise. En accès local uniquement. |

Plus de détails sur le serveur dans [`server/README.md`](server/README.md).

</details>

<details>
<summary><b>Ce que Docker monte et pourquoi</b></summary>

| Hôte | Conteneur | À quoi ça sert |
| --- | --- | --- |
| `<conta>/sessions/` | `/claude/<conta>/sessions` (lecture seule) | Sessions ouvertes et leurs statuts. |
| `<conta>/projects/` | `/claude/<conta>/projects` (lecture seule) | Transcripts des sessions et des sous-agents. |
| `~/.habblaud/usage/` | `/usage` (lecture seule) | Utilisation capturée par le mod (ou par la dérivation de statusline). |
| volume `habblaud-data` | `/data` | Données propres à Habblaud (noms des personnages, chronologie du timelapse et statistiques de Ma journée). |
| `~/.habblaud/remote-tls/server/` | `/remote-tls` (lecture seule) | Seulement après `npm run remote:setup` : le certificat et la clé du serveur du [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) (jamais la clé de la CA). |

Le dossier du compte n'est **jamais** monté en entier (il contient les identifiants et les configurations). Le conteneur
tourne avec un utilisateur sans privilèges, un système de fichiers en lecture seule, sans capabilities supplémentaires et
avec `no-new-privileges`. Les métadonnées des comptes (lettre, e-mail, organisation) sont lues sur l'hôte par
`docker:up` et transmises au conteneur.

</details>

## Confidentialité et sécurité

- **Lecture seule :** Habblaud n'écrit jamais dans les dossiers de Claude Code. Les exceptions sont les installateurs,
  que vous lancez vous-même : `npm run mod:install` / `mod:uninstall` utilise `claude plugin` lui-même (qui enregistre le
  marketplace et les plugins dans le `settings.json` et dans `<conta>/plugins/`) et, à l'installation, retire l'ancienne
  dérivation et l'ancien hook avec sauvegarde ; avec l'ancienne méthode, `npm run usage:install` / `usage:uninstall` ne
  modifie que le `statusLine.command` du `settings.json`, et `npm run hooks:install` / `hooks:uninstall`, que la liste
  `hooks.PermissionRequest` — toujours avec une sauvegarde préalable.
- **Le mod :** il tourne dans chaque session de Claude Code, avec vos permissions (comme tout mod), et ne fait que ce qui
  est listé dans [`mod/README.md`](mod/README.md) — `claude plugin validate mod/habblaud` affiche les événements et les
  appels, sans rien exécuter. Il n'enregistre que les pourcentages d'utilisation sur 5 heures et sur la semaine (et le
  moment où ils se réinitialisent) dans `~/.habblaud/usage/<conta>.json` ; pour la ligne « a besoin de vous » et
  `/habblaud`, il ne parle à Habblaud que sur `127.0.0.1`. Il ne lit pas la conversation, n'appelle pas le modèle et
  n'envoie rien hors de l'ordinateur. Il est lu depuis ce dossier : ce qui s'y trouve (y compris après un `git pull`)
  est ce qui s'exécute. Le plugin de messages (`habblaud-mensagens`) est séparé justement parce qu'il agit : il tape dans
  la session ce que vous avez envoyé depuis le bureau.
- **Local uniquement, par défaut :** le serveur n'accepte que les connexions venant de l'ordinateur lui-même ; ouvrir
  l'accès au réseau local est facultatif. Il n'y a pas de télémétrie. Le seul appel externe est la vérification de
  nouvelle version : toutes les 6 heures, une requête anonyme, sans token, à l'API publique de GitHub
  (`api.github.com/repos/marmottajr/habblaud/releases/latest`). Elle n'envoie rien sur vos sessions ; GitHub ne voit que
  votre IP et la version utilisée, qui figure dans le `User-Agent`.
  `HABBLAUD_UPDATE_CHECK=0` désactive la requête.
  [Habblaud World](#habblaud-world) (activé par défaut) n'envoie quelque chose au serveur du monde qu'après la création
  du compte et l'ouverture de session, et seulement ce qui figure dans [ce qui sort](docs/world/privacidade.md) (en
  portugais) ; `HABBLAUD_WORLD=0` désactive tout.
  Le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) aussi : il n'existe qu'après `npm run remote:setup`.
- **Sans identifiants :** Habblaud ne lit ni mots de passe ni tokens d'accès. Du `.claude.json` de chaque compte, il
  n'utilise que l'e-mail, l'organisation et le cache de `/usage` ; l'utilisation en direct vient du mod (ou de la
  dérivation de statusline).
- **Secrets masqués :** les tokens et mots de passe au format connu (`Bearer`, `-u usuário:senha`, `TOKEN=`, clés
  `sk-…`, `ghp_…`, `AKIA…`, JWT, mots de passe dans les URL) deviennent `***` avant d'arriver au navigateur.
- **Protégé contre les sites malveillants :** le serveur refuse les adresses qui ne sont pas `localhost`/IP (DNS
  rebinding) et les `POST` venant d'autres origines (CSRF), et empêche l'intégration de la page dans d'autres sites.
- **Terminal local uniquement :** la conversation complète des sessions (et l'historique des sessions terminées, avec
  leurs titres) ne sort du serveur que si Habblaud est accessible uniquement depuis l'ordinateur lui-même
  (`HABBLAUD_HOST` local en Node ; `HABBLAUD_BIND` local dans Docker) — impossible de
  l'activer avec le port exposé — et chaque requête doit passer par `localhost`/`127.0.0.1` : les IP du réseau et les
  noms de `HABBLAUD_ALLOWED_HOSTS` (proxys, tunnels) sont refusés. Les secrets sont masqués et les textes longs tronqués
  avant d'arriver au navigateur ; en mode démonstration, la conversation est fictive. `HABBLAUD_TERMINAL=0` le désactive complètement.
  Seule exception : le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes), et seulement avec `terminal` dans `HABBLAUD_REMOTE_ALLOW`.
- **Chronologie du timelapse :** uniquement les résumés déjà affichés à l'écran (activité sur une ligne, statut, titres,
  utilisation des comptes, sans e-mails, commandes complètes ni conversations), enregistrés dans `~/.habblaud/timeline/`
  et supprimés au bout de 7 jours. `HABBLAUD_TIMELINE=0` désactive l'enregistrement.
- **Répondre depuis le bureau, en local uniquement :** valider ou refuser agit sur les sessions, cela suit donc le même
  verrou que le terminal (bind local, `Host` local, pas de proxys ni de tunnels) et n'existe qu'avec le hook de
  permission (celui du plugin `habblaud-permissoes` ou celui de l'ancienne méthode) installé par vous. Les réponses
  exigent du JSON et une origine locale (un site ouvert dans le navigateur ne peut pas les envoyer), le hook ne parle
  qu'à `127.0.0.1` et, dans le doute — Habblaud hors service, erreur, délai écoulé —, il se termine sans décider : c'est
  le terminal qui compte. La commande complète ou le diff ne sortent du serveur que pour qui a ouvert la page depuis
  l'ordinateur lui-même. « Toujours autoriser » n'applique qu'une règle que Claude Code lui-même a proposée pour cette
  demande. Attention : tout programme ou toute personne capable d'ouvrir `http://localhost:4747` sur cette machine peut
  aussi répondre ; sur des ordinateurs partagés avec d'autres utilisateurs, n'installez pas le hook
  (`npm run mod:install -- --sem-permissoes`).
  Exception : le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes) répond aussi (c'est son réglage par défaut) et voit la même commande ou le même diff.
- **Envoyer des messages, en local uniquement — avec un avertissement :** le message entre dans la session comme si vous
  l'aviez tapé, donc tout ce que l'agent peut faire à votre demande s'applique. Cela suit le même verrou (bind local,
  `Host` local, JSON et origine locale, si bien qu'un site ouvert dans le navigateur ne peut pas en envoyer), mais
  **n'importe quel programme de cette machine** qui parle à `http://localhost:4747` — y compris un agent qui exécute une
  commande — peut déposer un message pour une autre session qui a le plugin. Si cela ne vous convient pas (ordinateur
  partagé, agents qui tournent sans supervision), n'installez pas le plugin (`npm run mod:install -- --sem-mensagens`)
  ou désactivez-le avec `HABBLAUD_MENSAGENS=0`. Le texte des messages n'est pas enregistré : il disparaît du serveur dès
  qu'il est remis.
  Depuis le [téléphone avec connexion](#téléphone-avec-connexion-et-https-valider-les-demandes), seulement avec `messages` dans `HABBLAUD_REMOTE_ALLOW`.
- **Terminal interactif, sur activation — avec un avertissement :** avec `HABBLAUD_PTY=1`, le bureau ouvre Claude Code
  dans n'importe quel dossier, y tape (y compris `!comando`, qui s'exécute dans le shell) et ferme ou reprend des
  sessions ouvertes dans d'autres terminaux. Cela suit le même verrou que le terminal (bind local, `Host` local, pas de
  proxys ni de tunnels) et chaque requête doit venir de l'ordinateur lui-même, avec une origine locale (un site ouvert
  dans le navigateur ne peut pas en envoyer). Malgré tout, **n'importe quel programme de cette machine** qui parle à
  `http://localhost:4747` — y compris un agent qui exécute une commande — obtient ce pouvoir. Avant de mettre fin à un
  processus externe, Habblaud vérifie dans le registre des sessions et dans le système que ce PID correspond toujours à
  ce Claude Code (même démarrage et même exécutable). Sur des ordinateurs partagés ou avec des agents qui tournent sans
  supervision, laissez-le désactivé.
- **Téléphone avec connexion, sur activation :** n'existe qu'après `npm run remote:setup`. Un second port avec HTTPS
  (une CA locale qui ne signe que les noms `.local`, `localhost`, votre propre adresse et les IP privées), un
  identifiant et un mot de passe (seul le hash scrypt est conservé) ; la session est un cookie `HttpOnly`,
  `SameSite=Strict` et `Secure` signé avec HMAC. Sur ce port, ce qui est autorisé vient de `HABBLAUD_REMOTE_ALLOW` (par
  défaut, seulement répondre aux demandes de permission), jamais de l'en-tête Host ; les routes des hooks, des plugins
  et de l'auxiliaire de l'hôte, le terminal interactif, l'éditeur de personnage et le renommage des salles ne
  fonctionnent jamais par ce port. Qui a le mot de passe obtient ce que vous avez autorisé : choisissez-en un robuste
  et n'autorisez que le nécessaire. La clé de la CA reste dans `~/.habblaud/remote-tls/ca` et n'entre jamais dans le
  conteneur.
- **Nouvel agent, sur activation :** avec `HABBLAUD_PTY=1`, le bureau lance des sessions Claude Code avec la demande
  que vous avez écrite, dans le dossier que vous choisissez — le même avertissement que pour le terminal interactif
  s'applique. Les pièces jointes sont écrites dans `~/.habblaud/attachments/` (dossier 700, fichiers 600). Dans Docker,
  c'est l'auxiliaire de l'hôte (`npm run codex:bridge`) qui lance les sessions ; il ne lit les fichiers des livraisons
  que dans les dossiers de projet connus (ceux que Claude Code a dans `<conta>/projects`), le dossier temporaire et les
  pièces jointes.
- **Éditeur de personnage, en local uniquement :** enregistrer ou revenir au tirage au sort modifie le bureau et écrit
  dans `names.json`, cela suit donc le même verrou que le terminal (bind local, `Host` local, pas de proxys ni de
  tunnels) : sans lui, le crayon n'apparaît pas et le serveur répond `403`. Les modifications exigent du JSON et une
  origine locale. `HABBLAUD_TERMINAL=0` le désactive aussi.
- **Statistiques de Ma journée :** uniquement des chiffres agrégés (temps par statut, comptages, tokens, coût) avec les
  noms de projet, de compte et d'agent, conservés dans `HABBLAUD_DATA_DIR/stats/` pendant 30 jours — rien de la conversation.
- **Codex :** Habblaud ne lit que les conversations (`sessions/`, `archived_sessions/`) et les verrous des sessions
  ouvertes (`thread-writer-locks/`) ; dans Docker, seuls ces trois dossiers sont montés, en lecture seule. Il ne lit
  jamais `auth.json`, `config.toml`, l'environnement du shell (`shell_snapshots/`), l'historique des prompts, les
  journaux ni les bases de données de Codex, et n'affiche pas les identifiants du compte ChatGPT. `npm run codex:install`
  ne fait qu'ajouter des groupes dans `hooks.json` (avec sauvegarde ; ceux des autres applis restent à leur place) et
  écrit `~/.habblaud/codex-hook.json` ; la validation des hooks vous revient toujours, dans `/hooks`. Les hooks ne
  parlent qu'à `127.0.0.1`. Les messages à Codex appellent le même avertissement que ceux de Claude Code : n'importe
  quel programme de cette machine qui parle à Habblaud peut déposer un message dans la file d'une session.
- **Ce qui apparaît à l'écran :** des résumés des activités (outil, fichier, commande ou requête), les titres des
  sessions, les tâches et les statistiques (et, dans le terminal, la conversation). N'exposez pas le port sur des réseaux
  auxquels vous ne faites pas confiance.

## Développement

| Commande | Ce qu'elle fait |
| --- | --- |
| `npm run dev` | Serveur + Vite sur http://localhost:4747, avec rechargement automatique. |
| `npm run dev:client` | Vite seul, sur http://localhost:5173 (ouvrez avec `?mock=1` ; `/api` est redirigé vers le port 4747). |
| `npm run demo` | `npm run dev` avec le mode démonstration activé. |
| `npm run build` / `npm start` | Compile et lance la version de production. |
| `npm test` | Tests (Vitest). |
| `npm run typecheck` | Vérification des types du client, du serveur et des scripts. |
| `claude plugin test mod/habblaud` | Tests du mod (sans session, compte ni réseau) ; idem pour `mod/habblaud-mensagens`. |
| `claude plugin validate .` | Valide le marketplace (`.claude-plugin/marketplace.json`) ; avec `mod/habblaud`, `mod/habblaud-permissoes` ou `mod/habblaud-mensagens`, valide le plugin et liste les événements et les appels du mod. |
| `claude --plugin-dir mod/habblaud` | Ouvre une session avec le mod de ce dossier, sans l'installer (modifiez-le puis lancez `/reload-plugins`). |
| `npm run mod:status` | Affiche, par compte, le marketplace, les plugins et les versions installées. |
| `npm run demo:timeline` | Génère une chronologie fictive (simulateur du mode démonstration) pour le timelapse. |
| `npm run release` | Publie la version du `package.json` sur GitHub (tag et release avec les notes du `CHANGELOG.md`). |

Pour prendre des captures d'écran sans ouvrir votre navigateur, `scripts/shot.mjs` utilise un Chromium headless isolé
(Playwright). La première fois, téléchargez le navigateur (une seule fois suffit) : `npx playwright-core install chromium-headless-shell`.

```bash
node scripts/shot.mjs 'http://localhost:4747/?mock=1&speed=3' /tmp/habblaud.png --size 1400x900 --wait 4000
```

Dans la console du navigateur, `habblaud.world.debug` propose des outils pour tester des scènes (ex. :
`habblaud.world.debug.setHour(21)` pour voir la nuit). Pour fixer l'heure dès l'ouverture, utilisez `?hora=21:30` dans l'URL.

**Timelapse avec des données fictives uniquement** (ex. : pour enregistrer un GIF) : `npm run demo:timeline` lance le
simulateur du mode démonstration hors ligne et enregistre une journée entière (par défaut, hier de 9 h à 19 h, avec une
matinée chargée, un déjeuner plus calme et un pic l'après-midi) dans `<tmp>/habblaud-demo/timeline/`. Lancez ensuite un
Habblaud qui ne lit que ce dossier et n'affiche pas vos sessions, puis ouvrez le Timelapse :

```bash
npm run demo:timeline -- --data-dir /tmp/habblaud-demo        # opções: --date, --start 8:30, --hours, --sessions, --seed
mkdir -p /tmp/habblaud-demo/vazio
HABBLAUD_DATA_DIR=/tmp/habblaud-demo HABBLAUD_TIMELINE=0 HABBLAUD_CLAUDE_DIRS=/tmp/habblaud-demo/vazio \
  HABBLAUD_PORT=4848 npm start                                 # depois de npm run build; abra http://localhost:4848
```

`HABBLAUD_TIMELINE=0` évite d'écrire dans ce dossier ; avec l'enregistrement activé, les jours de plus de 7 jours sont supprimés.

**Publier une version :** chaque version a sa section dans [`CHANGELOG.md`](CHANGELOG.md), avec ce qu'elle apporte.
Pendant le travail, notez les changements sous « Não lançado » (non publié). Pour publier :

1. Augmentez le numéro avec `npm version minor --no-git-tag-version` (ou `patch`, pour une version qui ne contient que des corrections).
2. Remplacez « Não lançado » par la version et la date (`## [0.3.0] - AAAA-MM-DD`), laissez un « Não lançado » vide
   au-dessus et mettez à jour les liens de la fin. `npm test` échoue si la version du `package.json` n'a pas de section.
3. Faites le merge dans `main` et lancez `npm run release` (nécessite [`gh`](https://cli.github.com/) authentifié ; `-- --dry-run`
   affiche seulement les notes). Le script crée le tag `v0.3.0` et la release avec le texte de la section. À partir de
   là, les utilisateurs de Habblaud voient le badge **Nouvelle version**.

## Dépannage

<details>
<summary><b>Le bureau est vide</b></summary>

Seules les sessions **ouvertes** de Claude Code apparaissent. Vérifiez qu'il y en a une en cours et que le compte a été
détecté dans `http://localhost:4747/api/health`. Si les dossiers des comptes se trouvent ailleurs, utilisez
`HABBLAUD_CLAUDE_DIRS=/caminho/conta1,/caminho/conta2`.

</details>

<details>
<summary><b>L'utilisation s'affiche comme « pas de données » ou « pas à jour »</b></summary>

Lancez `npm run mod:install` (ou, avec Claude Code antérieur à 2.1.287, `npm run usage:install`) et vérifiez avec
`npm run mod:status` (ou `npm run usage:status`). Les chiffres arrivent après la prochaine réponse dans une session ouverte
de ce compte ; dans une session ouverte avant l'installation, lancez `/reload-plugins` ou rouvrez la session. Un **—** à
la place du pourcentage signifie que la fenêtre s'est réinitialisée depuis la dernière collecte.

</details>

<details>
<summary><b>Le mod ne se charge pas dans une session</b></summary>

Lancez `npm run mod:status` : il affiche la version de Claude Code (le mod nécessite la 2.1.287 ou plus récente) et, par
compte, si le marketplace pointe vers ce dossier et si les plugins sont installés et activés. Dans une session ouverte
avant l'installation, lancez `/reload-plugins` ; `/plugin` affiche, sous les onglets, les mods chargés (ex. :
`1 mod active · habblaud`). Les mods ne tournent pas avec `"disableAllHooks": true` dans le `settings.json` du compte ni avec
`claude --safe-mode`.

</details>

<details>
<summary><b>« Le port 4747 est déjà utilisé »</b></summary>

Un autre Habblaud (Node ou Docker) tourne déjà. Arrêtez-le (`npm run docker:down`, ou Ctrl+C dans le terminal de
`npm start`) ou utilisez un autre port : `HABBLAUD_PORT=4848 npm run docker:up` (Docker) ou `HABBLAUD_PORT=4848 npm start`
(Node).

</details>

<details>
<summary><b>Ça ne s'ouvre pas sur le téléphone</b></summary>

Vérifiez que vous avez créé le `.env` avec `HABBLAUD_BIND=0.0.0.0` et recréé le conteneur (`npm run docker:up -- --no-build`), que
le téléphone est sur le même Wi-Fi et que le pare-feu de l'ordinateur autorise les connexions sur le port 4747. Par IP,
ça marche directement ; pour l'ouvrir par un nom (ex. : `meu-mac.local`), ajoutez `HABBLAUD_ALLOWED_HOSTS=meu-mac.local`
(dans Docker, dans le même `.env`).

</details>

<details>
<summary><b>Le terminal ne s'ouvre pas</b></summary>

Le terminal n'existe que si Habblaud est accessible uniquement depuis l'ordinateur lui-même. Vérifiez que le `.env` ne
contient pas `HABBLAUD_BIND=0.0.0.0` (ou, en mode Node, que vous n'avez pas utilisé `HABBLAUD_HOST=0.0.0.0`) ni
`HABBLAUD_TERMINAL=0`, et ouvrez via `http://localhost:4747` (par l'IP du réseau ou par un nom de `HABBLAUD_ALLOWED_HOSTS`,
il est refusé). Dans Docker, un conteneur créé avant l'arrivée de cette fonction doit être recréé : `npm run docker:up`.
Le journal de démarrage (`npm run docker:logs`) indique si le terminal est activé et, s'il ne l'est pas, pourquoi.

</details>

<details>
<summary><b>La demande de permission (ou la question) n'apparaît pas dans le bureau</b></summary>

Lancez `npm run mod:status` : il indique, par compte, si le plugin `habblaud-permissoes` est installé et activé (et s'il
reste l'ancien hook à côté, ce qui ferait répondre deux mécanismes) et si Habblaud traite les demandes. Avec l'ancienne
méthode, `npm run hooks:status` indique si le hook est installé et pointe vers ce dossier. La demande n'est détournée
qu'avec une page de Habblaud ouverte via `http://localhost` (ou `127.0.0.1`) et avec le terminal activé (même verrou).
Les sessions ouvertes avant l'installation chargent le plugin avec `/reload-plugins` (ou à leur réouverture). Avec
l'ancienne méthode, si Habblaud utilise un autre port, réinstallez avec `npm run hooks:install -- --port <porta>`. Pour
les questions de l'agent, le plugin doit être celui de la 0.6.0 ou plus récent : lancez `npm run mod:install` après la
mise à jour.

</details>

<details>
<summary><b>Codex n'apparaît pas dans le bureau (ou apparaît avec du retard)</b></summary>

Le journal de démarrage (`npm run docker:logs`) indique combien de comptes Codex Habblaud a trouvés ; s'il n'en a trouvé
aucun, indiquez le dossier avec `HABBLAUD_CODEX_DIRS` (et relancez `npm run docker:up` : dans Docker, seuls les dossiers
qui existaient au moment du `docker:up` sont montés). Sans les hooks, Codex apparaît via ses fichiers, qui ne sont écrits
qu'après chaque étape : lancez `npm run codex:install`, **validez les hooks dans `/hooks` dans Codex** et vérifiez avec
`npm run codex:status`. Codex lance les hooks via le shell de connexion, qui peut avoir un vieux Node ; `codex:install`
choisit un Node 22+ et indique lequel (ou utilisez `--node <caminho>`). Une session de CLI tout juste ouverte n'apparaît
qu'au **premier message** : avant cela, Codex n'indique pas dans quel dossier elle se trouve (il crée seulement le verrou
de la session), et sans dossier, pas de salle.

</details>

<details>
<summary><b>La zone de message n'apparaît pas (ou reste en file)</b></summary>

La zone n'apparaît que pour les agents principaux dont la session a le plugin `habblaud-mensagens` connecté : lancez
`npm run mod:status` (il indique, par compte, si le plugin est installé et si Habblaud a les messages activés) et, dans
les sessions ouvertes avant l'installation, `/reload-plugins`. Sans le plugin, les détails de l'agent affichent l'astuce
d'installation. Les messages suivent le verrou du terminal et `HABBLAUD_MENSAGENS=0` les désactive ; le journal de
démarrage (`npm run docker:logs`) indique s'ils sont activés et, sinon, pourquoi. Un message qui reste **en file** puis
échoue avec « la session n'a pas récupéré le message » signifie que la session a cessé d'interroger Habblaud (elle a été
fermée, ou le plugin a été désactivé).

</details>

<details>
<summary><b>Dans Docker, une session fermée reste dans le bureau</b></summary>

Cela arrive si Claude Code a été arrêté de force sans supprimer sa propre entrée dans `sessions/` (dans Docker, impossible
de vérifier si le processus existe encore). En lançant avec Node (`npm start`), Habblaud vérifie les processus et cela
n'arrive pas.

</details>

<details>
<summary><b>Dans Docker, un compte situé hors de /Users n'apparaît pas</b></summary>

Docker Desktop ne partage que certains dossiers du Mac avec les conteneurs (par défaut `/Users`, `/Volumes`, `/private` et
`/tmp`). Ajoutez le dossier dans *Settings › Resources › File sharing*.

</details>

<details>
<summary><b>Je veux repartir de zéro</b></summary>

`npm run docker:down`, puis `docker volume rm habblaud_habblaud-data` (supprime les noms enregistrés) et
`npm run docker:up`.

</details>

## Avertissement

Habblaud est un projet indépendant, **ni affilié à Anthropic, ni sponsorisé ou approuvé par elle**. « Claude » et
« Claude Code » sont des marques d'Anthropic, utilisées ici uniquement pour décrire ce avec quoi le projet fonctionne.

Pour afficher les agents, Habblaud lit uniquement des fichiers locaux que Claude Code écrit lui-même sur votre machine
(registres des sessions ouvertes, transcripts et configurations des comptes). Ce format n'est pas documenté et peut changer d'une version de Claude Code à l'autre :
après une mise à jour, Habblaud peut cesser de fonctionner, totalement ou partiellement, jusqu'à ce qu'il soit adapté.

## Licence

[MIT](LICENSE). Les images de `client/public/assets` (logo, illustrations, tableaux et affiches) ont été générées par
IA pour ce projet et converties en pixel art par les scripts de `scripts/assets/`.

## Vie sociale

Quand deux agents ou plus n'ont rien à faire — inactifs, ou en attente d'un shell depuis plus de 40 secondes —, ils
arrêtent de se promener seuls et se retrouvent. Personne ne se concerte : chaque personnage a une **personnalité**, des
**amis** et des **rivaux**, et c'est ce qui décide ce qu'il préfère faire, avec qui et ce qu'il dit. Celui qui attend un
shell ne quitte son bureau que pour rejoindre un groupe (seul, il reste devant son pop-corn) et emporte son sablier ;
quand la commande se termine — ou quand vous envoyez une nouvelle demande à quelqu'un —, il prévient la bande (« Oups,
on m'appelle ! 🏃 ») et retourne en courant à son bureau.

<p align="center">
  <img src="docs/screenshots/social-lounge.gif" width="816" alt="Le salon de Habblaud avec trois groupes en même temps : trois collègues sur le canapé regardent le foot à la télé (l'écran fait clignoter GOL), une partie de ping-pong avec des supporters et un duel sur les bornes d'arcade avec des provocations dans les bulles" />
</p>

### Les activités de groupe

| | Activité | Ce qui se passe |
| --- | --- | --- |
| 📺 | **Télé au salon** | Foot, feuilleton ou dessin animé, avec du pop-corn sur le canapé. Pendant le foot, les supporters fêtent le « GOL » qui clignote à l'écran (ou se lamentent du but adverse) ; pendant le feuilleton, petits cœurs et « J'y crois pas ! 😱 ». Les amateurs de siestes finissent par s'endormir sur le canapé. |
| 🎮 | **Jeux vidéo** | Deux sur le canapé, manette en main, la télé en écran partagé (course ou combat), en deux manches gagnantes, avec des provocations (« C'est quoi ce lag ?! ») et des supporters. |
| 👾 | **Arcade** | Duel sur les deux bornes du salon, en une seule partie. |
| 🏓 | **Ping-pong** | En 5 points, avec la balle qui va et vient, le score dans les bulles (« 3 × 2 🏓 ») et des supporters derrière la table. |
| ☕ | **Pause à la cuisine** | Chacun prend un café (ou de l'eau) et s'assoit à table : potins avec le nom des collègues (« Vous avez vu le commit de Rafaela ? 👀 »), blagues (tout le groupe éclate de rire), boulot (« Déployer un vendredi ? 😈 ») et sujets liés au jour et à l'heure (« C'est vendredi ! 🎉 »). |
| 💬 | **Discussion** | Deux collègues debout dans un coin de l'accueil, de la cuisine ou du salon. |
| ✊ | **Chifoumi avec mise** | « Chi… fou… mi ! », les gestes apparaissent au-dessus des têtes, le gagnant fête ça et les pièces volent de l'un à l'autre ; le perdant fait la tête et, s'il a l'esprit de compétition, demande une revanche. En cas d'égalité, on rejoue. Ceux qui passent peuvent s'arrêter pour regarder. |
| 💄 | **Miroir des toilettes** | Rouge à lèvres ou peigne, avec le visage reflété dans le miroir et un éclat à la fin. Seul ou à deux (« Tu me prêtes ton peigne ? »). |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/social-rps.png" alt="Chifoumi à l'accueil : Lia fête ça avec une pièce au-dessus de la tête et la bulle « Gagné ! », des pièces volent de Bruna (dépitée, avec l'icône de la pierre) vers elle, « +20 » et « −20 » flottent, et Iara regarde derrière" /></td>
    <td width="50%"><img src="docs/screenshots/social-kitchen.png" alt="Pause à la cuisine : quatre collègues assis à la longue table avec du café, avec les bulles « Ça va marcher ! » et « Hahaha »" /></td>
  </tr>
  <tr>
    <td><b>Chifoumi avec des pièces en jeu.</b> La mise dépend de la personnalité (les amateurs de paris misent gros, les radins misent peu) et ne dépasse jamais le solde de celui qui en a le moins.</td>
    <td><b>Pause à la cuisine.</b> Ceux qui parlent le plus sont les plus sociables ; les réactions dépendent du sujet (fou rire pour une blague, 👀 pour un potin).</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/social-mirror.png" alt="Deux collègues devant les lavabos des toilettes en train de se préparer, avec leurs visages reflétés dans les miroirs et la bulle « Tu assures ! »" /></td>
    <td><img src="docs/screenshots/social-drawer.png" alt="Section Vie sociale dans les détails de l'agent : « Regarde une série à la télé avec Bruna et Iara », 115 pièces, 1 victoire et 0 défaite, les traits Coquetterie et Économie, la réplique culte, les amitiés, les rivalités avec le score et le relevé" /></td>
  </tr>
  <tr>
    <td><b>Au miroir.</b> Les coquets passent aux toilettes dès qu'ils le peuvent — et apparaissent dans le reflet.</td>
    <td><b>Dans les détails de l'agent.</b> Ce qu'il fait, son porte-monnaie, son score, sa personnalité, ses amitiés et ses rivalités (avec le bilan) et son relevé.</td>
  </tr>
</table>

### Personnalités

Chaque agent a 2 ou 3 traits, tirés au sort à partir de sa graine (c'est toujours la même personne, dans n'importe quel navigateur) :

🏆 Compétition · 🎲 Paris · 🎮 Jeux vidéo · 📺 Séries et télé · 🗣️ Commérages · 💄 Coquetterie · ☕ Caféine · 😂 Blagues · 🏓 Sport ·
🙈 Timidité · 💰 Économie · 😴 Siestes · 🧘 Calme · 📚 Lecture

Les traits changent ce que chacun choisit (l'amateur de séries allume la télé, le sportif propose un ping-pong), qui il
invite (les amis se cherchent ; les rivaux se défient aux jeux), ce qu'il dit et même qui joue le mieux. Chacun a aussi
une réplique culte (« C'est fait ! », « Au code ! »). Survolez un trait dans les détails de l'agent pour voir son effet.

### Pièces

Des pièces fictives (🪙), juste pour pimenter les paris :

| | |
| --- | --- |
| **Arrivée au bureau** | 🪙100 (sous-agents, 🪙30) |
| **Tâche terminée** (élément de la liste de tâches) | +🪙10 |
| **Demande traitée** (fin de tour) | +🪙5 |
| **Sous-agent qui a remis son résultat** | +🪙15 |
| **Paris** (chifoumi ; parties entre rivaux ou avec un amateur de paris) | ce que l'un perd va au gagnant |

Chaque gain apparaît sous la forme « +🪙10 » au-dessus de la tête ; les parties et les paris entrent dans le fil
d'activité. Le solde, le score et le relevé sont enregistrés dans le navigateur (chaque navigateur a sa propre économie :
c'est là que les paris sont tirés au sort) et sont oubliés trois jours après le départ de l'agent.

> Tout cela n'est que de la mise en scène de Habblaud : rien ne change pour les agents Claude Code, qui continuent de travailler normalement.

---

<p align="center">
  Fait avec ☕ et beaucoup d'agents <a href="https://code.claude.com">Claude Code</a>.
</p>
