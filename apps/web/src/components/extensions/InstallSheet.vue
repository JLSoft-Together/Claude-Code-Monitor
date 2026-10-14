<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, LogIn, X } from 'lucide-vue-next'
import type { CatalogEntry, ExtResult, ExtScope } from '@ccm/shared'
import { defaultScope } from '../../lib/extensions'
import { retireOverlay } from '../../lib/motion'
import { useExtensionsStore } from '../../stores/extensions'
import { entryIcon } from './meta'
import ScopeRadio from './ScopeRadio.vue'

const props = defineProps<{ entry: CatalogEntry | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const ext = useExtensionsStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const values = ref<Record<string, string>>({})
const shown = ref<Record<string, boolean>>({})
const touched = ref(false)
const scope = ref<ExtScope>('user')
const picked = ref<string[]>([])
const result = ref<ExtResult | null>(null)
/** Installed with OAuth: the sheet stays open on a "Sign in" step. */
const signInStep = ref(false)

const projectMode = computed(() => ext.mode === 'project' && !!ext.project)
const guideOnly = computed(() => props.entry?.install.type === 'guide')
const plugins = computed(() => (props.entry?.install.type === 'plugins' ? props.entry.install.plugins : []))
const marketplace = computed(() => (props.entry?.install.type === 'plugins' ? props.entry.install.marketplace : ''))
const multi = computed(() => plugins.value.length > 1)
const hasSecret = computed(() => !!props.entry?.fields.some((f) => f.secret))
const steps = computed(() => Array.from({ length: props.entry?.steps ?? 0 }, (_, i) => i + 1))
const busy = computed(() => !!props.entry && ext.busy === props.entry.id)

/** Plugins of this entry installed in the chosen scope. */
const installedHere = computed(() => {
  const ids = new Set((ext.status?.plugins ?? []).filter((p) => p.scope === scope.value).map((p) => p.id))
  return plugins.value.filter((p) => ids.has(`${p}@${marketplace.value}`))
})


const invalid = computed(() => {
  const out: Record<string, boolean> = {}
  for (const f of props.entry?.fields ?? []) {
    const v = (values.value[f.key] ?? '').trim()
    out[f.key] = v ? !new RegExp(f.pattern).test(v) : f.required && !f.default
  }
  return out
})
const valid = computed(() => !Object.values(invalid.value).some(Boolean))
const toInstall = computed(() => picked.value.filter((p) => !installedHere.value.includes(p)))
const toRemove = computed(() => picked.value.filter((p) => installedHere.value.includes(p)))

function reset(entry: CatalogEntry): void {
  values.value = Object.fromEntries(entry.fields.map((f) => [f.key, f.default ?? '']))
  shown.value = {}
  touched.value = false
  result.value = null
  signInStep.value = false
  scope.value = defaultScope(entry, projectMode.value)
  picked.value = entry.install.type === 'plugins' ? [...entry.install.plugins] : []
}

watch(
  () => props.entry,
  async (entry) => {
    if (!entry) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    reset(entry)
    await nextTick()
    // First field, else the main action (a selector list would return the header's close button first).
    const d = dialog.value
    ;(d?.querySelector<HTMLElement>('input:not([type="radio"]):not([type="checkbox"])') ?? d?.querySelector<HTMLElement>('[data-ext-submit]:not([disabled])') ?? d?.querySelector<HTMLElement>('button'))?.focus()
  },
)

function close(): void {
  emit('close')
}

async function install(): Promise<void> {
  const entry = props.entry
  if (!entry || busy.value) return
  touched.value = true
  if (!valid.value) return
  const fieldValues: Record<string, string> = {}
  for (const f of entry.fields) {
    const v = (values.value[f.key] ?? '').trim()
    if (v) fieldValues[f.key] = v
  }
  const res = await ext.install({ id: entry.id, values: fieldValues, scope: scope.value, ...(multi.value ? { plugins: toInstall.value } : {}) })
  result.value = res
  if (!res.ok) return
  if (entry.install.type === 'http' && entry.install.oauth) signInStep.value = true
  else if (!multi.value) close()
}

async function removePicked(): Promise<void> {
  const entry = props.entry
  if (!entry || busy.value || !toRemove.value.length) return
  result.value = await ext.remove(entry.id, { kind: 'plugin', name: toRemove.value.map((p) => `${p}@${marketplace.value}`), scope: scope.value })
}

async function signIn(): Promise<void> {
  const entry = props.entry
  if (!entry?.server) return
  const res = await ext.login(entry.id, entry.server)
  result.value = res
  if (res.ok) close()
}

function toggle(p: string): void {
  picked.value = picked.value.includes(p) ? picked.value.filter((x) => x !== p) : [...picked.value, p]
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

const resultText = computed(() => {
  const r = result.value
  if (!r || r.ok) return null
  return t(`ext.result.${r.code}`)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="entry" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[8vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ext-sheet-title"
          class="w-full max-w-[540px] ccm-sheet"
          data-ext-sheet
          @keydown="trap"
        >
          <div class="flex items-start gap-3 border-b border-line px-5 py-4">
            <span class="grid size-8 shrink-0 place-items-center rounded-inner bg-fill" aria-hidden="true">
              <component :is="entryIcon(entry.id)" :size="16" class="text-ink-muted" />
            </span>
            <div class="mr-auto min-w-0">
              <h2 id="ext-sheet-title" class="text-base font-semibold">
                {{ guideOnly || multi ? t('ext.sheet.manageTitle', { name: entry.name }) : t('ext.sheet.title', { name: entry.name }) }}
              </h2>
              <p class="mt-0.5 text-xs text-ink-muted">{{ t(`ext.desc.${entry.id}`) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain -mr-1" :aria-label="t('ext.sheet.close')" :title="t('ext.sheet.close')" @click="close">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <form class="flex flex-col gap-4 px-5 py-4" novalidate @submit.prevent="install">
            <div v-if="signInStep" class="flex items-start gap-2 rounded-inner bg-fill px-3 py-2.5 text-sm" role="status">
              <CircleCheck :size="15" class="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              <span>{{ t('ext.sheet.oauthNext') }}</span>
            </div>

            <section v-if="steps.length" :aria-label="t('ext.sheet.steps')">
              <h3 class="mb-1.5 text-xs font-semibold text-ink-muted">{{ t('ext.sheet.steps') }}</h3>
              <ol class="flex list-decimal flex-col gap-1.5 pl-5 text-xs leading-relaxed select-text marker:text-ink-faint">
                <li v-for="n in steps" :key="n" class="break-words">{{ t(`ext.guide.${entry.id}.${n}`) }}</li>
              </ol>
              <p v-if="guideOnly" class="mt-2 text-2xs leading-relaxed text-ink-faint">{{ t('ext.sheet.guideOnly') }}</p>
            </section>

            <template v-if="!guideOnly && !signInStep">
              <div v-for="f in entry.fields" :key="f.key" class="flex flex-col gap-1">
                <label :for="`ext-f-${f.key}`" class="text-xs font-medium">
                  {{ t(`ext.field.${f.key}.label`) }}
                  <span v-if="!f.required" class="font-normal text-ink-faint">({{ t('ext.optional') }})</span>
                </label>
                <div class="flex items-center gap-1.5">
                  <input
                    :id="`ext-f-${f.key}`"
                    v-model="values[f.key]"
                    :type="f.secret && !shown[f.key] ? 'password' : 'text'"
                    class="ccm-field min-w-0 flex-1"
                    :class="{ 'font-mono': f.secret }"
                    autocomplete="off"
                    spellcheck="false"
                    :aria-invalid="(touched && invalid[f.key]) || undefined"
                    :aria-describedby="`ext-h-${f.key}`"
                    @blur="values[f.key] && (touched = true)"
                  />
                  <button
                    v-if="f.secret"
                    type="button"
                    class="ccm-btn-plain shrink-0"
                    :aria-label="shown[f.key] ? t('ext.hide') : t('ext.show')"
                    :aria-pressed="!!shown[f.key]"
                    :title="shown[f.key] ? t('ext.hide') : t('ext.show')"
                    @click="shown[f.key] = !shown[f.key]"
                  >
                    <EyeOff v-if="shown[f.key]" :size="14" aria-hidden="true" />
                    <Eye v-else :size="14" aria-hidden="true" />
                  </button>
                </div>
                <p :id="`ext-h-${f.key}`" class="text-2xs leading-relaxed" :class="touched && invalid[f.key] ? 'text-warning' : 'text-ink-faint'">
                  {{ touched && invalid[f.key] ? `${t('ext.invalid')} ${t(`ext.field.${f.key}.hint`)}` : t(`ext.field.${f.key}.hint`) }}
                </p>
              </div>

              <ScopeRadio v-model="scope" :project-mode="projectMode" :secret="hasSecret" name="ext-scope" />

              <fieldset v-if="multi" class="flex flex-col">
                <div class="mb-1.5 flex items-center gap-2">
                  <legend class="mr-auto text-xs font-medium">{{ t('ext.sheet.plugins') }}</legend>
                  <button type="button" class="ccm-btn-plain text-2xs" @click="picked = [...plugins]">{{ t('ext.sheet.all') }}</button>
                  <button type="button" class="ccm-btn-plain text-2xs" @click="picked = []">{{ t('ext.sheet.none') }}</button>
                </div>
                <div class="ccm-group max-h-64 overflow-y-auto">
                  <label v-for="p in plugins" :key="p" class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm">
                    <input type="checkbox" class="accent-accent" :checked="picked.includes(p)" :data-ext-plugin="p" @change="toggle(p)" />
                    <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ p }}</span>
                    <span v-if="installedHere.includes(p)" class="inline-flex items-center gap-1 text-2xs text-success">
                      <CircleCheck :size="12" aria-hidden="true" />{{ t('ext.sheet.installed') }}
                    </span>
                  </label>
                </div>
              </fieldset>

              <p class="text-2xs leading-relaxed text-ink-faint">{{ t('ext.sheet.confirmNote') }}</p>
            </template>

            <p v-if="resultText" class="flex items-start gap-1 text-xs leading-relaxed" :class="result?.ok === false && result.code === 'cancelled' ? 'text-ink-faint' : 'text-warning'" role="alert">
              <CircleAlert :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
              <span class="min-w-0 break-words">{{ resultText }}<template v-if="result && !result.ok && result.detail"> — <span class="font-mono text-2xs">{{ result.detail }}</span></template></span>
            </p>

            <div class="-mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              <button type="button" class="ccm-btn" @click="close">{{ guideOnly || signInStep ? t('ext.sheet.close') : t('ext.sheet.cancel') }}</button>
              <button v-if="signInStep" type="button" class="ccm-btn ccm-btn-primary" :disabled="!!ext.busy" data-ext-submit @click="signIn">
                <LoaderCircle v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
                <LogIn v-else :size="13" aria-hidden="true" />{{ t('ext.actions.signIn') }}
              </button>
              <template v-else-if="!guideOnly">
                <button v-if="multi && toRemove.length" type="button" class="ccm-btn" :disabled="!!ext.busy" @click="removePicked">
                  {{ t('ext.sheet.removeSelected') }} ({{ toRemove.length }})
                </button>
                <button
                  type="submit"
                  class="ccm-btn ccm-btn-primary"
                  :disabled="!!ext.busy || (multi && !toInstall.length) || (touched && !valid)"
                  data-ext-submit
                >
                  <LoaderCircle v-if="busy" :size="13" class="animate-spin" aria-hidden="true" />
                  {{ multi ? `${t('ext.sheet.installSelected')} (${toInstall.length})` : t('ext.sheet.install') }}
                </button>
              </template>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
