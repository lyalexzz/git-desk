import { dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path'
import { getConfig, getGitSettings, patchGitSettings } from './config'
import { getValidAuth } from './auth'
import { gitlabRequest } from './gitlab'
import {
  fingerprint,
  generateEd25519,
  hasForeignHost,
  hasOwnBlock,
  mergeSshConfig,
  parseProgress,
  parsePublicKey,
  parseSshUrl,
  safeHostName,
  sameKey,
  sshConfigBlock,
  validTarget
} from './sshkey'
import type {
  CloneEvent,
  CloneRequest,
  GitEnv,
  GitIdentity,
  GitResult,
  LocalKey,
  OpenTarget,
  SshStatus,
  SshTarget
} from '../shared/git'

const isWin = process.platform === 'win32'
const sshDir = (): string => join(homedir(), '.ssh')
const sshConfigPath = (): string => join(sshDir(), 'config')

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  error?: NodeJS.ErrnoException
  timedOut?: boolean
}

function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(ELECTRON_|VSCODE_)/i.test(k)) env[k] = v
  }
  // Git 自带的 ssh（MSYS）在没有 HOME 时可能找不到 ~/.ssh
  if (!env.HOME) env.HOME = homedir()
  return { ...env, ...extra }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else child.kill('SIGTERM')
}

const live = new Set<ChildProcess>()

function watch(child: ChildProcess): void {
  live.add(child)
  const drop = (): void => {
    live.delete(child)
  }
  child.once('exit', drop)
  child.once('error', drop)
}

function run(cmd: string, args: string[], opts: { timeout?: number; env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<RunResult> {
  return new Promise((done) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { windowsHide: true, env: opts.env ?? childEnv(), cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    watch(child)
    } catch (e) {
      done({ code: null, stdout, stderr, error: e as NodeJS.ErrnoException })
      return
    }
    const timer = opts.timeout
      ? setTimeout(() => {
          timedOut = true
          killTree(child)
        }, opts.timeout)
      : null
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')))
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')))
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer)
      done({ code: null, stdout, stderr, error })
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      done({ code, stdout, stderr, timedOut })
    })
  })
}

async function which(name: string): Promise<string[]> {
  const r = await run(isWin ? 'where.exe' : 'which', [name], { timeout: 5000 })
  return r.code === 0 ? r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []
}

// ---------- 环境检测 ----------

let envCache: Promise<GitEnv & { editorPaths: Partial<Record<'vscode' | 'cursor', string>> }> | null = null

async function findGit(): Promise<{ path: string; version: string } | null> {
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    ...(await which('git')),
    join(pf, 'Git', 'cmd', 'git.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Git', 'cmd', 'git.exe'),
    'D:\\Program Files\\Git\\cmd\\git.exe'
  ]
  for (const path of [...new Set(candidates)]) {
    if (isAbsolute(path) && !existsSync(path)) continue
    const r = await run(path, ['--version'], { timeout: 10_000 })
    const m = /git version (\S+)/.exec(r.stdout)
    if (r.code === 0 && m) return { path, version: m[1] }
  }
  return null
}

/** Git for Windows 目录下的 usr\bin（自带 ssh / ssh-keygen） */
function gitUsrBin(gitPath: string): string | null {
  let d = dirname(gitPath)
  for (let i = 0; i < 3; i++) {
    if (existsSync(join(d, 'usr', 'bin'))) return join(d, 'usr', 'bin')
    d = dirname(d)
  }
  return null
}

