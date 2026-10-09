import type { ToastMessage } from '@ccm/shared'
import type { ToastDeps } from './toast'

export function electronToastDeps(post: (msg: ToastMessage) => void, now: () => number = Date.now): ToastDeps {
  return {
    show: async (c) => {
      post({ type: 'toast.show', tag: c.tag, title: c.title, persistent: c.persistent })
      return true
    },
    hide: async (tag) => {
      post({ type: 'toast.hide', tag })
      return true
    },
    now,
    health: async () => 'ok',
  }
}
