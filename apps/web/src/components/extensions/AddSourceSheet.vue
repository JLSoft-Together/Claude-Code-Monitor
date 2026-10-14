<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, X } from 'lucide-vue-next'
import { MARKETPLACE_REPO, MCP_NAME, type AvailablePlugin, type ExtResult, type ExtScope } from '@ccm/shared'
import { retireOverlay } from '../../lib/motion'
import { useExtensionsStore } from '../../stores/extensions'
import SegmentedControl from '../ui/SegmentedControl.vue'
import ScopeRadio from './ScopeRadio.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const ext = useExtensionsStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

type Kind = 'marketplace' | 'mcp'
const kind = ref<Kind>('marketplace')
const repo = ref('')
const name = ref('')
const url = ref('')
const header = ref('')
const showHeader = ref(false)
const scope = ref<ExtScope>('user')
const touched = ref(false)
const result = ref<ExtResult | null>(null)
const added = ref<{ marketplace: string; plugins: AvailablePlugin[] } | null>(null)
const picked = ref<string[]>([])

const projectMode = computed(() => ext.mode === 'project' && !!ext.project)
const working = computed(() => !!ext.busy)

const repoOk = computed(() => MARKETPLACE_REPO.test(repo.value.trim()))
const nameOk = computed(() => MCP_NAME.test(name.value.trim()))
const urlOk = computed(() => {
  try {
    return /^https?:$/.test(new URL(url.value.trim()).protocol)
  } catch {
    return false
  }
})
const headerOk = computed(() => !header.value.trim() || /^[A-Za-z0-9-]{1,64}:\s*\S/.test(header.value.trim()))

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    repo.value = name.value = url.value = header.value = ''
    touched.value = false
    result.value = null
    added.value = null
    picked.value = []
    scope.value = projectMode.value ? 'local' : 'user'
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('input[type="text"], input:not([type])')?.focus()
  },
)
watch(kind, () => {
  touched.value = false
  result.value = null
})

async function addMarketplace(): Promise<void> {
  touched.value = true
  if (!repoOk.value || working.value) return
  const res = await ext.addMarketplace(repo.value.trim())
  result.value = res ?? { ok: false, code: 'failed' }
  if (res?.ok && res.marketplace) {
    added.value = { marketplace: res.marketplace, plugins: res.plugins ?? [] }
    picked.value = []
  }
}

async function installPicked(): Promise<void> {
  if (!picked.value.length || working.value) return
  const res = await ext.source(`source:${added.value?.marketplace}`, { type: 'plugin', ids: picked.value, scope: scope.value })
  result.value = res
  if (res.ok) emit('close')
}

async function addServer(): Promise<void> {
  touched.value = true
  if (!nameOk.value || !urlOk.value || !headerOk.value || working.value) return
  const res = await ext.source(`mcp:${name.value.trim()}`, {
    type: 'mcp',
    name: name.value.trim(),
    url: url.value.trim(),
    ...(header.value.trim() ? { header: header.value.trim() } : {}),
    scope: scope.value,
  })
  result.value = res
  if (res.ok) emit('close')
}

