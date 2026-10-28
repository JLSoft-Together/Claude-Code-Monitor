<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, CircleCheck, CircleDashed, Clock, Copy, RefreshCw, ShieldOff, Wrench, X } from 'lucide-vue-next'
import {
  base64Decode,
  base64Encode,
  countText,
  decodeJwt,
  DEV_TOOLS,
  parseStamp,
  prettyJson,
  stampViews,
  urlDecode,
  urlEncode,
  UUID_MAX,
  uuids,
  type DevTool,
} from '../lib/devTools'
import { now } from '../lib/format'

const props = defineProps<{ tool: DevTool }>()
const emit = defineEmits<{ close: [] }>()
const { t, locale } = useI18n()

// Inputs live only in this component: JWTs and encoded blobs are often secrets, so nothing is persisted.
const tool = ref<DevTool>(props.tool)
const jwtIn = ref('')
const b64In = ref('')
const b64Decode = ref(false)
const b64Url = ref(false)
const urlIn = ref('')
const urlDecodeMode = ref(false)
const urlPlus = ref(false)
const timeIn = ref(String(Math.floor(Date.now() / 1000)))
const countIn = ref('')
const uuidN = ref(5)
const uuidList = ref<string[]>(uuids(5))
const copied = ref<string | null>(null)
const card = ref<HTMLElement | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const jwt = computed(() => (jwtIn.value.trim() ? decodeJwt(jwtIn.value, now.value) : null))
const jwtStatus = computed(() => {
  const j = jwt.value
  if (!j?.ok) return null
  if (j.expired) return { key: 'expired', icon: CircleAlert, cls: 'text-st-error' }
  if (j.notYetValid) return { key: 'notYet', icon: Clock, cls: 'text-warning' }
  if (j.expired === false) return { key: 'valid', icon: CircleCheck, cls: 'text-success' }
  return { key: 'noExp', icon: CircleDashed, cls: 'text-ink-muted' }
})
const jwtJson = computed(() => (jwt.value?.ok ? { header: prettyJson(jwt.value.header), payload: prettyJson(jwt.value.payload) } : null))
const fmtDate = (ms: number): string => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(ms))

const b64Out = computed(() => (b64Decode.value ? base64Decode(b64In.value) : base64Encode(b64In.value, b64Url.value)))
const urlOut = computed(() => (urlDecodeMode.value ? urlDecode(urlIn.value, urlPlus.value) : urlEncode(urlIn.value)))
const stamp = computed(() => parseStamp(timeIn.value))
const stampRows = computed(() => {
  if (!stamp.value) return []
  const v = stampViews(stamp.value.ms, locale.value)
  return (['seconds', 'millis', 'iso', 'utc', 'local'] as const).map((k) => ({ key: k, value: v[k] }))
})
const counts = computed(() => countText(countIn.value))
const COUNT_KEYS = ['chars', 'codePoints', 'bytes', 'lines', 'words'] as const

async function copy(id: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = null), 1500)
  } catch {
    copied.value = null
  }
}

function generate(): void {
  uuidList.value = uuids(uuidN.value)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}

function onTabKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  tool.value = DEV_TOOLS[(DEV_TOOLS.indexOf(tool.value) + step + DEV_TOOLS.length) % DEV_TOOLS.length]!
  void nextTick(() => card.value?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus())
}

onMounted(async () => {
  await nextTick()
  card.value?.querySelector<HTMLElement>('[data-devtools-input]')?.focus()
})

