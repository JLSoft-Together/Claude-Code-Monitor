import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { i18n, initialLocale, type Locale } from '../i18n'

export type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    return
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<Theme>(initialTheme())
  const locale = ref<Locale>(initialLocale())
  const hideFinished = ref(readFlag('ccm.hideFinished'))

  watch(hideFinished, (value) => persist('ccm.hideFinished', value ? '1' : '0'))

  watch(
    theme,
    (value) => {
      document.documentElement.classList.toggle('dark', value === 'dark')
      persist('ccm.theme', value)
    },
    { flush: 'sync' },
  )

  watch(
    locale,
    (value) => {
      i18n.global.locale.value = value
      document.documentElement.lang = value
      persist('ccm.locale', value)
    },
    { immediate: true },
  )

  function toggleTheme(): void {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  function toggleLocale(): void {
    locale.value = locale.value === 'en' ? 'vi' : 'en'
  }

  function toggleHideFinished(): void {
    hideFinished.value = !hideFinished.value
  }

  return { theme, locale, hideFinished, toggleTheme, toggleLocale, toggleHideFinished }
})
