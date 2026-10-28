<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRightLeft, Check, CircleCheck, CircleX, Copy, LoaderCircle, Play, RefreshCw, Square, TriangleAlert } from 'lucide-vue-next'
import { buildRequest, envNames, envVars, parseEnvFile, parseHttpFile, prettyJson, statusTone, type HttpEnvs } from '../../lib/httpFile'
import { dirOf, hasHttpSend, httpCancel, httpSend, readFile, type HttpResult } from '../../lib/preview'
import { joinPath } from '../../lib/fileLinks'

const JsonTree = defineAsyncComponent(() => import('./JsonTree.vue'))

const props = defineProps<{ path: string; text: string; cursorLine: number | null }>()
const emit = defineEmits<{ reveal: [line: number] }>()
const { t, locale } = useI18n()

const ENV_FILE = 'http-client.env.json'
const PRIVATE_ENV_FILE = 'http-client.private.env.json'
const ENV_SEARCH_LEVELS = 8
const NO_ENV = ''
const sendId = `http-${crypto.randomUUID()}`

const file = computed(() => parseHttpFile(props.text))
const envDir = ref<string | null>(null)
const pubEnvs = shallowRef<HttpEnvs | null>(null)
const privEnvs = shallowRef<HttpEnvs | null>(null)
const envError = ref(false)
const env = ref<string>(NO_ENV)
const envs = computed(() => envNames(pubEnvs.value, privEnvs.value))
const vars = computed(() => envVars(pubEnvs.value, privEnvs.value, env.value || null))

const envKey = (dir: string) => `ccm.http.env:${dir}`
watch(env, (e) => {
  if (!envDir.value) return
  try {
    localStorage.setItem(envKey(envDir.value), e)
  } catch {
    // storage off
  }
})

/** Nearest folder (the file's, then up while readable) holding either env file. */
async function loadEnvs(): Promise<void> {
  const start = dirOf(props.path)
  let dir = start
  let found: { dir: string; pub: string | null; priv: string | null } | null = null
  for (let i = 0; i < ENV_SEARCH_LEVELS; i++) {
    const [pub, priv] = await Promise.all([readFile(joinPath(dir, ENV_FILE)), readFile(joinPath(dir, PRIVATE_ENV_FILE))])
    const text = (v: typeof pub) => (v?.kind === 'text' ? (v.text ?? '') : null)
    if (text(pub) !== null || text(priv) !== null) {
      found = { dir, pub: text(pub), priv: text(priv) }
      break
    }
    if (pub?.kind === 'denied' && priv?.kind === 'denied') break
    const up = dirOf(dir)
    if (!up || up === dir) break
    dir = up
  }
  if (dirOf(props.path) !== start) return
  envDir.value = found?.dir ?? null
  pubEnvs.value = found?.pub != null ? parseEnvFile(found.pub) : null
  privEnvs.value = found?.priv != null ? parseEnvFile(found.priv) : null
  envError.value = !!found && ((found.pub != null && !pubEnvs.value) || (found.priv != null && !privEnvs.value))
  let saved = NO_ENV
  try {
    saved = (found && localStorage.getItem(envKey(found.dir))) || NO_ENV
  } catch {
    // storage off
  }
  env.value = envs.value.includes(saved) ? saved : (envs.value[0] ?? NO_ENV)
}
watch(() => props.path, () => void loadEnvs(), { immediate: true })

const rows = computed(() =>
  file.value.requests.map((r, i) => {
    const b = buildRequest(r, file.value.vars, vars.value)
    return { i, req: r, built: b, active: props.cursorLine !== null && props.cursorLine >= r.startLine && props.cursorLine <= r.endLine }
  }),
)

const sending = ref<number | null>(null)
const result = shallowRef<{ index: number; method: string; url: string; res: HttpResult } | null>(null)
const notice = ref<string | null>(null)
const tab = ref<'body' | 'headers'>('body')
const bodyView = ref<'tree' | 'text'>('tree')
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function send(index: number): Promise<void> {
  const row = rows.value[index]
  if (!row || sending.value !== null) return
  const b = buildRequest(row.req, file.value.vars, vars.value)
  if (b.missing.length) {
    notice.value = t('workspace.http.missing', { names: b.missing.join(', ') })
    return
  }
  notice.value = null
  sending.value = index
  const res = await httpSend({ id: sendId, method: b.method, url: b.url, headers: b.headers, ...(b.body ? { body: b.body } : {}) })
  sending.value = null
  if (!res.ok && res.error === 'cancelled') return
  result.value = { index, method: b.method, url: b.shown.url, res }
  tab.value = 'body'
}

const cancel = (): void => void httpCancel(sendId)
onBeforeUnmount(() => {
  if (sending.value !== null) cancel()
  clearTimeout(copiedTimer)
})

