import { useEffect, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Form, Input, Modal, Progress, Radio, Result, Space, Typography } from 'antd'
import { CloudDownloadOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { GitMissing, useGitEnv, useSshStatus } from './GitSshSettings'
import type { CloneEvent, CloneProtocol, OpenTarget } from '../../../shared/git'
import type { Project } from '../types'

function joinPath(base: string, name: string): string {
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\'
  return base.replace(/[\\/]+$/, '') + sep + name
}

type Phase = 'form' | 'running' | 'done'

function OpenButtons({ projectId }: { projectId: number }) {
  const { message } = AntApp.useApp()
  const env = useGitEnv()
  const open = async (t: OpenTarget) => {
    const r = await window.desktop.gitOpen(projectId, t)
    if (!r.ok) message.error(r.error)
  }
  return (
    <Space wrap>
      <Button type="primary" onClick={() => open('folder')}>
        打开文件夹
      </Button>
      {env.data?.editors.vscode && <Button onClick={() => open('vscode')}>用 VS Code 打开</Button>}
      {env.data?.editors.cursor && <Button onClick={() => open('cursor')}>用 Cursor 打开</Button>}
      <Button onClick={() => open('terminal')}>在终端打开</Button>
    </Space>
  )
}

function CloneModal({ project, localDir, onClose }: { project: Project; localDir?: string; onClose: () => void }) {
  const { message, modal } = AntApp.useApp()
  const qc = useQueryClient()
  const env = useGitEnv()
  const ssh = useSshStatus()
  const cloneDir = useQuery({ queryKey: ['clone-dir'], queryFn: () => window.desktop.gitCloneDir() })
  const name = project.path_with_namespace.split('/').pop() ?? project.name
  const [protocol, setProtocol] = useState<CloneProtocol>('https')
  const [dir, setDir] = useState('')
  const [branch, setBranch] = useState('')
  const [phase, setPhase] = useState<Phase>(localDir ? 'done' : 'form')
  const [doneDir, setDoneDir] = useState(localDir ?? '')
  const [existing, setExisting] = useState(false)
  const [progress, setProgress] = useState<{ stage: string; overall: number; detail: string } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<{ text: string; log?: string } | null>(null)
  const [pulling, setPulling] = useState(false)
  const idRef = useRef('')

  useEffect(() => {
    if (cloneDir.data && !dir) setDir(joinPath(cloneDir.data, name))
  }, [cloneDir.data, dir, name])

  useEffect(() => {
    if (ssh.data?.verified && project.ssh_url_to_repo) setProtocol('ssh')
  }, [ssh.data?.verified, project.ssh_url_to_repo])

  useEffect(
    () =>
      window.desktop.onCloneEvent((e: CloneEvent) => {
        if (e.id !== idRef.current) return
        if (e.type === 'progress') setProgress({ stage: e.stage, overall: e.overall, detail: e.detail })
        else if (e.type === 'log') setLog((l) => [...l.slice(-50), e.line])
        else if (e.type === 'done') {
          setDoneDir(e.dir)
          setExisting(Boolean(e.existing))
          setPhase('done')
          void qc.invalidateQueries({ queryKey: ['git-clones'] })
        } else {
          setError({ text: e.error, log: e.log })
          setPhase('form')
        }
      }),
    [qc]
  )

  const browse = async () => {
    const parent = await window.desktop.chooseDir(cloneDir.data)
    if (parent) setDir(joinPath(parent, name))
  }

  const start = async () => {
    if (!dir.trim()) return message.warning('请选择保存位置')
    const id = `${project.id}-${Date.now()}`
    idRef.current = id
    setError(null)
    setLog([])
    setProgress(null)
    setPhase('running')
    await window.desktop.gitClone({ id, projectId: project.id, protocol, dir: dir.trim(), branch: branch.trim() || undefined })
  }

  const cancel = () => {
    modal.confirm({
      title: '取消拉取？',
      content: '已下载的部分会被删除',
      onOk: () => window.desktop.gitCancel(idRef.current)
    })
  }

  const pull = async () => {
    setPulling(true)
    try {
      const r = await window.desktop.gitPull(project.id)
      if (r.ok) message.success(r.data)
      else modal.error({ title: '拉取更新失败', content: r.error })
    } finally {
      setPulling(false)
    }
  }

  const forget = async () => {
    await window.desktop.gitForget(project.id)
    await qc.invalidateQueries({ queryKey: ['git-clones'] })
    message.success('已移除本地克隆记录（文件夹不会被删除）')
    onClose()
  }

  const e = env.data
  const sshReady = ssh.data?.verified

  return (
    <Modal
      open
      title={`拉取代码：${project.name_with_namespace}`}
      width={640}
      maskClosable={false}
      closable={phase !== 'running'}
      onCancel={phase === 'running' ? cancel : onClose}
      footer={
        phase === 'form' ? (
          <Space>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" disabled={!e?.git} onClick={start}>
              开始拉取
            </Button>
          </Space>
        ) : phase === 'running' ? (
          <Button danger onClick={cancel}>
            取消
          </Button>
        ) : (
          <Button onClick={onClose}>关闭</Button>
        )
      }
    >
      {phase === 'done' ? (
        <Result
          status="success"
          style={{ padding: '16px 0' }}
          title={localDir && doneDir === localDir ? '已克隆到本机' : existing ? '该文件夹已经是这个仓库' : '拉取完成'}
          subTitle={<Typography.Text copyable>{doneDir}</Typography.Text>}
          extra={
            <Space direction="vertical" size={12}>
              <OpenButtons projectId={project.id} />
              <Space>
                <Button loading={pulling} onClick={pull}>
                  拉取更新（git pull）
                </Button>
                <Button type="link" onClick={() => setPhase('form')}>
                  克隆到其他位置
                </Button>
                <Button type="link" danger onClick={forget}>
                  移除记录
                </Button>
              </Space>
            </Space>
          }
        />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {e && !e.git && <GitMissing />}
          {error && (
            <Alert
              type="error"
              showIcon
              message={error.text}
              description={error.log && error.text !== '已取消' ? <pre className="pre-text" style={{ maxHeight: 160, overflow: 'auto', margin: 0 }}>{error.log}</pre> : undefined}
            />
          )}
          <Form layout="vertical" disabled={phase === 'running'}>
            <Form.Item
              label="方式"
              extra={
                protocol === 'ssh'
                  ? sshReady
                    ? 'SSH 已配置并测试通过'
                    : 'SSH 还没有测试通过，可能会失败，建议先到「设置 → SSH 与 Git」一键配置'
                  : '使用当前登录账号认证，令牌不会保存到仓库配置中；之后在命令行推送时可能需要再次登录'
              }
            >
              <Radio.Group value={protocol} onChange={(ev) => setProtocol(ev.target.value)}>
                <Radio.Button value="https" disabled={!project.http_url_to_repo}>
                  HTTPS
                </Radio.Button>
                <Radio.Button value="ssh" disabled={!project.ssh_url_to_repo}>
                  SSH
                </Radio.Button>
              </Radio.Group>
            </Form.Item>
            <Form.Item label="保存到" extra="文件夹不存在会自动创建；已存在时必须为空">
              <Space.Compact style={{ width: '100%' }}>
                <Input value={dir} onChange={(ev) => setDir(ev.target.value)} />
                <Button onClick={browse}>浏览…</Button>
              </Space.Compact>
            </Form.Item>
            <Form.Item label="分支（可选）">
              <Input
                value={branch}
                onChange={(ev) => setBranch(ev.target.value)}
                placeholder={project.default_branch ? `默认：${project.default_branch}` : '默认分支'}
              />
            </Form.Item>
          </Form>
          {phase === 'running' && (
            <div>
              <Progress percent={progress?.overall ?? 0} status="active" />
              <Typography.Text type="secondary">
                {progress ? `${progress.stage}${progress.detail ? ' · ' + progress.detail : ''}` : '正在连接服务器…'}
              </Typography.Text>
              {log.length > 0 && (
                <pre className="pre-text" style={{ maxHeight: 120, overflow: 'auto', marginTop: 8, fontSize: 12 }}>
                  {log.slice(-8).join('\n')}
                </pre>
              )}
            </div>
          )}
        </Space>
      )}
    </Modal>
  )
}

/** 项目详情页头部的「拉取代码」按钮；已克隆到本机时显示本地路径与快捷打开 */
export default function CloneButton({ project }: { project: Project }) {
  const [open, setOpen] = useState(false)
  const clones = useQuery({ queryKey: ['git-clones'], queryFn: () => window.desktop.gitClones() })
  const localDir = clones.data?.[project.id]
  return (
    <>
      <Button
        type={localDir ? 'default' : 'primary'}
        icon={<CloudDownloadOutlined />}
        title={localDir ? `已克隆到 ${localDir}` : undefined}
        onClick={() => setOpen(true)}
      >
        {localDir ? '本地仓库' : '拉取代码'}
      </Button>
      {open && <CloneModal project={project} localDir={localDir} onClose={() => setOpen(false)} />}
    </>
  )
}
