import type { BranchOpResult, BuildError, CommitDetail, ContainsResult, EntryNameProblem, LogPageResult, LogQuery, PushPreview, RefsResult } from '@ccm/shared'
import { desktop } from './desktop'
import type { DirEntry } from './explorer/tree'

export type FileViewKind = 'text' | 'image' | 'binary' | 'too-large' | 'missing' | 'denied'

export interface FileView {
  kind: FileViewKind
  path: string
  size: number
  mtimeMs: number
  text?: string
  lang?: string
  /** v42: UTF-8 BOM on disk (kept on save). */
  bom?: boolean
  /** v42: line breaks on disk; saves write the same style back. */
  eol?: 'lf' | 'crlf' | 'cr'
  /** v42: not valid UTF-8 (lossy text); the editor stays view only. */
  invalidUtf8?: boolean
}

export type FileWriteError = 'denied' | 'missing' | 'conflict' | 'too-large' | 'encoding' | 'busy' | 'failed' | 'unavailable'
export type FileWriteResult = { ok: true; path: string; mtimeMs: number; size: number } | { ok: false; error: FileWriteError }

export interface PreviewTarget {
  url: string
  root: string
  token: string
  origin: string
}

export interface PreviewChange {
  root: string
  tokens: string[]
  paths: string[]
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

/** Mirrors `apps/desktop/src/preview/changes.ts`. */
export interface ChangeEntry {
  path: string
  origPath?: string
  x: string
  y: string
  kind: ChangeKind
  staged: boolean
  added?: number
  removed?: number
  binary?: boolean
}

export type ChangesError = 'denied' | 'no-git' | 'not-repo' | 'failed' | 'conflict' | 'stale' | 'missing' | 'unavailable'

export type ChangesStatus =
  | { ok: true; root: string; branch: string | null; upstream: string | null; ahead: number; behind: number; entries: ChangeEntry[]; truncated: boolean }
  | { ok: false; error: ChangesError }

export type ChangesDiff =
  /** `partial`: the full-context diff was too big, `text` is the 3-line-context one. */
  | { ok: true; path: string; text: string; binary: boolean; tooLarge: boolean; untracked: boolean; partial?: boolean }
  | { ok: false; error: ChangesError }

/** `imports` = `all-blank` in git; the viewer then hides import-only changes itself (`lib/diffImports.ts`). */
export type DiffWhitespace = 'none' | 'eol' | 'all' | 'all-blank' | 'imports'

export interface ChangesDiffOpts {
  context?: 3 | 'full'
  whitespace?: DiffWhitespace
}

/** One viewed file's diff vs HEAD (gutter markers); `kind` null = clean, ignored or not in the index. */
export type ChangesFile =
  | { ok: true; root: string; rel: string; kind: ChangeKind | null; staged: boolean; text: string; binary: boolean; tooLarge: boolean; untracked: boolean }
  | { ok: false; error: ChangesError }

export type ChangesResult = { ok: true } | { ok: false; error: ChangesError; detail?: string }
/** Mirrors `apps/desktop/src/preview/logRead.ts`. */
export type LogChunk =
  | { ok: true; path: string; text: string; start: number; end: number; size: number; mtimeMs: number; reset?: true }
  | { ok: false; error: 'denied' | 'missing' | 'too-large' | 'failed' | 'unavailable' }

/** Mirrors `apps/desktop/src/preview/gitImage.ts`. */
export type HeadImage = { ok: true; dataUrl: string; size: number } | { ok: false; error: 'denied' | 'unsupported' | 'missing' | 'too-large' | 'failed' | 'unavailable' }

export interface FileList {
  root: string
  files: string[]
  truncated: boolean
  source: 'git' | 'walk'
}

export type CreateEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'failed' | 'unavailable' }

export type RenameEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'missing' | 'busy' | 'failed' | 'unavailable' }
export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'busy' | 'failed' | 'unavailable' }

