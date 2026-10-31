import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { capabilities } from '../shared/capabilities'
import type { AccountSummary, AppConfig, AuthMethod, ConfigPatch, Platform, Provider } from '../shared/types'
import { DEFAULT_AI_MAX_CHARS, DEFAULT_REVIEW_PROMPT, type AiConfig, type AiPatch } from '../shared/ai'

export type AuthState =
  | { type: 'pat'; token: string }
  | { type: 'oauth'; method: 'password' | 'web'; accessToken: string; refreshToken?: string; expiresAt?: number }

export interface StoredAccount {
  id: string
  provider: Provider
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  oauthClientId: string
  oauthSecret?: string
  auth?: string
  serverVersion?: string
  label?: string
  username?: string
}

interface StoredConfig {
  /** 全局偏好 */
  pollMinutes: number
  notify: boolean
  ai?: StoredAi
  git?: StoredGit
  accounts: StoredAccount[]
  activeAccountId?: string
  /** 旧版单账号字段，迁移后清除 */
  platform?: Platform
  baseUrl?: string
  ignoreTls?: boolean
  oauthClientId?: string
  oauthSecret?: string
  auth?: string
  serverVersion?: string
  tokenEnc?: string
}

export interface StoredGit {
  cloneDir?: string
  /** `${baseUrl}#${projectId}` -> 本地克隆路径；项目 ID 只在同一服务器内唯一 */
  clones?: Record<string, string>
  /** 最近一次 SSH 测试成功的 `${baseUrl}|${host}:${port}` */
  sshVerified?: string
  /** 最近一次本地仓库扫描的根目录 */
  scanDir?: string
}

interface StoredAi {
  baseUrl: string
  apiKey?: string
  model: string
  temperature: number | null
  /** 空字符串表示使用默认提示词 */
  systemPrompt: string
  ignoreTls: boolean
  maxChars: number
}

const aiDefaults: StoredAi = {
  baseUrl: '',
  model: '',
  temperature: null,
  systemPrompt: '',
  ignoreTls: false,
  maxChars: DEFAULT_AI_MAX_CHARS
}

const defaults: StoredConfig = {
  pollMinutes: 2,
  notify: true,
  accounts: []
}

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

function encrypt(value: string): string {
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(value).toString('base64')
    : 'raw:' + Buffer.from(value, 'utf8').toString('base64')
}

function decrypt(value?: string): string {
  if (!value) return ''
  try {
    if (value.startsWith('raw:')) return Buffer.from(value.slice(4), 'base64').toString('utf8')
    const data = value.startsWith('enc:') ? value.slice(4) : value
    return safeStorage.decryptString(Buffer.from(data, 'base64'))
  } catch {
    return ''
  }
}

function newId(): string {
  return randomBytes(8).toString('hex')
}

export function providerOf(platform: Platform): Provider {
  return platform === 'github' ? 'github' : 'gitlab'
}

function migrate(raw: StoredConfig): StoredConfig {
  if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
    return {
      pollMinutes: raw.pollMinutes ?? 2,
      notify: raw.notify ?? true,
      ai: raw.ai,
      git: raw.git,
      accounts: raw.accounts,
      activeAccountId: raw.activeAccountId || raw.accounts[0]?.id
    }
  }
  // 旧版单账号 → 一条 account
  if (raw.baseUrl || raw.auth || raw.tokenEnc) {
    const id = newId()
    const platform = raw.platform || 'gitlab'
    const account: StoredAccount = {
      id,
      provider: providerOf(platform),
      platform,
      baseUrl: (raw.baseUrl || '').replace(/\/+$/, ''),
      ignoreTls: Boolean(raw.ignoreTls),
      oauthClientId: raw.oauthClientId || '',
      oauthSecret: raw.oauthSecret,
      auth: raw.auth,
      serverVersion: raw.serverVersion
    }
    if (!account.auth && raw.tokenEnc) {
      const legacy = decrypt(raw.tokenEnc)
      if (legacy) account.auth = encrypt(JSON.stringify({ type: 'pat', token: legacy }))
    }
    return {
      pollMinutes: raw.pollMinutes ?? 2,
      notify: raw.notify ?? true,
      ai: raw.ai,
      git: raw.git,
      accounts: [account],
      activeAccountId: id
    }
  }
  return { ...defaults, ai: raw.ai, git: raw.git }
}

function read(): StoredConfig {
  try {
    if (existsSync(configFile())) {
      const raw = { ...defaults, ...JSON.parse(readFileSync(configFile(), 'utf8')) } as StoredConfig
      const migrated = migrate(raw)
      // 若发生迁移则落盘
      if (!Array.isArray((raw as StoredConfig).accounts) || (raw.accounts?.length ?? 0) === 0) {
        if (migrated.accounts.length) write(migrated)
      }
      return migrated
    }
  } catch {
    // corrupted
  }
  return { ...defaults }
}

