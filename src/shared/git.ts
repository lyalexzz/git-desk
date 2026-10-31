export type GitResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface GitEnv {
  git: { path: string; version: string } | null
  ssh: string | null
  sshKeygen: string | null
  /** 可用于“用编辑器打开”的程序 */
  editors: { vscode: boolean; cursor: boolean }
  home: string
  sshDir: string
}

export interface SshTarget {
  host: string
  port: number
  user: string
}

export interface LocalKey {
  /** 公钥文件完整路径 */
  path: string
  name: string
  type: string
  /** 公钥文件完整内容（type base64 comment） */
  publicKey: string
  fingerprint: string
  comment: string
  /** 本软件为当前服务器生成的密钥 */
  app: boolean
}

export interface SshStatus {
  target: SshTarget
  keys: LocalKey[]
  /** 本软件为当前服务器准备的密钥路径（私钥），文件不一定存在 */
  appKeyPath: string
  configPath: string
  /** ~/.ssh/config 中已有本软件写入的配置块 */
  configured: boolean
  /** ~/.ssh/config 中还有其他（非本软件写入的）同名 Host 配置，可能覆盖本软件的设置 */
  conflict: boolean
  /** 最近一次测试连接成功的主机 */
  verified: boolean
  /** 本机计算机名，用于公钥标题 */
  computer: string
}

export interface GitIdentity {
  name: string
  email: string
}

export type CloneProtocol = 'ssh' | 'https'

export interface CloneRequest {
  id: string
  projectId: number
  protocol: CloneProtocol
  dir: string
  branch?: string
}

export type CloneEvent =
  | { type: 'progress'; id: string; stage: string; percent: number; overall: number; detail: string }
  | { type: 'log'; id: string; line: string }
  | { type: 'done'; id: string; dir: string; existing?: boolean }
  | { type: 'error'; id: string; error: string; log?: string }

export type OpenTarget = 'folder' | 'vscode' | 'cursor' | 'terminal'

/** 单个文件的 index/worktree 状态（git status --porcelain 字母） */
export interface GitFileStatus {
  path: string
  /** 索引区状态，空格表示未暂存变更 */
  index: string
  /** 工作区状态 */
  worktree: string
  /** 重命名时的原路径 */
  from?: string
}

export interface GitRepoStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: GitFileStatus[]
  dirty: boolean
}

export interface GitLocalBranch {
  name: string
  current: boolean
}

export type LocalDiffStaged = 'worktree' | 'staged'

export interface LocalDiffRequest {
  projectId: number
  /** worktree = git diff；staged = git diff --cached */
  staged?: LocalDiffStaged
  path?: string
}

export interface GitLocalCommit {
  id: string
  shortId: string
  subject: string
  body: string
  authorName: string
  authorEmail: string
  date: string
  parents: string[]
}

export interface LocalLogRequest {
  projectId: number
  /** 分支名或 HEAD；默认当前分支 */
  ref?: string
  skip?: number
  limit?: number
}

export interface LocalShowRequest {
  projectId: number
  sha: string
}

/** 扫描到的本地 Git 仓库，以及与当前服务器项目的匹配结果 */
export interface ScannedRepo {
  dir: string
  name: string
  remote: string | null
  branch: string | null
  /** 匹配到的 GitLab 项目；未匹配则为 null */
  projectId: number | null
  projectName: string | null
  /** 已写入本地克隆记录 */
  linked: boolean
}

export interface ScanResult {
  root: string
  repos: ScannedRepo[]
  matched: number
  unmatched: number
  linked: number
  truncated: boolean
}

export const GIT_DOWNLOAD_URL = 'https://git-scm.com/download/win'
export const GIT_MIRROR_URL = 'https://registry.npmmirror.com/binary.html?path=git-for-windows/'
