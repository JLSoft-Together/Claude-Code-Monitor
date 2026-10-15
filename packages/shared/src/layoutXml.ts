// v42 extra: a layout XML outside `res/layout*/` (scratch files, copies) still gets the Layout Preview.
import { DRAWABLE_ROOTS, DRAWABLE_SNIFF_BYTES, xmlRootName } from './drawable'

/** Android resource roots that are not inflated as a view hierarchy. */
const NOT_LAYOUT = new Set([
  'manifest', 'resources', 'menu', 'navigation', 'preferencescreen', 'preference-headers', 'searchable', 'appwidget-provider',
  'font-family', 'set', 'objectanimator', 'animator', 'alpha', 'translate', 'propertyvaluesholder', 'keyframe', 'interpolator',
  'transitionmanager', 'transitionset', 'motionscene', 'constraintset', 'keyframeset', 'paths', 'network-security-config',
  'data-extraction-rules', 'full-backup-content', 'accessibility-service', 'shortcuts', 'locale-config', 'automotiveapp',
  'device-admin', 'input-method', 'wallpaper', 'dream', 'plurals', 'string-array', 'integer-array', 'array', 'string',
])

const ANDROID_NS = /xmlns:(android|app|tools)\s*=\s*["']http:\/\/schemas\.android\.com\/(apk\/res\/android|apk\/res-auto|tools)["']/

const lastSegment = (name: string): string => name.slice(name.lastIndexOf('.') + 1)

/** Root element names that inflate as a view: a View / ViewGroup class (simple or dotted), `merge`, `view`, data binding `layout`. */
export function isLayoutRootName(name: string): boolean {
  const lower = name.toLowerCase()
  if (DRAWABLE_ROOTS.includes(name) || NOT_LAYOUT.has(lower) || NOT_LAYOUT.has(lastSegment(lower))) return false
  if (lower === 'merge' || lower === 'view' || lower === 'layout' || lower === 'fragment') return true
  if (name.includes(':')) return false
  return /^[A-Z][A-Za-z0-9_]*$/.test(name) || /^[a-z_][\w]*(\.[A-Za-z_][\w$]*)+$/.test(name)
}

/**
 * `.xml` anywhere whose root element (first {@link DRAWABLE_SNIFF_BYTES} bytes) is a view and that declares an
 * Android namespace, so generic XML with a capitalised root (`<Configuration>`, `<Project>`) stays plain text.
 */
export function isLooseLayoutXml(path: string, head: string | null): boolean {
  if (!/\.xml$/i.test(path) || head === null) return false
  const text = head.slice(0, DRAWABLE_SNIFF_BYTES)
  const root = xmlRootName(text)
  return !!root && isLayoutRootName(root) && ANDROID_NS.test(text)
}
