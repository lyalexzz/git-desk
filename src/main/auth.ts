import { BrowserWindow, session } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { getAuth, getConfig, getOAuthClient, providerOf, setAuth, upsertLoggedInAccount, type AuthState } from './config'
import { githubApiRoot } from './github'
import { httpRequest, networkError, parseJson } from './http'
import type { LoginResult, Platform } from '../shared/types'

export const OAUTH_REDIRECT_URI = 'http://localhost/gitlab-desk/oauth/callback'
export const LOGIN_PARTITION = 'persist:gitlab-login'

export interface LoginServer {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  oauthClientId?: string
  oauthSecret?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  created_at?: number
}

type OAuthContext = 'password' | 'refresh' | 'code'

function oauthError(status: number, data: unknown, ctx: OAuthContext): string {
  const d = (typeof data === 'object' && data ? data : {}) as { error?: string; error_description?: string }
  switch (d.error) {
    case 'invalid_grant':
      if (ctx === 'password') {
        return '用户名或密码错误。如果账号开启了双因素认证，或使用 LDAP、手机号、单点登录，请改用“网页登录”'
      }
      return ctx === 'refresh' ? '登录已过期，请重新登录' : '授权码无效或已过期，请重新登录'
    case 'invalid_client':
      return '无法识别 OAuth 应用：请检查“高级设置”中的应用 ID 和密钥。GitLab 16.0 及以上版本用账号密码登录时必须填写'
    case 'unsupported_grant_type':
      return '该服务器不支持账号密码直接登录（新版本 GitLab 已移除），请使用“网页登录”或个人访问令牌'
    case 'invalid_scope':
      return 'OAuth 应用没有勾选 api 权限范围'
    case 'unauthorized_client':
      return 'OAuth 应用不允许使用这种登录方式'
    case 'invalid_request':
      return `登录请求无效：${d.error_description ?? ''}`
  }
  const detail = d.error_description ?? d.error ?? (typeof data === 'string' ? data.slice(0, 200) : '')
  return `登录失败（HTTP ${status}）${detail ? '：' + detail : ''}`
}

function resolveServer(server?: LoginServer): LoginServer {
  if (server?.baseUrl) {
    return {
      platform: server.platform,
      baseUrl: server.baseUrl.replace(/\/+$/, ''),
      ignoreTls: Boolean(server.ignoreTls),
      oauthClientId: server.oauthClientId,
      oauthSecret: server.oauthSecret
    }
  }
  const cfg = getConfig()
  return {
    platform: cfg.platform,
    baseUrl: cfg.baseUrl,
    ignoreTls: cfg.ignoreTls,
    oauthClientId: cfg.oauthClientId
  }
}

async function tokenRequest(params: Record<string, string>, ctx: OAuthContext, server: LoginServer): Promise<TokenResponse> {
  const { clientId, clientSecret } = getOAuthClient()
  const body = new URLSearchParams(params)
  const id = server.oauthClientId || clientId
  const secret = server.oauthSecret || clientSecret
  if (id) body.set('client_id', id)
  if (secret) body.set('client_secret', secret)

  let res
  try {
    res = await httpRequest(new URL(server.baseUrl + '/oauth/token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      ignoreTls: server.ignoreTls
    })
  } catch (e) {
    throw new Error(networkError(e as NodeJS.ErrnoException))
  }
  const data = parseJson(res)
  if (res.status >= 400 || !(data as TokenResponse)?.access_token) throw new Error(oauthError(res.status, data, ctx))
  return data as TokenResponse
}

function toAuth(t: TokenResponse, method: 'password' | 'web'): AuthState {
  const issued = t.created_at ? t.created_at * 1000 : Date.now()
  return {
    type: 'oauth',
    method,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? issued + t.expires_in * 1000 : undefined
  }
}

let refreshing: Promise<AuthState | null> | null = null

