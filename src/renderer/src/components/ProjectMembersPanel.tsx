import { useEffect, useState } from 'react'
import { Alert, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Typography, type TableColumnsType } from 'antd'
import { useQuery } from '@tanstack/react-query'
import type { Dayjs } from 'dayjs'
import { del, get, post, put, useAction, useMe } from '../api'
import { accessLevels } from '../labels'
import type { Member, User } from '../types'

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

/** GitHub 可设权限；Owner(50) 一般不能通过协作者接口赋予 */
const githubAccessLevels = accessLevels.filter((l) => l.value < 50)

export default function ProjectMembersPanel({ projectId }: { projectId: number }) {
  const run = useAction()
  const me = useMe()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const isGithub = cfg.data?.provider === 'github'
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm<{ userId?: number; username?: string; accessLevel: number; expiresAt?: Dayjs }>()
  const key = ['members', projectId]
  const members = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => get<Member[]>(`/projects/${projectId}/members`, { per_page: 100 }, signal)
  })

  const roleOptions = isGithub ? githubAccessLevels : accessLevels

  const add = async (v: { userId?: number; username?: string; accessLevel: number; expiresAt?: Dayjs }) => {
    const ok = await run(
      () =>
        post(`/projects/${projectId}/members`, {
          user_id: v.userId,
          username: v.username?.trim(),
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
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message={
          isGithub
            ? '以下为仓库协作者。权限对应 GitHub 的 pull / triage / push / maintain / admin。'
            : '以下为项目直接成员。继承自群组的成员需在群组中管理。'
        }
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography.Text type="secondary">{members.data ? `共 ${members.data.length} 人` : ''}</Typography.Text>
        <Button
          type="primary"
          onClick={() => {
            form.setFieldsValue({ accessLevel: 30 })
            setAdding(true)
          }}
        >
          添加成员
        </Button>
      </div>
      <Table<Member>
        rowKey="id"
        loading={members.isFetching}
        dataSource={members.data}
        pagination={false}
        size="middle"
        columns={
          [
            {
              title: '姓名',
              render: (_: unknown, m: Member) => (
                <span>
                  {m.name}
                  {m.id === me.data?.id ? (
                    <Typography.Text type="secondary"> （我）</Typography.Text>
                  ) : null}
                </span>
              )
            },
            { title: '用户名', dataIndex: 'username' },
            {
              title: '权限',
              width: 200,
              render: (_: unknown, m: Member) => (
                <Select
                  value={m.access_level}
                  style={{ width: 180 }}
                  options={roleOptions}
                  disabled={m.id === me.data?.id && m.access_level >= 40}
                  onChange={(level) =>
                    run(() => put(`/projects/${projectId}/members/${m.id}`, { access_level: level }), '权限已更新', [key])
                  }
                />
              )
            },
            ...(isGithub
              ? []
              : [
                  {
                    title: '到期',
                    width: 120,
                    dataIndex: 'expires_at' as const,
                    render: (v: string | null | undefined) => v ?? '永久'
                  }
                ]),
            {
              title: '状态',
              width: 90,
              dataIndex: 'state',
              render: (v: string) => (v === 'active' ? '正常' : v)
            },
            {
              title: '操作',
              width: 90,
              render: (_: unknown, m: Member) =>
                m.id === me.data?.id ? (
                  <Typography.Text type="secondary">-</Typography.Text>
                ) : (
                  <Popconfirm
                    title={`从${isGithub ? '仓库' : '项目'}中移除 ${m.name}？`}
                    onConfirm={() => run(() => del(`/projects/${projectId}/members/${m.id}`), '已移除', [key])}
                  >
                    <a style={{ color: '#ff4d4f' }}>移除</a>
                  </Popconfirm>
                )
            }
          ] satisfies TableColumnsType<Member>
        }
      />
      <Modal
        title={`添加${isGithub ? '协作者' : '项目成员'}`}
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={() => form.submit()}
        okText="添加"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={add} initialValues={{ accessLevel: 30 }}>
          {isGithub ? (
            <Form.Item
              label="GitHub 用户名"
              name="username"
              rules={[{ required: true, message: '请填写用户名' }]}
              extra="对方需已有 GitHub 账号；添加后可能需对方接受邀请"
            >
              <Input placeholder="例如 octocat" autoComplete="off" />
            </Form.Item>
          ) : (
            <Form.Item label="用户" name="userId" rules={[{ required: true, message: '请选择用户' }]}>
              <UserPicker />
            </Form.Item>
          )}
          <Form.Item label="权限" name="accessLevel" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          {!isGithub && (
            <Form.Item label="到期时间（可选）" name="expiresAt">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Space>
  )
}
