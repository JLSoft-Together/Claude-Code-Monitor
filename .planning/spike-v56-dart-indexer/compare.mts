// v55 TS heuristic vs analyzer (spike A) on the same project: which widget classes each finds.
import { readFileSync } from 'node:fs'
import { scanProject } from '@ccm/desktop/src/flutterPreview/scan'

const [root, analyzerJson] = process.argv.slice(2) as [string, string]
const t0 = Date.now()
const entries = await scanProject(root)
const tsMs = Date.now() - t0
const ts = new Map(entries.filter((e) => e.kind === 'class').map((e) => [`${e.file}#${e.symbol}`, e]))
const an = JSON.parse(readFileSync(analyzerJson, 'utf8')) as { widgets: Array<{ name: string; file: string; cat: string }> }
const truth = new Map(an.widgets.filter((w) => w.cat !== 'abstract').map((w) => [`${w.file}#${w.name}`, w]))
const missed = [...truth.keys()].filter((k) => !ts.has(k))
const extra = [...ts.keys()].filter((k) => !truth.has(k))
// Previewable now (v55: no required params) vs analyzer category zero.
const tsOk = [...ts.values()].filter((e) => !e.skipped).map((e) => `${e.file}#${e.symbol}`)
const anZero = [...truth.values()].filter((w) => w.cat === 'zero').map((w) => `${w.file}#${w.name}`)
const okWrong = tsOk.filter((k) => !anZero.includes(k))
console.log(JSON.stringify({ tsMs, analyzer: truth.size, ts: ts.size, missed, extra, tsPreviewable: tsOk.length, analyzerZero: anZero.length, tsPreviewableButAnalyzerNotZero: okWrong }, null, 2))
