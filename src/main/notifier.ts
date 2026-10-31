import { BrowserWindow, Notification } from 'electron'
import { getConfig } from './config'
import { gitlabRequest } from './gitlab'

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

export function startNotifier(getWin: () => BrowserWindow | null): void {
  stopNotifier()

  const tick = async (): Promise<void> => {
    const cfg = getConfig()
    if (!cfg.baseUrl || !cfg.loggedIn) return
    const res = await gitlabRequest<Todo[]>({ path: '/todos', query: { state: 'pending', per_page: 50 } })
    if (!res.ok) return

    getWin()?.webContents.send('todos:count', res.total ?? res.data.length)

    if (seeded && cfg.notify && Notification.isSupported()) {
      for (const t of res.data) {
        if (seen.has(t.id)) continue
        const n = new Notification({
          title: `${t.author.name} ${actionText[t.action_name] ?? t.action_name}`,
          body: [t.target?.title ?? t.body, t.project?.name_with_namespace].filter(Boolean).join('\n')
        })
        n.on('click', () => {
          const w = getWin()
          if (!w) return
          if (w.isMinimized()) w.restore()
          w.show()
          w.focus()
          w.webContents.send('navigate', '/todos')
        })
        n.show()
      }
    }
    seen = new Set(res.data.map((t) => t.id))
    seeded = true
  }

  void tick()
  timer = setInterval(() => void tick(), getConfig().pollMinutes * 60_000)
}
