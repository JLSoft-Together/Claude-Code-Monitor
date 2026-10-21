// Dependências opcionais do terminal interativo (optionalDependencies): carregadas com import() dinâmico e usadas
// só por tipos locais (manager.ts, screen.ts). Declaradas aqui para o typecheck não depender delas instaladas.
declare module 'node-pty';
declare module '@xterm/headless';
declare module '@xterm/addon-serialize';
