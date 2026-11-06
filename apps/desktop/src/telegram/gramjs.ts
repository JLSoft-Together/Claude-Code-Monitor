// Bundled on its own as stage/gramjs.cjs (build.mjs) so the ~2 MB MTProto client loads only when a large file is sent.
export { Api, helpers, Logger, sessions, TelegramClient } from 'telegram'
export { computeCheck } from 'telegram/Password'
export { LogLevel } from 'telegram/extensions/Logger'
export { CustomFile } from 'telegram/client/uploads'
