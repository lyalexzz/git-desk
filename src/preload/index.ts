import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: DesktopApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (input) => ipcRenderer.invoke('config:save', input),
  logout: () => ipcRenderer.invoke('config:logout'),
  request: (req) => ipcRenderer.invoke('api:request', req),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  onNavigate: (cb) => subscribe('navigate', cb),
  onTodoCount: (cb) => subscribe('todos:count', cb)
}

contextBridge.exposeInMainWorld('desktop', api)
