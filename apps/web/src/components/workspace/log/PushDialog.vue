<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpFromLine, LoaderCircle, X } from 'lucide-vue-next'
import { checkBranchName, pushArgs, type BranchOpResult, type PushPreview } from '@ccm/shared'
import { retireOverlay } from '../../../lib/motion'
import { gitPush, gitPushPreview } from '../../../lib/preview'
import AppSelect from '../../AppSelect.vue'

/** `ref` = `refs/heads/<local>` to push from the repo `root`. */
const props = defineProps<{ request: { root: string; ref: string } | null }>()
const emit = defineEmits<{ done: [res: BranchOpResult, name: string]; close: [] }>()
const { t, locale } = useI18n()
const L = (k: string, named?: Record<string, unknown>, plural?: number): string =>
  plural === undefined ? t(`workspace.log.branches.${k}`, named ?? {}) : t(`workspace.log.branches.${k}`, named ?? {}, plural)

const preview = shallowRef<PushPreview | null>(null)
const loading = ref(false)
const remote = ref('')
const branch = ref('')
const setUpstream = ref(false)
const upstreamTouched = ref(false)
const busy = ref(false)
const failure = ref<string | null>(null)
const sheet = ref<HTMLElement | null>(null)
const pushBtn = ref<HTMLButtonElement | null>(null)
let restoreFocus: HTMLElement | null = null
let seq = 0
let typing: ReturnType<typeof setTimeout> | undefined

const ok = computed(() => (preview.value?.ok ? preview.value : null))
const check = computed(() => checkBranchName(branch.value))
const problem = computed(() => (branch.value && !check.value.ok ? L(`name.${check.value.reason}`) : null))
const target = computed(() => `${remote.value}/${branch.value}`)
const remoteOptions = computed(() => (ok.value?.remotes ?? []).map((r) => ({ value: r, label: r })))
/** The shown preview answers the current remote + branch (not one still being typed or loaded). */
const current = computed(() => !!ok.value && ok.value.remote === remote.value && ok.value.branch === branch.value)
const count = computed(() => ok.value?.commits.length ?? 0)
const canPush = computed(() => current.value && check.value.ok && !loading.value && !busy.value && (count.value > 0 || !ok.value!.exists))
const command = computed(() => (ok.value && check.value.ok ? `git ${pushArgs(ok.value.local, remote.value, branch.value, setUpstream.value).join(' ')}` : ''))
const dateFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }))
const fullFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'full', timeStyle: 'medium' }))
const previewError = computed(() => (preview.value && !preview.value.ok ? [L(`error.${preview.value.error}`, { name: branch.value }), preview.value.detail].filter(Boolean).join(' — ') : null))

async function load(nextRemote?: string, nextBranch?: string): Promise<void> {
  const req = props.request
  if (!req) return
  const mine = ++seq
  loading.value = true
  const res = await gitPushPreview(req.root, req.ref, nextRemote, nextBranch)
  if (mine !== seq || props.request !== req) return
  loading.value = false
  preview.value = res
  if (!res.ok) return
  // Only the first load fills the fields: later ones echo what was asked and must not undo newer typing.
  if (nextRemote === undefined) remote.value = res.remote
  if (nextBranch === undefined) branch.value = res.branch
  if (!upstreamTouched.value) setUpstream.value = !res.hasUpstream
}

watch(
  () => props.request,
  async (req) => {
    clearTimeout(typing)
    seq++
    if (!req) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    preview.value = null
    remote.value = ''
    branch.value = ''
    upstreamTouched.value = false
    busy.value = false
    failure.value = null
    await load()
    await nextTick()
    ;(pushBtn.value && !pushBtn.value.disabled ? pushBtn.value : sheet.value?.querySelector<HTMLElement>('[data-push-cancel]'))?.focus()
  },
)
onBeforeUnmount(() => clearTimeout(typing))

function onRemote(r: string): void {
  failure.value = null
  remote.value = r
  void load(r, check.value.ok ? branch.value : undefined)
}
function onBranch(): void {
  failure.value = null
  clearTimeout(typing)
  seq++
  loading.value = false
  if (check.value.ok) typing = setTimeout(() => void load(remote.value, branch.value), 250)
}

function close(): void {
  if (!busy.value) emit('close')
}

async function submit(): Promise<void> {
  const req = props.request
  const p = ok.value
  if (!req || !p || !canPush.value) return
  busy.value = true
  failure.value = null
  const name = `${p.local} → ${target.value}`
  const res = await gitPush(req.root, req.ref, remote.value, branch.value, setUpstream.value)
  busy.value = false
  if (props.request !== req) return
  if (res.ok || res.error === 'cancelled') return emit('done', res, name)
  const text = res.error === 'non-ff' ? L('pushError.non-ff', { name: target.value }) : L(`error.${res.error}`, { name: target.value })
  failure.value = [text, res.detail].filter(Boolean).join(' — ')
  void load(remote.value, branch.value)
}

