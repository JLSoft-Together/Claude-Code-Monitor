<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, CircleAlert, CirclePlay, CircleSlash, CircleStop, CircleX, LoaderCircle, Package, PlayCircle, TriangleAlert, X } from 'lucide-vue-next'
import { isRunLive, type EnvIssue, type RunSession, type RunState } from '@ccm/shared'
import { desktop, type RunSettings } from '../../lib/desktop'
import { baseName } from '../../lib/preview'
import { issueKey, projectMark, runStep, tidyIssueText } from '../../lib/runUi'
import { dirKey } from '../../stores/favorites'
import { useRunStore } from '../../stores/run'
import RunBar from './RunBar.vue'
import RunConfigsDialog from './RunConfigsDialog.vue'
import RunLog from './RunLog.vue'
import RunProjectMark from './RunProjectMark.vue'
import RunToolchainDialog from './RunToolchainDialog.vue'

const props = withDefaults(defineProps<{ root: string; active?: boolean }>(), { active: true })
const emit = defineEmits<{
  /** Absolute path + line of a build error. */
  open: [path: string, line: number]
  /** "Send to agent" found no Claude / Codex pane: start Claude in the run root. */
  openAgent: []
}>()

const { t, te } = useI18n()
const run = useRunStore()

const loaded = ref(false)
watch(
  () => [props.active, props.root] as const,
  async ([active]) => {
    if (!active) return
    loaded.value = false
    await run.ensure(true)
    await Promise.all([run.detected(props.root) ? null : run.detect(props.root), run.loadConfigs(props.root)])
    loaded.value = true
    void run.autoImport(props.root)
  },
  { immediate: true },
)

