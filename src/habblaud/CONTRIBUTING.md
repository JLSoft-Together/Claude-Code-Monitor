# Como contribuir

Obrigado por querer contribuir com o Habblaud! Relatos de bugs, ideias e melhorias são bem-vindos.

## Antes de começar

- Para bugs e ideias, procure nas [issues](https://github.com/marmottajr/habblaud/issues) se o assunto já foi registrado.
- Para mudanças maiores ou que alterem o comportamento do Habblaud, abra uma issue para conversar sobre a proposta antes de implementar.
- Prefira mudanças pequenas e focadas. Se a alteração muda o que aparece ou acontece no escritório, descreva esse comportamento no pull request.

## Preparar o ambiente

O Habblaud requer Node.js 22.12 ou mais recente e npm. Depois de clonar o repositório:

```sh
npm install
npm run dev
```

O escritório de desenvolvimento fica em <http://localhost:4747>.

## Textos e traduções

O Habblaud tem interface em português, inglês, espanhol e francês. O português é a língua de origem:

- Todo texto que aparece para quem usa (interface, erros, logs, scripts de instalação) é escrito em português dentro
  de `tr()` (`shared/i18n.ts`). Valores entram por lacunas numeradas: `tr('Lendo {0}', [arquivo])`, nunca uma
  template string dentro do `tr()`.
- A chave da tradução é o próprio texto em português: mudar o texto muda a chave. Atualize as traduções dele em
  `shared/locales/` (`en.ts`, `es.ts`, `fr.ts`) ou deixe sem: um texto sem tradução aparece em português.
- `npm run i18n:check` lista os textos sem tradução e as traduções que sobraram.

## Verificar uma mudança

Antes de abrir o pull request, rode:

```sh
npm run typecheck
npm test
npm run build
```

Se a mudança alterar um plugin do Claude Code, valide também o plugin afetado:

```sh
claude plugin validate mod/habblaud
claude plugin test mod/habblaud
```

Use o caminho do plugin alterado (`mod/habblaud-permissoes` ou `mod/habblaud-mensagens`) quando for o caso.

## Abrir um pull request

- Use um título claro e explique o problema, a mudança e como ela foi verificada.
- Referencie a issue relacionada, se houver.
- Para mudanças visuais, inclua uma captura de tela ou um GIF, se ajudar a mostrar o resultado. Faça as capturas no
  modo demonstração (`?mock=1` na URL ou `npm run demo`), que mostra só agentes fictícios.
- Atualize a seção **Não lançado** do `CHANGELOG.md` quando a mudança trouxer algo visível para quem usa o Habblaud.
- PRs que tocam `shared/world/` ou `server/world/` (Habblaud World) explicam o que muda no que sai do computador, e a
  revisão confere a lista de [`docs/world/privacidade.md`](docs/world/privacidade.md) contra o código. Leia antes o
  [`shared/world/README.md`](shared/world/README.md).
- Não inclua dados pessoais, credenciais ou conteúdo privado de sessões em capturas, exemplos ou logs.

Se algo não estiver claro, pergunte na issue relacionada antes de seguir por uma direção que possa mudar o comportamento do projeto.