export interface SearchQuery {
  q: string
  regex: boolean
  caseSensitive: boolean
  word: boolean
}
/** One `git grep` hit; `path` relative to the searched folder, `col` 1-based in `text`. */
export interface SearchMatch {
  path: string
  line: number
  col: number
  text: string
}
export type CommitError = 'denied' | 'no-git' | 'not-repo' | 'failed' | 'conflict' | 'stale' | 'missing' | 'nothing' | 'empty-message' | 'pushed' | 'cancelled' | 'hook' | 'timeout' | 'unavailable'
export type StageResult = { ok: true } | { ok: false; error: CommitError; detail?: string }
export type CommitResult = { ok: true; hash: string; subject: string } | { ok: false; error: CommitError; detail?: string }
export interface CheckRequest {
  source: string
  name: string
}
export type CheckResult =
  | { ok: true; code: number | null; ms: number; errors: BuildError[]; errorsTruncated: boolean; tail: string }
  | { ok: false; error: 'denied' | 'unknown-script' | 'busy' | 'cancelled' | 'failed' | 'unavailable'; detail?: string }
export type WtError = 'denied' | 'not-repo' | 'unknown' | 'dirty-base' | 'not-ff' | 'conflict' | 'cancelled' | 'failed' | 'empty' | 'unavailable'
export type WtCompare =
  | { ok: true; base: string; branch: string; ahead: number; behind: number; files: number; added: number; removed: number; merged: boolean }
  | { ok: false; error: WtError; detail?: string }
export type WtMerge = { ok: true; mode: 'ff' | 'squash'; hash: string } | { ok: false; error: WtError; detail?: string; kept?: string }
export interface SlashCommand {
  name: string
  description: string
  scope: 'project' | 'user'
}
export type CommandsListResult = { ok: true; commands: SlashCommand[] } | { ok: false; error: 'denied' | 'unavailable' }
export interface WtBetweenFile {
  path: string
  status: 'A' | 'M' | 'D' | 'T'
  added: number
  removed: number
  binary: boolean
}
export type WtBetween = { ok: true; a: string; b: string; files: WtBetweenFile[]; truncated: boolean } | { ok: false; error: WtError | 'denied'; detail?: string }
export type WtBetweenDiff = { ok: true; text: string; tooLarge: boolean } | { ok: false; error: WtError | 'denied'; detail?: string }
export type WtTake = { ok: true } | { ok: false; error: WtError | 'denied' | 'dirty' | 'missing'; detail?: string }
export type OverlapFiles =
  | { ok: true; root: string; common: string | null; branch: string | null; base: string | null; files: string[]; truncated: boolean }
  | { ok: false; error: 'not-repo' | 'failed' | 'unavailable' }
export type DryMerge = { ok: true; clean: boolean; conflicts: string[] } | { ok: false; error: 'unknown' | 'unsupported' | 'failed' | 'cancelled' | 'unavailable'; detail?: string }
export type MergeKind = 'merge' | 'squash' | 'rebase' | 'cherry-pick' | 'revert'
export type MergeStateResult = { ok: true; kind: MergeKind | null } | { ok: false; error: 'failed' | 'unavailable' }
export type MergeAbortResult = { ok: true } | { ok: false; error: 'none' | 'cancelled' | 'failed' | 'unavailable'; detail?: string }
export interface BlameCommit {
  author: string
  time: number
  summary: string
}
export type BlameResult =
  | { ok: true; root: string; commits: Record<string, BlameCommit>; lines: string[] }
  | { ok: false; error: 'denied' | 'not-repo' | 'untracked' | 'too-large' | 'cancelled' | 'failed' | 'unavailable'; detail?: string }