function write(cfg: StoredConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  // 不再写旧字段
  const out: StoredConfig = {
    pollMinutes: cfg.pollMinutes,
    notify: cfg.notify,
    ai: cfg.ai,
    git: cfg.git,
    accounts: cfg.accounts,
    activeAccountId: cfg.activeAccountId
  }
  writeFileSync(configFile(), JSON.stringify(out, null, 2), 'utf8')
}

function activeAccount(s: StoredConfig = read()): StoredAccount | null {
  if (!s.accounts.length) return null
  return s.accounts.find((a) => a.id === s.activeAccountId) ?? s.accounts[0] ?? null
}

function parseAuth(enc?: string): AuthState | null {
  if (!enc) return null
  try {
    return JSON.parse(decrypt(enc)) as AuthState
  } catch {
    return null
  }
}

export function getAuth(): AuthState | null {
  return parseAuth(activeAccount()?.auth)
}

export function setAuth(auth: AuthState | null, serverVersion?: string, profile?: { label?: string; username?: string }): void {
  const s = read()
  let acc = activeAccount(s)
  if (!acc) {
    if (!auth) {
      write(s)
      return
    }
    // 登录时若尚无账号，由 upsertAccount 创建；这里兜底
    acc = {
      id: newId(),
      provider: 'gitlab',
      platform: 'gitlab',
      baseUrl: '',
      ignoreTls: false,
      oauthClientId: ''
    }
    s.accounts.push(acc)
    s.activeAccountId = acc.id
  }
  if (auth) acc.auth = encrypt(JSON.stringify(auth))
  else delete acc.auth
  if (serverVersion !== undefined) acc.serverVersion = serverVersion
  if (profile?.label !== undefined) acc.label = profile.label
  if (profile?.username !== undefined) acc.username = profile.username
  write(s)
}

/** 登录成功：按 provider+baseUrl 合并账号并设为当前 */
export function upsertLoggedInAccount(input: {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  oauthClientId?: string
  oauthSecret?: string
  auth: AuthState
  serverVersion?: string
  label: string
  username: string
}): void {
  const s = read()
  const baseUrl = input.baseUrl.replace(/\/+$/, '')
  const provider = providerOf(input.platform)
  let acc = s.accounts.find((a) => a.provider === provider && a.baseUrl === baseUrl)
  if (!acc) {
    acc = {
      id: newId(),
      provider,
      platform: input.platform,
      baseUrl,
      ignoreTls: input.ignoreTls,
      oauthClientId: input.oauthClientId || ''
    }
    s.accounts.push(acc)
  }
  acc.platform = input.platform
  acc.ignoreTls = input.ignoreTls
  if (input.oauthClientId !== undefined) acc.oauthClientId = input.oauthClientId
  if (input.oauthSecret) acc.oauthSecret = encrypt(input.oauthSecret)
  acc.auth = encrypt(JSON.stringify(input.auth))
  acc.serverVersion = input.serverVersion || ''
  acc.label = input.label
  acc.username = input.username
  s.activeAccountId = acc.id
  write(s)
}

export function switchAccount(id: string): AppConfig {
  const s = read()
  if (!s.accounts.some((a) => a.id === id)) throw new Error('账号不存在')
  s.activeAccountId = id
  write(s)
  return getConfig()
}

export function removeAccount(id: string): AppConfig {
  const s = read()
  s.accounts = s.accounts.filter((a) => a.id !== id)
  if (s.activeAccountId === id) {
    const next = s.accounts.find((a) => a.auth) ?? s.accounts[0]
    s.activeAccountId = next?.id
  }
  write(s)
  return getConfig()
}

export function getOAuthClient(): { clientId: string; clientSecret: string } {
  const acc = activeAccount()
  return { clientId: acc?.oauthClientId || '', clientSecret: decrypt(acc?.oauthSecret) }
}

export function getGitSettings(): StoredGit {
  return { ...read().git }
}

export function patchGitSettings(fn: (g: StoredGit) => void): void {
  const s = read()
  const g: StoredGit = { ...s.git }
  fn(g)
  s.git = g
  write(s)
}

export function normalizeAiBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
}

function readAi(): StoredAi {
  return { ...aiDefaults, ...read().ai }
}

export function getAiSettings(): StoredAi & { apiKey: string; systemPrompt: string } {
  const a = readAi()
  return { ...a, apiKey: decrypt(a.apiKey), systemPrompt: a.systemPrompt || DEFAULT_REVIEW_PROMPT }
}

function aiConfig(): AiConfig {
  const a = readAi()
  return {
    baseUrl: a.baseUrl,
    model: a.model,
    temperature: a.temperature,
    systemPrompt: a.systemPrompt || DEFAULT_REVIEW_PROMPT,
    ignoreTls: a.ignoreTls,
    maxChars: a.maxChars,
    hasApiKey: Boolean(a.apiKey),
    configured: Boolean(a.baseUrl && a.model)
  }
}

