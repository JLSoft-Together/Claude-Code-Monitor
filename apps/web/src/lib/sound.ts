let ctx: AudioContext | null = null

/** Short two-note chime. Browsers block audio until a user gesture; failures stay silent. */
export function playChime(kind: 'waiting' | 'alert' = 'waiting'): void {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const notes = kind === 'waiting' ? [660, 880] : [520, 390]
    const start = ctx.currentTime + 0.02
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      const t0 = start + i * 0.16
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0)
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t0)
      osc.stop(t0 + 0.3)
    })
  } catch {
    return
  }
}
