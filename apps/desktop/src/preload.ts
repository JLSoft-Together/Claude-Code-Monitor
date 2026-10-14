import { contextBridge, ipcRenderer } from 'electron'

// Sandboxed preload: only this narrow surface reaches the page. The main process re-checks the caller's origin.
contextBridge.exposeInMainWorld('ccmDesktop', {
  platform: process.platform,
  ptyEndpoint: (): Promise<unknown> => ipcRenderer.invoke('ccm:pty-endpoint'),
  pickFolder: (): Promise<unknown> => ipcRenderer.invoke('ccm:pick-folder'),
  logs: (action: 'copy' | 'save', report: string): Promise<unknown> => ipcRenderer.invoke('ccm:logs', action, report),
  /** Toast click: the page answers whether a workspace pane holds that session. */
  onFocus: (handler: (terminalId: string) => boolean): void => {
    ipcRenderer.on('ccm:focus', (_event, terminalId: unknown) => {
      ipcRenderer.send('ccm:focus-reply', typeof terminalId === 'string' && handler(terminalId))
    })
  },
  onSelect: (handler: (terminalId: string) => void): void => {
    ipcRenderer.on('ccm:select', (_event, terminalId: unknown) => {
      if (typeof terminalId === 'string') handler(terminalId)
    })
  },
})
