import { compareLibVersions, PLAY_TARGET_SDK, PLAY_TARGET_SDK_SINCE, type ReleaseFinding, type ReleaseMark, type ReleaseRule, type ReleaseSection, type ReleaseStatus } from '@ccm/shared'
import { xmlAttrs } from '../devices/uiDump'

export type CodeLang = 'c' | 'xml' | 'yaml'

const blank = (s: string): string => s.replace(/[^\r\n]/g, ' ')

/** Comments become spaces (newlines kept), so match indexes still map to the original lines; string literals stay. */
export function maskComments(text: string, lang: CodeLang): string {
  if (lang === 'xml') return text.replace(/<!--[\s\S]*?(-->|$)/g, blank)
  if (lang === 'yaml') return text.replace(/(^|[ \t])#.*$/gm, (m, lead: string) => lead + blank(m.slice(lead.length)))
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    const two = text.slice(i, i + 2)
    if (two === '//') {
      const end = text.indexOf('\n', i)
      const stop = end < 0 ? text.length : end
      out += blank(text.slice(i, stop))
      i = stop
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end < 0 ? text.length : end + 2
      out += blank(text.slice(i, stop))
      i = stop
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i)
      const quote = triple ? c.repeat(3) : c
      let j = i + quote.length
      while (j < text.length && !text.startsWith(quote, j)) {
        if (!triple && text[j] === '\n') break
        j += text[j] === '\\' ? 2 : 1
      }
      const stop = Math.min(text.length, j + (text.startsWith(quote, j) ? quote.length : 0))
      out += text.slice(i, stop)
      i = stop
    } else {
      out += c
      i++
    }
  }
  return out
}

export const lineAt = (text: string, index: number): number => {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/** End index (exclusive of the closing brace) of the block whose `{` is at `open`. */
function blockEnd(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return i
  }
  return text.length
}

interface Range {
  /** Index of the block name, for its line. */
  at: number
  start: number
  end: number
}

function findBlock(text: string, head: RegExp, within: { start: number; end: number } = { start: 0, end: text.length }): Range | null {
  const re = new RegExp(head.source, 'g')
  re.lastIndex = within.start
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && m.index < within.end) {
    const open = m.index + m[0].length - 1
    if (text[open] !== '{') continue
    return { at: m.index, start: open + 1, end: Math.min(blockEnd(text, open), within.end) }
  }
  return null
}

export interface GradleValue<T> {
  value: T | null
  raw: string
  line: number
}

export interface GradleRelease {
  line: number
  minify: GradleValue<boolean> | null
  shrink: GradleValue<boolean> | null
  debuggable: GradleValue<boolean> | null
  /** `name` null when the value is an expression or `null`. */
  signing: (GradleValue<string> & { name: string | null }) | null
}

export interface GradleApp {
  versionCode: GradleValue<number> | null
  versionName: GradleValue<string> | null
  minSdk: GradleValue<number> | null
  targetSdk: GradleValue<number> | null
  compileSdk: GradleValue<number> | null
  release: GradleRelease | null
  /** Line of `buildTypes {` (or `android {`, else 1) for findings about a missing release block. */
  anchorLine: number
}

const RAW_MAX = 80
const tidy = (raw: string): string => {
  let s = raw.trim().replace(/(\s*\})+$/, '').replace(/[;,]$/, '').trim()
  while (s.endsWith(')') && s.split(')').length > s.split('(').length) s = s.slice(0, -1).trim()
  return s.length > RAW_MAX ? `${s.slice(0, RAW_MAX)}…` : s
}

function pick<T>(text: string, re: RegExp, range: { start: number; end: number }, parse: (raw: string) => T | null): GradleValue<T> | null {
  const g = new RegExp(re.source, 'g')
  g.lastIndex = range.start
  const m = g.exec(text)
  if (!m || m.index >= range.end) return null
  const raw = tidy(m[1]!)
  return { value: parse(raw), raw, line: lineAt(text, m.index) }
}

