<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookText, CornerDownLeft, Pencil, Plus, Slash, Trash2, X } from 'lucide-vue-next'
import { fuzzyScore, highlightRuns } from '../../lib/fuzzy'
import { isMac } from '../../lib/platform'
import { fileMention } from '../../lib/promptAttachments'
import { checksText, diffstatText, expand, missingVars, type PromptContext, type SavedPrompt } from '../../lib/promptLibrary'
import { changesStatus, commandsList, type SlashCommand } from '../../lib/preview'
import { useChecksStore } from '../../stores/checks'
import { dirKey } from '../../stores/favorites'
import { usePromptsStore } from '../../stores/prompts'
import { isTerm, useWorkspaceStore, workCwd, type Pane } from '../../stores/workspace'

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const prompts = usePromptsStore()
const checks = useChecksStore()

interface Row {
  id: string
  kind: 'saved' | 'command'
  name: string
  sub: string
  text: string
  saved?: SavedPrompt
}

const MAX_SELECTION = 4000
const selection = (window.getSelection()?.toString() ?? '').slice(0, MAX_SELECTION)
const query = ref('')
const active = ref(0)
const commands = ref<SlashCommand[]>([])
const ctx = ref<PromptContext>({})
const editing = ref<{ id?: string; name: string; text: string; global: boolean } | null>(null)
const input = ref<HTMLInputElement | null>(null)
const card = ref<HTMLElement | null>(null)

function pickTarget(): Pane | null {
  const a = workspace.active
  const live = (p: Pane) => isTerm(p) && (p.state === 'running' || p.state === 'starting')
  if (a && live(a)) return a
  if (!workspace.activeKey) return null
  const r = workspace.resolveAgentPane(workspace.activeKey)
  return 'pane' in r ? r.pane : null
}
const target = pickTarget()
const filePane = [...workspace.panes].filter((p) => p.kind === 'file' && p.path).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))[0]
const cwd = (target && workCwd(target)) ?? filePane?.cwd
const scope = cwd ? dirKey(cwd) : null

onMounted(async () => {
  input.value?.focus()
  const base: PromptContext = {
    file: filePane?.path ? fileMention(filePane.path, cwd, !isMac) : undefined,
    selection: selection.trim() ? selection : undefined,
    branch: target?.branch,
    wt: cwd,
  }
  ctx.value = base
  if (!cwd) return
  const [status, cmds] = await Promise.all([changesStatus(cwd), commandsList(cwd)])
  if (cmds.ok) commands.value = cmds.commands
  const root = status.ok ? status.root : cwd
  const run = checks.of(root) ?? checks.of(cwd)
  const errors = run?.result?.ok ? run.result.errors : []
  ctx.value = {
    ...base,
    branch: base.branch ?? (status.ok ? (status.branch ?? undefined) : undefined),
    diffstat: status.ok ? diffstatText(status.entries) || undefined : undefined,
    checks: errors.length ? checksText(errors, run!.root) : undefined,
  }
})