export interface Checkpoint {
  id: string
  at: number
  label: string
}
export interface CheckpointFile {
  path: string
  status: 'A' | 'D' | 'M'
  added?: number
  removed?: number
}
export type CpError = 'denied' | 'off' | 'busy' | 'unknown' | 'failed' | 'cancelled' | 'stale' | 'unavailable'
export type CpState = { ok: true; root: string; on: boolean; list: Checkpoint[] } | { ok: false; error: CpError }
export type CpDiff = { ok: true; files: CheckpointFile[] } | { ok: false; error: CpError; detail?: string }
export type CpFileDiff = { ok: true; text: string; tooLarge: boolean } | { ok: false; error: CpError; detail?: string }
export type CpResult = { ok: true; id?: string | null } | { ok: false; error: CpError; detail?: string }
export type NoteError = 'denied' | 'too-large' | 'failed' | 'unavailable'
export type NoteRead = { ok: true; text: string; mtimeMs: number | null } | { ok: false; error: NoteError }
export type NoteWrite = { ok: true; mtimeMs: number | null } | { ok: false; error: NoteError }
export interface LhVersion {
  id: string
  time: number
  size: number
}
export type LhList = { ok: true; versions: LhVersion[] } | { ok: false; error: 'denied' | 'failed' | 'unavailable' }
export type FormatTool = 'prettier' | 'dart' | 'ktlint'
export type FormatResult =
  | { ok: true; text: string; tool: FormatTool; local: boolean }
  | { ok: false; error: 'denied' | 'unsupported' | 'not-found' | 'failed' | 'timeout' | 'too-large' | 'busy' | 'unavailable'; tool?: FormatTool; detail?: string }
export type LhRead = { ok: true; text: string; time: number } | { ok: false; error: 'denied' | 'missing' | 'failed' | 'unavailable' }
export type SearchResult =
  | { ok: true; matches: SearchMatch[]; truncated: boolean }
  | { ok: false; error: 'denied' | 'not-repo' | 'no-git' | 'bad-query' | 'cancelled' | 'failed' | 'unavailable'; detail?: string }

