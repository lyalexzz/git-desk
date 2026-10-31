import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { del, get, getPage, post, put, useAction, useMe } from '../api'
import { TimeAgo, UserState, accessLevels } from '../labels'
import ProjectSelect from '../components/ProjectSelect'
import ResetPasswordModal from '../components/ResetPasswordModal'
import { isLdapUser } from '../password'
import type { Member, User } from '../types'

type Filter = 'all' | 'active' | 'blocked'

const userKeys = [['users'], ['user-options']]

interface NewUser {
  name: string
  username: string
  email: string
  password?: string
}

function UserList() {
  const run = useAction()
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User>()
  const [form] = Form.useForm<NewUser>()

  const users = useQuery({
    queryKey: ['users', filter, search, page, pageSize],
    queryFn: ({ signal }) =>
      getPage<User>('/users', {
        active: filter === 'active' || undefined,
        blocked: filter === 'blocked' || undefined,
        search,
        order_by: 'created_at',
        page,
        per_page: pageSize
      }, signal)
  })

  const create = async (v: NewUser) => {
    const ok = await run(
      () =>
        post('/users', {
          ...v,
          password: v.password || undefined,
          reset_password: !v.password,
          skip_confirmation: true
        }),
      v.password ? '用户已创建' : '用户已创建，重置密码邮件已发送',
      userKeys
    )
    if (ok) {
      setCreating(false)
      form.resetFields()
    }
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented<Filter>
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setPage(1)
          }}
          options={[
            { label: '正常', value: 'active' },
            { label: '已封禁', value: 'blocked' },
            { label: '全部', value: 'all' }
          ]}
        />
        <Input.Search
          allowClear
          placeholder="搜索姓名、用户名、邮箱"
          style={{ width: 260 }}
          onSearch={(v) => {
            setSearch(v)
            setPage(1)
          }}
        />
        <Button type="primary" onClick={() => setCreating(true)}>
          新建用户
        </Button>
      </Space>
      <Table<User>
        rowKey="id"
        loading={users.isFetching}
        dataSource={users.data?.data}
        pagination={{
          current: page,
          pageSize,
          total: users.data?.total ?? undefined,
          showTotal: (n) => `共 ${n} 人`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          }
        }}
        columns={[
          {
            title: '姓名',
            render: (_, u) => (
              <Space>
                {u.name}
                {u.is_admin && <Tag color="red">管理员</Tag>}
              </Space>
            )
          },
          { title: '用户名', dataIndex: 'username' },
          { title: '邮箱', dataIndex: 'email' },
          { title: '状态', width: 100, render: (_, u) => <UserState value={u.state} /> },
          { title: '最后活动', width: 110, dataIndex: 'last_activity_on', render: (v) => v ?? '从未' },
          { title: '创建时间', width: 110, dataIndex: 'created_at', render: (v) => <TimeAgo value={v} /> },
          {
            title: '操作',
            width: 170,
            render: (_, u) => (
              <Space size={12}>
                <StateAction u={u} />
                {isLdapUser(u) ? (
                  <Tooltip title="LDAP 账号的密码由公司统一身份系统管理，不能在 GitLab 中重置">
                    <span>
                      <Typography.Link disabled>重置密码</Typography.Link>
                    </span>
                  </Tooltip>
                ) : (
                  <a onClick={() => setResetting(u)}>重置密码</a>
                )}
              </Space>
            )
          }
        ]}
      />
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(undefined)} />}
      <Modal title="新建用户" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} okText="创建">
        <Form form={form} layout="vertical" onFinish={create}>
          <Form.Item label="姓名" name="name" rules={[{ required: true, message: '请填写姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="用户名（登录名）" name="username" rules={[{ required: true, message: '请填写用户名' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="邮箱" name="email" rules={[{ required: true, type: 'email', message: '请填写正确的邮箱' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="初始密码（留空则发送重置密码邮件）" name="password" rules={[{ min: 8, message: '至少 8 位' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function StateAction({ u }: { u: User }) {
  const run = useAction()
  const act = (action: string, done: string) => () => run(() => post(`/users/${u.id}/${action}`), done, userKeys)
  switch (u.state) {
    case 'active':
      return (
        <Popconfirm title={`封禁用户 ${u.name}？`} description="封禁后该用户无法登录和访问仓库" onConfirm={act('block', '已封禁')}>
          <a style={{ color: '#ff4d4f' }}>封禁</a>
        </Popconfirm>
      )
    case 'blocked':
      return (
        <Popconfirm title={`解封用户 ${u.name}？`} onConfirm={act('unblock', '已解封')}>
          <a>解封</a>
        </Popconfirm>
      )
    case 'banned':
      return (
        <Popconfirm title={`解除禁用用户 ${u.name}？`} onConfirm={act('unban', '已解除禁用')}>
          <a>解除禁用</a>
        </Popconfirm>
      )
    case 'deactivated':
      return (
        <Popconfirm title={`重新激活用户 ${u.name}？`} onConfirm={act('activate', '已激活')}>
          <a>激活</a>
        </Popconfirm>
      )
    case 'blocked_pending_approval':
      return (
        <Popconfirm title={`批准用户 ${u.name} 的注册？`} onConfirm={act('approve', '已批准')}>
          <a>批准</a>
        </Popconfirm>
      )
    default:
      return <span>-</span>
  }
}

function UserPicker({ value, onChange }: { value?: number; onChange?: (v: number) => void }) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300)
    return () => clearTimeout(t)
  }, [input])
  const users = useQuery({
    queryKey: ['user-options', search],
    queryFn: ({ signal }) => get<User[]>('/users', { search, active: true, per_page: 20 }, signal),
    enabled: search.length > 0
  })
  return (
    <Select
      showSearch
      value={value}
      onChange={onChange}
      filterOption={false}
      onSearch={setInput}
      placeholder="输入姓名或用户名搜索"
      loading={users.isFetching}
      notFoundContent={search ? '没有匹配的用户' : '请输入关键字'}
      options={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name}（${u.username}）` }))}
    />
  )
}

function ProjectMembers() {
  const run = useAction()
  const [projectId, setProjectId] = useState<number>()
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm<{ userId: number; accessLevel: number; expiresAt?: Dayjs }>()
  const key = ['members', projectId]
  const members = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<Member[]>(`/projects/${projectId}/members`, { per_page: 100 }, signal),
    enabled: projectId != null
  })

  const add = async (v: { userId: number; accessLevel: number; expiresAt?: Dayjs }) => {
    const ok = await run(
      () =>
        post(`/projects/${projectId}/members`, {
          user_id: v.userId,
          access_level: v.accessLevel,
          expires_at: v.expiresAt?.format('YYYY-MM-DD')
        }),
      '成员已添加',
      [key]
    )
    if (ok) {
      setAdding(false)
      form.resetFields()
    }
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        <ProjectSelect value={projectId} onChange={setProjectId} />
        <Button type="primary" disabled={projectId == null} onClick={() => setAdding(true)}>
          添加成员
        </Button>
      </Space>
      {projectId == null ? (
        <Empty description="选择项目后管理其直接成员（继承自群组的成员需在群组中管理）" />
      ) : (
        <Table<Member>
          rowKey="id"
          loading={members.isFetching}
          dataSource={members.data}
          pagination={false}
          columns={[
            { title: '姓名', dataIndex: 'name' },
            { title: '用户名', dataIndex: 'username' },
            {
              title: '角色',
              width: 200,
              render: (_, m) => (
                <Select
                  value={m.access_level}
                  style={{ width: 180 }}
                  options={accessLevels}
                  onChange={(level) =>
                    run(() => put(`/projects/${projectId}/members/${m.id}`, { access_level: level }), '角色已更新', [key])
                  }
                />
              )
            },
            { title: '到期', width: 120, dataIndex: 'expires_at', render: (v) => v ?? '永久' },
            {
              title: '操作',
              width: 90,
              render: (_, m) => (
                <Popconfirm title={`从项目中移除 ${m.name}？`} onConfirm={() => run(() => del(`/projects/${projectId}/members/${m.id}`), '已移除', [key])}>
                  <a style={{ color: '#ff4d4f' }}>移除</a>
                </Popconfirm>
              )
            }
          ]}
        />
      )}
      <Modal title="添加项目成员" open={adding} onCancel={() => setAdding(false)} onOk={() => form.submit()} okText="添加">
        <Form form={form} layout="vertical" onFinish={add} initialValues={{ accessLevel: 30 }}>
          <Form.Item label="用户" name="userId" rules={[{ required: true, message: '请选择用户' }]}>
            <UserPicker />
          </Form.Item>
          <Form.Item label="角色" name="accessLevel">
            <Select options={accessLevels} />
          </Form.Item>
          <Form.Item label="到期时间（可选）" name="expiresAt">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default function UsersPage() {
  const me = useMe()
  return (
    <Card title="用户与权限">
      <Tabs
        items={[
          {
            key: 'users',
            label: '用户管理',
            children: me.data?.is_admin ? <UserList /> : <Result status="403" subTitle="用户管理仅 GitLab 管理员可用" />
          },
          { key: 'members', label: '项目成员', children: <ProjectMembers /> }
        ]}
      />
    </Card>
  )
}
