import type { AiChatRequest, AiConfig, AiConnection, AiPatch, AiResult, AiStreamEvent } from './ai'
import type { Capabilities } from './capabilities'
import type {
  CloneEvent,
  CloneRequest,
  GitEnv,
  GitIdentity,
  GitLocalBranch,
  GitRepoStatus,
  GitResult,
  GitLocalCommit,
  LocalDiffRequest,
  LocalLogRequest,
  LocalKey,
  LocalShowRequest,
  OpenTarget,
  ScanResult,
  SshStatus
} from './git'

export type Provider = 'gitlab' | 'github'

export type Platform = 'gitlab' | 'jihu' | 'jihulab' | 'gitlab_com' | 'github'

/** token = 个人访问令牌，password = 账号密码，web = 网页登录 */
export type AuthMethod = 'token' | 'password' | 'web'

export interface AccountSummary {
  id: string
  provider: Provider
  platform: Platform
  baseUrl: string
  label: string
  username: string
  loggedIn: boolean
}

export interface AppConfig {
  platform: Platform
  provider: Provider
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
  activeAccountId: string | null
  accounts: AccountSummary[]
  capabilities: Capabilities
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

/** 登录时传入的服务器信息（多账号下不先改写当前会话） */
export interface LoginServer {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  oauthClientId?: string
  oauthSecret?: string
}

export type PasswordPageResult = { ok: true } | { ok: false; error: string; cancelled?: boolean }

export type QueryValue = string | number | boolean | undefined | null

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, QueryValue>
  body?: unknown
  raw?: boolean
  /** 渲染进程用来取消这一次请求 */
  requestId?: number
}

export type ApiResult<T = unknown> =
  | { ok: true; data: T; total: number | null }
  | { ok: false; error: string; status: number }

export interface DesktopApi {
  getConfig(): Promise<AppConfig>
  saveConfig(patch: ConfigPatch): Promise<AppConfig>
  loginWithToken(token: string, server?: LoginServer): Promise<LoginResult>
  loginWithPassword(username: string, password: string, server?: LoginServer): Promise<LoginResult>
  loginWithWeb(server?: LoginServer): Promise<LoginResult>
  /** 在应用内打开 GitLab 网页的修改密码页 */
  openPasswordPage(): Promise<PasswordPageResult>
  logout(): Promise<AppConfig>
  /** 切换已保存的账号会话 */
  switchAccount(id: string): Promise<AppConfig>
  removeAccount(id: string): Promise<AppConfig>
  oauthRedirectUri(): Promise<string>
  request<T = unknown>(req: ApiRequest): Promise<ApiResult<T>>
  cancelRequest(id: number): void
  openExternal(url: string): Promise<void>
  onNavigate(cb: (path: string) => void): () => void
  onTodoCount(cb: (count: number) => void): () => void
  aiListModels(conn: AiConnection): Promise<AiResult<{ models: string[]; baseUrl: string }>>
  aiTest(conn: AiConnection): Promise<AiResult<string>>
  /** 开始流式对话，结果通过 onAiStream 按 id 推送 */
  aiChat(req: AiChatRequest): Promise<void>
  aiCancel(id: string): Promise<void>
  onAiStream(cb: (e: AiStreamEvent) => void): () => void
  gitEnv(refresh?: boolean): Promise<GitEnv>
  sshStatus(): Promise<GitResult<SshStatus>>
  /** 为当前服务器生成专用密钥；已存在时直接返回，不会覆盖 */
  sshGenerate(username: string): Promise<GitResult<{ key: LocalKey; created: boolean; warning?: string }>>
  sshWriteConfig(): Promise<GitResult<{ path: string; backup?: string; conflict: boolean }>>
  sshTest(): Promise<GitResult<string>>
  gitIdentity(): Promise<GitResult<GitIdentity>>
  gitSetIdentity(id: GitIdentity): Promise<GitResult<GitIdentity>>
  gitCloneDir(): Promise<string>
  gitSetCloneDir(dir: string): Promise<GitResult<string>>
  chooseDir(defaultPath?: string): Promise<string | null>
  /** 开始克隆，进度通过 onCloneEvent 按 id 推送 */
  gitClone(req: CloneRequest): Promise<void>
  gitCancel(id: string): Promise<void>
  onCloneEvent(cb: (e: CloneEvent) => void): () => void
  /** 当前服务器下已记录的本地克隆：项目 ID -> 路径 */
  gitClones(): Promise<Record<number, string>>
  gitForget(projectId: number): Promise<void>
  gitOpen(projectId: number, target: OpenTarget): Promise<GitResult<null>>
  gitPull(projectId: number): Promise<GitResult<string>>
  gitStatus(projectId: number): Promise<GitResult<GitRepoStatus>>
  gitStage(projectId: number, paths: string[]): Promise<GitResult<null>>
  gitUnstage(projectId: number, paths: string[]): Promise<GitResult<null>>
  gitCommit(projectId: number, message: string): Promise<GitResult<string>>
  gitPush(projectId: number): Promise<GitResult<string>>
  gitBranches(projectId: number): Promise<GitResult<GitLocalBranch[]>>
  gitCheckout(projectId: number, branch: string): Promise<GitResult<string>>
  gitDiff(req: LocalDiffRequest): Promise<GitResult<string>>
  gitLog(req: LocalLogRequest): Promise<GitResult<GitLocalCommit[]>>
  /** 单个提交的说明 + patch */
  gitShow(req: LocalShowRequest): Promise<GitResult<{ commit: GitLocalCommit; diff: string }>>
  /** 扫描本地目录下的 Git 仓库，并按 origin 与当前服务器项目匹配；匹配成功会自动写入克隆记录 */
  gitScan(root: string): Promise<GitResult<ScanResult>>
  gitScanDir(): Promise<string | null>
  /** 手动把本地路径关联到项目（会校验 origin） */
  gitLink(projectId: number, dir: string): Promise<GitResult<null>>
  /** 直接打开任意本地路径（未匹配仓库也可用） */
  gitOpenPath(dir: string, target: OpenTarget): Promise<GitResult<null>>
}