/** Preview methods added to `window.ccmDesktop` by the v21 preload (see .planning/PLAN-v21-integration.md). */
interface PreviewBridge {
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  logRead?: (req: { path: string; from?: number; end?: number; bytes?: number }) => Promise<LogChunk>
  fileWrite?: (req: { path: string; text: string; expectedMtime?: number }) => Promise<FileWriteResult>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any', near?: string) => Promise<string | null>
  openExternal?: (url: string) => Promise<boolean>
  reveal?: (path: string) => Promise<boolean>
  openPath?: (path: string) => Promise<string>
  requestAccess?: (path: string) => Promise<boolean>
  forgetGrants?: () => Promise<boolean>
  fullAccess?: (on?: boolean | 'first') => Promise<boolean | null>
  changesStatus?: (dir: string) => Promise<ChangesStatus>
  changesDiff?: (root: string, path: string, opts?: ChangesDiffOpts) => Promise<ChangesDiff>
  changesFile?: (path: string) => Promise<ChangesFile>
  gitShowImage?: (root: string, path: string) => Promise<HeadImage>
  search?: (dir: string, query: SearchQuery) => Promise<SearchResult>
  gitStage?: (root: string, paths: string[], hunk?: string) => Promise<StageResult>
  gitUnstage?: (root: string, paths: string[]) => Promise<StageResult>
  gitCanAmend?: (root: string) => Promise<boolean>
  gitCommit?: (root: string, message: string, amend: boolean) => Promise<CommitResult>
  gitCommitCancel?: (root: string) => Promise<boolean>
  checkRun?: (dir: string, check: CheckRequest) => Promise<CheckResult>
  checkCancel?: (dir: string) => Promise<boolean>
  wtCompare?: (dir: string, branch: string) => Promise<WtCompare>
  wtMerge?: (dir: string, branch: string, mode: 'ff' | 'squash', keep?: boolean) => Promise<WtMerge>
  mergeState?: (root: string) => Promise<MergeStateResult>
  mergeAbort?: (root: string) => Promise<MergeAbortResult>
  gitBlame?: (file: string) => Promise<BlameResult>
  commandsList?: (dir: string) => Promise<CommandsListResult>
  notesRead?: (root: string) => Promise<NoteRead>
  notesWrite?: (root: string, text: string) => Promise<NoteWrite>
  lhList?: (file: string) => Promise<LhList>
  lhRead?: (file: string, id: string) => Promise<LhRead>
  formatText?: (file: string, text: string) => Promise<FormatResult>
  wtDiff?: (dir: string, a: string, b: string) => Promise<WtBetween>
  wtFileDiff?: (dir: string, a: string, b: string, path: string) => Promise<WtBetweenDiff>
  wtTake?: (dir: string, from: string, path: string) => Promise<WtTake>
  overlapFiles?: (dir: string) => Promise<OverlapFiles>
  overlapDryRun?: (dir: string, a: string, b: string) => Promise<DryMerge>
  cpState?: (root: string) => Promise<CpState>
  cpSet?: (root: string, on: boolean) => Promise<boolean>
  cpTake?: (root: string, label: string) => Promise<CpResult>
  cpDiff?: (root: string, id: string, to?: string) => Promise<CpDiff>
  cpFileDiff?: (root: string, from: string, to: string, path: string) => Promise<CpFileDiff>
  cpRevertHunk?: (root: string, path: string, patch: string) => Promise<CpResult>
  cpRestore?: (root: string, id: string, paths: string[]) => Promise<CpResult>
  logRefs?: (dir: string) => Promise<RefsResult>
  logPage?: (root: string, query: LogQuery) => Promise<LogPageResult>
  logCommit?: (root: string, hash: string) => Promise<CommitDetail>
  logContains?: (root: string, hash: string) => Promise<ContainsResult>
  logDiff?: (root: string, hash: string, path: string, opts?: ChangesDiffOpts, origPath?: string) => Promise<ChangesDiff>
  gitBranchCreate?: (root: string, name: string, base: string, checkout: boolean) => Promise<BranchOpResult>
  gitBranchDelete?: (root: string, ref: string) => Promise<BranchOpResult>
  gitFetch?: (root: string) => Promise<BranchOpResult>
  gitBranchUpdate?: (root: string, ref: string) => Promise<BranchOpResult>
  gitPushPreview?: (root: string, ref: string, remote?: string, branch?: string) => Promise<PushPreview>
  gitPush?: (root: string, ref: string, remote: string, branch: string, setUpstream: boolean) => Promise<BranchOpResult>
  changesDiscard?: (root: string, path: string, hunk?: string) => Promise<ChangesResult>
  changesWatch?: (root: string) => Promise<boolean>
  changesUnwatch?: (root: string) => Promise<boolean>
  onChangesUpdated?: (handler: (change: { root: string }) => void) => () => void
  listFiles?: (root: string) => Promise<FileList | null>
  listDir?: (root: string, dir: string) => Promise<DirEntry[] | null>
  createEntry?: (root: string, parent: string, name: string, kind: 'file' | 'directory') => Promise<CreateEntryResult>
  renameEntry?: (root: string, path: string, name: string) => Promise<RenameEntryResult>
  trashEntry?: (root: string, path: string) => Promise<TrashEntryResult>
  clipboardImage?: (pngDataUrl: string) => Promise<boolean>
  clipboardImageFile?: (file: string) => Promise<boolean>
  pickFiles?: () => Promise<string[]>
  pathForFile?: (file: File) => string
  captureGuest?: (webContentsId: number) => Promise<boolean>
}

const bridge = desktop as unknown as PreviewBridge | undefined

export const hasPreview = typeof bridge?.previewUrl === 'function'

export const previewUrl = (path: string): Promise<PreviewTarget | null> => bridge?.previewUrl?.(path) ?? Promise.resolve(null)
export const readFile = (path: string): Promise<FileView | null> => bridge?.readFile?.(path) ?? Promise.resolve(null)
export const hasLogRead = typeof bridge?.logRead === 'function'
/** Log chunk ≤ 2 MB cut on line breaks: backwards ending at `end` (default EOF), or forward from `from` (follow). */
export const logRead = (path: string, opts: { from?: number; end?: number; bytes?: number } = {}): Promise<LogChunk> =>
  bridge?.logRead?.({ path, ...opts }) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const hasFileWrite = typeof bridge?.fileWrite === 'function'
/** Saves an edited text file; expectedMtime = mtime when it was read (else conflict). */
export const fileWrite = (path: string, text: string, expectedMtime?: number): Promise<FileWriteResult> =>
  bridge?.fileWrite?.({ path, text, expectedMtime }) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const watchRoot = (root: string): Promise<boolean> => bridge?.watch?.(root) ?? Promise.resolve(false)
