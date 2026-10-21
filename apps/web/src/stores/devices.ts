import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { AdbDevice, DevBatchResult, DevErrorCode, DevEvent, DevResult, QrStatus } from '@ccm/shared'
import * as api from '../lib/devices'

export interface DevQr {
  id: string
  payload: string
  status: QrStatus
  detail?: string
}

export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<AdbDevice[]>([])
  const adbFound = ref(true)
  const autoConnect = ref(true)
  const loaded = ref(false)
  const busy = ref<Set<string>>(new Set())
  const selected = ref<Set<string>>(new Set())
  const qr = ref<DevQr | null>(null)
  const lastError = ref<{ code: DevErrorCode; detail?: string } | null>(null)
  let unsubscribe: (() => void) | null = null

  const rows = (pick: (d: AdbDevice) => boolean) => devices.value.filter((d) => selected.value.has(d.id) && pick(d))
  const selectedRows = computed(() => rows(() => true))
  const selectedOnlineWifi = computed(() => rows((d) => d.online && d.transport === 'wifi'))
  const selectedOfflineWifi = computed(() => rows((d) => !d.online && d.transport === 'wifi'))
  const selectedOffline = computed(() => rows((d) => !d.online))

  function setDevices(list: AdbDevice[]): void {
    devices.value = list
    const ids = new Set(list.map((d) => d.id))
    const kept = [...selected.value].filter((id) => ids.has(id))
    if (kept.length !== selected.value.size) selected.value = new Set(kept)
  }

  function onEvent(e: DevEvent): void {
    if (e.type === 'devices') setDevices(e.devices)
    else if (e.type === 'qr' && qr.value?.id === e.id) qr.value = { ...qr.value, status: e.status, detail: e.detail }
  }

  function fail(r: DevResult): void {
    if (!r.ok && r.error !== 'cancelled') lastError.value = { code: r.error, detail: r.detail }
  }

  function failBatch(list: DevBatchResult[]): void {
    const first = list.find((b) => !b.result.ok)
    if (first) fail(first.result)
  }

  async function track(keys: string[], fn: () => Promise<void>): Promise<void> {
    busy.value = new Set([...busy.value, ...keys])
    try {
      await fn()
    } finally {
      const next = new Set(busy.value)
      for (const k of keys) next.delete(k)
      busy.value = next
    }
  }

  async function open(): Promise<void> {
    unsubscribe ??= api.onDevEvent(onEvent)
    await api.devHold(true)
    const snap = await api.devSnapshot()
    if (snap) {
      adbFound.value = snap.adb !== null
      autoConnect.value = snap.autoConnect
      setDevices(snap.devices)
    }
    loaded.value = true
  }

  async function close(): Promise<void> {
    const running = qr.value
    qr.value = null
    await api.devHold(false)
    if (running) await api.devQrCancel(running.id)
  }

  const connect = (address: string) => track(['connect'], async () => fail(await api.devConnect(address)))
  const pair = (address: string, code: string) => track(['connect'], async () => fail(await api.devPair(address, code)))
  const disconnect = (ids: string[]) => track(ids, async () => failBatch(await api.devDisconnect(ids)))
  const connectMany = (ids: string[]) => track(ids, async () => failBatch(await api.devConnectMany(ids)))
  const toWifi = (id: string) => track([id], async () => fail(await api.devToWifi(id)))
  const remove = (ids: string[]) => track(ids, async () => fail(await api.devRemove(ids)))
  const setAlias = (id: string, alias: string | null) => track([id], async () => fail(await api.devAlias(id, alias)))

  async function setAutoConnect(on: boolean): Promise<void> {
    const r = await api.devAutoConnect(on)
    if (r.ok) autoConnect.value = on
    else fail(r)
  }

  const discover = () =>
    track(['discover'], async () => {
      const r = await api.devDiscover()
      if (Array.isArray(r)) failBatch(r)
      else fail(r)
    })

  const startQr = () =>
    track(['qr'], async () => {
      const r = await api.devQrStart()
      if ('payload' in r) qr.value = { id: r.id, payload: r.payload, status: 'waiting' }
      else fail(r)
    })

  async function cancelQr(): Promise<void> {
    const running = qr.value
    if (!running) return
    qr.value = null
    await api.devQrCancel(running.id)
  }

  function toggle(id: string): void {
    const next = new Set(selected.value)
    if (!next.delete(id)) next.add(id)
    selected.value = next
  }

  function selectAll(on: boolean): void {
    selected.value = on ? new Set(devices.value.map((d) => d.id)) : new Set()
  }

  return {
    devices, adbFound, autoConnect, loaded, busy, selected, qr, lastError,
    selectedRows, selectedOnlineWifi, selectedOfflineWifi, selectedOffline,
    open, close, connect, pair, disconnect, connectMany, toWifi, remove, setAlias, setAutoConnect,
    discover, startQr, cancelQr, toggle, selectAll,
  }
})
