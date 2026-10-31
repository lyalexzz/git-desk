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

export const GIT_DOWNLOAD_URL = 'https://git-scm.com/download/win'
export const GIT_MIRROR_URL = 'https://registry.npmmirror.com/binary.html?path=git-for-windows/'