export const unwatchRoot = (root: string): Promise<boolean> => bridge?.unwatch?.(root) ?? Promise.resolve(false)
/** `near`: folder the dialog opens in (the focused terminal's). */
export const pickFile = (kind: 'html' | 'any', near?: string): Promise<string | null> => bridge?.pickFile?.(kind, near) ?? Promise.resolve(null)
export const openExternal = (url: string): Promise<boolean> => bridge?.openExternal?.(url) ?? Promise.resolve(false)
export const hasReveal = typeof bridge?.reveal === 'function'
export const revealPath = (path: string): Promise<boolean> => bridge?.reveal?.(path) ?? Promise.resolve(false)
export const openPath = (path: string): Promise<string> => bridge?.openPath?.(path) ?? Promise.resolve('denied')
/** Native "allow this folder?" prompt; true when the path is (now) readable. */
export const requestAccess = (path: string): Promise<boolean> => bridge?.requestAccess?.(path) ?? Promise.resolve(false)
export const hasGrants = typeof bridge?.forgetGrants === 'function'
export const forgetGrants = (): Promise<boolean> => bridge?.forgetGrants?.() ?? Promise.resolve(false)
/** Every folder readable: no argument reads, true asks natively first, 'first' asks only if never decided. Null outside the app. */
export const fullAccess = (on?: boolean | 'first'): Promise<boolean | null> => bridge?.fullAccess?.(on) ?? Promise.resolve(null)
export const hasFullAccess = typeof bridge?.fullAccess === 'function'

const unavailable = { ok: false as const, error: 'unavailable' as const }
export const hasChanges = typeof bridge?.changesStatus === 'function'
export const changesStatus = (dir: string): Promise<ChangesStatus> => bridge?.changesStatus?.(dir) ?? Promise.resolve(unavailable)
export const changesDiff = (root: string, path: string, opts?: ChangesDiffOpts): Promise<ChangesDiff> =>
  bridge?.changesDiff?.(root, path, opts) ?? Promise.resolve(unavailable)
export const hasFileChanges = typeof bridge?.changesFile === 'function'
export const changesFile = (path: string): Promise<ChangesFile> => bridge?.changesFile?.(path) ?? Promise.resolve(unavailable)
export const hasGitShowImage = typeof bridge?.gitShowImage === 'function'
/** HEAD's copy of an image (`rel` inside the repo `root`) as a data URL, ≤ 20 MB. */
export const gitShowImage = (root: string, rel: string): Promise<HeadImage> => bridge?.gitShowImage?.(root, rel) ?? Promise.resolve(unavailable)
export const hasCommit = typeof bridge?.gitCommit === 'function'
export const gitStage = (root: string, paths: string[], hunk?: string): Promise<StageResult> => bridge?.gitStage?.(root, paths, hunk) ?? Promise.resolve(unavailable)
export const gitUnstage = (root: string, paths: string[]): Promise<StageResult> => bridge?.gitUnstage?.(root, paths) ?? Promise.resolve(unavailable)
export const gitCanAmend = (root: string): Promise<boolean> => bridge?.gitCanAmend?.(root) ?? Promise.resolve(false)
export const gitCommit = (root: string, message: string, amend: boolean): Promise<CommitResult> => bridge?.gitCommit?.(root, message, amend) ?? Promise.resolve(unavailable)
export const gitCommitCancel = (root: string): Promise<boolean> => bridge?.gitCommitCancel?.(root) ?? Promise.resolve(false)
export const hasChecks = typeof bridge?.checkRun === 'function'
export const checkRun = (dir: string, check: CheckRequest): Promise<CheckResult> => bridge?.checkRun?.(dir, check) ?? Promise.resolve(unavailable)
export const checkCancel = (dir: string): Promise<boolean> => bridge?.checkCancel?.(dir) ?? Promise.resolve(false)
export const hasWtMerge = typeof bridge?.wtMerge === 'function'
export const wtCompare = (dir: string, branch: string): Promise<WtCompare> => bridge?.wtCompare?.(dir, branch) ?? Promise.resolve(unavailable)
export const wtMerge = (dir: string, branch: string, mode: 'ff' | 'squash', keep = false): Promise<WtMerge> => bridge?.wtMerge?.(dir, branch, mode, keep) ?? Promise.resolve(unavailable)
export const mergeState = (root: string): Promise<MergeStateResult> => bridge?.mergeState?.(root) ?? Promise.resolve(unavailable)
export const mergeAbort = (root: string): Promise<MergeAbortResult> => bridge?.mergeAbort?.(root) ?? Promise.resolve(unavailable)
export const hasCheckpoints = typeof bridge?.cpState === 'function'
export const hasBlame = typeof bridge?.gitBlame === 'function'
export const gitBlame = (file: string): Promise<BlameResult> => bridge?.gitBlame?.(file) ?? Promise.resolve(unavailable)
export const hasOverlap = typeof bridge?.overlapFiles === 'function'
/** Files the checkout of `dir` changed against the main branch (committed since the merge base + uncommitted). */
export const overlapFiles = (dir: string): Promise<OverlapFiles> => bridge?.overlapFiles?.(dir) ?? Promise.resolve({ ok: false, error: 'unavailable' })
/** `git merge-tree --write-tree` of two branch tips: nothing on disk changes. */
export const overlapDryRun = (dir: string, a: string, b: string): Promise<DryMerge> => bridge?.overlapDryRun?.(dir, a, b) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const hasWtCompare = typeof bridge?.wtDiff === 'function'
export const wtDiff = (dir: string, a: string, b: string): Promise<WtBetween> => bridge?.wtDiff?.(dir, a, b) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const wtFileDiff = (dir: string, a: string, b: string, path: string): Promise<WtBetweenDiff> =>
  bridge?.wtFileDiff?.(dir, a, b, path) ?? Promise.resolve({ ok: false, error: 'unavailable' })