async function findTool(name: 'ssh' | 'ssh-keygen', gitPath?: string): Promise<string | null> {
  const exe = isWin ? name + '.exe' : name
  const usr = gitPath ? gitUsrBin(gitPath) : null
  const candidates = [
    ...(usr ? [join(usr, exe)] : []),
    join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'OpenSSH', exe),
    ...(await which(name))
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

async function findEditor(kind: 'vscode' | 'cursor'): Promise<string | null> {
  const local = process.env.LOCALAPPDATA ?? ''
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
  if (!isWin) return (await which(kind === 'vscode' ? 'code' : 'cursor'))[0] ?? null
  const exe = kind === 'vscode' ? 'Code.exe' : 'Cursor.exe'
  // PATH 里的 code / cursor 是 .cmd 脚本，不经过 shell 无法直接启动，所以找到对应的 exe
  for (const line of await which(kind === 'vscode' ? 'code' : 'cursor')) {
    let d = dirname(line)
    for (let i = 0; i < 4; i++) {
      d = dirname(d)
      if (existsSync(join(d, exe))) return join(d, exe)
    }
  }
  const fixed =
    kind === 'vscode'
      ? [join(local, 'Programs', 'Microsoft VS Code', exe), join(pf, 'Microsoft VS Code', exe)]
      : [join(local, 'Programs', 'cursor', exe), join(pf, 'Cursor', exe)]
  return fixed.find((p) => existsSync(p)) ?? null
}

function detect(refresh = false) {
  if (!envCache || refresh) {
    envCache = (async () => {
      const git = await findGit()
      const [ssh, sshKeygen, vscode, cursor] = await Promise.all([
        findTool('ssh', git?.path),
        findTool('ssh-keygen', git?.path),
        findEditor('vscode'),
        findEditor('cursor')
      ])
      return {
        git,
        ssh,
        sshKeygen,
        editors: { vscode: Boolean(vscode), cursor: Boolean(cursor) },
        editorPaths: { vscode: vscode ?? undefined, cursor: cursor ?? undefined },
        home: homedir(),
        sshDir: sshDir()
      }
    })()
  }
  return envCache
}

async function gitEnv(refresh?: boolean): Promise<GitEnv> {
  const e = await detect(refresh)
  return { git: e.git, ssh: e.ssh, sshKeygen: e.sshKeygen, editors: e.editors, home: e.home, sshDir: e.sshDir }
}

async function requireGit(): Promise<string> {
  const env = await detect()
  if (!env.git) throw new Error('没有检测到 Git，请先安装 Git for Windows，安装后点击「重新检测」')
  return env.git.path
}

// ---------- SSH ----------

let targetCache: { baseUrl: string; target: SshTarget } | null = null

async function sshTarget(): Promise<SshTarget> {
  const cfg = getConfig()
  if (targetCache?.baseUrl === cfg.baseUrl) return targetCache.target
  for (const membership of [true, false]) {
    const r = await gitlabRequest<{ ssh_url_to_repo?: string }[]>({
      path: '/projects',
      query: { per_page: 1, simple: true, membership: membership || undefined }
    })
    const url = r.ok ? r.data[0]?.ssh_url_to_repo : undefined
    const t = url ? parseSshUrl(url) : null
    if (t && validTarget(t)) {
      targetCache = { baseUrl: cfg.baseUrl, target: t }
      return t
    }
  }
  return { host: new URL(cfg.baseUrl).hostname, port: 22, user: 'git' }
}

function appKeyPath(t: SshTarget): string {
  return join(sshDir(), `gitlab_desk_${safeHostName(t.host)}_ed25519`)
}

function verifiedKey(t: SshTarget): string {
  return `${getConfig().baseUrl}|${t.host}:${t.port}`
}

function readSshConfig(): string {
  if (!existsSync(sshConfigPath())) return ''
  // 按字节读写，避免破坏文件里非 UTF-8（如 GBK）的注释
  return readFileSync(sshConfigPath()).toString('latin1').replace(/^\xEF\xBB\xBF/, '\uFEFF')
}

function readKey(pubPath: string, appPath: string): LocalKey | null {
  try {
    const text = readFileSync(pubPath, 'utf8')
    const k = parsePublicKey(text)
    if (!k) return null
    return {
      path: pubPath,
      name: basename(pubPath),
      type: k.type,
      publicKey: `${k.type} ${k.blob}${k.comment ? ' ' + k.comment : ''}`,
      fingerprint: fingerprint(k.blob),
      comment: k.comment,
      app: resolve(pubPath).toLowerCase() === resolve(appPath + '.pub').toLowerCase()
    }
  } catch {
    return null
  }
}

async function sshStatus(): Promise<SshStatus> {
  const target = await sshTarget()
  const appPath = appKeyPath(target)
  let names: string[] = []
  try {
    names = readdirSync(sshDir()).filter((n) => n.toLowerCase().endsWith('.pub'))
  } catch {
    // ~/.ssh 不存在
  }
  const keys = names
    .slice(0, 50)
    .map((n) => readKey(join(sshDir(), n), appPath))
    .filter((k): k is LocalKey => k !== null)
    .sort((a, b) => Number(b.app) - Number(a.app) || a.name.localeCompare(b.name))
  const content = readSshConfig()
  return {
    target,
    keys,
    appKeyPath: appPath,
    configPath: sshConfigPath(),
    configured: hasOwnBlock(content, target.host),
    conflict: hasForeignHost(content, target.host),
    verified: getGitSettings().sshVerified === verifiedKey(target),
    computer: hostname()
  }
}

/** Windows 版 OpenSSH 拒绝使用其他用户可读的私钥，需要去掉继承的权限 */
async function restrictAcl(path: string): Promise<boolean> {
  if (!isWin) return true
  const users = [
    process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : '',
    userInfo().username
  ].filter(Boolean)
  for (const u of users) {
    const r = await run('icacls', [path, '/inheritance:r', '/grant:r', `${u}:F`], { timeout: 10_000 })
    if (r.code === 0) return true
  }
  return false
}

async function generateKey(username: string): Promise<GitResult<{ key: LocalKey; created: boolean; warning?: string }>> {
  const target = await sshTarget()
  const path = appKeyPath(target)
  const env = await detect()
  const existing = existsSync(path) && existsSync(path + '.pub') ? readKey(path + '.pub', path) : null
  if (existing) return { ok: true, data: { key: existing, created: false } }
  if (existsSync(path) || existsSync(path + '.pub')) {
    return { ok: false, error: `密钥文件不完整：${path}（缺少公钥或私钥）。为避免覆盖，请手动删除或改名后重试` }
  }
  mkdirSync(sshDir(), { recursive: true })
  const comment = `${/^[\w.-]{1,100}$/.test(username) ? username : 'user'}@gitlab-desk`

  let generated = false
  if (env.sshKeygen) {
    const r = await run(env.sshKeygen, ['-t', 'ed25519', '-N', '', '-C', comment, '-f', path, '-q'], { timeout: 30_000 })
    generated = r.code === 0 && existsSync(path) && existsSync(path + '.pub')
  }
  if (!generated) {
    if (existsSync(path) || existsSync(path + '.pub')) {
      return { ok: false, error: 'ssh-keygen 生成密钥失败，且留下了不完整的文件：' + path }
    }
    const k = generateEd25519(comment)
    writeFileSync(path, k.privateKey, { flag: 'wx', mode: 0o600 })
    writeFileSync(path + '.pub', k.publicKey, { flag: 'wx', mode: 0o644 })
  }

  const aclOk = await restrictAcl(path)
  const key = readKey(path + '.pub', path)
  if (!key) return { ok: false, error: '读取生成的公钥失败：' + path + '.pub' }
  if (env.sshKeygen) {
    const check = await run(env.sshKeygen, ['-y', '-f', path], { timeout: 10_000 })
    if (check.code === 0 && !sameKey(check.stdout, key.publicKey)) {
      return { ok: false, error: '生成的私钥与公钥不匹配，请删除后重试：' + path }
    }
  }
  return {
    ok: true,
    data: { key, created: true, warning: aclOk ? undefined : '未能收紧私钥文件权限，Windows 自带的 ssh 可能拒绝使用该密钥' }
  }
}

function identityFileValue(path: string): string {
  const dir = sshDir()
  if (dirname(path).toLowerCase() === dir.toLowerCase()) return `~/.ssh/${basename(path)}`
  return path.replace(/\\/g, '/')
}

async function writeSshConfig(): Promise<GitResult<{ path: string; backup?: string; conflict: boolean }>> {
  const target = await sshTarget()
  if (!validTarget(target)) return { ok: false, error: `无法识别 SSH 地址：${target.user}@${target.host}:${target.port}` }
  const key = appKeyPath(target)
  if (!existsSync(key)) return { ok: false, error: '请先生成密钥' }
  const file = sshConfigPath()
  try {
    mkdirSync(sshDir(), { recursive: true })
    const content = readSshConfig()
    let backup: string | undefined
    if (existsSync(file) && !hasOwnBlock(content, target.host)) {
      backup = file + '.gitlab-desk.bak'
      if (existsSync(backup)) backup = `${file}.gitlab-desk-${Date.now()}.bak`
      copyFileSync(file, backup, constants.COPYFILE_EXCL)
    }
    const next = mergeSshConfig(content, sshConfigBlock(target, identityFileValue(key)), target.host)
    if (next !== content) writeFileSync(file, Buffer.from(next.replace(/^\uFEFF/, '\xEF\xBB\xBF'), 'latin1'))
    return { ok: true, data: { path: file, backup, conflict: hasForeignHost(next, target.host) } }
  } catch (e) {
    return { ok: false, error: `写入 ${file} 失败：${(e as Error).message}` }
  }
}

function sshExplain(out: string, t: SshTarget): string {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(out)) {
    return `服务器 ${t.host} 的主机指纹与本机记录（~/.ssh/known_hosts）不一致。如果服务器最近重装或迁移过，请向管理员确认后删除 known_hosts 中该主机的旧记录；否则可能存在网络劫持，请勿继续。`
  }
  if (/UNPROTECTED PRIVATE KEY|bad permissions/i.test(out)) {
    return '私钥文件权限过宽，ssh 拒绝使用。请重新点击「一键配置 SSH」或手动收紧私钥文件的访问权限。'
  }
  if (/Bad owner or permissions on/i.test(out)) return `ssh 配置文件权限不正确：${sshConfigPath()}`
  if (/Permission denied \(publickey/i.test(out)) {
    return '服务器拒绝了密钥：公钥还没有添加到当前 GitLab 账号（或添加到了别的账号）。请点击「一键配置 SSH」，或确认下方密钥显示「已添加」。'
  }
  if (/Could not resolve hostname/i.test(out)) return `找不到主机 ${t.host}，请检查网络或 DNS。`
  if (/Connection refused/i.test(out)) {
    return `${t.host} 的 ${t.port} 端口拒绝连接：服务器可能没有开放 SSH，请改用 HTTPS 拉取代码。`
  }
  if (/timed out|Operation timed out|Connection timed out/i.test(out)) {
    return `连接 ${t.host}:${t.port} 超时：公司网络或防火墙可能屏蔽了 SSH 端口，或服务器只开放了 HTTPS。可以改用 HTTPS 拉取代码。`
  }
  if (/Connection (closed|reset)/i.test(out)) return `连接被 ${t.host} 关闭：可能是网络代理或防火墙拦截了 SSH。`
  const tail = out.trim().split(/\r?\n/).slice(-3).join('\n')
  return `SSH 连接失败${tail ? '：' + tail : ''}`
}

/** 与 GIT_SSH_COMMAND 保持一致：配置文件里没有本软件的配置块时直接指定密钥 */
function identityArgs(status: SshStatus): string[] {
  if (status.configured || !existsSync(status.appKeyPath)) return []
  return ['-i', status.appKeyPath, '-o', 'IdentitiesOnly=yes']
}

async function testSsh(): Promise<GitResult<string>> {
  const env = await detect()
  if (!env.ssh) return { ok: false, error: '没有找到 ssh 程序。请安装 Git for Windows（自带 ssh），或在 Windows「可选功能」中添加 OpenSSH 客户端' }
  const status = await sshStatus()
  const t = status.target
  const args = [
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    ...identityArgs(status),
    '-p', String(t.port),
    `${t.user}@${t.host}`
  ]
  const r = await run(env.ssh, args, { timeout: 20_000 })
  const out = `${r.stdout}\n${r.stderr}`
  const welcome = /Welcome to (GitLab|极狐)[^\r\n]*|欢迎[^\r\n]*/i.exec(out)
  patchGitSettings((g) => {
    if (welcome) g.sshVerified = verifiedKey(t)
    else if (g.sshVerified === verifiedKey(t)) delete g.sshVerified
  })
  if (welcome) return { ok: true, data: `连接成功：${welcome[0].trim()}` }
  if (r.timedOut) return { ok: false, error: sshExplain('Connection timed out', t) }
  if (r.error) return { ok: false, error: `无法运行 ssh：${r.error.message}` }
  return { ok: false, error: sshExplain(out, t) }
}

// ---------- Git 身份 ----------

async function getIdentity(): Promise<GitResult<GitIdentity>> {
  try {
    const git = await requireGit()
    const get = async (k: string) => (await run(git, ['config', '--global', '--get', k], { timeout: 10_000 })).stdout.trim()
    return { ok: true, data: { name: await get('user.name'), email: await get('user.email') } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function setIdentity(id: GitIdentity): Promise<GitResult<GitIdentity>> {
  const name = String(id?.name ?? '').trim()
  const email = String(id?.email ?? '').trim()
  const bad = /[\x00-\x1f\x7f]/
  if (!name || name.length > 200 || bad.test(name)) return { ok: false, error: '请填写有效的用户名' }
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || email.length > 200) return { ok: false, error: '请填写有效的邮箱' }
  try {
    const git = await requireGit()
    for (const [k, v] of [['user.name', name], ['user.email', email]]) {
      const r = await run(git, ['config', '--global', k, v], { timeout: 10_000 })
      if (r.code !== 0) return { ok: false, error: `设置 ${k} 失败：${r.stderr.trim() || r.error?.message}` }
    }
    return getIdentity()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ---------- 克隆 ----------

const defaultCloneDir = (): string => join(homedir(), 'Projects')

function cloneDir(): string {
  return getGitSettings().cloneDir || defaultCloneDir()
}

const cloneKey = (projectId: number): string => `${getConfig().baseUrl}#${projectId}`

function checkDir(dir: unknown): string {
  if (typeof dir !== 'string' || !dir.trim() || !isAbsolute(dir.trim())) throw new Error('请填写完整的本地文件夹路径')
  const p = resolve(dir.trim())
  const root = parsePath(p).root
  if (root === p) throw new Error('不能直接使用磁盘根目录，请选择一个子文件夹')
  if (p.length > 240) throw new Error('路径过长')
  const rest = p.slice(root.length)
  if (/[<>:"|?*\u0000-\u001f]/.test(rest) || /[ .]$/.test(p)) {
    throw new Error('路径包含 Windows 不允许的字符，或以空格、句点结尾')
  }
  return p
}

interface RepoProject {
  id: number
  path_with_namespace: string
  ssh_url_to_repo?: string
  http_url_to_repo?: string
}

async function getProject(projectId: number): Promise<RepoProject> {
  if (!Number.isInteger(projectId) || projectId <= 0) throw new Error('项目 ID 无效')
  const r = await gitlabRequest<RepoProject>({ path: `/projects/${projectId}` })
  if (!r.ok) throw new Error(r.error)
  return r.data
}

function gitVersionAtLeast(version: string, major: number, minor: number): boolean {
  const [a, b] = version.split('.').map(Number)
  return a > major || (a === major && b >= minor)
}

/** HTTPS 认证通过环境变量注入一次性配置，令牌不会写进 .git/config，也不出现在命令行里 */
async function gitAuthEnv(url: string): Promise<{ env: Record<string, string>; args: string[] }> {
  const env = await detect()
  const cfg = getConfig()
  const configs: [string, string][] = [['credential.helper', '']]
  const extra: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANG: 'C' }

  if (/^https?:\/\//i.test(url)) {
    const u = new URL(url)
    const origin = `${u.protocol}//${u.host}/`
    const auth = await getValidAuth()
    if (auth && u.hostname.toLowerCase() === new URL(cfg.baseUrl).hostname.toLowerCase()) {
      const token = auth.type === 'pat' ? auth.token : auth.accessToken
      // GitLab 对 git over HTTP 的 Basic 认证：OAuth 令牌要求用户名为 oauth2，个人访问令牌不校验用户名
      configs.push([`http.${origin}.extraHeader`, 'Authorization: Basic ' + Buffer.from(`oauth2:${token}`).toString('base64')])
    }
    if (cfg.ignoreTls) configs.push([`http.${origin}.sslVerify`, 'false'])
  } else {
    const status = await sshStatus()
    const q = (s: string) => `'${s.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`
    const parts = [env.ssh ? q(env.ssh) : 'ssh', '-o BatchMode=yes', '-o StrictHostKeyChecking=accept-new']
    const ids = identityArgs(status)
    if (ids.length) parts.push(`-i ${q(ids[1])}`, '-o IdentitiesOnly=yes')
    extra.GIT_SSH_COMMAND = parts.join(' ')
  }

  if (env.git && gitVersionAtLeast(env.git.version, 2, 31)) {
    extra.GIT_CONFIG_COUNT = String(configs.length)
    configs.forEach(([k, v], i) => {
      extra[`GIT_CONFIG_KEY_${i}`] = k
      extra[`GIT_CONFIG_VALUE_${i}`] = v
    })
    return { env: extra, args: [] }
  }
  return { env: extra, args: configs.flatMap(([k, v]) => ['-c', `${k}=${v}`]) }
}

function redact(text: string): string {
  return text
    .replace(/Authorization:\s*Basic\s+\S+/gi, 'Authorization: Basic [已隐藏]')
    .replace(/PRIVATE-TOKEN:\s*\S+/gi, 'PRIVATE-TOKEN: [已隐藏]')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1')
}

function validCloneUrl(url: string): boolean {
  if (!url || url.length > 2000 || /[\r\n\0]/.test(url) || url.startsWith('-')) return false
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url)
      return u.hostname.length > 0 && !u.username && !u.password
    } catch {
      return false
    }
  }
  if (/^ssh:\/\//i.test(url)) {
    try {
      return new URL(url).hostname.length > 0
    } catch {
      return false
    }
  }
  return /^[\w.+-]+@[\w.-]+:[^\s]+$/.test(url)
}

function gitExplain(out: string): string {
  out = redact(out)
  if (/Permission denied \(publickey/i.test(out)) return 'SSH 密钥认证失败：请先到「设置 → SSH 与 Git」完成一键配置并测试连接，或改用 HTTPS。'
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(out)) {
    return '服务器主机指纹校验失败（~/.ssh/known_hosts 中的记录不一致），请向管理员确认。'
  }
  if (/HTTP Basic: Access denied|Authentication failed|returned error: 401|could not read Username/i.test(out)) {
    return '账号认证失败：登录令牌可能已过期或没有仓库读取权限，请重新登录后再试。'
  }
  if (/returned error: 403/i.test(out)) return '没有权限拉取这个仓库（HTTP 403）。'
  if (/Remote branch .* not found/i.test(out)) return '远端没有这个分支。'
  if (/not found|does not appear to be a git repository|returned error: 404/i.test(out)) {
    return '仓库不存在，或当前账号没有访问权限。'
  }
  if (/SSL certificate problem|server certificate verification failed/i.test(out)) {
    return 'HTTPS 证书校验失败：内网自签证书请在「设置 → 偏好设置」中开启“忽略 HTTPS 证书校验”。'
  }
  if (/Could not resolve host|Could not resolve hostname/i.test(out)) return '找不到服务器，请检查网络或 DNS。'
  if (/schannel|SSL\/TLS connection failed|Recv failure|Failed to connect|early EOF|RPC failed/i.test(out)) {
    return '网络连接中断或不稳定，请稍后重试；如果使用了代理，请检查代理设置。'
  }
  if (/timed out|Connection refused/i.test(out)) {
    return '连接服务器失败或超时：如果使用的是 SSH，公司网络可能屏蔽了 SSH 端口，可改用 HTTPS。'
  }
  if (/already exists and is not an empty directory/i.test(out)) return '目标文件夹已存在且不为空。'
  if (/Filename too long/i.test(out)) return '文件路径过长：请选择更短的目标路径，或执行 git config --global core.longpaths true。'
  if (/No space left on device/i.test(out)) return '磁盘空间不足。'
  const tail = out.trim().split(/\r?\n/).filter((l) => !parseProgress(l)).slice(-3).join('\n')
  return `拉取失败${tail ? '：' + tail : ''}`
}

function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/\.git\/?$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
}

async function sameRepo(dir: string, project: RepoProject): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false
  const r = await run(await requireGit(), ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 10_000 })
  if (r.code !== 0) return false
  const remote = normalizeRemote(r.stdout)
  return [project.ssh_url_to_repo, project.http_url_to_repo].some((u) => u && normalizeRemote(u) === remote)
}