const all = computed<Row[]>(() => [
  ...prompts.forScope(scope).map((p) => ({ id: `p:${p.id}`, kind: 'saved' as const, name: p.name, sub: t(p.scope === 'global' ? 'workspace.prompts.global' : 'workspace.prompts.project'), text: p.text, saved: p })),
  ...commands.value.map((c) => ({ id: `c:${c.scope}:${c.name}`, kind: 'command' as const, name: `/${c.name}`, sub: c.description || t(`workspace.prompts.${c.scope}Command`), text: `/${c.name} ` })),
])
const rows = computed(() => {
  const q = query.value.trim()
  if (!q) return all.value.map((r) => ({ row: r, positions: [] as number[] }))
  return all.value
    .map((r) => ({ row: r, hit: fuzzyScore(q, r.name) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((x) => ({ row: x.row, positions: x.hit!.positions }))
})
watch(query, () => (active.value = 0))
const current = computed(() => rows.value[active.value]?.row ?? null)
const preview = computed(() => (current.value ? expand(current.value.text, ctx.value) : ''))
const missing = computed(() => (current.value ? missingVars(current.value.text, ctx.value) : []))
const targetLabel = computed(() => (target ? (target.title ?? workCwd(target) ?? target.preset) : null))

function fill(row = current.value): void {
  if (!row || !target) return
  workspace.insertInto(target.key, expand(row.text, ctx.value))
  emit('close')
}

function startNew(): void {
  editing.value = { name: '', text: '', global: !scope }
  void nextTick(() => card.value?.querySelector<HTMLInputElement>('[data-prompt-name]')?.focus())
}
function startEdit(p: SavedPrompt): void {
  editing.value = { id: p.id, name: p.name, text: p.text, global: p.scope === 'global' }
  void nextTick(() => card.value?.querySelector<HTMLInputElement>('[data-prompt-name]')?.focus())
}
const canSave = computed(() => !!editing.value?.name.trim() && !!editing.value.text.trim())
function saveEdit(): void {
  const e = editing.value
  if (!e || !canSave.value) return
  const saved = prompts.save({ id: e.id, name: e.name, text: e.text, scope: e.global || !scope ? 'global' : scope })
  if (!saved) return
  editing.value = null
  query.value = ''
  void nextTick(() => {
    active.value = Math.max(0, rows.value.findIndex((r) => r.row.saved?.id === saved.id))
    input.value?.focus()
  })
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (editing.value) {
      editing.value = null
      void nextTick(() => input.value?.focus())
    } else emit('close')
    return
  }
  if (editing.value) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const n = rows.value.length
    if (n) active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    void nextTick(() => card.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    fill()
  }
}

const VAR_HELP = ['file', 'selection', 'branch', 'diffstat', 'checks', 'wt'] as const
const braced = (v: string): string => `{${v}}`
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-prompt-picker-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        class="ccm-sheet flex h-[min(80vh,620px)] w-[min(94vw,760px)] flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        :aria-label="t('workspace.prompts.title')"
        data-prompt-picker
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <BookText :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            ref="input"
            v-model="query"
            class="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            :placeholder="t('workspace.prompts.search')"
            :aria-label="t('workspace.prompts.search')"
            role="combobox"
            aria-controls="prompt-rows"
            :aria-expanded="true"
            autocomplete="off"
            spellcheck="false"
            data-prompt-search
          />
          <button type="button" class="ccm-btn h-7 shrink-0 gap-1 text-xs" data-prompt-new @click="startNew()">
            <Plus :size="13" aria-hidden="true" />{{ t('workspace.prompts.new') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.prompts.close')" :aria-label="t('workspace.prompts.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <form v-if="editing" class="flex min-h-0 flex-1 flex-col gap-2 p-3" @submit.prevent="saveEdit()">
          <input v-model="editing.name" class="ccm-field h-8 text-sm" :placeholder="t('workspace.prompts.name')" :aria-label="t('workspace.prompts.name')" maxlength="80" data-prompt-name />
          <textarea
            v-model="editing.text"
            class="ccm-field min-h-0 flex-1 resize-none py-1.5 font-mono text-xs"
            :placeholder="t('workspace.prompts.textHint')"
            :aria-label="t('workspace.prompts.text')"
            spellcheck="false"
            data-prompt-text
          />
          <p class="text-2xs text-ink-faint">{{ t('workspace.prompts.vars') }} <code v-for="v in VAR_HELP" :key="v" class="mr-1.5 font-mono" v-text="braced(v)" /></p>
          <div class="flex items-center gap-2">
            <label v-if="scope" class="flex cursor-pointer items-center gap-1.5 text-xs text-ink-muted">
              <input v-model="editing.global" type="checkbox" />{{ t('workspace.prompts.everywhere') }}
            </label>
            <span class="flex-1" />
            <button type="button" class="ccm-btn h-7" @click="editing = null">{{ t('workspace.prompts.cancel') }}</button>
            <button type="submit" class="ccm-btn ccm-btn-primary h-7" :disabled="!canSave" data-prompt-save>{{ t('workspace.prompts.save') }}</button>
          </div>
        </form>

        <div v-else class="flex min-h-0 flex-1 flex-col md:flex-row">
          <ul id="prompt-rows" class="ccm-scroll max-h-[40%] shrink-0 overflow-y-auto border-b border-line py-1 md:max-h-none md:w-[45%] md:border-r md:border-b-0" role="listbox" :aria-label="t('workspace.prompts.title')">
            <li
              v-for="(r, i) in rows"
              :key="r.row.id"
              role="option"
              :aria-selected="i === active"
              class="group mx-1 flex min-h-8 cursor-pointer items-center gap-2 rounded-inner px-2 py-1 text-xs"
              :class="i === active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
              :data-prompt-row="r.row.id"
              @click="active = i"
              @dblclick="fill(r.row)"
            >
              <component :is="r.row.kind === 'command' ? Slash : BookText" :size="13" class="shrink-0 opacity-70" aria-hidden="true" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium"><template v-for="(run, k) in highlightRuns(r.row.name, r.positions)" :key="k"><mark v-if="run.hit" class="bg-transparent font-semibold text-accent-ink">{{ run.text }}</mark><template v-else>{{ run.text }}</template></template></span>
                <span class="truncate text-2xs" :class="i === active ? 'text-accent-ink' : 'text-ink-faint'">{{ r.row.sub }}</span>
              </span>
              <template v-if="r.row.saved">
                <button type="button" class="ccm-btn-plain size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :title="t('workspace.prompts.edit')" :aria-label="t('workspace.prompts.edit')" @click.stop="startEdit(r.row.saved)">
                  <Pencil :size="12" aria-hidden="true" />
                </button>
                <button type="button" class="ccm-btn-plain size-6 shrink-0 opacity-0 group-hover:opacity-100 hover:text-st-error focus-visible:opacity-100" :title="t('workspace.prompts.delete')" :aria-label="t('workspace.prompts.delete')" @click.stop="prompts.remove(r.row.saved.id)">
                  <Trash2 :size="12" aria-hidden="true" />
                </button>
              </template>
            </li>
            <li v-if="!rows.length" class="px-3 py-3 text-xs text-ink-faint">{{ all.length ? t('workspace.prompts.noMatch') : t('workspace.prompts.empty') }}</li>
          </ul>
          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <pre class="ccm-scroll m-0 min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap text-ink" data-prompt-preview>{{ preview }}</pre>
            <p v-if="missing.length" class="border-t border-line px-3 py-1.5 text-2xs text-warning" role="status" data-prompt-missing>
              {{ t('workspace.prompts.missing', { vars: missing.map(braced).join(', ') }) }}
            </p>
          </div>
        </div>

        <footer v-if="!editing" class="flex h-10 shrink-0 items-center gap-2 border-t border-line px-3">
          <span class="min-w-0 flex-1 truncate text-2xs text-ink-faint" :title="targetLabel ?? undefined">{{
            targetLabel ? t('workspace.prompts.into', { pane: targetLabel }) : t('workspace.prompts.noTarget')
          }}</span>
          <button type="button" class="ccm-btn ccm-btn-primary h-7 shrink-0 gap-1" :disabled="!current || !target" data-prompt-fill @click="fill()">
            <CornerDownLeft :size="13" aria-hidden="true" />{{ t('workspace.prompts.fill') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