/** `git checkout <from> -- path` in the checkout of `dir`, after a native confirm; refused while the file is dirty. */
export const wtTake = (dir: string, from: string, path: string): Promise<WtTake> => bridge?.wtTake?.(dir, from, path) ?? Promise.resolve({ ok: false, error: 'unavailable' })
/** `.claude/commands` of the folder (and its repo) plus the user's, names + descriptions only. */
export const commandsList = (dir: string): Promise<CommandsListResult> => bridge?.commandsList?.(dir) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const hasNotes = typeof bridge?.notesRead === 'function'
/** Project notes kept by the app in its data folder (`notes/<sha1 of root>.md`), never in the repo. */
export const notesRead = (root: string): Promise<NoteRead> => bridge?.notesRead?.(root) ?? Promise.resolve(unavailable)
export const notesWrite = (root: string, text: string): Promise<NoteWrite> => bridge?.notesWrite?.(root, text) ?? Promise.resolve(unavailable)
export const hasLocalHistory = typeof bridge?.lhList === 'function'
/** Local History: disk text before each save the app made (data folder, 50 per file, 7 days). */
export const lhList = (file: string): Promise<LhList> => bridge?.lhList?.(file) ?? Promise.resolve(unavailable)
const FORMAT_EXT = /\.(?:[mc]?js|jsx|[mc]?ts|tsx|vue|jsonc?|json5|s?css|less|md|markdown|html?|ya?ml|dart|kts?)$/i
export const hasFormat = typeof bridge?.formatText === 'function'
/** prettier / dart format / ktlint picks by extension (desktop); the same list as `preview/format.ts` `formatterFor`. */
export const canFormat = (file: string): boolean => hasFormat && FORMAT_EXT.test(file)
/** Formats `text` (the buffer, not the disk file) with the project's formatter, else the one on PATH. */
export const formatText = (file: string, text: string): Promise<FormatResult> => bridge?.formatText?.(file, text) ?? Promise.resolve(unavailable)
export const lhRead = (file: string, id: string): Promise<LhRead> => bridge?.lhRead?.(file, id) ?? Promise.resolve(unavailable)
export const cpState = (root: string): Promise<CpState> => bridge?.cpState?.(root) ?? Promise.resolve(unavailable)
export const cpSet = (root: string, on: boolean): Promise<boolean> => bridge?.cpSet?.(root, on) ?? Promise.resolve(false)
export const cpTake = (root: string, label: string): Promise<CpResult> => bridge?.cpTake?.(root, label) ?? Promise.resolve(unavailable)
export const cpDiff = (root: string, id: string, to?: string): Promise<CpDiff> => bridge?.cpDiff?.(root, id, to) ?? Promise.resolve(unavailable)
export const cpFileDiff = (root: string, from: string, to: string, path: string): Promise<CpFileDiff> => bridge?.cpFileDiff?.(root, from, to, path) ?? Promise.resolve(unavailable)
export const cpRevertHunk = (root: string, path: string, patch: string): Promise<CpResult> => bridge?.cpRevertHunk?.(root, path, patch) ?? Promise.resolve(unavailable)
export const cpRestore = (root: string, id: string, paths: string[]): Promise<CpResult> => bridge?.cpRestore?.(root, id, paths) ?? Promise.resolve(unavailable)
export const hasSearch = typeof bridge?.search === 'function'
export const searchFiles = (dir: string, query: SearchQuery): Promise<SearchResult> => bridge?.search?.(dir, query) ?? Promise.resolve(unavailable)

