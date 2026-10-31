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
  openPasswordPage: () => ipcRenderer.invoke('auth:password-page'),
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
  onAiStream: (cb) => subscribe('ai:stream', cb),
  gitEnv: (refresh) => ipcRenderer.invoke('git:env', refresh),
  sshStatus: () => ipcRenderer.invoke('ssh:status'),
  sshGenerate: (username) => ipcRenderer.invoke('ssh:generate', username),
  sshWriteConfig: () => ipcRenderer.invoke('ssh:write-config'),
  sshTest: () => ipcRenderer.invoke('ssh:test'),
  gitIdentity: () => ipcRenderer.invoke('git:identity'),
  gitSetIdentity: (id) => ipcRenderer.invoke('git:set-identity', id),
  gitCloneDir: () => ipcRenderer.invoke('git:clone-dir'),
  gitSetCloneDir: (dir) => ipcRenderer.invoke('git:set-clone-dir', dir),
  chooseDir: (defaultPath) => ipcRenderer.invoke('git:choose-dir', defaultPath),
  gitClone: (req) => ipcRenderer.invoke('git:clone', req),
  gitCancel: (id) => ipcRenderer.invoke('git:cancel', id),
  onCloneEvent: (cb) => subscribe('git:clone', cb),
  gitClones: () => ipcRenderer.invoke('git:clones'),
  gitForget: (projectId) => ipcRenderer.invoke('git:forget', projectId),
  gitOpen: (projectId, target) => ipcRenderer.invoke('git:open', projectId, target),
  gitPull: (projectId) => ipcRenderer.invoke('git:pull', projectId)
}

contextBridge.exposeInMainWorld('desktop', api)