function toggle(id: string): void {
  picked.value = picked.value.includes(id) ? picked.value.filter((x) => x !== id) : [...picked.value, id]
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')]
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

const kinds = computed(() => [
  { value: 'marketplace' as Kind, label: t('ext.source.marketplace') },
  { value: 'mcp' as Kind, label: t('ext.source.mcp') },
])
const resultText = computed(() => (result.value && !result.value.ok ? t(`ext.result.${result.value.code}`) : null))
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[8vh]" @mousedown.self="emit('close')">
        <div ref="dialog" role="dialog" aria-modal="true" aria-labelledby="ext-src-title" class="w-full max-w-[540px] ccm-sheet" data-ext-source @keydown="trap">
          <div class="flex items-start gap-2 border-b border-line px-5 py-4">
            <h2 id="ext-src-title" class="mr-auto text-base font-semibold">{{ t('ext.source.title') }}</h2>
            <button type="button" class="ccm-btn-plain -mr-1" :aria-label="t('ext.sheet.close')" :title="t('ext.sheet.close')" @click="emit('close')">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <div class="flex flex-col gap-4 px-5 py-4">
            <SegmentedControl v-model="kind" :options="kinds" :label="t('ext.source.kind')" fill />

            <!-- Marketplace: owner/repo → its plugins -->
            <form v-if="kind === 'marketplace'" class="flex flex-col gap-4" novalidate @submit.prevent="added ? installPicked() : addMarketplace()">
              <div class="flex flex-col gap-1">
                <label for="ext-src-repo" class="text-xs font-medium">{{ t('ext.source.repo') }}</label>
                <div class="flex items-center gap-2">
                  <input
                    id="ext-src-repo"
                    v-model="repo"
                    type="text"
                    class="ccm-field min-w-0 flex-1 font-mono"
                    placeholder="owner/repo"
                    autocomplete="off"
                    spellcheck="false"
                    :disabled="!!added"
                    :aria-invalid="(touched && !repoOk) || undefined"
                    aria-describedby="ext-src-repo-h"
                  />
                  <button v-if="!added" type="submit" class="ccm-btn ccm-btn-primary shrink-0" :disabled="working" data-ext-add-market>
                    <LoaderCircle v-if="working" :size="13" class="animate-spin" aria-hidden="true" />{{ t('ext.source.add') }}
                  </button>
                </div>
                <p id="ext-src-repo-h" class="text-2xs leading-relaxed" :class="touched && !repoOk ? 'text-warning' : 'text-ink-faint'">
                  {{ t('ext.source.repoHint') }}
                </p>
              </div>

              <template v-if="added">
                <fieldset class="flex flex-col">
                  <legend class="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    <CircleCheck :size="13" class="text-success" aria-hidden="true" />{{ t('ext.source.pluginsOf', { name: added.marketplace }) }}
                  </legend>
                  <p v-if="!added.plugins.length" class="text-xs text-ink-faint">{{ t('ext.source.noPlugins') }}</p>
                  <div v-else class="ccm-group max-h-72 overflow-y-auto">
                    <label v-for="p in added.plugins" :key="p.id" class="flex cursor-pointer items-start gap-2.5 px-3 py-2">
                      <input type="checkbox" class="mt-0.5 accent-accent" :checked="picked.includes(p.id)" @change="toggle(p.id)" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate font-mono text-xs">{{ p.name }}</span>
                        <span v-if="p.description" class="line-clamp-2 block text-2xs leading-relaxed text-ink-faint">{{ p.description }}</span>
                      </span>
                    </label>
                  </div>
                </fieldset>
                <ScopeRadio v-if="added.plugins.length" v-model="scope" :project-mode="projectMode" :secret="false" name="ext-src-scope" />
              </template>

              <p v-if="resultText" class="flex items-start gap-1 text-xs leading-relaxed text-warning" role="alert">
                <CircleAlert :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 break-words">{{ resultText }}<template v-if="result && !result.ok && result.detail"> — <span class="font-mono text-2xs">{{ result.detail }}</span></template></span>
              </p>

              <div v-if="added && added.plugins.length" class="-mx-5 -mb-4 flex justify-end gap-2 border-t border-line px-5 py-3">
                <button type="button" class="ccm-btn" @click="emit('close')">{{ t('ext.sheet.close') }}</button>
                <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="working || !picked.length">
                  <LoaderCircle v-if="working" :size="13" class="animate-spin" aria-hidden="true" />{{ t('ext.sheet.installSelected') }} ({{ picked.length }})
                </button>
              </div>
            </form>

            <!-- Remote MCP server by URL -->
            <form v-else class="flex flex-col gap-4" novalidate @submit.prevent="addServer">
              <div class="flex flex-col gap-1">
                <label for="ext-src-name" class="text-xs font-medium">{{ t('ext.source.name') }}</label>
                <input id="ext-src-name" v-model="name" type="text" class="ccm-field font-mono" autocomplete="off" spellcheck="false" :aria-invalid="(touched && !nameOk) || undefined" aria-describedby="ext-src-name-h" />
                <p id="ext-src-name-h" class="text-2xs" :class="touched && !nameOk ? 'text-warning' : 'text-ink-faint'">{{ t('ext.source.nameHint') }}</p>
              </div>
              <div class="flex flex-col gap-1">
                <label for="ext-src-url" class="text-xs font-medium">{{ t('ext.source.url') }}</label>
                <input id="ext-src-url" v-model="url" type="text" inputmode="url" class="ccm-field font-mono" placeholder="https://" autocomplete="off" spellcheck="false" :aria-invalid="(touched && !urlOk) || undefined" aria-describedby="ext-src-url-h" />
                <p id="ext-src-url-h" class="text-2xs" :class="touched && !urlOk ? 'text-warning' : 'text-ink-faint'">{{ t('ext.source.urlHint') }}</p>
              </div>
              <div class="flex flex-col gap-1">
                <label for="ext-src-header" class="text-xs font-medium">{{ t('ext.source.header') }} <span class="font-normal text-ink-faint">({{ t('ext.optional') }})</span></label>
                <div class="flex items-center gap-1.5">
                  <input id="ext-src-header" v-model="header" :type="showHeader ? 'text' : 'password'" class="ccm-field min-w-0 flex-1 font-mono" autocomplete="off" spellcheck="false" :aria-invalid="(touched && !headerOk) || undefined" aria-describedby="ext-src-header-h" />
                  <button type="button" class="ccm-btn-plain shrink-0" :aria-label="showHeader ? t('ext.hide') : t('ext.show')" :aria-pressed="showHeader" @click="showHeader = !showHeader">
                    <EyeOff v-if="showHeader" :size="14" aria-hidden="true" />
                    <Eye v-else :size="14" aria-hidden="true" />
                  </button>
                </div>
                <p id="ext-src-header-h" class="text-2xs" :class="touched && !headerOk ? 'text-warning' : 'text-ink-faint'">{{ t('ext.source.headerHint') }}</p>
              </div>
              <ScopeRadio v-model="scope" :project-mode="projectMode" :secret="!!header.trim()" name="ext-src-scope" />

              <p v-if="resultText" class="flex items-start gap-1 text-xs leading-relaxed text-warning" role="alert">
                <CircleAlert :size="13" class="mt-0.5 shrink-0" aria-hidden="true" />
                <span class="min-w-0 break-words">{{ resultText }}<template v-if="result && !result.ok && result.detail"> — <span class="font-mono text-2xs">{{ result.detail }}</span></template></span>
              </p>
              <p class="text-2xs leading-relaxed text-ink-faint">{{ t('ext.sheet.confirmNote') }}</p>

              <div class="-mx-5 -mb-4 flex justify-end gap-2 border-t border-line px-5 py-3">
                <button type="button" class="ccm-btn" @click="emit('close')">{{ t('ext.sheet.cancel') }}</button>
                <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="working" data-ext-add-server>
                  <LoaderCircle v-if="working" :size="13" class="animate-spin" aria-hidden="true" />{{ t('ext.source.addServer') }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
