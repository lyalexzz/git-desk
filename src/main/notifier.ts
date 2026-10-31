import { BrowserWindow, Notification } from 'electron'
import { getConfig } from './config'
import { apiRequest } from './api'

interface Todo {
  id: number
  action_name: string
  target_type: string
  body: string
  author: { name: string }
  project?: { name_with_namespace: string }
  target?: { title?: string }
}

const actionText: Record<string, string> = {
  assigned: '把一项工作指派给了你',
  mentioned: '提到了你',
  directly_addressed: '@了你',
  build_failed: '的流水线失败了',
  marked: '为你添加了待办',
  approval_required: '需要你审批',
  unmergeable: '的合并请求无法合并',
  review_requested: '请你审核合并请求',
  member_access_requested: '申请加入项目',
  merge_train_removed: '的合并请求被移出合并队列'
}

let timer: NodeJS.Timeout | null = null
let seen = new Set<number>()
let seeded = false

export function stopNotifier(): void {
  if (timer) clearInterval(timer)
  timer = null
}

export function resetNotifier(): void {
  seen = new Set()
  seeded = false
}

let ticking = false

export function startNotifier(getWin: () => BrowserWindow | null): void {
  stopNotifier()
  const cfg = getConfig()
  if (!cfg.baseUrl || !cfg.loggedIn) return
  // GitHub 等无 todos 能力的平台不轮询
  if (!cfg.capabilities.todos) return

  const tick = async (): Promise<void> => {
    if (ticking) return
    const w = getWin()
    if (!w || w.isDestroyed()) return
    const current = getConfig()
    if (!current.baseUrl || !current.loggedIn || !current.capabilities.todos) {
      stopNotifier()
      return
    }
    ticking = true
    try {
      const res = await apiRequest<Todo[]>({ path: '/todos', query: { state: 'pending', per_page: 50 } })
      if (!res.ok || w.isDestroyed()) return

      w.webContents.send('todos:count', res.total ?? res.data.length)

      if (seeded && current.notify && Notification.isSupported()) {
        for (const t of res.data) {
          if (seen.has(t.id)) continue
          const n = new Notification({
            title: `${t.author.name} ${actionText[t.action_name] ?? t.action_name}`,
            body: [t.target?.title ?? t.body, t.project?.name_with_namespace].filter(Boolean).join('\n')
          })
          n.on('click', () => {
            const target = getWin()
            if (!target || target.isDestroyed()) return
            if (target.isMinimized()) target.restore()
            target.show()
            target.focus()
            target.webContents.send('navigate', '/todos')
          })
          n.show()
        }
      }
      seen = new Set(res.data.map((t) => t.id))
      seeded = true
    } finally {
      ticking = false
    }
  }

  void tick()
  const minutes = Math.min(60, Math.max(1, getConfig().pollMinutes || 2))
  timer = setInterval(() => void tick(), minutes * 60_000)
}
