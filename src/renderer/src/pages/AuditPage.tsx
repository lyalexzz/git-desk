import { useMemo, useState } from 'react'
import { Alert, Card, DatePicker, Empty, Result, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { ApiError, getPage, useMe } from '../api'
import { TimeAgo } from '../labels'
import ProjectSelect from '../components/ProjectSelect'
import type { AuditEvent } from '../types'

type Scope = 'git' | 'all'
type Source = 'project' | 'instance'

function messageText(e: AuditEvent): string {
  const m = e.details?.custom_message
  if (typeof m === 'string') return m
  if (m && typeof m === 'object') {
    const action = String(m.action ?? m.protocol ?? '')
    const proto = m.protocol ? String(m.protocol) : ''
    if (action && proto) return `${action}（${proto}）`
    if (action) return action
    try {
      return JSON.stringify(m)
    } catch {
      return 'Git 操作'
    }
  }
  if (e.details?.change) return `变更：${e.details.change}`
  if (e.details?.add) return `添加：${e.details.add}`
  if (e.details?.remove) return `移除：${e.details.remove}`
  return e.event_type || e.details?.target_details || '审计事件'
}

function isGitEvent(e: AuditEvent): boolean {
  const t = (e.event_type || '').toLowerCase()
  if (t.includes('git') || t.includes('repository_download') || t === 'repository_git_operation') return true
  const m = e.details?.custom_message
  if (typeof m === 'string') {
    return /git-|upload-pack|receive-pack|clone|fetch|pull|push|download|repository/i.test(m)
  }
  if (m && typeof m === 'object') {
    const action = String(m.action ?? '')
    return /git-|upload-pack|receive-pack|clone|fetch|pull|push|download/i.test(action) || Boolean(m.protocol)
  }
  return false
}

function gitActionLabel(e: AuditEvent): string {
  const m = e.details?.custom_message
  const raw =
    typeof m === 'string'
      ? m
      : m && typeof m === 'object'
        ? String(m.action ?? m.custom_message ?? '')
        : e.event_type || ''
  const s = raw.toLowerCase()
  if (s.includes('receive-pack') || /\bpush\b/.test(s)) return '推送'
  if (s.includes('upload-pack') || /\bpull\b|\bfetch\b|\bclone\b/.test(s)) return '拉取/克隆'
  if (s.includes('download')) return '下载仓库'
  return messageText(e)
}

function authorOf(e: AuditEvent): string {
  return e.author_name || e.details?.author_name || (e.author_id != null ? `用户 #${e.author_id}` : '未知')
}

function ipOf(e: AuditEvent): string {
  return e.ip_address || e.details?.ip_address || '-'
}

function explainError(err: unknown): { title: string; sub: string } {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return {
        title: '没有权限查看审计事件',
        sub: '维护者及以上可查看项目全部审计；开发者通常只能看自己的操作。若服务器是社区版或未开通审计功能，也可能返回无权限。'
      }
    }
    if (err.status === 404) {
      return {
        title: '当前服务器不支持审计事件接口',
        sub: '审计事件多为 Premium / Ultimate（或对应商业版）能力。社区版一般没有「谁拉取了代码」的 API，只能看服务器系统日志。'
      }
    }
    return { title: '加载失败', sub: err.message }
  }
  return { title: '加载失败', sub: (err as Error)?.message || '未知错误' }
}

