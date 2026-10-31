import { BrowserWindow, session } from 'electron'
import { getConfig } from './config'
import { LOGIN_PARTITION, applyCertificatePolicy } from './auth'
import type { PasswordPageResult } from '../shared/types'

/** 新版在前；17.x 以前是 /-/profile/password/edit */
const EDIT_PATHS = ['/-/user_settings/password/edit', '/-/profile/password/edit']
const isPasswordPage = (path: string) => /\/(user_settings|profile)\/password(\/|$)/.test(path)
const isPasswordSubmit = (path: string) => /\/(user_settings|profile)\/password$/.test(path)

/** 在应用内打开 GitLab 自带的修改密码页，复用网页登录的会话；改成功后 GitLab 会跳到登录页或首页 */
export function openPasswordPage(parent: BrowserWindow | null): Promise<PasswordPageResult> {
  const cfg = getConfig()
  if (!cfg.baseUrl) return Promise.resolve({ ok: false, error: '请先填写 GitLab 服务器地址' })
  const base = new URL(cfg.baseUrl)
  const prefix = base.pathname.replace(/\/$/, '')

  const ses = session.fromPartition(LOGIN_PARTITION)
  applyCertificatePolicy(ses)

  const title = `修改${cfg.isJihu ? '极狐 GitLab' : ' GitLab'} 密码 —— 未登录时请先登录；保存成功后窗口会自动关闭`
  const win = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: 960,
    height: 780,
    title,
    autoHideMenuBar: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('page-title-updated', (e) => e.preventDefault())

  return new Promise((resolve) => {
    let done = false
    let submitted = false
    let attempt = 0
    const finish = (r: PasswordPageResult): void => {
      if (done) return
      done = true
      ses.webRequest.onBeforeRequest(null)
      resolve(r)
      if (!win.isDestroyed()) win.close()
    }

    // 表单是 POST + _method=put，导航事件里拿不到请求方法，只能在网络层记下“已提交”
    ses.webRequest.onBeforeRequest({ urls: [`${base.origin}/*`] }, (d, cb) => {
      if (d.method === 'POST' && d.resourceType === 'mainFrame' && isPasswordSubmit(new URL(d.url).pathname)) {
        submitted = true
      }
      cb({})
    })

    const load = (): void => {
      win.loadURL(base.origin + prefix + EDIT_PATHS[attempt]).catch((e: Error) => {
        if (!done && !/ERR_ABORTED/.test(e.message)) finish({ ok: false, error: `无法打开修改密码页面：${e.message}` })
      })
    }

    win.webContents.on('did-navigate', (_e, url, code) => {
      const path = new URL(url).pathname
      if (submitted && code < 400 && !isPasswordPage(path)) return finish({ ok: true })
      submitted = false
      if (code === 404 && isPasswordPage(path)) {
        if (++attempt < EDIT_PATHS.length) return load()
        finish({
          ok: false,
          error: '该账号不能在 GitLab 中修改密码：账号由 LDAP/单点登录管理，或管理员关闭了密码登录。请到公司统一身份系统修改。'
        })
      }
    })
    win.on('closed', () => finish({ ok: false, cancelled: true, error: '窗口已关闭' }))
    load()
  })
}
