import type { TreeEntry } from './types'

export type ListDir = (sha: string, path: string) => Promise<TreeEntry[]>

export interface RestorePlan {
  /** 需要从目标提交读取内容后创建/覆盖的文件 */
  writes: { path: string; create: boolean; executable: boolean }[]
  deletes: string[]
  chmods: { path: string; executable: boolean }[]
  /** 提交接口无法处理的条目（子模块、符号链接） */
  unsupported: { path: string; reason: string }[]
}

const SYMLINK = '120000'

/**
 * 逐目录比较两个提交的文件树，只深入对象 ID 不同的子目录，得到让 head 恢复成 target 所需的全部改动。
 * compare 接口在改动多时会静默截断文件列表，所以真正执行时以这里为准。
 */
export async function planRestore(
  list: ListDir,
  target: string,
  head: string,
  onProgress?: (dirs: number) => void,
  concurrency = 6
): Promise<RestorePlan> {
  const plan: RestorePlan = { writes: [], deletes: [], chmods: [], unsupported: [] }
  const queue: { path: string; inTarget: boolean; inHead: boolean }[] = [{ path: '', inTarget: true, inHead: true }]
  let done = 0

  const removeFromHead = (h: TreeEntry) => {
    if (h.type === 'tree') queue.push({ path: h.path, inTarget: false, inHead: true })
    else if (h.type === 'commit') plan.unsupported.push({ path: h.path, reason: '子模块' })
    else if (h.mode === SYMLINK) plan.unsupported.push({ path: h.path, reason: '符号链接' })
    else plan.deletes.push(h.path)
  }
  const addFromTarget = (t: TreeEntry) => {
    if (t.type === 'tree') queue.push({ path: t.path, inTarget: true, inHead: false })
    else if (t.type === 'commit') plan.unsupported.push({ path: t.path, reason: '子模块' })
    else if (t.mode === SYMLINK) plan.unsupported.push({ path: t.path, reason: '符号链接' })
    else plan.writes.push({ path: t.path, create: true, executable: t.mode === '100755' })
  }

  const visit = async (dir: { path: string; inTarget: boolean; inHead: boolean }) => {
    const [ts, hs] = await Promise.all([
      dir.inTarget ? list(target, dir.path) : Promise.resolve([]),
      dir.inHead ? list(head, dir.path) : Promise.resolve([])
    ])
    const tMap = new Map(ts.map((e) => [e.name, e]))
    const hMap = new Map(hs.map((e) => [e.name, e]))
    for (const name of new Set([...tMap.keys(), ...hMap.keys()])) {
      const t = tMap.get(name)
      const h = hMap.get(name)
      if (t && h && t.id === h.id && t.mode === h.mode) continue
      if (t && h && t.type === 'tree' && h.type === 'tree') {
        queue.push({ path: t.path, inTarget: true, inHead: true })
      } else if (t && h && t.type === 'blob' && h.type === 'blob' && t.mode !== SYMLINK && h.mode !== SYMLINK) {
        if (t.id !== h.id) plan.writes.push({ path: t.path, create: false, executable: t.mode === '100755' })
        if (t.mode !== h.mode) plan.chmods.push({ path: t.path, executable: t.mode === '100755' })
      } else if (t && h && t.type === 'commit' && h.type === 'commit') {
        plan.unsupported.push({ path: t.path, reason: '子模块' })
      } else {
        if (h) removeFromHead(h)
        if (t) addFromTarget(t)
      }
    }
    onProgress?.(++done)
  }

  // 简单的并发池：队列在处理过程中会继续增长
  let active = 0
  await new Promise<void>((resolve, reject) => {
    let failed = false
    const pump = () => {
      if (failed) return
      if (queue.length === 0 && active === 0) return resolve()
      while (active < concurrency && queue.length) {
        const dir = queue.shift()!
        active++
        visit(dir).then(
          () => {
            active--
            pump()
          },
          (e) => {
            failed = true
            reject(e)
          }
        )
      }
    }
    pump()
  })
  return plan
}

export type CommitAction =
  | { action: 'create' | 'update'; file_path: string; content: string; encoding: 'base64' }
  | { action: 'delete'; file_path: string }
  | { action: 'chmod'; file_path: string; execute_filemode: boolean }

/** contents: path → base64 内容。先删再写，避免“目录变文件/文件变目录”时路径冲突 */
export function buildActions(plan: RestorePlan, contents: Map<string, string>): CommitAction[] {
  const actions: CommitAction[] = plan.deletes.map((p) => ({ action: 'delete', file_path: p }))
  for (const w of plan.writes) {
    actions.push({ action: w.create ? 'create' : 'update', file_path: w.path, content: contents.get(w.path) ?? '', encoding: 'base64' })
  }
  for (const w of plan.writes) {
    if (w.create && w.executable) actions.push({ action: 'chmod', file_path: w.path, execute_filemode: true })
  }
  for (const c of plan.chmods) actions.push({ action: 'chmod', file_path: c.path, execute_filemode: c.executable })
  return actions
}

/** 两个提交的根目录条目完全一致即文件树相同 */
export async function sameTree(list: ListDir, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([list(a, ''), list(b, '')])
  if (x.length !== y.length) return false
  const key = (e: TreeEntry) => `${e.name}\0${e.id}\0${e.mode}`
  const set = new Set(x.map(key))
  return y.every((e) => set.has(key(e)))
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      result[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return result
}
