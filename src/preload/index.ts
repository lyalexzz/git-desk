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
  loginWithToken: (token, server) => ipcRenderer.invoke('auth:token', token, server),
  loginWithPassword: (username, password, server) => ipcRenderer.invoke('auth:password', username, password, server),
  loginWithWeb: (server) => ipcRenderer.invoke('auth:web', server),
  openPasswordPage: () => ipcRenderer.invoke('auth:password-page'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  switchAccount: (id) => ipcRenderer.invoke('accounts:switch', id),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  oauthRedirectUri: () => ipcRenderer.invoke('auth:redirect-uri'),
  request: (req) => ipcRenderer.invoke('api:request', req),
  cancelRequest: (id) => ipcRenderer.send('api:cancel', id),
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
  gitPull: (projectId) => ipcRenderer.invoke('git:pull', projectId),
  gitStatus: (projectId) => ipcRenderer.invoke('git:status', projectId),
  gitStage: (projectId, paths) => ipcRenderer.invoke('git:stage', projectId, paths),
  gitUnstage: (projectId, paths) => ipcRenderer.invoke('git:unstage', projectId, paths),
  gitCommit: (projectId, message) => ipcRenderer.invoke('git:commit', projectId, message),
  gitPush: (projectId) => ipcRenderer.invoke('git:push', projectId),
  gitBranches: (projectId) => ipcRenderer.invoke('git:branches', projectId),
  gitCheckout: (projectId, branch) => ipcRenderer.invoke('git:checkout', projectId, branch),
  gitDiff: (req) => ipcRenderer.invoke('git:diff', req),
  gitLog: (req) => ipcRenderer.invoke('git:log', req),
  gitShow: (req) => ipcRenderer.invoke('git:show', req),
  gitScan: (root) => ipcRenderer.invoke('git:scan', root),
  gitScanDir: () => ipcRenderer.invoke('git:scan-dir'),
  gitLink: (projectId, dir) => ipcRenderer.invoke('git:link', projectId, dir),
  gitOpenPath: (dir, target) => ipcRenderer.invoke('git:open-path', dir, target)
}

contextBridge.exposeInMainWorld('desktop', api)
