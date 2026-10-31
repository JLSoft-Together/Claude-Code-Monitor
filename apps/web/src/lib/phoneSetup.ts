export const NTFY_PLAY_URL = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy'
export const NTFY_APP_STORE_URL = 'https://apps.apple.com/us/app/ntfy/id1625396347'

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export const validTopic = (topic: string): boolean => TOPIC_RE.test(topic)

/** `orrery-` + 16 chars; bytes ≥ 252 are dropped so every one of the 36 chars is equally likely. */
export function randomTopic(rand: (buf: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  let out = ''
  while (out.length < 16) {
    for (const b of rand(new Uint8Array(32))) {
      if (b < 252 && out.length < 16) out += ALPHABET[b % 36]
    }
  }
  return `orrery-${out}`
}

/** Android app deep link (docs.ntfy.sh/subscribe/phone): opens and subscribes; iOS has no equivalent. */
export function ntfySubscribeLink(server: string, topic: string): string | null {
  if (!validTopic(topic)) return null
  let url: URL
  try {
    url = new URL(server.trim() || 'https://ntfy.sh')
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const base = `${url.host}${url.pathname.replace(/\/+$/, '')}`
  return `ntfy://${base}/${topic}${url.protocol === 'http:' ? '?secure=false' : ''}`
}
