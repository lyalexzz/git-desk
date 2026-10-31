import type { AiChatRequest, AiConfig, AiConnection, AiPatch, AiResult, AiStreamEvent } from './ai'

export type Platform = 'gitlab' | 'jihu' | 'jihulab' | 'gitlab_com'

/** token = 个人访问令牌，password = 账号密码，web = 网页登录 */
export type AuthMethod = 'token' | 'password' | 'web'

export interface AppConfig {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  pollMinutes: number
  notify: boolean
  oauthClientId: string
  hasOAuthSecret: boolean
  loggedIn: boolean
  authMethod: AuthMethod | null
  serverVersion: string
  isJihu: boolean
  ai: AiConfig
}

export interface ConfigPatch {
  platform?: Platform
  baseUrl?: string
  ignoreTls?: boolean
  pollMinutes?: number
  notify?: boolean
  oauthClientId?: string
  /** 留空表示不修改，除非 clearOAuthSecret 为 true */
  oauthSecret?: string
  clearOAuthSecret?: boolean
  ai?: AiPatch
}

export type LoginResult = { ok: true; user: { name: string; username: string } } | { ok: false; error: string }

export type QueryValue = string | number | boolean | undefined | null

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  raw?: boolean
}

export type ApiResult<T = unknown> =
  | { ok: true; data: T; total: number | null }
  | { ok: false; error: string; status: number }

export interface DesktopApi {
  getConfig(): Promise<AppConfig>
  saveConfig(patch: ConfigPatch): Promise<AppConfig>
  loginWithToken(token: string): Promise<LoginResult>
  loginWithPassword(username: string, password: string): Promise<LoginResult>
  loginWithWeb(): Promise<LoginResult>
  logout(): Promise<AppConfig>
  oauthRedirectUri(): Promise<string>
  request<T = unknown>(req: ApiRequest): Promise<ApiResult<T>>
  openExternal(url: string): Promise<void>
  onNavigate(cb: (path: string) => void): () => void
  onTodoCount(cb: (count: number) => void): () => void
  aiListModels(conn: AiConnection): Promise<AiResult<{ models: string[]; baseUrl: string }>>
  aiTest(conn: AiConnection): Promise<AiResult<string>>
  /** 开始流式对话，结果通过 onAiStream 按 id 推送 */
  aiChat(req: AiChatRequest): Promise<void>
  aiCancel(id: string): Promise<void>
  onAiStream(cb: (e: AiStreamEvent) => void): () => void
}