type Unavailable = { ok: false; error: 'unavailable' }
export type WebRefs = RefsResult | Unavailable
export type WebLogPage = LogPageResult | Unavailable
export type WebCommitDetail = CommitDetail | Unavailable
export type WebContains = ContainsResult | Unavailable
export const hasLog = typeof bridge?.logPage === 'function'
export const logRefs = (dir: string): Promise<WebRefs> => bridge?.logRefs?.(dir) ?? Promise.resolve(unavailable)
export const logPage = (root: string, query: LogQuery): Promise<WebLogPage> => bridge?.logPage?.(root, query) ?? Promise.resolve(unavailable)
export const logCommit = (root: string, hash: string): Promise<WebCommitDetail> => bridge?.logCommit?.(root, hash) ?? Promise.resolve(unavailable)
export const logContains = (root: string, hash: string): Promise<WebContains> => bridge?.logContains?.(root, hash) ?? Promise.resolve(unavailable)
export const logDiff = (root: string, hash: string, path: string, opts?: ChangesDiffOpts, origPath?: string): Promise<ChangesDiff> =>
  bridge?.logDiff?.(root, hash, path, opts, origPath) ?? Promise.resolve(unavailable)
const noBranchOps: BranchOpResult = { ok: false, error: 'denied' }
export const hasBranchOps = typeof bridge?.gitFetch === 'function'
export const gitBranchCreate = (root: string, name: string, base: string, checkout: boolean): Promise<BranchOpResult> =>
  bridge?.gitBranchCreate?.(root, name, base, checkout) ?? Promise.resolve(noBranchOps)
export const gitBranchDelete = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchDelete?.(root, ref) ?? Promise.resolve(noBranchOps)
export const gitFetch = (root: string): Promise<BranchOpResult> => bridge?.gitFetch?.(root) ?? Promise.resolve(noBranchOps)
export const gitBranchUpdate = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchUpdate?.(root, ref) ?? Promise.resolve(noBranchOps)
const noPush: PushPreview = { ok: false, error: 'denied' }
export const hasPush = typeof bridge?.gitPush === 'function'
/** Omitted `remote` / `branch` = main's defaults (upstream, else push remote / origin with the local name). */
export const gitPushPreview = (root: string, ref: string, remote?: string, branch?: string): Promise<PushPreview> =>
  bridge?.gitPushPreview?.(root, ref, remote, branch) ?? Promise.resolve(noPush)
export const gitPush = (root: string, ref: string, remote: string, branch: string, setUpstream: boolean): Promise<BranchOpResult> =>
  bridge?.gitPush?.(root, ref, remote, branch, setUpstream) ?? Promise.resolve(noBranchOps)
export const changesDiscard = (root: string, path: string, hunk?: string): Promise<ChangesResult> =>
  bridge?.changesDiscard?.(root, path, hunk) ?? Promise.resolve(unavailable)