/** 刷新 OAuth 令牌；刷新令牌是一次性的，所以并发调用必须共用同一次刷新 */
export function refreshOAuth(): Promise<AuthState | null> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const auth = getAuth()
    if (auth?.type !== 'oauth' || !auth.refreshToken) return null
    try {
      const t = await tokenRequest(
        { grant_type: 'refresh_token', refresh_token: auth.refreshToken, redirect_uri: OAUTH_REDIRECT_URI },
        'refresh',
        resolveServer()
      )
      const next = toAuth(t, auth.method)
      setAuth(next)
      return next
    } catch {
      return null
    }
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** 返回可用的登录状态，OAuth 令牌快过期时先刷新 */
export async function getValidAuth(): Promise<AuthState | null> {
  const auth = getAuth()
  if (auth?.type === 'oauth' && auth.expiresAt && auth.expiresAt - 60_000 < Date.now()) {
    return (await refreshOAuth()) ?? auth
  }
  return auth
}

export function authHeaders(auth: AuthState): Record<string, string> {
  return auth.type === 'pat' ? { 'PRIVATE-TOKEN': auth.token } : { Authorization: `Bearer ${auth.accessToken}` }
}

/** 忽略证书只作用于当前主机；其它站点仍走系统校验。未开启时恢复默认 */
export function applyCertificatePolicy(ses: Electron.Session): void {
  const cfg = getConfig()
  if (!cfg.ignoreTls || !cfg.baseUrl) {
    ses.setCertificateVerifyProc(null)
    return
  }
  let host = ''
  try {
    host = new URL(cfg.baseUrl).hostname.toLowerCase()
  } catch {
    ses.setCertificateVerifyProc(null)
    return
  }
  ses.setCertificateVerifyProc((request, callback) => {
    callback(request.hostname.toLowerCase() === host ? 0 : -3)
  })
}