function patchAi(s: StoredConfig, patch: AiPatch): void {
  const a: StoredAi = { ...aiDefaults, ...s.ai }
  if (patch.baseUrl !== undefined) a.baseUrl = normalizeAiBaseUrl(patch.baseUrl)
  if (patch.model !== undefined) a.model = patch.model.trim()
  if (patch.temperature !== undefined) {
    a.temperature = patch.temperature === null ? null : Math.max(0, Math.min(2, patch.temperature))
  }
  if (patch.systemPrompt !== undefined) {
    a.systemPrompt = patch.systemPrompt.trim() === DEFAULT_REVIEW_PROMPT.trim() ? '' : patch.systemPrompt.trim()
  }
  if (patch.ignoreTls !== undefined) a.ignoreTls = patch.ignoreTls
  if (patch.maxChars !== undefined) {
    a.maxChars = Math.max(5000, Math.min(1_000_000, Math.round(patch.maxChars || DEFAULT_AI_MAX_CHARS)))
  }
  const key = patch.apiKey?.trim()
  if (key) a.apiKey = encrypt(key)
  else if (patch.clearApiKey) delete a.apiKey
  s.ai = a
}

function accountSummary(a: StoredAccount): AccountSummary {
  return {
    id: a.id,
    provider: a.provider,
    platform: a.platform,
    baseUrl: a.baseUrl,
    label: a.label || a.username || a.baseUrl || '未命名账号',
    username: a.username || '',
    loggedIn: Boolean(parseAuth(a.auth))
  }
}

export function getConfig(): AppConfig {
  const s = read()
  const acc = activeAccount(s)
  const auth = parseAuth(acc?.auth)
  const authMethod: AuthMethod | null = !auth ? null : auth.type === 'pat' ? 'token' : auth.method
  const platform = acc?.platform || 'gitlab'
  const provider = acc?.provider || providerOf(platform)
  return {
    platform,
    provider,
    baseUrl: acc?.baseUrl || '',
    ignoreTls: acc?.ignoreTls ?? false,
    pollMinutes: s.pollMinutes,
    notify: s.notify,
    oauthClientId: acc?.oauthClientId || '',
    hasOAuthSecret: Boolean(acc?.oauthSecret),
    loggedIn: auth !== null,
    authMethod,
    serverVersion: acc?.serverVersion ?? '',
    isJihu: platform === 'jihu' || platform === 'jihulab' || /-jh\b/i.test(acc?.serverVersion ?? ''),
    ai: aiConfig(),
    activeAccountId: acc?.id ?? null,
    accounts: s.accounts.map(accountSummary),
    capabilities: capabilities(provider)
  }
}

export function saveConfig(patch: ConfigPatch): AppConfig {
  const s = read()
  if (patch.pollMinutes !== undefined) s.pollMinutes = Math.max(1, Math.min(60, Math.round(patch.pollMinutes || 2)))
  if (patch.notify !== undefined) s.notify = patch.notify
  if (patch.ai) patchAi(s, patch.ai)

  let acc = activeAccount(s)
  // 登录页改服务器：更新当前账号字段；若还没有账号则创建草稿账号
  if (
    patch.platform !== undefined ||
    patch.baseUrl !== undefined ||
    patch.ignoreTls !== undefined ||
    patch.oauthClientId !== undefined ||
    patch.oauthSecret !== undefined ||
    patch.clearOAuthSecret
  ) {
    if (!acc) {
      acc = {
        id: newId(),
        provider: 'gitlab',
        platform: 'gitlab',
        baseUrl: '',
        ignoreTls: false,
        oauthClientId: ''
      }
      s.accounts.push(acc)
      s.activeAccountId = acc.id
    }
    if (patch.platform !== undefined) {
      acc.platform = patch.platform
      acc.provider = providerOf(patch.platform)
    }
    if (patch.baseUrl !== undefined) {
      const url = patch.baseUrl.trim().replace(/\/+$/, '')
      if (url !== acc.baseUrl) {
        delete acc.auth
        delete acc.serverVersion
        delete acc.label
        delete acc.username
      }
      acc.baseUrl = url
    }
    if (patch.ignoreTls !== undefined) acc.ignoreTls = patch.ignoreTls
    if (patch.oauthClientId !== undefined) acc.oauthClientId = patch.oauthClientId.trim()
    if (patch.oauthSecret !== undefined) {
      const secret = patch.oauthSecret.trim()
      if (secret) acc.oauthSecret = encrypt(secret)
      else if (patch.clearOAuthSecret) delete acc.oauthSecret
    }
  }

  write(s)
  return getConfig()
}
