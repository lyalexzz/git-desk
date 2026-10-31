import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { AppConfig, AuthMethod, ConfigPatch, Platform } from '../shared/types'
import { DEFAULT_AI_MAX_CHARS, DEFAULT_REVIEW_PROMPT, type AiConfig, type AiPatch } from '../shared/ai'

export type AuthState =
  | { type: 'pat'; token: string }
  | { type: 'oauth'; method: 'password' | 'web'; accessToken: string; refreshToken?: string; expiresAt?: number }

interface StoredConfig {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  pollMinutes: number
  notify: boolean
  oauthClientId: string
  oauthSecret?: string
  auth?: string
  serverVersion?: string
  /** 旧版本只保存了个人访问令牌 */
  tokenEnc?: string
  ai?: StoredAi
  git?: StoredGit
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
  platform: 'gitlab',
  baseUrl: '',
  ignoreTls: false,
  pollMinutes: 2,
  notify: true,
  oauthClientId: ''
}

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

function read(): StoredConfig {
  try {
    if (existsSync(configFile())) return { ...defaults, ...JSON.parse(readFileSync(configFile(), 'utf8')) }
  } catch {
    // corrupted file: fall back to defaults
  }
  return { ...defaults }
}

function write(cfg: StoredConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(cfg, null, 2), 'utf8')
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

export function getAuth(): AuthState | null {
  const s = read()
  if (s.auth) {
    try {
      return JSON.parse(decrypt(s.auth)) as AuthState
    } catch {
      return null
    }
  }
  const legacy = decrypt(s.tokenEnc)
  return legacy ? { type: 'pat', token: legacy } : null
}

export function setAuth(auth: AuthState | null, serverVersion?: string): void {
  const s = read()
  delete s.tokenEnc
  if (auth) s.auth = encrypt(JSON.stringify(auth))
  else delete s.auth
  if (serverVersion !== undefined) s.serverVersion = serverVersion
  write(s)
}

export function getOAuthClient(): { clientId: string; clientSecret: string } {
  const s = read()
  return { clientId: s.oauthClientId, clientSecret: decrypt(s.oauthSecret) }
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

export function getConfig(): AppConfig {
  const s = read()
  const auth = getAuth()
  const authMethod: AuthMethod | null = !auth ? null : auth.type === 'pat' ? 'token' : auth.method
  return {
    platform: s.platform,
    baseUrl: s.baseUrl,
    ignoreTls: s.ignoreTls,
    pollMinutes: s.pollMinutes,
    notify: s.notify,
    oauthClientId: s.oauthClientId,
    hasOAuthSecret: Boolean(s.oauthSecret),
    loggedIn: auth !== null,
    authMethod,
    serverVersion: s.serverVersion ?? '',
    isJihu: s.platform === 'jihu' || s.platform === 'jihulab' || /-jh\b/i.test(s.serverVersion ?? ''),
    ai: aiConfig()
  }
}

export function saveConfig(patch: ConfigPatch): AppConfig {
  const s = read()
  if (patch.platform !== undefined) s.platform = patch.platform
  if (patch.baseUrl !== undefined) {
    const url = patch.baseUrl.trim().replace(/\/+$/, '')
    if (url !== s.baseUrl) {
      delete s.auth
      delete s.tokenEnc
      delete s.serverVersion
    }
    s.baseUrl = url
  }
  if (patch.ignoreTls !== undefined) s.ignoreTls = patch.ignoreTls
  if (patch.notify !== undefined) s.notify = patch.notify
  if (patch.pollMinutes !== undefined) s.pollMinutes = Math.max(1, Math.min(60, Math.round(patch.pollMinutes || 2)))
  if (patch.oauthClientId !== undefined) s.oauthClientId = patch.oauthClientId.trim()
  if (patch.oauthSecret !== undefined) {
    const secret = patch.oauthSecret.trim()
    if (secret) s.oauthSecret = encrypt(secret)
    else if (patch.clearOAuthSecret) delete s.oauthSecret
  }
  if (patch.ai) patchAi(s, patch.ai)
  write(s)
  return getConfig()
}