function recordClone(projectId: number, dir: string): void {
  patchGitSettings((g) => {
    g.clones = { ...g.clones, [cloneKey(projectId)]: dir }
  })
}

function listClones(): Record<number, string> {
  const prefix = getConfig().baseUrl + '#'
  const out: Record<number, string> = {}
  for (const [k, v] of Object.entries(getGitSettings().clones ?? {})) {
    if (k.startsWith(prefix) && existsSync(v)) out[Number(k.slice(prefix.length))] = v
  }
  return out
}

function recordedDir(projectId: number): string {
  const dir = getGitSettings().clones?.[cloneKey(projectId)]
  if (!dir) throw new Error('没有找到这个项目的本地克隆记录')
  if (!existsSync(dir)) {
    patchGitSettings((g) => {
      if (g.clones) delete g.clones[cloneKey(projectId)]
    })
    throw new Error(`本地文件夹已不存在：${dir}`)
  }
  return dir
}

function isEmptyDir(dir: string): boolean {
  return readdirSync(dir).length === 0
}

function validBranch(b: string): boolean {
  return b.length < 250 && !b.startsWith('-') && !/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{/.test(b)
}

const running = new Map<string, { child: ChildProcess; cancelled: boolean }>()

export function killGitChildren(): void {
  for (const job of running.values()) job.cancelled = true
  for (const child of live) killTree(child)
}

async function startClone(wc: WebContents, req: CloneRequest): Promise<void> {
  const id = String(req.id)
  const emit = (e: CloneEvent): void => {
    if (!wc.isDestroyed()) wc.send('git:clone', e)
  }
  let dir: string
  let project: RepoProject
  let url: string
  let createdDir = false
  try {
    const git = await requireGit()
    dir = checkDir(req.dir)
    project = await getProject(Number(req.projectId))
    url = (req.protocol === 'ssh' ? project.ssh_url_to_repo : project.http_url_to_repo) ?? ''
    if (!url) throw new Error(req.protocol === 'ssh' ? '该项目没有 SSH 地址' : '该项目没有 HTTPS 地址')
    if (!validCloneUrl(url)) throw new Error('仓库地址不合法')
    const branch = req.branch?.trim()
    if (branch && !validBranch(branch)) throw new Error('分支名不合法')

    if (existsSync(dir)) {
      if (!statSync(dir).isDirectory()) throw new Error(`目标路径已存在且不是文件夹：${dir}`)
      if (!isEmptyDir(dir)) {
        if (await sameRepo(dir, project)) {
          recordClone(project.id, dir)
          emit({ type: 'done', id, dir, existing: true })
          return
        }
        throw new Error(`目标文件夹已存在且不为空：${dir}，请换一个位置`)
      }
    } else {
      mkdirSync(dirname(dir), { recursive: true })
      createdDir = true
    }

    const auth = await gitAuthEnv(url)
    const args = [...auth.args, 'clone', '--progress', ...(branch ? ['--branch', branch] : []), '--', url, dir]
    const child = spawn(git, args, { windowsHide: true, env: childEnv(auth.env), stdio: ['ignore', 'pipe', 'pipe'] })
    watch(child)
    const job = { child, cancelled: false }
    running.set(id, job)

    const log: string[] = []
    let rest = ''
    let lastEmit = 0
    const onData = (c: Buffer): void => {
      const parts = (rest + c.toString('utf8')).split(/\r\n|\r|\n/)
      rest = parts.pop() ?? ''
      for (const line of parts) handleLine(line)
    }
    const handleLine = (line: string): void => {
      const text = line.trimEnd()
      if (!text) return
      const p = parseProgress(text)
      if (p) {
        const now = Date.now()
        if (p.percent === 100 || now - lastEmit > 120) {
          lastEmit = now
          emit({ type: 'progress', id, ...p })
        }
        return
      }
      const safe = redact(text)
      log.push(safe)
      if (log.length > 200) log.shift()
      emit({ type: 'log', id, line: safe })
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    const cleanup = (): void => {
      try {
        if (createdDir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
        else if (existsSync(dir)) {
          for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
        }
      } catch {
        // 文件可能仍被占用，保留给用户手动处理
      }
    }

    child.on('error', (e) => {
      running.delete(id)
      emit({ type: 'error', id, error: `无法运行 git：${e.message}` })
    })
    child.on('close', (code) => {
      running.delete(id)
      if (rest) handleLine(rest)
      if (job.cancelled) {
        // 被强制结束的 git 不会自己清理半成品
        setTimeout(cleanup, 500)
        emit({ type: 'error', id, error: '已取消' })
        return
      }
      if (code === 0) {
        recordClone(project.id, dir)
        emit({ type: 'done', id, dir })
        return
      }
      if (existsSync(dir) && createdDir) cleanup()
      emit({ type: 'error', id, error: gitExplain(log.join('\n')), log: log.slice(-30).join('\n') })
    })
  } catch (e) {
    emit({ type: 'error', id, error: (e as Error).message })
  }
}

function cancelClone(id: string): void {
  const job = running.get(id)
  if (!job) return
  job.cancelled = true
  killTree(job.child)
}

async function pull(projectId: number): Promise<GitResult<string>> {
  try {
    const git = await requireGit()
    const dir = recordedDir(Number(projectId))
    const remote = await run(git, ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: 10_000 })
    if (remote.code !== 0) return { ok: false, error: '本地仓库没有 origin 远端' }
    const auth = await gitAuthEnv(remote.stdout.trim())
    const r = await run(git, [...auth.args, '-C', dir, 'pull', '--ff-only'], { timeout: 10 * 60_000, env: childEnv(auth.env) })
    const out = `${r.stdout}\n${r.stderr}`.trim()
    if (r.code === 0) return { ok: true, data: /Already up to date/i.test(out) ? '已经是最新' : '已拉取最新代码' }
    if (r.timedOut) return { ok: false, error: '拉取超时' }
    if (/Not possible to fast-forward|diverging|have diverged/i.test(out)) {
      return { ok: false, error: '本地有未推送的提交，与远端已分叉，无法自动快进。请在编辑器或终端中手动合并。' }
    }
    if (/local changes .* would be overwritten|Please commit your changes or stash them/is.test(out)) {
      return { ok: false, error: '本地有未提交的修改与远端更新冲突，请先提交或暂存（stash）后再拉取。' }
    }
    if (/no tracking information|There is no tracking information/i.test(out)) {
      return { ok: false, error: '当前分支没有关联远端分支，请在终端中执行 git branch --set-upstream-to。' }
    }
    return { ok: false, error: gitExplain(out) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function openClone(projectId: number, target: OpenTarget): Promise<GitResult<null>> {
  try {
    const dir = recordedDir(Number(projectId))
    if (target === 'folder') {
      const err = await shell.openPath(dir)
      return err ? { ok: false, error: err } : { ok: true, data: null }
    }
    const detached = { detached: true, stdio: 'ignore' as const, env: childEnv() }
    if (target === 'vscode' || target === 'cursor') {
      const exe = (await detect()).editorPaths[target]
      if (!exe) return { ok: false, error: `没有找到 ${target === 'vscode' ? 'VS Code' : 'Cursor'}` }
      spawn(exe, [dir], detached).unref()
      return { ok: true, data: null }
    }
    if (target === 'terminal') {
      if (isWin) spawn('powershell.exe', ['-NoExit'], { ...detached, cwd: dir }).unref()
      else return { ok: false, error: '当前系统暂不支持' }
      return { ok: true, data: null }
    }
    return { ok: false, error: '不支持的打开方式' }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function wrap<T>(fn: () => Promise<GitResult<T>>): Promise<GitResult<T>> {
  return fn().catch((e: Error) => ({ ok: false as const, error: e.message }))
}

export function registerGitIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('git:env', (_e, refresh?: boolean) => gitEnv(Boolean(refresh)))
  ipcMain.handle('ssh:status', () => wrap(async () => ({ ok: true, data: await sshStatus() })))
  ipcMain.handle('ssh:generate', (_e, username: string) => wrap(() => generateKey(String(username ?? ''))))
  ipcMain.handle('ssh:write-config', () => wrap(writeSshConfig))
  ipcMain.handle('ssh:test', () => wrap(testSsh))
  ipcMain.handle('git:identity', () => getIdentity())
  ipcMain.handle('git:set-identity', (_e, id: GitIdentity) => setIdentity(id))
  ipcMain.handle('git:clone-dir', () => cloneDir())
  ipcMain.handle('git:set-clone-dir', (_e, dir: string): GitResult<string> => {
    try {
      const p = checkDir(dir)
      patchGitSettings((g) => {
        g.cloneDir = p
      })
      return { ok: true, data: p }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('git:choose-dir', async (_e, defaultPath?: string) => {
    const win = getWin()
    const opts: Electron.OpenDialogOptions = {
      title: '选择文件夹',
      defaultPath: typeof defaultPath === 'string' && isAbsolute(defaultPath) ? defaultPath : cloneDir(),
      properties: ['openDirectory', 'createDirectory']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('git:clone', (e, req: CloneRequest) => {
    void startClone(e.sender, req)
  })
  ipcMain.handle('git:cancel', (_e, id: string) => cancelClone(String(id)))
  ipcMain.handle('git:clones', () => listClones())
  ipcMain.handle('git:forget', (_e, projectId: number) => {
    patchGitSettings((g) => {
      if (g.clones) delete g.clones[cloneKey(Number(projectId))]
    })
  })
  ipcMain.handle('git:open', (_e, projectId: number, target: OpenTarget) => openClone(projectId, target))
  ipcMain.handle('git:pull', (_e, projectId: number) => pull(projectId))
}