const area = 'ccm-field ccm-scroll h-auto w-full resize-none py-1.5 font-mono leading-5'
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-devtools-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex max-h-[min(88vh,760px)] w-[min(94vw,720px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.devTools.title')"
        data-devtools
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <Wrench :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="shrink-0 text-sm font-semibold text-ink">{{ t('workspace.devTools.title') }}</h2>
          <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint">{{ t('workspace.devTools.local') }}</span>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.devTools.close')" :aria-label="t('workspace.devTools.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div class="flex shrink-0 gap-4 overflow-x-auto border-b border-line px-3" role="tablist" :aria-label="t('workspace.devTools.title')" @keydown="onTabKey">
          <button
            v-for="id in DEV_TOOLS"
            :key="id"
            type="button"
            role="tab"
            :aria-selected="tool === id"
            :tabindex="tool === id ? 0 : -1"
            class="-mb-px inline-flex h-9 shrink-0 cursor-pointer items-center border-b-2 text-xs font-medium transition-colors"
            :class="tool === id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-muted'"
            :data-devtools-tab="id"
            @click="tool = id"
          >
            {{ t(`workspace.devTools.tab.${id}`) }}
          </button>
        </div>

        <div class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 text-xs" role="tabpanel">
          <template v-if="tool === 'jwt'">
            <label class="mb-1 block text-2xs font-medium text-ink-muted" for="devtools-jwt">{{ t('workspace.devTools.jwt.input') }}</label>
            <textarea id="devtools-jwt" v-model="jwtIn" rows="4" spellcheck="false" autocomplete="off" :class="area" class="break-all" data-devtools-input />
            <p class="mt-1.5 flex items-center gap-1.5 text-2xs text-warning">
              <ShieldOff :size="12" class="shrink-0" aria-hidden="true" />{{ t('workspace.devTools.jwt.noVerify') }}
            </p>
            <p v-if="jwt && !jwt.ok" class="mt-2 flex items-center gap-1.5 text-st-error" role="status" data-devtools-error>
              <CircleAlert :size="13" aria-hidden="true" />{{ t(`workspace.devTools.jwt.error.${jwt.error}`) }}
            </p>
            <template v-else-if="jwt && jwt.ok">
              <p v-if="jwtStatus" class="mt-2 flex items-center gap-1.5 font-medium" :class="jwtStatus.cls" role="status" data-devtools-jwt-status>
                <component :is="jwtStatus.icon" :size="13" aria-hidden="true" />{{ t(`workspace.devTools.jwt.status.${jwtStatus.key}`) }}
              </p>
              <dl v-if="jwt.times.length" class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <template v-for="x in jwt.times" :key="x.claim">
                  <dt class="text-ink-muted">{{ t(`workspace.devTools.jwt.claim.${x.claim}`) }}</dt>
                  <dd class="tabular min-w-0 truncate text-ink" :title="new Date(x.ms).toISOString()">{{ fmtDate(x.ms) }} · {{ x.seconds }}</dd>
                </template>
              </dl>
              <section v-for="(text, part) in jwtJson" :key="part" class="mt-3">
                <div class="mb-1 flex items-center gap-2">
                  <h3 class="text-2xs font-medium text-ink-muted">{{ t(`workspace.devTools.jwt.${part}`) }}</h3>
                  <span class="flex-1" />
                  <button type="button" class="ccm-btn-plain" :aria-label="t('workspace.devTools.copy')" :title="t('workspace.devTools.copy')" @click="copy(part, text)">
                    <component :is="copied === part ? Check : Copy" :size="13" aria-hidden="true" />
                  </button>
                </div>
                <pre class="ccm-scroll max-h-64 overflow-auto rounded-inner bg-fill p-2 font-mono leading-5 whitespace-pre-wrap break-all text-ink">{{ text }}</pre>
              </section>
            </template>
          </template>

          <template v-else-if="tool === 'base64' || tool === 'url'">
            <div class="mb-2 flex flex-wrap items-center gap-3">
              <div class="flex rounded-inner bg-fill p-0.5" role="radiogroup" :aria-label="t('workspace.devTools.mode')">
                <button
                  v-for="dec in [false, true]"
                  :key="String(dec)"
                  type="button"
                  role="radio"
                  :aria-checked="(tool === 'base64' ? b64Decode : urlDecodeMode) === dec"
                  class="h-6 cursor-pointer rounded-[6px] px-2.5 text-2xs font-medium"
                  :class="(tool === 'base64' ? b64Decode : urlDecodeMode) === dec ? 'bg-surface text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
                  @click="tool === 'base64' ? (b64Decode = dec) : (urlDecodeMode = dec)"
                >
                  {{ t(dec ? 'workspace.devTools.decode' : 'workspace.devTools.encode') }}
                </button>
              </div>
              <label v-if="tool === 'base64' && !b64Decode" class="flex cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
                <input v-model="b64Url" type="checkbox" class="accent-(--ccm-accent)" data-devtools-urlsafe />{{ t('workspace.devTools.base64.urlSafe') }}
              </label>
              <label v-if="tool === 'url' && urlDecodeMode" class="flex cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
                <input v-model="urlPlus" type="checkbox" class="accent-(--ccm-accent)" />{{ t('workspace.devTools.url.plus') }}
              </label>
            </div>
            <label class="mb-1 block text-2xs font-medium text-ink-muted" :for="`devtools-${tool}`">{{ t('workspace.devTools.input') }}</label>
            <textarea
              v-if="tool === 'base64'"
              :id="`devtools-${tool}`"
              v-model="b64In"
              rows="5"
              spellcheck="false"
              autocomplete="off"
              :class="area"
              data-devtools-input
            />
            <textarea v-else :id="`devtools-${tool}`" v-model="urlIn" rows="5" spellcheck="false" autocomplete="off" :class="area" data-devtools-input />
            <div class="mt-3 mb-1 flex items-center gap-2">
              <h3 class="text-2xs font-medium text-ink-muted">{{ t('workspace.devTools.output') }}</h3>
              <span class="flex-1" />
              <button
                type="button"
                class="ccm-btn-plain"
                :disabled="(tool === 'base64' ? b64Out : urlOut) === null"
                :aria-label="t('workspace.devTools.copy')"
                :title="t('workspace.devTools.copy')"
                @click="copy('out', (tool === 'base64' ? b64Out : urlOut) ?? '')"
              >
                <component :is="copied === 'out' ? Check : Copy" :size="13" aria-hidden="true" />
              </button>
            </div>
            <p v-if="(tool === 'base64' ? b64Out : urlOut) === null" class="flex items-center gap-1.5 text-st-error" role="status" data-devtools-error>
              <CircleAlert :size="13" aria-hidden="true" />{{ t(tool === 'base64' ? 'workspace.devTools.base64.invalid' : 'workspace.devTools.url.invalid') }}
            </p>
            <pre
              v-else
              class="ccm-scroll max-h-64 min-h-9 overflow-auto rounded-inner bg-fill p-2 font-mono leading-5 whitespace-pre-wrap break-all text-ink"
              data-devtools-output
            >{{ tool === 'base64' ? b64Out : urlOut }}</pre>
          </template>

          <template v-else-if="tool === 'time'">
            <label class="mb-1 block text-2xs font-medium text-ink-muted" for="devtools-time">{{ t('workspace.devTools.time.input') }}</label>
            <div class="flex gap-2">
              <input id="devtools-time" v-model="timeIn" type="text" spellcheck="false" autocomplete="off" class="ccm-field min-w-0 flex-1 font-mono" data-devtools-input />
              <button type="button" class="ccm-btn shrink-0" @click="timeIn = String(Math.floor(Date.now() / 1000))">{{ t('workspace.devTools.time.now') }}</button>
            </div>
            <p class="mt-1.5 text-2xs text-ink-faint">{{ t('workspace.devTools.time.hint') }}</p>
            <p v-if="!stamp" class="mt-2 flex items-center gap-1.5 text-st-error" role="status" data-devtools-error>
              <CircleAlert :size="13" aria-hidden="true" />{{ t('workspace.devTools.time.invalid') }}
            </p>
            <template v-else>
              <p class="mt-2 text-2xs text-ink-muted" data-devtools-unit>{{ t(`workspace.devTools.time.read.${stamp.unit}`) }}</p>
              <dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
                <template v-for="row in stampRows" :key="row.key">
                  <dt class="text-ink-muted">{{ t(`workspace.devTools.time.row.${row.key}`) }}</dt>
                  <dd class="tabular min-w-0 truncate font-mono text-ink" :title="row.value" :data-devtools-time="row.key">{{ row.value }}</dd>
                  <button type="button" class="ccm-btn-plain" :aria-label="t('workspace.devTools.copy')" :title="t('workspace.devTools.copy')" @click="copy(row.key, row.value)">
                    <component :is="copied === row.key ? Check : Copy" :size="13" aria-hidden="true" />
                  </button>
                </template>
              </dl>
            </template>
          </template>

          <template v-else-if="tool === 'count'">
            <label class="mb-1 block text-2xs font-medium text-ink-muted" for="devtools-count">{{ t('workspace.devTools.input') }}</label>
            <textarea id="devtools-count" v-model="countIn" rows="8" spellcheck="false" autocomplete="off" :class="area" data-devtools-input />
            <dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <div v-for="k in COUNT_KEYS" :key="k" class="rounded-inner bg-fill px-2.5 py-2">
                <dt class="text-2xs text-ink-muted">{{ t(`workspace.devTools.count.${k}`) }}</dt>
                <dd class="tabular text-sm font-semibold text-ink" :data-devtools-count="k">{{ counts[k].toLocaleString(locale) }}</dd>
              </div>
            </dl>
          </template>

          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <label class="text-2xs font-medium text-ink-muted" for="devtools-uuid">{{ t('workspace.devTools.uuid.count') }}</label>
              <input id="devtools-uuid" v-model.number="uuidN" type="number" min="1" :max="UUID_MAX" class="ccm-field w-20 tabular" data-devtools-input @keydown.enter="generate()" />
              <button type="button" class="ccm-btn" data-devtools-generate @click="generate()">
                <RefreshCw :size="13" aria-hidden="true" />{{ t('workspace.devTools.uuid.generate') }}
              </button>
              <span class="flex-1" />
              <button type="button" class="ccm-btn" @click="copy('uuids', uuidList.join('\n'))">
                <component :is="copied === 'uuids' ? Check : Copy" :size="13" aria-hidden="true" />{{ t('workspace.devTools.uuid.copyAll') }}
              </button>
            </div>
            <ul class="mt-3 rounded-inner bg-fill py-1">
              <li v-for="(u, i) in uuidList" :key="`${i}-${u}`" class="group flex items-center gap-2 px-2" data-devtools-uuid>
                <span class="min-w-0 flex-1 truncate font-mono text-ink select-all">{{ u }}</span>
                <button type="button" class="ccm-btn-plain opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="t('workspace.devTools.copy')" :title="t('workspace.devTools.copy')" @click="copy(`u${i}`, u)">
                  <component :is="copied === `u${i}` ? Check : Copy" :size="13" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>