export default function AuditPage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ? Number(params.get('project')) : undefined
  const [source, setSource] = useState<Source>('project')
  const [scope, setScope] = useState<Scope>('git')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(7, 'day').startOf('day'), dayjs().endOf('day')])

  const createdAfter = range[0].toISOString()
  const createdBefore = range[1].toISOString()

  const path =
    source === 'instance'
      ? '/audit_events'
      : projectId
        ? `/projects/${projectId}/audit_events`
        : ''

  const events = useQuery({
    queryKey: ['audit-events', source, projectId, createdAfter, createdBefore, page, pageSize],
    queryFn: ({ signal }) =>
      getPage<AuditEvent>(
        path,
        {
          created_after: createdAfter,
          created_before: createdBefore,
          page,
          per_page: pageSize,
          ...(source === 'instance' ? { entity_type: 'Project' } : {})
        },
        signal
      ),
    enabled: source === 'instance' ? Boolean(me.data?.is_admin) : projectId != null,
    retry: false
  })

  const rows = useMemo(() => {
    const list = events.data?.data ?? []
    return scope === 'git' ? list.filter(isGitEvent) : list
  }, [events.data, scope])

  const err = events.error ? explainError(events.error) : null

  return (
    <Card
      title="审计日志"
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          查看谁拉取、克隆或推送了代码（依赖服务器审计能力）
        </Typography.Text>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="说明"
        description="数据来自 GitLab 审计事件 API。Git 拉取/克隆一般记为 authenticated 的 git-upload-pack；匿名访问公共仓库通常不会留下记录。社区版或未开通审计时接口可能不可用。"
      />

      <Space wrap style={{ marginBottom: 16 }}>
        {me.data?.is_admin && (
          <Segmented<Source>
            value={source}
            onChange={(v) => {
              setSource(v)
              setPage(1)
            }}
            options={[
              { label: '按项目', value: 'project' },
              { label: '实例（管理员）', value: 'instance' }
            ]}
          />
        )}
        {source === 'project' && (
          <ProjectSelect
            value={projectId}
            placeholder="选择项目"
            style={{ minWidth: 280 }}
            onChange={(v) => {
              const next = new URLSearchParams(params)
              if (v) next.set('project', String(v))
              else next.delete('project')
              setParams(next)
              setPage(1)
            }}
          />
        )}
        <Segmented<Scope>
          value={scope}
          onChange={(v) => setScope(v)}
          options={[
            { label: 'Git 操作', value: 'git' },
            { label: '全部审计', value: 'all' }
          ]}
        />
        <DatePicker.RangePicker
          value={range}
          allowClear={false}
          onChange={(v) => {
            if (v?.[0] && v[1]) {
              setRange([v[0].startOf('day'), v[1].endOf('day')])
              setPage(1)
            }
          }}
        />
        <Select
          value={pageSize}
          style={{ width: 110 }}
          onChange={(v) => {
            setPageSize(v)
            setPage(1)
          }}
          options={[
            { value: 20, label: '每页 20' },
            { value: 50, label: '每页 50' },
            { value: 100, label: '每页 100' }
          ]}
        />
      </Space>

      {source === 'project' && projectId == null ? (
        <Empty description="请先选择一个项目" />
      ) : source === 'instance' && !me.data?.is_admin ? (
        <Result status="403" subTitle="实例级审计仅管理员可用" />
      ) : err ? (
        <Result status={events.error instanceof ApiError && events.error.status === 404 ? 'warning' : '403'} title={err.title} subTitle={err.sub} />
      ) : (
        <>
          {scope === 'git' && !events.isLoading && (events.data?.data.length ?? 0) > 0 && rows.length === 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="当前页没有识别为 Git 操作的事件"
              description="可切换到「全部审计」查看原始事件，或扩大时间范围。部分版本把拉取记在流式审计里，列表 API 未必包含每一次 fetch。"
            />
          )}
          <Table<AuditEvent>
            rowKey="id"
            size="small"
            loading={events.isLoading}
            dataSource={rows}
            locale={{ emptyText: '暂无审计事件' }}
            pagination={{
              current: page,
              pageSize,
              total: events.data?.total ?? undefined,
              showTotal: (n) => (events.data?.total != null ? `共 ${n} 条` : undefined),
              onChange: (p, s) => {
                setPage(p)
                setPageSize(s)
              }
            }}
            columns={[
              {
                title: '时间',
                width: 120,
                dataIndex: 'created_at',
                render: (v: string) => <TimeAgo value={v} />
              },
              {
                title: '操作人',
                width: 140,
                render: (_, e) => authorOf(e)
              },
              {
                title: '操作',
                width: 140,
                render: (_, e) =>
                  isGitEvent(e) ? <Tag color="blue">{gitActionLabel(e)}</Tag> : <span>{messageText(e)}</span>
              },
              {
                title: '详情',
                ellipsis: true,
                render: (_, e) => (
                  <Typography.Text type="secondary" ellipsis>
                    {messageText(e)}
                    {e.entity_path || e.details?.entity_path
                      ? ` · ${e.entity_path || e.details?.entity_path}`
                      : ''}
                  </Typography.Text>
                )
              },
              {
                title: 'IP',
                width: 130,
                render: (_, e) => <Typography.Text code>{ipOf(e)}</Typography.Text>
              },
              {
                title: '类型',
                width: 160,
                ellipsis: true,
                render: (_, e) => e.event_type || e.entity_type
              }
            ]}
          />
        </>
      )}
    </Card>
  )
}
