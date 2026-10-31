import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { getConfig, saveConfig } from './config'
import { cancelAllGitlab, cancelGitlab, gitlabRequest } from './gitlab'
import { OAUTH_REDIRECT_URI, loginWithPassword, loginWithToken, loginWithWeb, logout } from './auth'
import { openPasswordPage } from './password'
import { resetNotifier, startNotifier, stopNotifier } from './notifier'
import { cancelAllChats, cancelChat, listModels, streamChat, testAi } from './ai'
import { killGitChildren, registerGitIpc } from './git'
import type { ApiRequest, ConfigPatch, LoginResult } from '../shared/types'
import type { AiChatRequest, AiConnection } from '../shared/ai'

let win: BrowserWindow | null = null

function openExternal(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    title: 'Git 桌面端',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const appUrl = process.env.ELECTRON_RENDERER_URL
    if (url.startsWith('file://') || (appUrl && url.startsWith(appUrl))) return
    e.preventDefault()
    openExternal(url)
  })
  win.on('closed', () => {
    win = null
    stopNotifier()
    cancelAllGitlab()
    cancelAllChats()
    killGitChildren()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.gitlabdesk.app')

    ipcMain.handle('config:get', () => getConfig())
    ipcMain.handle('config:save', (_e, patch: ConfigPatch) => {
      const cfg = saveConfig(patch)
      startNotifier(() => win)
      return cfg
    })

    const afterLogin = (r: LoginResult): LoginResult => {
      if (r.ok) {
        resetNotifier()
        startNotifier(() => win)
      }
      return r
    }
    ipcMain.handle('auth:token', async (_e, token: string) => afterLogin(await loginWithToken(token)))
    ipcMain.handle('auth:password', async (_e, username: string, password: string) =>
      afterLogin(await loginWithPassword(username, password))
    )
    ipcMain.handle('auth:web', async () => afterLogin(await loginWithWeb(win)))
    ipcMain.handle('auth:password-page', () => openPasswordPage(win))
    ipcMain.handle('auth:redirect-uri', () => OAUTH_REDIRECT_URI)
    ipcMain.handle('auth:logout', async () => {
      await logout()
      stopNotifier()
      resetNotifier()
      return getConfig()
    })
    ipcMain.handle('api:request', (e, req: ApiRequest) => {
      const id = req.requestId
      if (typeof id === 'number') {
        const wc = e.sender
        const onGone = (): void => cancelGitlab(id)
        wc.once('destroyed', onGone)
        return gitlabRequest(req).finally(() => {
          if (!wc.isDestroyed()) wc.removeListener('destroyed', onGone)
        })
      }
      return gitlabRequest(req)
    })
    ipcMain.on('api:cancel', (_e, id: number) => cancelGitlab(id))
    ipcMain.handle('shell:open', (_e, url: string) => openExternal(url))
    ipcMain.handle('ai:models', (_e, conn: AiConnection) => listModels(conn))
    ipcMain.handle('ai:test', (_e, conn: AiConnection) => testAi(conn))
    ipcMain.handle('ai:chat', (e, req: AiChatRequest) => {
      void streamChat(e.sender, req)
    })
    ipcMain.handle('ai:cancel', (_e, id: string) => cancelChat(id))
    registerGitIpc(() => win)

    createWindow()
    startNotifier(() => win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        startNotifier(() => win)
      }
    })
  })

  app.on('before-quit', () => {
    stopNotifier()
    cancelAllGitlab()
    cancelAllChats()
    killGitChildren()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
