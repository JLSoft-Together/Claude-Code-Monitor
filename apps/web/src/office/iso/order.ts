export type DrawOp = { k: 'static'; i: number } | { k: 'char'; i: number } | { k: 'front'; i: number }

export function frameOps(nStatics: number, charPos: readonly number[], charFronts: readonly (readonly number[] | undefined)[], hasFront: (i: number) => boolean, out: DrawOp[] = []): DrawOp[] {
  out.length = 0
  const occupants = new Map<number, number[]>()
  for (let c = 0; c < charFronts.length; c++) {
    const list = charFronts[c]
    if (list) for (const f of list) if (hasFront(f)) (occupants.get(f) ?? occupants.set(f, []).get(f)!).push(c)
  }
  const left = new Map<number, number>()
  let ci = 0
  const drawChar = (c: number) => {
    out.push({ k: 'char', i: c })
    const list = charFronts[c]
    if (!list) return
    for (const f of list) {
      const n = left.get(f)
      if (n === undefined) continue
      if (n > 1) left.set(f, n - 1)
      else {
        left.delete(f)
        out.push({ k: 'front', i: f })
      }
    }
  }
  for (let s = 0; s < nStatics; s++) {
    while (ci < charPos.length && charPos[ci]! < s) drawChar(ci++)
    out.push({ k: 'static', i: s })
    if (!hasFront(s)) continue
    let waiting = 0
    for (const c of occupants.get(s) ?? []) if (c >= ci) waiting++
    if (waiting > 0) left.set(s, waiting)
    else out.push({ k: 'front', i: s })
  }
  while (ci < charPos.length) drawChar(ci++)
  for (const f of left.keys()) out.push({ k: 'front', i: f })
  return out
}