const int = (raw: string): number | null => (/^\d{1,10}$/.test(raw) ? Number(raw) : null)
export const sdkValue = (raw: string): number | null => {
  const n = int(raw) ?? int(/^["']android-(\d+)["']$/.exec(raw)?.[1] ?? '')
  return n ?? int(/release\(\s*(\d+)/.exec(raw)?.[1] ?? '')
}
const bool = (raw: string): boolean | null => (raw === 'true' ? true : raw === 'false' ? false : null)
const str = (raw: string): string | null => /^["']([^"'\r\n]*)["']$/.exec(raw)?.[1] ?? null

const VALUE = '\\s*(?:=\\s*|\\(\\s*)?([^\\r\\n;]+)'
const sdkRe = (name: string): RegExp => new RegExp(`\\b${name}(?:Version)?\\b${VALUE}`)
const RELEASE_HEAD = /(?:\brelease|getByName\(\s*["']release["']\s*\)|named\(\s*["']release["']\s*\)|maybeCreate\(\s*["']release["']\s*\))\s*\{/

/** App module build file (Groovy or Kotlin DSL): versions, SDK levels and the release build type. */
export function parseGradleApp(source: string): GradleApp {
  const text = maskComments(source, 'c')
  const all = { start: 0, end: text.length }
  const android = findBlock(text, /\bandroid\s*\{/)
  const scope = android ?? all
  const dc = findBlock(text, /\bdefaultConfig\s*\{/, scope)
  const inDc = dc ?? scope
  const sdkIn = (name: string) => pick(text, sdkRe(name), inDc, sdkValue) ?? (dc ? pick(text, sdkRe(name), scope, sdkValue) : null)
  let compileSdk = pick(text, /\bcompileSdk(?:Version)?\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, scope, sdkValue)
  if (compileSdk && compileSdk.raw.startsWith('{')) {
    const block = findBlock(text, /\bcompileSdk\s*\{/, scope)
    const inner = block ? /release\(\s*(\d+)\s*\)/.exec(text.slice(block.start, block.end)) : null
    compileSdk = { ...compileSdk, raw: inner ? `release(${inner[1]})` : compileSdk.raw, value: inner ? Number(inner[1]) : null }
  }
  const types = findBlock(text, /\bbuildTypes\s*\{/, scope)
  const rel = types ? findBlock(text, RELEASE_HEAD, types) : null
  let release: GradleRelease | null = null
  if (rel) {
    const signing = pick(text, /\bsigningConfig\b\s*(?:=\s*)?([^\r\n;]+)/, rel, (raw) => raw)
    const name = signing
      ? (/signingConfigs\.getByName\(\s*["'](\w+)["']\s*\)/.exec(signing.raw)?.[1] ??
        /signingConfigs\s*\[\s*["'](\w+)["']\s*\]/.exec(signing.raw)?.[1] ??
        /signingConfigs\.(?!getByName|named)(\w+)/.exec(signing.raw)?.[1] ??
        null)
      : null
    release = {
      line: lineAt(text, rel.at),
      minify: pick(text, /\b(?:isMinifyEnabled|minifyEnabled)\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, rel, bool),
      shrink: pick(text, /\b(?:isShrinkResources|shrinkResources)\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, rel, bool),
      debuggable: pick(text, /\b(?:isDebuggable|debuggable)\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, rel, bool),
      signing: signing ? { ...signing, name } : null,
    }
  }
  return {
    versionCode: pick(text, /\bversionCode\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, inDc, int),
    versionName: pick(text, /\bversionName\b\s*(?:=\s*|\(\s*)?([^\r\n;]+)/, inDc, str),
    minSdk: sdkIn('minSdk'),
    targetSdk: sdkIn('targetSdk'),
    compileSdk,
    release,
    anchorLine: types ? lineAt(text, types.at) : android ? lineAt(text, android.at) : 1,
  }
}

/** `version: 1.2.3+45` of a pubspec.yaml. */
export function parsePubspecVersion(source: string): { name: string | null; code: number | null; raw: string; line: number } | null {
  const text = maskComments(source, 'yaml')
  const m = /^version:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(text)
  if (!m) return null
  const raw = m[1]!.trim()
  const [name, build] = raw.split('+')
  return { name: name?.trim() || null, code: build !== undefined ? int(build.trim()) : null, raw, line: lineAt(text, m.index) }
}

export const pubspecName = (source: string): string | null => /^name:[ \t]*["']?([\w-]+)/m.exec(maskComments(source, 'yaml'))?.[1] ?? null

const make = (rule: ReleaseRule, section: ReleaseSection, status: ReleaseStatus, detail: string, file: string | null, line: number | null, params?: ReleaseFinding['params']): ReleaseFinding =>
  params ? { rule, section, status, detail, params, file, line } : { rule, section, status, detail, file, line }

export interface VersionInput {
  code: number | null
  codeRaw: string | null
  name: string | null
  file: string | null
  codeLine: number | null
  nameLine: number | null
}

export function versionFindings(v: VersionInput, released: ReleaseMark | null): ReleaseFinding[] {
  const out: ReleaseFinding[] = []
  if (v.code !== null) {
    if (!released || released.code === null) out.push(make('version-code', 'version', 'ok', 'first', v.file, v.codeLine, { code: v.code }))
    else if (v.code > released.code) out.push(make('version-code', 'version', 'ok', 'raised', v.file, v.codeLine, { code: v.code, prev: released.code }))
    else out.push(make('version-code', 'version', 'fail', 'notRaised', v.file, v.codeLine, { code: v.code, prev: released.code }))
  } else if (v.codeRaw) out.push(make('version-code', 'version', 'unknown', 'expr', v.file, v.codeLine, { raw: v.codeRaw }))
  else out.push(make('version-code', 'version', 'fail', 'missing', v.file, v.codeLine))
  if (v.name === null) out.push(make('version-name', 'version', 'warn', 'missing', v.file, v.nameLine))
  else if (released?.name && v.name === released.name) out.push(make('version-name', 'version', 'warn', 'same', v.file, v.nameLine, { name: v.name }))
  else if (released?.name && compareLibVersions(v.name, released.name) < 0) out.push(make('version-name', 'version', 'warn', 'lower', v.file, v.nameLine, { name: v.name, prev: released.name }))
  else out.push(make('version-name', 'version', 'ok', 'value', v.file, v.nameLine, { name: v.name }))
  return out
}

/** Release build type. Flutter's Gradle plugin turns R8 and resource shrinking on for release unless the app says otherwise. */
export function buildFindings(g: GradleApp, file: string, flutter: boolean): ReleaseFinding[] {
  const r = g.release
  const at = r?.line ?? g.anchorLine
  const toggle = (rule: 'minify' | 'shrink', v: GradleValue<boolean> | null | undefined): ReleaseFinding => {
    if (!v) return flutter ? make(rule, 'build', 'ok', 'flutterDefault', file, at) : make(rule, 'build', 'warn', 'missing', file, at)
    if (v.value === true) return make(rule, 'build', 'ok', 'on', file, v.line)
    if (v.value === false) return make(rule, 'build', 'warn', 'off', file, v.line)
    return make(rule, 'build', 'unknown', 'expr', file, v.line, { raw: v.raw })
  }
  const out = [toggle('minify', r?.minify), toggle('shrink', r?.shrink)]
  const d = r?.debuggable
  if (d?.value === true) out.push(make('debuggable', 'build', 'fail', 'on', file, d.line))
  else if (d && d.value === null) out.push(make('debuggable', 'build', 'unknown', 'expr', file, d.line, { raw: d.raw }))
  else out.push(make('debuggable', 'build', 'ok', 'off', file, d?.line ?? at))
  const s = r?.signing
  if (!s || s.raw === 'null') out.push(make('signing', 'build', 'warn', 'none', file, s?.line ?? at))
  else if (s.name === 'debug') out.push(make('signing', 'build', 'warn', 'debugKey', file, s.line))
  else if (s.name) out.push(make('signing', 'build', 'ok', 'named', file, s.line, { name: s.name }))
  else out.push(make('signing', 'build', 'unknown', 'expr', file, s.line, { raw: s.raw }))
  return out
}

export function sdkFindings(g: GradleApp, file: string, flutter: boolean): ReleaseFinding[] {
  const out: ReleaseFinding[] = []
  const need = { need: PLAY_TARGET_SDK, since: PLAY_TARGET_SDK_SINCE }
  const t = g.targetSdk
  if (!t) out.push(make('target-sdk', 'sdk', 'fail', 'missing', file, g.anchorLine, need))
  else if (t.value === null) out.push(make('target-sdk', 'sdk', 'unknown', flutter && t.raw.includes('flutter.') ? 'flutter' : 'expr', file, t.line, { ...need, raw: t.raw }))
  else if (t.value < PLAY_TARGET_SDK) out.push(make('target-sdk', 'sdk', 'fail', 'low', file, t.line, { ...need, n: t.value }))
  else out.push(make('target-sdk', 'sdk', 'ok', 'meets', file, t.line, { ...need, n: t.value }))
  const m = g.minSdk
  if (m) out.push(m.value === null ? make('min-sdk', 'sdk', 'unknown', 'expr', file, m.line, { raw: m.raw }) : make('min-sdk', 'sdk', 'ok', 'value', file, m.line, { n: m.value }))
  const c = g.compileSdk
  if (c?.value != null && t?.value != null && c.value < t.value) out.push(make('compile-sdk', 'sdk', 'warn', 'belowTarget', file, c.line, { n: c.value, target: t.value }))
  else if (c) out.push(c.value === null ? make('compile-sdk', 'sdk', 'unknown', 'expr', file, c.line, { raw: c.raw }) : make('compile-sdk', 'sdk', 'ok', 'value', file, c.line, { n: c.value }))
  return out
}

/** Permissions Play asks a declaration form (or a policy exception) for. */
export const SENSITIVE_PERMISSIONS = [
  'READ_SMS',
  'RECEIVE_SMS',
  'SEND_SMS',
  'READ_CALL_LOG',
  'WRITE_CALL_LOG',
  'PROCESS_OUTGOING_CALLS',
  'QUERY_ALL_PACKAGES',
  'MANAGE_EXTERNAL_STORAGE',
  'ACCESS_BACKGROUND_LOCATION',
  'REQUEST_INSTALL_PACKAGES',
] as const

const attr = (a: Record<string, string>, name: string): string | undefined => a[`android:${name}`] ?? a[name]
const COMPONENTS = /<(activity|activity-alias|service|receiver|provider)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/g

/** Source manifest (main or release source set). Comments ignored; ok rows only from the main manifest (`main`). */
export function manifestFindings(source: string, file: string, main: boolean): ReleaseFinding[] {
  const text = maskComments(source, 'xml')
  const out: ReleaseFinding[] = []
  const app = /<application\b([^>]*)>?/.exec(text)
  const lineOfAttr = (m: RegExpExecArray, name: string): number => {
    const i = m[0].indexOf(name)
    return lineAt(text, m.index + Math.max(0, i))
  }
  const appAttrs = app ? xmlAttrs(app[1]!) : {}
  const appLine = app ? lineAt(text, app.index) : 1
  if (attr(appAttrs, 'usesCleartextTraffic') === 'true') out.push(make('cleartext', 'manifest', 'warn', 'on', file, lineOfAttr(app!, 'usesCleartextTraffic')))
  else if (main) out.push(make('cleartext', 'manifest', 'ok', 'off', file, appLine))
  if (attr(appAttrs, 'debuggable') === 'true') out.push(make('manifest-debuggable', 'manifest', 'fail', 'on', file, lineOfAttr(app!, 'debuggable')))
  else if (main) out.push(make('manifest-debuggable', 'manifest', 'ok', 'off', file, appLine))
  let exported = 0
  for (const m of text.matchAll(COMPONENTS)) {
    const a = xmlAttrs(m[2]!)
    if (attr(a, 'exported') !== 'true' || /<intent-filter\b/.test(m[4] ?? '')) continue
    exported++
    out.push(make('exported', 'manifest', 'warn', 'noFilter', file, lineAt(text, m.index!), { name: attr(a, 'name') ?? m[1]!, tag: m[1]! }))
  }
  if (!exported && main) out.push(make('exported', 'manifest', 'ok', 'none', file, appLine))
  let sensitive = 0
  for (const m of text.matchAll(/<uses-permission(?:-sdk-23)?\b([^>]*)>/g)) {
    const a = xmlAttrs(m[1]!)
    const name = attr(a, 'name') ?? ''
    const short = name.replace(/^android\.permission\./, '')
    if (a['tools:node'] === 'remove' || !(SENSITIVE_PERMISSIONS as readonly string[]).includes(short) || !name.startsWith('android.permission.')) continue
    sensitive++
    out.push(make('permission', 'manifest', 'warn', 'declare', file, lineAt(text, m.index!), { name: short }))
  }
  if (!sensitive && main) out.push(make('permission', 'manifest', 'ok', 'none', file, lineAt(text, /<uses-permission\b/.exec(text)?.index ?? app?.index ?? 0)))
  return out
}

const ADMOB_TEST = /ca-app-pub-3940256099942544[~/]\d{6,12}/g
const DEBUG_GUARD = /\b(kDebugMode|kReleaseMode|kProfileMode|BuildConfig\.DEBUG|isDebug\w*|DEBUG)\b|\bassert\s*\(/
const GUARD_LINES = 6

export const langOf = (file: string): CodeLang | null => {
  const f = file.toLowerCase()
  if (/\.(kt|kts|java|dart|gradle|swift|m|js|ts)$/.test(f)) return 'c'
  if (/\.(xml|plist)$/.test(f)) return 'xml'
  if (/\.(ya?ml|properties)$/.test(f)) return 'yaml'
  if (/\.json$/.test(f)) return 'c'
  return null
}

/**
 * AdMob sample ids (Google's public test publisher). In a debug-only source set, or under a `kDebugMode` /
 * `BuildConfig.DEBUG` check a few lines up, it is likely deliberate: warn "check it is debug only" instead of fail.
 */
export function admobFindings(source: string, file: string, debugPath: boolean): ReleaseFinding[] {
  const lang = langOf(file)
  if (!lang || !source.includes('ca-app-pub-3940256099942544')) return []
  const text = maskComments(source, lang)
  const lines = text.split('\n')
  const out: ReleaseFinding[] = []
  for (const m of text.matchAll(ADMOB_TEST)) {
    const line = lineAt(text, m.index!)
    const params = { id: m[0], kind: m[0].includes('~') ? 'app' : 'unit' }
    if (debugPath) out.push(make('admob-test', 'ads', 'warn', 'debugPath', file, line, params))
    else if (lines.slice(Math.max(0, line - 1 - GUARD_LINES), line).some((l) => DEBUG_GUARD.test(l))) out.push(make('admob-test', 'ads', 'warn', 'guarded', file, line, params))
    else out.push(make('admob-test', 'ads', 'fail', 'release', file, line, params))
  }
  return out
}

export interface Located {
  file: string
  line: number
}

export interface ExtrasFacts {
  ads: Located | null
  consent: boolean
  billing: (Located & { revenueCat: boolean }) | null
  acknowledge: boolean
  googleServicesJson: string | null
  gmsPlugin: Located | null
}

export function extrasFindings(f: ExtrasFacts): ReleaseFinding[] {
  const out: ReleaseFinding[] = []
  if (f.ads) out.push(f.consent ? make('ump', 'extras', 'ok', 'found', f.ads.file, f.ads.line) : make('ump', 'extras', 'warn', 'missing', f.ads.file, f.ads.line))
  if (f.billing) {
    if (f.billing.revenueCat) out.push(make('billing-ack', 'extras', 'ok', 'revenueCat', f.billing.file, f.billing.line))
    else out.push(f.acknowledge ? make('billing-ack', 'extras', 'ok', 'found', f.billing.file, f.billing.line) : make('billing-ack', 'extras', 'warn', 'missing', f.billing.file, f.billing.line))
  }
  if (f.googleServicesJson && !f.gmsPlugin) out.push(make('firebase', 'extras', 'warn', 'noPlugin', f.googleServicesJson, 1))
  else if (f.gmsPlugin && !f.googleServicesJson) out.push(make('firebase', 'extras', 'warn', 'noJson', f.gmsPlugin.file, f.gmsPlugin.line))
  else if (f.gmsPlugin) out.push(make('firebase', 'extras', 'ok', 'paired', f.gmsPlugin.file, f.gmsPlugin.line))
  return out
}

/** First match of `re` in `source` (comments ignored) with its line. */
export function locate(source: string, file: string, lang: CodeLang, re: RegExp): Located | null {
  const text = maskComments(source, lang)
  const m = re.exec(text)
  return m ? { file, line: lineAt(text, m.index) } : null
}

export const ADS_GRADLE = /play-services-ads(?:-lite)?(?![\w-])/
export const ADS_PUBSPEC = /^[ \t]+google_mobile_ads[ \t]*:/m
export const BILLING_GRADLE = /com\.android\.billingclient|com\.revenuecat\.purchases/
export const BILLING_PUBSPEC = /^[ \t]+(in_app_purchase|purchases_flutter|flutter_inapp_purchase)[ \t]*:/m
export const CONSENT_SOURCE = /\b(UserMessagingPlatform|ConsentInformation|ConsentRequestParameters|ConsentForm)\b/
export const ACK_SOURCE = /\b(acknowledgePurchase|completePurchase|consumeAsync|consumePurchase|finishTransaction|finishPurchase)\b/
export const GMS_PLUGIN = /com\.google\.gms\.google-services|plugins\.(?:google[.-]?services|gms[\w.-]*)\b|google-services["']/

export const formatSha256 = (hex: string): string | null => {
  const h = hex.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  return h.length === 64 ? h.match(/../g)!.join(':') : null
}

/** First signer of `apksigner verify --print-certs`. */
export function parseApksigner(out: string): { sha256: string; subject: string | null } | null {
  const sha = /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(out)?.[1]
  const formatted = sha ? formatSha256(sha) : null
  return formatted ? { sha256: formatted, subject: /certificate DN:\s*(.+)/.exec(out)?.[1]?.trim() ?? null } : null
}

/** First certificate of `keytool -printcert -jarfile`. */
export function parseKeytool(out: string): { sha256: string; subject: string | null } | null {
  const sha = /SHA-?256:\s*((?:[0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2})/.exec(out)?.[1]
  const formatted = sha ? formatSha256(sha) : null
  return formatted ? { sha256: formatted, subject: /(?:Owner|Chủ sở hữu):\s*(.+)/.exec(out)?.[1]?.trim() ?? null } : null
}

export const isDebugSubject = (subject: string | null): boolean => !!subject && /CN=Android Debug\b/i.test(subject)

export function certFinding(sha256: string | null, remembered: string | null, debugKey: boolean, file: string | null): ReleaseFinding {
  const short = (s: string): string => `${s.slice(0, 11)}…${s.slice(-5)}`
  if (!sha256) return remembered ? make('cert', 'signing', 'unknown', 'remembered', null, null, { sha: short(remembered) }) : make('cert', 'signing', 'unknown', 'notVerified', null, null)
  if (debugKey) return make('cert', 'signing', 'fail', 'debugKey', file, null, { sha: short(sha256) })
  if (!remembered) return make('cert', 'signing', 'unknown', 'notRemembered', file, null, { sha: short(sha256) })
  return sha256 === remembered
    ? make('cert', 'signing', 'ok', 'match', file, null, { sha: short(sha256) })
    : make('cert', 'signing', 'fail', 'mismatch', file, null, { sha: short(sha256), prev: short(remembered) })
}
