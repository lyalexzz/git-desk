import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { getConfig, saveConfig } from './config'
import { gitlabRequest } from './gitlab'
import { OAUTH_REDIRECT_URI, loginWithPassword, loginWithToken, loginWithWeb, logout } from './auth'
import { resetNotifier, startNotifier, stopNotifier } from './notifier'
import type { ApiRequest, ConfigPatch, LoginResult } from '../shared/types'

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
    title: 'GitLab 桌面版',
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
  win.on('closed', () => {
    win = null
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
    ipcMain.handle('auth:redirect-uri', () => OAUTH_REDIRECT_URI)
    ipcMain.handle('auth:logout', async () => {
      await logout()
      stopNotifier()
      resetNotifier()
      return getConfig()
    })
    ipcMain.handle('api:request', (_e, req: ApiRequest) => gitlabRequest(req))
    ipcMain.handle('shell:open', (_e, url: string) => openExternal(url))

    createWindow()
    startNotifier(() => win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
