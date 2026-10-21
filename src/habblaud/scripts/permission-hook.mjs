#!/usr/bin/env node
// Caminho antigo do hook de permissão. Até a 0.2.0, o `npm run hooks:install` gravava este arquivo no settings.json
// das contas; o script passou para mod/habblaud-permissoes/hooks/permission-hook.mjs (o plugin habblaud-permissoes).
// Este atalho mantém essas instalações funcionando depois do `git pull`, até o `npm run mod:install` (que tira o
// hook antigo) ou um novo `npm run hooks:install` trocá-las. Node puro, sem dependências.
import { main } from '../mod/habblaud-permissoes/hooks/permission-hook.mjs';

main().catch(() => process.exit(0));