function trap(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !sheet.value) return
  const items = [...sheet.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')].filter((n) => n.offsetParent)
  const at = items.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="request" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="close">
        <div
          ref="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-push-title"
          class="ccm-sheet flex max-h-[80vh] w-full max-w-[560px] flex-col overflow-hidden"
          data-push-dialog
          @keydown.esc.stop="close"
          @keydown="trap"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <ArrowUpFromLine :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 id="log-push-title" class="truncate text-sm font-semibold text-ink">{{ L('pushTitle') }}</h2>
              <p v-if="ok" class="truncate font-mono text-xs text-ink-faint" :title="L('pushRoute', { local: ok.local, target })" data-push-route>{{ L('pushRoute', { local: ok.local, target }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :disabled="busy" :title="L('cancel')" :aria-label="L('cancel')" @click="close">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>

          <form class="flex min-h-0 flex-1 flex-col" novalidate @submit.prevent="submit">
            <div v-if="ok || remote" class="flex flex-col gap-1 px-4 pt-3">
              <div class="flex min-w-0 items-end gap-2">
                <div v-if="remoteOptions.length > 1" class="flex shrink-0 flex-col gap-1 text-xs font-medium text-ink-muted">
                  <span>{{ L('remote') }}</span>
                  <AppSelect :model-value="remote" :options="remoteOptions" :label="L('remote')" size="sm" data-push-remote @update:model-value="(r) => onRemote(r as string)" />
                </div>
                <label class="flex min-w-0 flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
                  {{ L('remoteBranch') }}
                  <span class="flex min-w-0 items-center gap-1">
                    <span v-if="remoteOptions.length <= 1" class="shrink-0 font-mono text-sm text-ink-faint">{{ remote }}/</span>
                    <input
                      v-model="branch"
                      type="text"
                      spellcheck="false"
                      autocomplete="off"
                      class="ccm-field h-8 min-w-0 flex-1 font-mono text-sm"
                      :disabled="busy"
                      :aria-invalid="!!problem"
                      aria-describedby="log-push-problem"
                      data-push-branch
                      @input="onBranch"
                    />
                  </span>
                </label>
              </div>
              <p id="log-push-problem" class="min-h-4 text-xs text-st-error" role="status">{{ problem ?? '' }}</p>
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pb-2" :class="ok || remote ? '' : 'pt-3'">
              <div class="flex min-w-0 items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-medium text-ink" role="status" data-push-count>
                  <template v-if="!preview && loading">{{ L('previewLoading') }}</template>
                  <template v-else-if="ok">{{ L('outgoing', { n: count }, count) }}</template>
                </span>
                <LoaderCircle v-if="loading && preview" :size="12" class="shrink-0 animate-spin text-ink-faint motion-reduce:animate-none" aria-hidden="true" />
                <span v-if="ok && !ok.exists" class="shrink-0 rounded-inner bg-fill px-1.5 py-px text-2xs font-medium text-ink-muted" data-push-new>{{ L('newRemoteBranch', { remote }) }}</span>
              </div>

              <p v-if="previewError" class="rounded-inner border border-line px-3 py-2 text-xs text-st-error" data-push-error>{{ previewError }}</p>
              <p v-else-if="ok && !count && ok.exists" class="rounded-inner border border-line px-3 py-3 text-xs text-ink-muted" data-push-nothing>
                {{ L('nothing', { target, local: ok.local }) }}
              </p>
              <ul v-else-if="ok && count" class="ccm-scroll max-h-[240px] min-h-0 overflow-x-hidden overflow-y-auto rounded-inner border border-line py-0.5" :aria-label="L('outgoing', { n: count }, count)" data-push-commits>
                <li v-for="c in ok.commits" :key="c.hash" class="flex h-7 min-w-0 items-center gap-2 px-2.5 text-xs" :title="`${c.subject}\n${c.author} <${c.email}> · ${fullFmt.format(c.time * 1000)}`">
                  <span class="shrink-0 font-mono text-ink-faint tabular">{{ c.hash.slice(0, 8) }}</span>
                  <span class="min-w-0 flex-1 truncate text-ink">{{ c.subject }}</span>
                  <span class="hidden max-w-28 shrink-0 truncate text-ink-muted sm:block">{{ c.author }}</span>
                  <span class="shrink-0 text-ink-faint tabular">{{ dateFmt.format(c.time * 1000) }}</span>
                </li>
              </ul>
              <p v-if="ok?.more" class="text-2xs text-ink-faint">{{ L('moreNotShown', { n: count }) }}</p>

              <label v-if="ok" class="mt-1 flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input v-model="setUpstream" type="checkbox" class="accent-[var(--ccm-accent)]" :disabled="busy" data-push-upstream @change="upstreamTouched = true" />
                <span class="min-w-0 truncate">{{ L('setUpstream', { target }) }}</span>
              </label>
              <p v-if="failure" class="text-xs text-st-error" role="alert" data-push-failure>{{ failure }}</p>
            </div>

            <footer class="flex flex-col gap-2 border-t border-line px-4 py-3">
              <p v-if="command" class="flex min-w-0 items-baseline gap-1.5 text-2xs text-ink-faint">
                <span class="shrink-0">{{ L('command') }}</span>
                <code class="min-w-0 flex-1 truncate font-mono text-ink-muted" :title="command" data-push-command>{{ command }}</code>
              </p>
              <div class="flex items-center justify-end gap-2">
                <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint" :title="L('noForce')">{{ L('noForce') }}</span>
                <button type="button" class="ccm-btn" :disabled="busy" data-push-cancel @click="close">{{ L('cancel') }}</button>
                <button ref="pushBtn" type="submit" class="ccm-btn ccm-btn-primary" :disabled="!canPush" :aria-busy="busy" data-push-submit>
                  <LoaderCircle v-if="busy" :size="13" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {{ busy ? L('pushing') : count ? L('pushN', { n: count }, count) : L('pushButton') }}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
