import { useEffect, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Popconfirm,
  Space,
  Steps,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ApiError, del, get, openExternal, post, useMe } from '../api'
import { TimeAgo } from '../labels'
import { GIT_DOWNLOAD_URL, GIT_MIRROR_URL, type GitIdentity, type LocalKey } from '../../../shared/git'
import type { User } from '../types'

interface GitlabKey {
  id: number
  title: string
  key: string
  created_at: string
  expires_at?: string | null
}

type Me = User & { commit_email?: string; public_email?: string }

function keyMaterial(key: string): string {
  return key.trim().split(/\s+/).slice(0, 2).join(' ')
}

export function sameKey(a: string, b: string): boolean {
  return keyMaterial(a) === keyMaterial(b)
}

export function GitMissing() {
  return (
    <Alert
      type="warning"
      showIcon
      message="没有检测到 Git"
      description={
        <>
          拉取代码需要先安装 Git for Windows（安装时一路“下一步”即可，自带 ssh 工具）。安装完成后回到这里点击「重新检测」。
          <div style={{ marginTop: 8 }}>
            <Space>
              <Button size="small" type="primary" onClick={() => openExternal(GIT_MIRROR_URL)}>
                国内镜像下载
              </Button>
              <Button size="small" onClick={() => openExternal(GIT_DOWNLOAD_URL)}>
                官网下载
              </Button>
            </Space>
          </div>
        </>
      }
    />
  )
}

export function useGitEnv() {
  return useQuery({ queryKey: ['git-env'], queryFn: () => window.desktop.gitEnv(), staleTime: Infinity })
}

