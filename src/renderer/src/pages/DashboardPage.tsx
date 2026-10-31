import { useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Space, Spin, Statistic } from 'antd'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { getAll, getPage, useMe } from '../api'
import ProjectSelect from '../components/ProjectSelect'
import type { Commit, Project, UserEvent } from '../types'

const DAYS = 30

function eventCategory(e: UserEvent): string {
  if (e.action_name.startsWith('pushed')) return '推送代码'
  if (e.action_name === 'commented on') return '评论'
  if (e.target_type === 'MergeRequest') return '合并请求'
  if (e.target_type === 'Issue') return 'Issue'
  return '其他'
}

function useCount(key: string, path: string, query: Record<string, string | number | boolean | undefined>, enabled = true) {
  return useQuery({
    queryKey: ['count', key, query],
    queryFn: async ({ signal }) => {
      const r = await getPage(path, { ...query, per_page: 1 }, signal)
      return r.total
    },
    enabled
  })
}

function CountCard({ title, value, loading, onClick }: { title: string; value?: number | null; loading: boolean; onClick: () => void }) {
  return (
    <Card hoverable onClick={onClick}>
      <Statistic title={title} value={value ?? '-'} loading={loading} />
    </Card>
  )
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const me = useMe()
  const username = me.data?.username
  const since = dayjs().subtract(DAYS, 'day').format('YYYY-MM-DD')
  const [projectId, setProjectId] = useState<number>()

  const toReview = useCount('review', '/merge_requests', { scope: 'all', state: 'opened', reviewer_username: username }, !!username)
  const myMrs = useCount('my-mrs', '/merge_requests', { scope: 'created_by_me', state: 'opened' })
  const myIssues = useCount('my-issues', '/issues', { scope: 'assigned_to_me', state: 'opened' })
  const todos = useCount('todos', '/todos', { state: 'pending' })

  const events = useQuery({
    queryKey: ['my-events', me.data?.id, since],
    queryFn: ({ signal }) =>
      getAll<UserEvent>(`/users/${me.data!.id}/events`, { after: dayjs(since).subtract(1, 'day').format('YYYY-MM-DD') }, undefined, signal),
    enabled: !!me.data
  })
  const projects = useQuery({
    queryKey: ['membership-projects'],
    queryFn: ({ signal }) => getAll<Project>('/projects', { membership: true, simple: true }, 3, signal)
  })
  const commits = useQuery({
    queryKey: ['project-commits', projectId, since],
    queryFn: ({ signal }) =>
      getAll<Commit>(`/projects/${projectId}/repository/commits`, { since: dayjs(since).toISOString(), all: true }, 10, signal),
    enabled: projectId != null
  })

  const days = useMemo(
    () => Array.from({ length: DAYS + 1 }, (_, i) => dayjs(since).add(i, 'day').format('MM-DD')),
    [since]
  )

  const activityOption = useMemo(() => {
    const cats = ['推送代码', '合并请求', 'Issue', '评论', '其他']
    const series = cats.map((name) => ({ name, type: 'bar', stack: 'total', data: days.map(() => 0) }))
    let commitTotal = 0
    for (const e of events.data ?? []) {
      const idx = days.indexOf(dayjs(e.created_at).format('MM-DD'))
      if (idx < 0) continue
      series[cats.indexOf(eventCategory(e))].data[idx]++
      commitTotal += e.push_data?.commit_count ?? 0
    }
    return {
      commitTotal,
      option: {
        tooltip: { trigger: 'axis' },
        legend: { top: 0 },
        grid: { left: 40, right: 20, top: 40, bottom: 30 },
        xAxis: { type: 'category', data: days },
        yAxis: { type: 'value', minInterval: 1 },
        series
      }
    }
  }, [events.data, days])

  const projectOption = useMemo(() => {
    const names = new Map((projects.data ?? []).map((p) => [p.id, p.name_with_namespace]))
    const counts = new Map<number, number>()
    for (const e of events.data ?? []) if (e.project_id) counts.set(e.project_id, (counts.get(e.project_id) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).reverse()
    return {
      tooltip: {},
      grid: { left: 200, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: top.map(([id]) => names.get(id) ?? `项目 #${id}`) },
      series: [{ type: 'bar', data: top.map(([, c]) => c), name: '动态数' }]
    }
  }, [events.data, projects.data])

  const authorOption = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of commits.data ?? []) counts.set(c.author_name, (counts.get(c.author_name) ?? 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).reverse()
    return {
      tooltip: {},
      grid: { left: 120, right: 30, top: 10, bottom: 20 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: top.map(([n]) => n) },
      series: [{ type: 'bar', data: top.map(([, c]) => c), name: '提交数', itemStyle: { color: '#52c41a' } }]
    }
  }, [commits.data])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={6}>
          <CountCard title="待我审核的合并请求" value={toReview.data} loading={toReview.isLoading} onClick={() => navigate('/mrs?scope=review')} />
        </Col>
        <Col span={6}>
          <CountCard title="我发起的进行中合并请求" value={myMrs.data} loading={myMrs.isLoading} onClick={() => navigate('/mrs?scope=created_by_me')} />
        </Col>
        <Col span={6}>
          <CountCard title="指派给我的未解决 Issue" value={myIssues.data} loading={myIssues.isLoading} onClick={() => navigate('/issues')} />
        </Col>
        <Col span={6}>
          <CountCard title="待办事项" value={todos.data} loading={todos.isLoading} onClick={() => navigate('/todos')} />
        </Col>
      </Row>

      <Card
        title={`我近 ${DAYS} 天的活动`}
        extra={!events.isLoading && <span>共推送提交 {activityOption.commitTotal} 个，动态 {events.data?.length ?? 0} 条</span>}
      >
        {events.isLoading ? <Spin /> : <ReactECharts option={activityOption.option} style={{ height: 300 }} />}
      </Card>

      <Row gutter={16}>
        <Col span={12}>
          <Card title={`我最活跃的项目（近 ${DAYS} 天）`}>
            {events.isLoading ? (
              <Spin />
            ) : (events.data ?? []).length === 0 ? (
              <Empty description="近期没有动态" />
            ) : (
              <ReactECharts option={projectOption} style={{ height: 320 }} />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card
            title={`项目提交排行（近 ${DAYS} 天，所有分支）`}
            extra={<ProjectSelect value={projectId} onChange={setProjectId} style={{ minWidth: 260 }} />}
          >
            {projectId == null ? (
              <Empty description="选择一个项目查看成员提交量" />
            ) : commits.isLoading ? (
              <Spin />
            ) : (commits.data ?? []).length === 0 ? (
              <Empty description="该项目近期没有提交" />
            ) : (
              <ReactECharts option={authorOption} style={{ height: 320 }} />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
