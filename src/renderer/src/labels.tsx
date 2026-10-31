import { Tag, Tooltip } from 'antd'
import dayjs from 'dayjs'
import type { AuthMethod, Platform } from '../../shared/types'

export const platforms: { value: Platform; label: string; url?: string }[] = [
  { value: 'gitlab', label: 'GitLab 私有部署' },
  { value: 'jihu', label: '极狐 GitLab 私有部署' },
  { value: 'jihulab', label: '极狐 GitLab SaaS（jihulab.com）', url: 'https://jihulab.com' },
  { value: 'gitlab_com', label: 'GitLab.com', url: 'https://gitlab.com' },
  { value: 'github', label: 'GitHub', url: 'https://github.com' }
]

export function productName(platform: Platform, isJihu?: boolean): string {
  if (platform === 'github') return 'GitHub'
  if (isJihu || platform === 'jihu' || platform === 'jihulab') return '极狐 GitLab'
  return 'GitLab'
}

export function mrLabel(provider: 'gitlab' | 'github'): string {
  return provider === 'github' ? 'Pull Request' : '合并请求'
}

export const authMethodText: Record<AuthMethod, string> = {
  token: '个人访问令牌',
  password: '账号密码',
  web: '网页登录'
}

type TagInfo = [text: string, color: string]

const pipelineStatus: Record<string, TagInfo> = {
  created: ['已创建', 'default'],
  waiting_for_resource: ['等待资源', 'default'],
  preparing: ['准备中', 'processing'],
  pending: ['排队中', 'warning'],
  running: ['运行中', 'processing'],
  success: ['成功', 'success'],
  failed: ['失败', 'error'],
  canceled: ['已取消', 'default'],
  canceling: ['取消中', 'default'],
  skipped: ['已跳过', 'default'],
  manual: ['待手动触发', 'purple'],
  scheduled: ['已计划', 'cyan']
}

const mrState: Record<string, TagInfo> = {
  opened: ['进行中', 'processing'],
  merged: ['已合并', 'success'],
  closed: ['已关闭', 'default'],
  locked: ['已锁定', 'warning']
}

const issueState: Record<string, TagInfo> = {
  opened: ['未解决', 'processing'],
  closed: ['已关闭', 'default']
}

const mergeStatus: Record<string, TagInfo> = {
  mergeable: ['可合并', 'success'],
  conflict: ['有冲突', 'error'],
  need_rebase: ['需要变基', 'error'],
  ci_must_pass: ['等待流水线通过', 'warning'],
  ci_still_running: ['流水线运行中', 'processing'],
  not_approved: ['未获批准', 'warning'],
  draft_status: ['草稿', 'default'],
  discussions_not_resolved: ['讨论未解决', 'warning'],
  blocked_status: ['被阻塞', 'error'],
  checking: ['检查中', 'processing'],
  unchecked: ['未检查', 'default'],
  approvals_syncing: ['审批同步中', 'processing'],
  not_open: ['未打开', 'default'],
  jira_association_missing: ['缺少 Jira 关联', 'warning'],
  requested_changes: ['被要求修改', 'warning']
}

const userState: Record<string, TagInfo> = {
  active: ['正常', 'success'],
  blocked: ['已封禁', 'error'],
  ldap_blocked: ['LDAP 封禁', 'error'],
  banned: ['已禁用（ban）', 'volcano'],
  deactivated: ['已停用', 'default'],
  blocked_pending_approval: ['待审批', 'warning']
}

export const todoAction: Record<string, string> = {
  assigned: '指派给你',
  mentioned: '提到了你',
  directly_addressed: '@了你',
  build_failed: '流水线失败',
  marked: '手动添加的待办',
  approval_required: '需要你审批',
  unmergeable: '无法合并',
  review_requested: '请你审核',
  member_access_requested: '申请加入',
  merge_train_removed: '移出合并队列'
}

export const targetType: Record<string, string> = {
  MergeRequest: '合并请求',
  Issue: 'Issue',
  Commit: '提交',
  Epic: '史诗',
  DesignManagement: '设计',
  AlertManagement: '告警'
}

export const visibilityText: Record<string, string> = {
  private: '私有',
  internal: '内部',
  public: '公开'
}

export const accessLevels: { value: number; label: string }[] = [
  { value: 10, label: '访客 Guest' },
  { value: 20, label: '报告者 Reporter' },
  { value: 30, label: '开发者 Developer' },
  { value: 40, label: '维护者 Maintainer' },
  { value: 50, label: '所有者 Owner' }
]

/** 受保护分支/标签可选的角色（GitLab 只接受这几个值） */
export const protectLevels: { value: number; label: string }[] = [
  { value: 30, label: '开发者和维护者' },
  { value: 40, label: '仅维护者' },
  { value: 60, label: '仅管理员' },
  { value: 0, label: '不允许任何人' }
]

function renderTag(map: Record<string, TagInfo>, value?: string) {
  if (!value) return null
  const [text, color] = map[value] ?? [value, 'default']
  return <Tag color={color}>{text}</Tag>
}

export const PipelineStatus = ({ value }: { value?: string }) => renderTag(pipelineStatus, value)
export const MrState = ({ value }: { value?: string }) => renderTag(mrState, value)
export const IssueState = ({ value }: { value?: string }) => renderTag(issueState, value)
export const MergeStatus = ({ value }: { value?: string }) => renderTag(mergeStatus, value)
export const UserState = ({ value }: { value?: string }) => renderTag(userState, value)

export function TimeAgo({ value }: { value?: string | null }) {
  if (!value) return <span>-</span>
  return (
    <Tooltip title={dayjs(value).format('YYYY-MM-DD HH:mm:ss')}>
      <span>{dayjs(value).fromNow()}</span>
    </Tooltip>
  )
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null) return '-'
  const s = Math.round(seconds)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小时 ${m % 60} 分`
}
