import { useState } from 'react'
import { Card, Input, Segmented, Space, Table, Tag, Typography } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getAll, getPage, openExternal, post, useAction } from '../api'
import { TimeAgo, visibilityText } from '../labels'
import type { Project } from '../types'

type Scope = 'membership' | 'starred' | 'all'

export default function ProjectsPage() {
  const navigate = useNavigate()
  const run = useAction()
  const [scope, setScope] = useState<Scope>('membership')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  const projects = useQuery({
    queryKey: ['projects', scope, search, page, pageSize],
    queryFn: () =>
      getPage<Project>('/projects', {
        membership: scope === 'membership' || undefined,
        starred: scope === 'starred' || undefined,
        search,
        order_by: 'last_activity_at',
        page,
        per_page: pageSize
      })
  })
  const starred = useQuery({
    queryKey: ['starred-ids'],
    queryFn: async () => new Set((await getAll<Project>('/projects', { starred: true, simple: true })).map((p) => p.id))
  })

  const toggleStar = (p: Project) => {
    const isStarred = starred.data?.has(p.id)
    void run(
      () => post(`/projects/${p.id}/${isStarred ? 'unstar' : 'star'}`),
      isStarred ? '已取消星标' : '已加星标',
      [['starred-ids'], ['projects']]
    )
  }

  return (
    <Card
      title="项目"
      extra={
        <Space>
          <Segmented<Scope>
            value={scope}
            onChange={(v) => {
              setScope(v)
              setPage(1)
            }}
            options={[
              { label: '我参与的', value: 'membership' },
              { label: '我星标的', value: 'starred' },
              { label: '全部可见', value: 'all' }
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索项目名称"
            style={{ width: 240 }}
            onSearch={(v) => {
              setSearch(v)
              setPage(1)
            }}
          />
        </Space>
      }
    >
      <Table<Project>
        rowKey="id"
        loading={projects.isLoading}
        dataSource={projects.data?.data}
        onRow={(p) => ({ onDoubleClick: () => navigate(`/projects/${p.id}`) })}
        pagination={{
          current: page,
          pageSize,
          total: projects.data?.total ?? undefined,
          showTotal: (n) => `共 ${n} 个项目`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          {
            title: '',
            width: 40,
            render: (_, p) =>
              starred.data?.has(p.id) ? (
                <StarFilled className="clickable" style={{ color: '#faad14' }} onClick={() => toggleStar(p)} />
              ) : (
                <StarOutlined className="clickable" onClick={() => toggleStar(p)} />
              )
          },
          {
            title: '项目',
            render: (_, p) => (
              <div>
                <a onClick={() => navigate(`/projects/${p.id}`)}>{p.name_with_namespace}</a>
                {p.description && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
                    {p.description}
                  </Typography.Text>
                )}
              </div>
            )
          },
          { title: '可见性', width: 80, render: (_, p) => (p.visibility ? <Tag>{visibilityText[p.visibility] ?? p.visibility}</Tag> : '-') },
          { title: '默认分支', width: 120, dataIndex: 'default_branch' },
          { title: '星标', width: 70, dataIndex: 'star_count' },
          { title: '最后活动', width: 110, dataIndex: 'last_activity_at', render: (v) => <TimeAgo value={v} /> },
          {
            title: '操作',
            width: 300,
            render: (_, p) => (
              <Space>
                <a onClick={() => navigate(`/projects/${p.id}`)}>代码</a>
                <a onClick={() => navigate(`/mrs?project=${p.id}`)}>合并请求</a>
                <a onClick={() => navigate(`/issues?project=${p.id}`)}>Issue</a>
                <a onClick={() => navigate(`/pipelines?project=${p.id}`)}>流水线</a>
                <a onClick={() => openExternal(p.web_url)}>网页</a>
              </Space>
            )
          }
        ]}
      />
    </Card>
  )
}
