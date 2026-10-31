import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: DesktopApi = {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (patch) => ipcRenderer.invoke('config:save', patch),
  loginWithToken: (token) => ipcRenderer.invoke('auth:token', token),
  loginWithPassword: (username, password) => ipcRenderer.invoke('auth:password', username, password),
  loginWithWeb: () => ipcRenderer.invoke('auth:web'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  oauthRedirectUri: () => ipcRenderer.invoke('auth:redirect-uri'),
  request: (req) => ipcRenderer.invoke('api:request', req),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  onNavigate: (cb) => subscribe('navigate', cb),
  onTodoCount: (cb) => subscribe('todos:count', cb),
  aiListModels: (conn) => ipcRenderer.invoke('ai:models', conn),
  aiTest: (conn) => ipcRenderer.invoke('ai:test', conn),
  aiChat: (req) => ipcRenderer.invoke('ai:chat', req),
  aiCancel: (id) => ipcRenderer.invoke('ai:cancel', id),
  onAiStream: (cb) => subscribe('ai:stream', cb)
}

contextBridge.exposeInMainWorld('desktop', api)