export function useSshStatus() {
  return useQuery({
    queryKey: ['ssh-status'],
    queryFn: async () => {
      const r = await window.desktop.sshStatus()
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
  })
}

type StepState = { title: string; status: 'wait' | 'process' | 'finish' | 'error'; description?: string }

export default function GitSshSettings() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const me = useMe()
  const env = useGitEnv()
  const status = useSshStatus()
  const keys = useQuery({ queryKey: ['user-keys'], queryFn: () => get<GitlabKey[]>('/user/keys', { per_page: 100 }) })
  const identity = useQuery({
    queryKey: ['git-identity'],
    enabled: Boolean(env.data?.git),
    queryFn: async () => {
      const r = await window.desktop.gitIdentity()
      if (!r.ok) throw new Error(r.error)
      return r.data
    }
  })
  const cloneDir = useQuery({ queryKey: ['clone-dir'], queryFn: () => window.desktop.gitCloneDir() })
  const [idForm] = Form.useForm<GitIdentity>()
  const [steps, setSteps] = useState<StepState[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (identity.data) idForm.setFieldsValue(identity.data)
  }, [identity.data, idForm])

  const s = status.data
  const remoteKeys = keys.data ?? []
  const uploaded = (k: LocalKey) => remoteKeys.some((r) => sameKey(r.key, k.publicKey))

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['ssh-status'] }),
      qc.invalidateQueries({ queryKey: ['user-keys'] })
    ])
  }

  const redetect = async () => {
    const e = await window.desktop.gitEnv(true)
    qc.setQueryData(['git-env'], e)
    await Promise.all([refreshAll(), qc.invalidateQueries({ queryKey: ['git-identity'] })])
    message.success(e.git ? `已检测到 Git ${e.git.version}` : '仍未检测到 Git')
  }

  /** 上传公钥；返回 null 表示成功（含已存在） */
  const upload = async (k: LocalKey, computer: string): Promise<string | null> => {
    const list = await get<GitlabKey[]>('/user/keys', { per_page: 100 })
    if (list.some((r) => sameKey(r.key, k.publicKey))) return null
    try {
      await post('/user/keys', { title: `gitlab-desk · ${computer} · ${dayjs().format('YYYY-MM-DD')}`, key: k.publicKey })
      return null
    } catch (e) {
      if (e instanceof ApiError && e.status === 400 && /taken|已被/i.test(e.message)) {
        return '这个公钥已经被其他 GitLab 账号使用了，请在那个账号中删除后重试'
      }
      return (e as Error).message
    }
  }

  const uploadOne = async (k: LocalKey) => {
    const err = await upload(k, s?.computer ?? 'PC')
    if (err) message.error(err)
    else message.success('公钥已添加到 GitLab 账号')
    await refreshAll()
  }

  const oneClick = async () => {
    if (!me.data) return
    const list: StepState[] = [
      { title: '生成密钥', status: 'process' },
      { title: '添加到 GitLab', status: 'wait' },
      { title: '写入 SSH 配置', status: 'wait' },
      { title: '测试连接', status: 'wait' }
    ]
    const set = (i: number, patch: Partial<StepState>) => {
      list[i] = { ...list[i], ...patch }
      if (patch.status === 'finish' && list[i + 1]) list[i + 1] = { ...list[i + 1], status: 'process' }
      setSteps([...list])
    }
    setSteps([...list])
    setBusy(true)
    setTestResult(null)
    try {
      const g = await window.desktop.sshGenerate(me.data.username)
      if (!g.ok) return set(0, { status: 'error', description: g.error })
      set(0, {
        status: 'finish',
        description: [g.data.created ? `已生成 ${g.data.key.name}` : `使用已有的 ${g.data.key.name}`, g.data.warning]
          .filter(Boolean)
          .join('；')
      })

      const st = await window.desktop.sshStatus()
      const err = await upload(g.data.key, st.ok ? st.data.computer : 'PC')
      if (err) return set(1, { status: 'error', description: err })
      set(1, { status: 'finish', description: '公钥已在当前账号中' })

      const w = await window.desktop.sshWriteConfig()
      if (!w.ok) return set(2, { status: 'error', description: w.error })
      set(2, {
        status: 'finish',
        description: [
          w.data.backup ? `原文件已备份为 ${w.data.backup}` : '',
          w.data.conflict ? '注意：配置文件中还有该主机的其他配置，可能优先生效' : ''
        ]
          .filter(Boolean)
          .join('；') || w.data.path
      })

      const t = await window.desktop.sshTest()
      if (!t.ok) return set(3, { status: 'error', description: t.error })
      set(3, { status: 'finish', description: t.data })
      message.success('SSH 配置完成，可以用 SSH 拉取代码了')
    } catch (e) {
      message.error((e as Error).message)
    } finally {
      setBusy(false)
      await refreshAll()
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.desktop.sshTest()
      setTestResult(r.ok ? { ok: true, text: r.data } : { ok: false, text: r.error })
      await qc.invalidateQueries({ queryKey: ['ssh-status'] })
    } finally {
      setTesting(false)
    }
  }

  const removeKey = async (k: GitlabKey) => {
    try {
      await del(`/user/keys/${k.id}`)
      message.success('已从 GitLab 账号删除该公钥')
    } catch (e) {
      message.error((e as Error).message)
    }
    await refreshAll()
  }

  const fillFromGitlab = () => {
    const u = me.data as Me | undefined
    if (!u) return
    const email = u.commit_email || u.email || u.public_email || ''
    idForm.setFieldsValue({ name: u.name, email })
    if (!email) message.warning('GitLab 没有返回你的邮箱，请手动填写')
  }

  const saveIdentity = async (v: GitIdentity) => {
    const r = await window.desktop.gitSetIdentity(v)
    if (!r.ok) return message.error(r.error)
    qc.setQueryData(['git-identity'], r.data)
    message.success('Git 提交身份已保存')
  }

  const chooseCloneDir = async () => {
    const dir = await window.desktop.chooseDir(cloneDir.data)
    if (!dir) return
    const r = await window.desktop.gitSetCloneDir(dir)
    if (!r.ok) return message.error(r.error)
    qc.setQueryData(['clone-dir'], r.data)
    message.success('默认位置已保存')
  }

  const e = env.data
  const localByKey = (k: GitlabKey) => s?.keys.find((l) => sameKey(l.publicKey, k.key))

  return (
    <Card
      title="SSH 与 Git"
      extra={
        <Button size="small" onClick={redetect}>
          重新检测
        </Button>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {e && !e.git && <GitMissing />}
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="Git">
            {e?.git ? (
              <Space>
                <Tag color="success">{e.git.version}</Tag>
                <Typography.Text type="secondary">{e.git.path}</Typography.Text>
              </Space>
            ) : (
              <Tag color="error">未安装</Tag>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="SSH">
            {e?.ssh ? <Typography.Text type="secondary">{e.ssh}</Typography.Text> : <Tag color="error">未找到</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="SSH 服务器">
            {s ? `${s.target.user}@${s.target.host}:${s.target.port}` : '-'}
            {s?.verified && (
              <Tag color="success" style={{ marginLeft: 8 }}>
                已连通
              </Tag>
            )}
          </Descriptions.Item>
        </Descriptions>

        <div>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            一键配置会为当前服务器生成专用密钥（不会覆盖已有密钥）、添加到你的 GitLab 账号、写入 ~/.ssh/config 并测试连接。
          </Typography.Paragraph>
          <Space>
            <Button type="primary" loading={busy} disabled={!me.data} onClick={oneClick}>
              一键配置 SSH
            </Button>
            <Button loading={testing} onClick={test} disabled={!e?.ssh}>
              测试连接
            </Button>
          </Space>
        </div>
        {steps && <Steps direction="vertical" size="small" items={steps} />}
        {testResult && <Alert type={testResult.ok ? 'success' : 'error'} showIcon message={testResult.text} />}
        {status.error && <Alert type="error" showIcon message={(status.error as Error).message} />}

        <div>
          <Typography.Text strong>本机密钥</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {e?.sshDir}
          </Typography.Text>
        </div>
        <Table<LocalKey>
          rowKey="path"
          size="small"
          pagination={false}
          loading={status.isLoading}
          dataSource={s?.keys ?? []}
          locale={{ emptyText: '还没有 SSH 密钥，点击「一键配置 SSH」自动生成' }}
          columns={[
            {
              title: '文件',
              render: (_, k) => (
                <Space>
                  {k.name}
                  {k.app && <Tag color="blue">本软件生成</Tag>}
                </Space>
              )
            },
            { title: '类型', dataIndex: 'type', width: 110 },
            {
              title: '指纹',
              dataIndex: 'fingerprint',
              ellipsis: true,
              render: (v: string) => (
                <Typography.Text code style={{ fontSize: 12 }}>
                  {v}
                </Typography.Text>
              )
            },
            {
              title: 'GitLab',
              width: 90,
              render: (_, k) => (keys.isLoading ? '-' : uploaded(k) ? <Tag color="success">已添加</Tag> : <Tag>未添加</Tag>)
            },
            {
              title: '操作',
              width: 150,
              render: (_, k) => (
                <Space>
                  <Typography.Text copyable={{ text: k.publicKey, tooltips: ['复制公钥', '已复制'] }} />
                  {!uploaded(k) && !keys.isLoading && <a onClick={() => uploadOne(k)}>添加到 GitLab</a>}
                </Space>
              )
            }
          ]}
        />

        <Typography.Text strong>GitLab 账号中的公钥</Typography.Text>
        <Table<GitlabKey>
          rowKey="id"
          size="small"
          pagination={false}
          loading={keys.isLoading}
          dataSource={remoteKeys}
          locale={{ emptyText: keys.error ? (keys.error as Error).message : '账号里还没有 SSH 公钥' }}
          columns={[
            {
              title: '标题',
              ellipsis: true,
              render: (_, k) => (
                <Space>
                  {k.title}
                  {localByKey(k) && (
                    <Tooltip title={localByKey(k)?.path}>
                      <Tag color="blue">本机</Tag>
                    </Tooltip>
                  )}
                </Space>
              )
            },
            {
              title: '公钥',
              ellipsis: true,
              render: (_, k) => (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {k.key.split(/\s+/)[0]} …{k.key.split(/\s+/)[1]?.slice(-16)}
                </Typography.Text>
              )
            },
            { title: '添加时间', width: 110, render: (_, k) => <TimeAgo value={k.created_at} /> },
            {
              title: '过期',
              width: 100,
              render: (_, k) => (k.expires_at ? dayjs(k.expires_at).format('YYYY-MM-DD') : '永不')
            },
            {
              title: '操作',
              width: 70,
              render: (_, k) => (
                <Popconfirm
                  title={`从 GitLab 账号删除「${k.title}」？`}
                  description="删除后使用该密钥的电脑将无法通过 SSH 拉取/推送代码"
                  onConfirm={() => removeKey(k)}
                >
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              )
            }
          ]}
        />

        <Divider style={{ margin: 0 }} />
        <div>
          <Typography.Text strong>Git 提交身份</Typography.Text>
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            写入全局配置（git config --global），提交记录会显示这里的名字和邮箱
          </Typography.Text>
        </div>
        <Form form={idForm} layout="inline" onFinish={saveIdentity} disabled={!e?.git}>
          <Form.Item name="name" rules={[{ required: true, message: '请填写名字' }]}>
            <Input placeholder="user.name" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="email" rules={[{ required: true, type: 'email', message: '请填写有效邮箱' }]}>
            <Input placeholder="user.email" style={{ width: 240 }} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
            <Button onClick={fillFromGitlab} disabled={!me.data}>
              使用 GitLab 账号信息
            </Button>
          </Space>
        </Form>
        {identity.error && <Alert type="error" showIcon message={(identity.error as Error).message} />}

        <Divider style={{ margin: 0 }} />
        <div>
          <Typography.Text strong>默认克隆位置</Typography.Text>
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input readOnly value={cloneDir.data} />
          <Button onClick={chooseCloneDir}>选择…</Button>
        </Space.Compact>
      </Space>
    </Card>
  )
}