/** 用新的登录凭证调用 /user 校验，成功才写入 accounts */
async function finishLogin(auth: AuthState, server: LoginServer): Promise<LoginResult> {
  const provider = providerOf(server.platform)
  let apiRoot: string
  try {
    apiRoot = provider === 'github' ? githubApiRoot(server.baseUrl) : server.baseUrl + '/api/v4'
  } catch {
    return { ok: false, error: '服务器地址格式不正确' }
  }

  const headers: Record<string, string> =
    provider === 'github'
      ? {
          Authorization: `Bearer ${auth.type === 'pat' ? auth.token : auth.accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      : { ...authHeaders(auth), Accept: 'application/json' }

  const call = (path: string) =>
    httpRequest(new URL(apiRoot + path), {
      headers,
      ignoreTls: server.ignoreTls
    })

  try {
    const res = await call('/user')
    const raw = parseJson(res) as { name?: string | null; username?: string; login?: string; message?: string }
    if (res.status === 401) return { ok: false, error: '令牌无效、已过期或已被撤销' }
    if (res.status === 403) {
      return {
        ok: false,
        error: provider === 'github' ? '令牌权限不足，请确认勾选了 repo、read:user' : '令牌权限不足，请确认勾选了 api 权限范围'
      }
    }
    const username = raw.username || raw.login
    if (res.status >= 400 || !username) return { ok: false, error: `校验登录失败（HTTP ${res.status}）` }

    let version = ''
    if (provider === 'gitlab') {
      try {
        const v = parseJson(await call('/version')) as { version?: string }
        version = v?.version ?? ''
      } catch {
        // 版本号只用于展示
      }
    }

    const label = (raw.name || username).trim()
    upsertLoggedInAccount({
      platform: server.platform,
      baseUrl: server.baseUrl,
      ignoreTls: server.ignoreTls,
      oauthClientId: server.oauthClientId,
      oauthSecret: server.oauthSecret,
      auth,
      serverVersion: version,
      label,
      username
    })
    return { ok: true, user: { name: label, username } }
  } catch (e) {
    return { ok: false, error: networkError(e as NodeJS.ErrnoException) }
  }
}

function checkServer(server: LoginServer): string | null {
  if (!server.baseUrl) return '请先填写服务器地址'
  return null
}

export async function loginWithToken(token: string, serverInput?: LoginServer): Promise<LoginResult> {
  const server = resolveServer(serverInput)
  const err = checkServer(server)
  if (err) return { ok: false, error: err }
  if (!token.trim()) return { ok: false, error: '请填写访问令牌' }
  return finishLogin({ type: 'pat', token: token.trim() }, server)
}

export async function loginWithPassword(username: string, password: string, serverInput?: LoginServer): Promise<LoginResult> {
  const server = resolveServer(serverInput)
  const err = checkServer(server)
  if (err) return { ok: false, error: err }
  if (providerOf(server.platform) === 'github') {
    return { ok: false, error: 'GitHub 暂不支持账号密码登录，请使用个人访问令牌（PAT）' }
  }
  try {
    const t = await tokenRequest({ grant_type: 'password', username, password, scope: 'api' }, 'password', server)
    return finishLogin(toAuth(t, 'password'), server)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 弹出 GitLab 自带的登录页（支持双因素、LDAP、手机号等），授权码 + PKCE 换取令牌 */
export function loginWithWeb(parent: BrowserWindow | null, serverInput?: LoginServer): Promise<LoginResult> {
  const server = resolveServer(serverInput)
  const err = checkServer(server)
  if (err) return Promise.resolve({ ok: false, error: err })
  if (providerOf(server.platform) === 'github') {
    return Promise.resolve({ ok: false, error: 'GitHub 网页 OAuth 尚未接入，请使用个人访问令牌（PAT）' })
  }
  const { clientId } = getOAuthClient()
  const appId = server.oauthClientId || clientId
  if (!appId) {
    return Promise.resolve({ ok: false, error: '网页登录需要先在“高级设置”中填写 OAuth 应用 ID' })
  }

  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))
  const authUrl = new URL(server.baseUrl + '/oauth/authorize')
  authUrl.search = new URLSearchParams({
    client_id: appId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    state,
    scope: 'api',
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString()

  const ses = session.fromPartition(LOGIN_PARTITION)
  applyCertificatePolicy(ses)

  const win = new BrowserWindow({
    parent: parent ?? undefined,
    modal: Boolean(parent),
    width: 960,
    height: 780,
    title: 'Git 桌面端 · 登录',
    autoHideMenuBar: true,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.on('page-title-updated', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  return new Promise((resolve) => {
    let done = false
    let captured = false
    const finish = (r: LoginResult): void => {
      if (done) return
      done = true
      resolve(r)
      if (!win.isDestroyed()) win.close()
    }

    const intercept = (e: Electron.Event, url: string): void => {
      if (!url.startsWith(OAUTH_REDIRECT_URI)) return
      e.preventDefault()
      captured = true
      const u = new URL(url)
      if (u.searchParams.get('state') !== state) return finish({ ok: false, error: '登录状态校验失败，请重试' })
      const error = u.searchParams.get('error')
      if (error) {
        return finish({
          ok: false,
          error: error === 'access_denied' ? '你拒绝了授权' : `授权失败：${u.searchParams.get('error_description') ?? error}`
        })
      }
      const code = u.searchParams.get('code')
      if (!code) return finish({ ok: false, error: '没有拿到授权码' })
      win.hide()
      tokenRequest(
        { grant_type: 'authorization_code', code, redirect_uri: OAUTH_REDIRECT_URI, code_verifier: verifier },
        'code',
        server
      )
        .then((t) => finishLogin(toAuth(t, 'web'), server))
        .catch((e2: Error) => ({ ok: false as const, error: e2.message }))
        .then(finish)
    }

    win.webContents.on('will-redirect', intercept)
    win.webContents.on('will-navigate', intercept)
    win.on('closed', () => {
      if (!captured) finish({ ok: false, error: '登录窗口已关闭' })
    })
    win.loadURL(authUrl.toString()).catch((e: Error) => {
      if (!captured && !done && !/ERR_ABORTED/.test(e.message)) {
        finish({ ok: false, error: `无法打开登录页：${e.message}` })
      }
    })
  })
}

export async function logout(): Promise<void> {
  setAuth(null)
  await session.fromPartition(LOGIN_PARTITION).clearStorageData()
}