// While shown, main watches the project files (re-detect, pub get banner) and keeps device trackers up.
let release: (() => void) | null = null
watch(
  () => [props.active, props.root] as const,
  ([active, root]) => {
    release?.()
    release = active ? run.hold(root) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => release?.())

const detectedProjects = computed(() => run.projectsFor(props.root))
function markText(p: (typeof detectedProjects.value)[number]): string {
  const m = projectMark(p)
  return `${t(`run.project.${m.label}`)} · ${p.name}`
}
const reasonOf = (p: (typeof detectedProjects.value)[number]): string | null => {
  const r = projectMark(p).reason
  return r ? t(`run.project.reason.${r}`) : null
}
const step = computed(() => runStep(session.value))
const toolchainOpen = ref(false)

const config = computed(() => run.selectedConfig(props.root))
const project = computed(() => {
  const cfg = config.value
  return cfg ? (run.projectsFor(props.root).find((p) => dirKey(p.dir) === dirKey(cfg.cwd)) ?? null) : null
})
const runKind = computed(() => (config.value?.type === 'custom' ? null : (config.value?.type ?? null)))

watch(
  () => config.value && runKind.value && `${runKind.value}:${config.value.cwd}`,
  (key) => {
    if (key && config.value && runKind.value) void run.loadEnv(config.value.cwd, runKind.value)
  },
  { immediate: true },
)

const env = computed(() => (config.value && runKind.value ? run.envFor(config.value.cwd, runKind.value) : null))
// A project-local SDK / JDK is only not executed until Run; nothing to set up.
const INFO_ISSUES = new Set(['fvm-local-unverified', 'jdk-local-unverified'])
const envIssues = computed(() => (env.value?.issues ?? []).filter((i) => !INFO_ISSUES.has(i.code)))
const needsPubGet = computed(() => project.value?.kind === 'flutter' && project.value.needsPubGet)
const pubGetting = ref(false)

async function pubGet(): Promise<void> {
  if (!project.value) return
  pubGetting.value = true
  try {
    await run.pubGet(props.root, project.value.dir)
  } finally {
    pubGetting.value = false
  }
}


const live = computed(() => run.liveSessionsFor(props.root))
const session = computed(() => run.focusedSession(props.root))
const switchable = computed(() => (session.value && !isRunLive(session.value.state) ? [session.value, ...live.value] : live.value))

// Picking a config / device whose session exists brings that session's log up.
watch(
  () => {
    const cfg = config.value
    if (!cfg) return null
    const device = cfg.type === 'custom' ? null : (run.selectedDevice(props.root, cfg)?.id ?? null)
    return run.sessionOf(props.root, cfg.id, device)?.id ?? null
  },
  (id) => {
    if (id) run.focusSession(props.root, id)
  },
)

const runnable = computed(() => run.runnable(props.root) || run.configsFor(props.root).length > 0)
const notice = computed(() => run.noticeFor(props.root))

function issueText(issue: EnvIssue, groups: string[]): string {
  const { key, params } = issueKey(issue, groups, te)
  return tidyIssueText(t(key, params))
}

type SdkTarget = Exclude<keyof RunSettings, 'flutterSdkProjects'>
const SDK_TARGET: Record<string, SdkTarget> = {
  'flutter-missing': 'flutterSdk',
  'flutter-setting-invalid': 'flutterSdk',
  'sdk-missing': 'androidSdk',
  'jdk-missing': 'jdk',
  'jdk-old': 'jdk',
  'jdk-incompatible': 'jdk',
}
const sdkTargets = computed(() => [...new Set(envIssues.value.map((i) => SDK_TARGET[i.code]).filter((x): x is SdkTarget => !!x))])

function currentSdk(target: SdkTarget): string | null {
  const e = env.value
  if (run.settings?.[target]) return run.settings[target]
  if (!e) return null
  if (e.kind === 'flutter') return target === 'flutterSdk' ? e.sdk : null
  return target === 'jdk' ? e.jdk : target === 'androidSdk' ? e.sdk : null
}

async function chooseSdk(target: SdkTarget): Promise<void> {
  const dir = await desktop?.pickFolder(currentSdk(target) ?? undefined)
  if (dir) await run.updateSettings({ [target]: dir })
}

const configsOpen = ref(false)
const noAgent = ref(false)
watch(
  () => props.root,
  () => (noAgent.value = false),
)

function openAgent(): void {
  noAgent.value = false
  emit('openAgent')
}

type Tone = 'busy' | 'running' | 'error' | 'idle' | 'stale'
const BUSY: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching', 'starting', 'reloading', 'stopping']
const toneOf = (s: RunState): Tone => (BUSY.includes(s) ? 'busy' : s === 'running' ? 'running' : s === 'failed' ? 'error' : s === 'cancelled' ? 'stale' : 'idle')
const TONE_CLASS: Record<Tone, string> = {
  busy: 'text-st-working',
  running: 'text-st-working',
  error: 'text-st-error',
  idle: 'text-st-idle',
  stale: 'text-st-stale',
}
const tone = computed<Tone>(() => (session.value ? toneOf(session.value.state) : 'idle'))

function sessionLabel(s: RunSession): string {
  return s.deviceName ? t('run.session.on', { config: s.configName, device: s.deviceName }) : t('run.session.noDevice', { config: s.configName })
}
</script>

<template>
  <section class="@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card outline-none" tabindex="-1" :aria-label="t('run.titleIn', { name: baseName(root) })" data-run-pane>
    <div class="ccm-material flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2">
      <CirclePlay :size="15" class="mr-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span class="hidden shrink-0 text-xs font-semibold text-ink @md:inline">{{ t('run.title') }}</span>
      <RunBar v-if="runnable" :root="root" :blocked="envIssues.length > 0" @edit-configs="configsOpen = true" @toolchain="toolchainOpen = true" />
      <span v-else class="min-w-0 flex-1 truncate text-2xs text-ink-faint" :title="root">{{ baseName(root) }}</span>
      <span v-if="env?.kind === 'flutter' && env.version" class="hidden shrink-0 items-center gap-1 text-2xs text-ink-faint @lg:inline-flex" :title="env.sdk ?? undefined">
        {{ t('run.flutter', { version: env.version }) }}
        <span v-if="env.fvm" class="rounded-full bg-fill px-1.5 text-ink-muted">{{ t('run.fvm') }}</span>
      </span>
      <slot name="end" />
    </div>

    <div v-if="!loaded && !run.detected(root)" class="flex flex-1 items-center justify-center gap-2 text-xs text-ink-muted">
      <LoaderCircle :size="14" class="ccm-spin" aria-hidden="true" />{{ t('run.empty.detecting') }}
    </div>

    <div v-else-if="!runnable" class="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center" data-run-empty>
      <CircleSlash :size="22" class="text-ink-faint" aria-hidden="true" />
      <p class="text-sm font-medium text-ink">{{ t('run.empty.notRunnable') }}</p>
      <p class="max-w-sm text-xs text-ink-muted">{{ t('run.empty.notRunnableHint') }}</p>
      <div v-if="detectedProjects.length" class="mt-2 flex w-full max-w-sm min-w-0 flex-col gap-1 text-left" data-run-found>
        <p class="text-2xs font-semibold text-ink-faint">{{ t('run.empty.found') }}</p>
        <div v-for="p in detectedProjects" :key="p.dir" class="flex min-w-0 items-start gap-2 rounded-inner bg-fill px-2 py-1.5 text-xs" :title="p.dir" data-run-found-project>
          <RunProjectMark :project="p" class="mt-px" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-ink">{{ markText(p) }}</span>
            <span v-if="reasonOf(p)" class="block text-2xs text-ink-muted">{{ reasonOf(p) }}</span>
          </span>
        </div>
      </div>
    </div>

    <template v-else>
      <div class="flex h-8 min-w-0 shrink-0 items-center gap-2 border-b border-line px-3 text-xs" aria-live="polite" data-run-state>
        <span class="flex shrink-0 items-center gap-1.5 font-medium" :class="TONE_CLASS[tone]">
          <LoaderCircle v-if="tone === 'busy'" :size="13" class="ccm-spin" aria-hidden="true" />
          <PlayCircle v-else-if="tone === 'running'" :size="13" aria-hidden="true" />
          <CircleX v-else-if="tone === 'error'" :size="13" aria-hidden="true" />
          <CircleStop v-else :size="13" aria-hidden="true" />
          {{ t(`run.state.${session?.state ?? 'idle'}`) }}
        </span>
        <span v-if="session?.progress" class="min-w-0 truncate text-ink-muted" :title="session.progress">{{ session.progress }}</span>
        <span v-else-if="session && !isRunLive(session.state) && session.failure" class="min-w-0 truncate text-ink-muted" :title="issueText(session.failure, ['fail', 'env'])" data-run-failure>
          {{ issueText(session.failure, ['fail', 'env']) }}
        </span>
        <span class="min-w-0 flex-1" />
        <select
          v-if="live.length > 1"
          class="ccm-field h-6 max-w-56 min-w-0 shrink cursor-pointer text-2xs"
          :value="session?.id"
          :aria-label="t('run.session.label')"
          :title="t('run.session.label')"
          data-run-session
          @change="run.focusSession(root, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in switchable" :key="s.id" :value="s.id">{{ sessionLabel(s) }} · {{ t(`run.state.${s.state}`) }}</option>
        </select>
        <span v-else-if="session" class="hidden min-w-0 truncate text-2xs text-ink-faint @md:inline" :title="session.cwd">{{ sessionLabel(session) }}</span>
      </div>

      <div
        v-if="tone === 'busy'"
        class="h-0.5 shrink-0 overflow-hidden bg-fill"
        role="progressbar"
        :aria-label="t('run.progress.label')"
        :aria-valuemin="step ? 0 : undefined"
        :aria-valuemax="step?.total"
        :aria-valuenow="step?.n"
        :aria-valuetext="step ? t('run.progress.step', step) : (session?.progress ?? undefined)"
        data-run-progress
      >
        <div v-if="step" class="h-full bg-st-working transition-[width] duration-(--ccm-dur-base)" :style="{ width: `${(step.n / step.total) * 100}%` }" />
        <div v-else class="ccm-shimmer h-full w-full bg-st-working" />
      </div>

      <div v-if="envIssues.length" class="flex shrink-0 items-start gap-2 border-b border-line bg-warning-soft px-3 py-2 text-xs" role="alert" data-run-env>
        <TriangleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="font-medium text-ink">{{ t('run.envBanner.title') }}</p>
          <p v-for="i in envIssues" :key="i.code" class="break-words text-ink-muted">{{ issueText(i, ['env']) }}</p>
        </div>
        <div v-if="sdkTargets.length" class="flex shrink-0 flex-col items-end gap-1">
          <button v-for="target in sdkTargets" :key="target" type="button" class="ccm-btn" :data-run-choose-sdk="target" @click="chooseSdk(target)">{{ t(`run.envBanner.choose.${target}`) }}</button>
        </div>
      </div>

      <div v-if="needsPubGet" class="flex shrink-0 items-center gap-2 border-b border-line bg-fill px-3 py-1.5 text-xs" data-run-pubget>
        <Package :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ t('run.pubGet.needed') }}</span>
        <button type="button" class="ccm-btn shrink-0" :disabled="pubGetting" @click="pubGet">
          <LoaderCircle v-if="pubGetting" :size="13" class="ccm-spin" aria-hidden="true" />{{ t('run.pubGet.run') }}
        </button>
      </div>

      <div v-if="notice" class="flex shrink-0 items-center gap-2 border-b border-line bg-st-error-soft px-3 py-1.5 text-xs" role="alert" data-run-notice>
        <CircleAlert :size="14" class="shrink-0 text-st-error" aria-hidden="true" />
        <span class="min-w-0 flex-1 break-words text-ink">{{ issueText(notice, ['error', 'validate', 'env', 'fail']) }}</span>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('run.dismiss')" :aria-label="t('run.dismiss')" @click="run.dismissNotice(root)">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>

      <div v-if="noAgent" class="flex shrink-0 items-center gap-2 border-b border-line bg-fill px-3 py-1.5 text-xs" role="status" data-run-no-agent>
        <Bot :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-ink">{{ t('run.agent.noTarget') }}</span>
        <button type="button" class="ccm-btn shrink-0" data-run-open-agent @click="openAgent">{{ t('run.agent.openClaude') }}</button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('run.dismiss')" :aria-label="t('run.dismiss')" @click="noAgent = false">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>

      <RunLog :session="session" :kind="session?.type ?? config?.type ?? 'custom'" :root="root" @open="(path, line) => emit('open', path, line)" @no-agent="noAgent = true" />
    </template>
    <RunConfigsDialog :open="configsOpen" :root="root" @close="configsOpen = false" />
    <RunToolchainDialog :open="toolchainOpen" :root="root" :config="config" @close="toolchainOpen = false" />
  </section>
</template>