export const changesWatch = (root: string): Promise<boolean> => bridge?.changesWatch?.(root) ?? Promise.resolve(false)
export const changesUnwatch = (root: string): Promise<boolean> => bridge?.changesUnwatch?.(root) ?? Promise.resolve(false)
export const listFiles = (root: string): Promise<FileList | null> => bridge?.listFiles?.(root) ?? Promise.resolve(null)
export const hasExplorer = typeof bridge?.listDir === 'function'
/** One folder of the project `root`; null when outside it or unreadable. */
export const listDir = (root: string, dir: string): Promise<DirEntry[] | null> => bridge?.listDir?.(root, dir) ?? Promise.resolve(null)
export const createEntry = (root: string, parent: string, name: string, kind: 'file' | 'directory'): Promise<CreateEntryResult> =>
  bridge?.createEntry?.(root, parent, name, kind) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const renameEntry = (root: string, path: string, name: string): Promise<RenameEntryResult> =>
  bridge?.renameEntry?.(root, path, name) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const trashEntry = (root: string, path: string): Promise<TrashEntryResult> => bridge?.trashEntry?.(root, path) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const clipboardImage = (pngDataUrl: string): Promise<boolean> => bridge?.clipboardImage?.(pngDataUrl) ?? Promise.resolve(false)
export const clipboardImageFile = (file: string): Promise<boolean> => bridge?.clipboardImageFile?.(file) ?? Promise.resolve(false)
export const pickFiles = (): Promise<string[]> => bridge?.pickFiles?.() ?? Promise.resolve([])
export const hasAttachments = typeof bridge?.pathForFile === 'function'
/** Absolute path of a dropped file, '' when it has none (dragged out of a web page). */
export const pathForFile = (file: File): string => bridge?.pathForFile?.(file) ?? ''
export const captureGuest = (webContentsId: number): Promise<boolean> => bridge?.captureGuest?.(webContentsId) ?? Promise.resolve(false)
export const hasCaptureGuest = typeof bridge?.captureGuest === 'function'

const changesHandlers = new Set<(change: { root: string }) => void>()
let unsubscribeChanges: (() => void) | null = null

export function onChangesUpdated(handler: (change: { root: string }) => void): () => void {
  changesHandlers.add(handler)
  if (!unsubscribeChanges && bridge?.onChangesUpdated) unsubscribeChanges = bridge.onChangesUpdated((c) => changesHandlers.forEach((h) => h(c)))
  return () => {
    changesHandlers.delete(handler)
    if (changesHandlers.size === 0 && unsubscribeChanges) {
      unsubscribeChanges()
      unsubscribeChanges = null
    }
  }
}

/** One IPC listener for the whole page; panes subscribe here. */
const changeHandlers = new Set<(change: PreviewChange) => void>()
let unsubscribeBridge: (() => void) | null = null

export function onPreviewChanged(handler: (change: PreviewChange) => void): () => void {
  changeHandlers.add(handler)
  if (!unsubscribeBridge && bridge?.onPreviewChanged) unsubscribeBridge = bridge.onPreviewChanged((c) => changeHandlers.forEach((h) => h(c)))
  return () => {
    changeHandlers.delete(handler)
    if (changeHandlers.size === 0 && unsubscribeBridge) {
      unsubscribeBridge()
      unsubscribeBridge = null
    }
  }
}

export const isAbsolutePath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

export const dirOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (i <= 0) return p.slice(0, i + 1) || p
  // keep "C:\" rather than "C:"
  return /^[A-Za-z]:$/.test(p.slice(0, i)) ? p.slice(0, i + 1) : p.slice(0, i)
}

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** What the address field accepts: full http(s) URL, bare host:port (http assumed), or an absolute path. */
export function parseAddress(input: string): { kind: 'url'; url: string } | { kind: 'path'; path: string } | null {
  const text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'url', url: new URL(text).href }
    } catch {
      return null
    }
  }
  if (/^file:\/\//i.test(text)) {
    try {
      const path = decodeURIComponent(new URL(text).pathname)
      return { kind: 'path', path: /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path }
    } catch {
      return null
    }
  }
  if (isAbsolutePath(text)) return { kind: 'path', path: text }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(text)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(text)
    try {
      return { kind: 'url', url: new URL(`${local ? 'http' : 'https'}://${text}`).href }
    } catch {
      return null
    }
  }
  return null
}