const ok = computed(() => (result.value?.res.ok ? result.value.res : null))
const contentType = computed(() => ok.value?.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1])
const pretty = computed(() => (ok.value && !ok.value.binary ? prettyJson(ok.value.body, contentType.value) : null))
const tone = computed(() => (ok.value ? statusTone(ok.value.status) : 'error'))
const TONE_CLASS = { success: 'text-success', redirect: 'text-ink-muted', warning: 'text-warning', error: 'text-st-error' } as const
const errorText = computed(() => {
  const r = result.value?.res
  if (!r || r.ok) return ''
  const base = t(`workspace.http.error.${r.error}`)
  return r.detail ? `${base} (${r.detail})` : base
})

function fmtBytes(n: number): string {
  const nf = (v: number, d: number) => v.toLocaleString(locale.value, { maximumFractionDigits: d })
  return n < 1024 ? `${nf(n, 0)} B` : n < 1024 * 1024 ? `${nf(n / 1024, 1)} KB` : `${nf(n / 1024 / 1024, 1)} MB`
}

async function copyBody(): Promise<void> {
  if (!ok.value) return
  try {
    await navigator.clipboard.writeText(pretty.value ?? ok.value.body)
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1200)
  } catch {
    // clipboard denied
  }
}
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface text-ink" :aria-label="t('workspace.http.title')" data-http-panel>
    <div class="ccm-material flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" role="toolbar" :aria-label="t('workspace.http.toolbar')">
      <span class="text-xs font-semibold">{{ t('workspace.http.title') }}</span>
      <span class="ml-auto" />
      <select v-if="envs.length" v-model="env" class="ccm-field h-7 max-w-40 shrink cursor-pointer pr-1 text-2xs" :aria-label="t('workspace.http.env')" :title="envDir ?? ''" data-http-env>
        <option :value="''">{{ t('workspace.http.noEnv') }}</option>
        <option v-for="e in envs" :key="e" :value="e">{{ e }}</option>
      </select>
      <span v-else class="truncate text-2xs text-ink-faint" :title="t('workspace.http.noEnvFileHint')">{{ t('workspace.http.noEnvFile') }}</span>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.http.reloadEnv')" :aria-label="t('workspace.http.reloadEnv')" @click="loadEnvs">
        <RefreshCw :size="13" aria-hidden="true" />
      </button>
    </div>
    <p v-if="!hasHttpSend" class="border-b border-line px-3 py-1.5 text-xs text-ink-muted">{{ t('workspace.http.error.unavailable') }}</p>
    <p v-if="envError" class="flex items-center gap-1.5 border-b border-line bg-warning-soft px-3 py-1.5 text-xs" role="alert">
      <TriangleAlert :size="13" class="shrink-0 text-warning" aria-hidden="true" />{{ t('workspace.http.envInvalid') }}
    </p>
    <p v-if="notice" class="flex items-center gap-1.5 border-b border-line bg-warning-soft px-3 py-1.5 text-xs" role="alert" data-http-notice>
      <TriangleAlert :size="13" class="shrink-0 text-warning" aria-hidden="true" />{{ notice }}
    </p>

    <ul class="ccm-scroll max-h-[40%] shrink-0 overflow-y-auto border-b border-line py-1" :aria-label="t('workspace.http.requests')">
      <li v-if="!rows.length" class="px-3 py-2 text-xs text-ink-muted">{{ t('workspace.http.none') }}</li>
      <li
        v-for="r in rows"
        :key="r.i"
        class="group flex min-w-0 items-center gap-1.5 px-2 py-0.5 text-xs hover:bg-fill"
        :class="r.active || result?.index === r.i ? 'bg-accent-soft' : ''"
        :data-http-request="r.i"
      >
        <button
          type="button"
          class="ccm-btn-plain size-6 shrink-0"
          :disabled="!hasHttpSend || (sending !== null && sending !== r.i)"
          :title="sending === r.i ? t('workspace.http.cancel') : t('workspace.http.send')"
          :aria-label="sending === r.i ? t('workspace.http.cancel') : `${t('workspace.http.send')} ${r.req.name ?? r.built.shown.url}`"
          data-http-send
          @click="sending === r.i ? cancel() : send(r.i)"
        >
          <Square v-if="sending === r.i" :size="12" aria-hidden="true" />
          <Play v-else :size="13" class="text-success" aria-hidden="true" />
        </button>
        <button type="button" class="flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 text-left" :title="t('workspace.http.reveal', { line: r.req.line })" @click="emit('reveal', r.req.line)">
          <span class="w-12 shrink-0 font-mono text-2xs font-semibold text-ink-muted">{{ r.req.method }}</span>
          <span v-if="r.req.name" class="shrink-0 truncate font-medium">{{ r.req.name }}</span>
          <span class="min-w-0 truncate font-mono text-2xs text-ink-faint" :title="r.built.shown.url">{{ r.built.shown.url }}</span>
        </button>
        <span v-if="r.built.missing.length" class="shrink-0 text-2xs text-warning" :title="t('workspace.http.missing', { names: r.built.missing.join(', ') })">
          <TriangleAlert :size="12" class="inline" aria-hidden="true" /><span class="sr-only">{{ t('workspace.http.missing', { names: r.built.missing.join(', ') }) }}</span>
        </span>
        <LoaderCircle v-if="sending === r.i" :size="13" class="shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
      </li>
    </ul>

    <div v-if="!result" class="grid min-h-0 flex-1 place-items-center p-4 text-center text-xs text-ink-muted">{{ t('workspace.http.hint') }}</div>
    <div v-else class="flex min-h-0 flex-1 flex-col" data-http-result>
      <div class="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line px-3 py-1 text-xs">
        <template v-if="ok">
          <span class="flex items-center gap-1 font-semibold tabular" :class="TONE_CLASS[tone]" data-http-status>
            <CircleCheck v-if="tone === 'success'" :size="13" aria-hidden="true" />
            <ArrowRightLeft v-else-if="tone === 'redirect'" :size="13" aria-hidden="true" />
            <TriangleAlert v-else-if="tone === 'warning'" :size="13" aria-hidden="true" />
            <CircleX v-else :size="13" aria-hidden="true" />
            {{ ok.status }} {{ ok.statusText }}
          </span>
          <span class="tabular text-ink-muted">{{ t('workspace.http.time', { ms: ok.timeMs.toLocaleString(locale) }) }}</span>
          <span class="tabular text-ink-muted">{{ fmtBytes(ok.size) }}</span>
          <span v-if="ok.truncated" class="text-warning">{{ t('workspace.http.truncated') }}</span>
        </template>
        <span v-else class="flex items-center gap-1 text-st-error" role="alert" data-http-error><CircleX :size="13" aria-hidden="true" />{{ errorText }}</span>
        <span class="min-w-0 flex-1 truncate font-mono text-2xs text-ink-faint" :title="`${result.method} ${result.url}`">{{ result.method }} {{ result.url }}</span>
      </div>
      <template v-if="ok">
        <div class="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2">
          <div class="flex shrink-0 rounded-inner bg-fill p-0.5" role="tablist" :aria-label="t('workspace.http.response')">
            <button
              v-for="v in ['body', 'headers'] as const"
              :key="v"
              type="button"
              role="tab"
              :aria-selected="tab === v"
              class="h-6 cursor-pointer rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast)"
              :class="tab === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
              @click="tab = v"
            >
              {{ v === 'body' ? t('workspace.http.body') : t('workspace.http.headers', { n: ok.headers.length }) }}
            </button>
          </div>
          <button v-if="tab === 'body' && pretty" type="button" class="ccm-btn-plain shrink-0 text-2xs" :aria-pressed="bodyView === 'tree'" @click="bodyView = bodyView === 'tree' ? 'text' : 'tree'">
            {{ bodyView === 'tree' ? t('workspace.http.asText') : t('workspace.http.asTree') }}
          </button>
          <span class="ml-auto" />
          <button v-if="tab === 'body' && !ok.binary" type="button" class="ccm-btn-plain shrink-0 gap-1 text-2xs" :title="t('workspace.http.copyBody')" data-http-copy @click="copyBody">
            <Check v-if="copied" :size="13" class="text-success" aria-hidden="true" />
            <Copy v-else :size="13" aria-hidden="true" />
            <span>{{ copied ? t('workspace.http.copied') : t('workspace.http.copyBody') }}</span>
          </button>
        </div>
        <div class="min-h-0 flex-1 bg-well text-well-ink" :class="tab === 'body' && pretty && bodyView === 'tree' ? 'flex flex-col' : 'ccm-scroll overflow-auto'">
          <template v-if="tab === 'body'">
            <p v-if="ok.binary" class="px-3 py-2 text-xs">{{ t('workspace.http.binary', { type: contentType ?? '' }) }}</p>
            <JsonTree v-else-if="pretty && bodyView === 'tree'" :text="ok.body" format="json" :name="t('workspace.http.body')" />
            <pre v-else class="http-pre px-3 py-2 font-mono whitespace-pre-wrap break-all">{{ pretty ?? ok.body }}</pre>
          </template>
          <dl v-else class="http-pre grid grid-cols-[max-content_1fr] gap-x-3 px-3 py-2 font-mono">
            <template v-for="([k, v], i) in ok.headers" :key="i">
              <dt class="text-(--ccm-syn-type)">{{ k }}</dt>
              <dd class="break-all">{{ v }}</dd>
            </template>
          </dl>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.http-pre { font-size: var(--ccm-code-size, 12px); }
</style>
