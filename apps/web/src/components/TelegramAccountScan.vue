<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, LogIn, RefreshCw, UserCheck } from 'lucide-vue-next'
import type { TelegramUserInput } from '@ccm/shared'
import { useTelegramStore } from '../stores/telegram'

const { t } = useI18n()
const tg = useTelegramStore()

type Step = 'idle' | 'phone' | 'code' | 'password'
const step = ref<Step>('idle')
const phone = ref('')
const code = ref('')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const field = ref<HTMLInputElement | null>(null)

const state = computed(() => tg.state)
const hasKeys = computed(() => !!state.value?.bigFiles.apiId && !!state.value?.bigFiles.hasHash)
const account = computed(() => state.value?.userAccount ?? null)

async function go(next: Step): Promise<void> {
  step.value = next
  error.value = null
  await nextTick()
  field.value?.focus()
}

async function send(input: TelegramUserInput): Promise<void> {
  busy.value = true
  error.value = null
  const res = await tg.user(input)
  busy.value = false
  if (!res.ok) {
    error.value = t(`telegram.account.error.${res.error}`)
    if (res.error === 'expired') void go('phone')
    return
  }
  if (res.next) return go(res.next)
  code.value = ''
  password.value = ''
  step.value = 'idle'
  if (input.action !== 'logout') void tg.discover()
}

function submit(): void {
  if (busy.value) return
  if (step.value === 'phone') void send({ action: 'code', phone: phone.value })
  else if (step.value === 'code') void send({ action: 'signin', code: code.value })
  else if (step.value === 'password') void send({ action: 'password', password: password.value })
}

const canSubmit = computed(() => {
  if (step.value === 'phone') return /^\+?[\d\s().-]{6,24}$/.test(phone.value.trim())
  if (step.value === 'code') return /^\d{4,8}$/.test(code.value.replace(/\D/g, ''))
  return password.value.length > 0
})
</script>

<template>
  <div class="flex flex-col gap-2 px-3 py-2" data-telegram-account>
    <div class="flex items-start gap-2">
      <KeyRound :size="15" class="mt-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-medium">{{ t('telegram.account.title') }}</p>
        <p class="mt-0.5 text-2xs leading-relaxed text-ink-faint">{{ t('telegram.account.hint') }}</p>
      </div>
    </div>

    <p v-if="!hasKeys && !account" class="pl-6 text-2xs text-ink-muted" data-telegram-account-keys>{{ t('telegram.account.needKeys') }}</p>

    <div v-else-if="account" class="flex flex-wrap items-center gap-2 pl-6" data-telegram-account-on>
      <span class="inline-flex min-w-0 items-center gap-1 text-xs text-success"><UserCheck :size="13" class="shrink-0" aria-hidden="true" /><span class="truncate">{{ t('telegram.account.signedIn', { name: account }) }}</span></span>
      <button type="button" class="ccm-btn-plain text-xs" :disabled="tg.scanning" data-telegram-account-scan @click="tg.discover()">
        <RefreshCw :size="12" :class="tg.scanning ? 'ccm-spin' : ''" aria-hidden="true" />{{ tg.scanning ? t('telegram.scanning') : t('telegram.scan') }}
      </button>
      <button type="button" class="ccm-btn-plain ml-auto text-xs text-st-error" :disabled="busy" data-telegram-account-logout @click="send({ action: 'logout' })">{{ t('telegram.account.logout') }}</button>
    </div>

    <div v-else-if="step === 'idle'" class="pl-6">
      <button type="button" class="ccm-btn" :disabled="!state?.keychain" data-telegram-account-start @click="go('phone')"><LogIn :size="13" aria-hidden="true" />{{ t('telegram.account.start') }}</button>
    </div>

    <form v-else class="flex flex-col gap-1.5 pl-6" autocomplete="off" @submit.prevent="submit">
      <label :for="`tg-account-${step}`" class="text-2xs text-ink-muted">{{ t(`telegram.account.${step}Label`, { phone }) }}</label>
      <div class="flex flex-wrap items-center gap-2">
        <input
          v-if="step === 'phone'"
          id="tg-account-phone"
          ref="field"
          v-model="phone"
          type="tel"
          inputmode="tel"
          maxlength="24"
          spellcheck="false"
          :placeholder="t('telegram.account.phonePlaceholder')"
          class="ccm-field w-48 font-mono text-xs"
          data-telegram-account-phone
        />
        <input
          v-else-if="step === 'code'"
          id="tg-account-code"
          ref="field"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="8"
          spellcheck="false"
          class="ccm-field w-32 font-mono text-xs tracking-widest"
          data-telegram-account-code
        />
        <input v-else id="tg-account-password" ref="field" v-model="password" type="password" maxlength="256" class="ccm-field w-48 text-xs" data-telegram-account-password />
        <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!canSubmit || busy" data-telegram-account-next>
          {{ busy ? t('telegram.account.wait') : t(step === 'phone' ? 'telegram.account.sendCode' : 'telegram.account.signIn') }}
        </button>
        <button type="button" class="ccm-btn-plain text-xs" :disabled="busy" @click="step === 'phone' ? go('idle') : go('phone')">{{ t(step === 'phone' ? 'telegram.account.cancel' : 'telegram.account.changePhone') }}</button>
      </div>
      <p v-if="step === 'code'" class="text-2xs text-ink-faint">{{ t('telegram.account.codeHint') }}</p>
    </form>

    <p v-if="error" class="pl-6 text-2xs text-st-error" role="alert" data-telegram-account-error>{{ error }}</p>
  </div>
</template>
