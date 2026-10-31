import { useEffect, useMemo, useState } from 'react'
import { Alert, App as AntApp, Collapse, Descriptions, Input, Modal, Progress, Radio, Select, Space, Spin, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, del, get, getAll, post, useAction } from '../api'
import { TimeAgo } from '../labels'
import { buildActions, mapLimit, planRestore, sameTree, type ListDir } from '../rollback'
import type { Branch, Commit, Compare, MergeRequest, RepoFile, TreeEntry } from '../types'

const short = (sha: string) => sha.slice(0, 8)
const isSha = (s: string) => /^[0-9a-f]{40}$/i.test(s)
const MAX_DIR_ENTRIES = 5000

function refreshKeys(projectId: number) {
  return [
    ['branch-list', projectId],
    ['branches', projectId],
    ['rollback-branch', projectId],
    ['commits', projectId],
    ['tree', projectId],
    ['last-commit', projectId],
    ['file', projectId]
  ]
}

function BranchPicker({ projectId, value, onChange }: { projectId: number; value?: string; onChange: (v: string) => void }) {
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(input), 300)
    return () => clearTimeout(t)
  }, [input])
  const branches = useQuery({
    queryKey: ['branches', projectId, search],
    queryFn: ({ signal }) => get<Branch[]>(`/projects/${projectId}/repository/branches`, { search, per_page: 50 }, signal)
  })
  const options = (branches.data ?? []).map((b) => ({ value: b.name, label: b.name }))
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: value })
  return (
    <Select
      showSearch
      value={value}
      placeholder="选择分支"
      style={{ width: '100%' }}
      filterOption={false}
      onSearch={setInput}
      onChange={onChange}
      loading={branches.isFetching}
      options={options}
    />
  )
}

function CommitLine({ c }: { c: Commit }) {
  return (
    <Space size={8}>
      <Typography.Text code copyable={{ text: c.id }}>
        {c.short_id}
      </Typography.Text>
      <span>{c.title}</span>
      <Typography.Text type="secondary">
        {c.author_name} · <TimeAgo value={c.committed_date} />
      </Typography.Text>
    </Space>
  )
}

type Mode = 'safe' | 'force'

interface Props {
  projectId: number
  branch?: string
  target?: string
  onClose: () => void
}

export default function RollbackModal({ projectId, branch: initialBranch, target: initialTarget, onClose }: Props) {
  const { message, modal } = AntApp.useApp()
  const qc = useQueryClient()
  const [branch, setBranch] = useState(initialBranch && !isSha(initialBranch) ? initialBranch : undefined)
  const [notBranch, setNotBranch] = useState<string>()
  const [target, setTarget] = useState(initialTarget)
  const [shaInput, setShaInput] = useState('')
  const [mode, setMode] = useState<Mode>('safe')
  const [commitMessage, setCommitMessage] = useState('')
  const [messageTouched, setMessageTouched] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [progress, setProgress] = useState<{ text: string; percent?: number } | null>(null)
  const running = progress !== null

  const branchPath = branch ? `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}` : ''
  const branchQ = useQuery({
    queryKey: ['rollback-branch', projectId, branch],
    queryFn: ({ signal }) => get<Branch>(branchPath, undefined, signal),
    enabled: !!branch,
    retry: false
  })
  useEffect(() => {
    if (branch && branch === initialBranch && branchQ.error instanceof ApiError && branchQ.error.status === 404) {
      setNotBranch(branch)
      setBranch(undefined)
    }
  }, [branchQ.error, branch, initialBranch])

  const b = branchQ.data
  const head = b?.commit
  const commitsQ = useQuery({
    queryKey: ['commits', projectId, 'rollback-picker', branch],
    queryFn: ({ signal }) =>
      get<Commit[]>(`/projects/${projectId}/repository/commits`, { ref_name: branch, per_page: 100 }, signal),
    enabled: !!branch
  })
  const targetQ = useQuery({
    queryKey: ['commit', projectId, target],
    queryFn: ({ signal }) => get<Commit>(`/projects/${projectId}/repository/commits/${target}`, undefined, signal),
    enabled: !!target,
    retry: false
  })
  const t = targetQ.data
  const ready = !!head && !!t && head.id !== t.id
  const compareQ = useQuery({
    queryKey: ['rollback-compare', projectId, t?.id, head?.id],
    queryFn: ({ signal }) =>
      get<Compare>(`/projects/${projectId}/repository/compare`, { from: t!.id, to: head!.id, straight: true }, signal),
    enabled: ready
  })
  const baseQ = useQuery({
    queryKey: ['rollback-base', projectId, t?.id, head?.id],
    queryFn: ({ signal }) =>
      get<{ id: string }>(`/projects/${projectId}/repository/merge_base?refs[]=${t!.id}&refs[]=${head!.id}`, undefined, signal),
    enabled: ready
  })
  const mrsQ = useQuery({
    queryKey: ['rollback-mrs', projectId, branch],
    queryFn: ({ signal }) =>
      get<MergeRequest[]>(
        `/projects/${projectId}/merge_requests`,
        { state: 'opened', source_branch: branch, per_page: 20 },
        signal
      ),
    enabled: !!branch && mode === 'force'
  })

  useEffect(() => {
    if (t && !messageTouched) setCommitMessage(`回滚到 ${short(t.id)}：${t.title}`)
  }, [t, messageTouched])

  const commitOptions = useMemo(() => {
    const list = (commitsQ.data ?? []).map((c) => ({
      value: c.id,
      label: `${c.short_id} ${c.title}`,
      disabled: c.id === head?.id
    }))
    if (target && !list.some((o) => o.value === target)) {
      list.unshift({ value: target, label: t ? `${t.short_id} ${t.title}` : short(target), disabled: false })
    }
    const s = shaInput.trim()
    if (/^[0-9a-f]{7,40}$/i.test(s) && !list.some((o) => o.value.startsWith(s.toLowerCase()))) {
      list.unshift({ value: s, label: `使用 SHA ${s}`, disabled: false })
    }
    return list
  }, [commitsQ.data, head?.id, target, t, shaInput])

  const notAncestor = !!baseQ.data && !!t && baseQ.data.id !== t.id
  const cmp = compareQ.data
  const undone = useMemo(
    () => [...(cmp?.commits ?? [])].sort((x, y) => Date.parse(y.committed_date) - Date.parse(x.committed_date)),
    [cmp]
  )
  const summary = useMemo(() => {
    const s = { added: 0, deleted: 0, renamed: 0, modified: 0 }
    for (const d of cmp?.diffs ?? []) {
      if (d.new_file) s.added++
      else if (d.deleted_file) s.deleted++
      else if (d.renamed_file) s.renamed++
      else s.modified++
    }
    return s
  }, [cmp])

  const pushDenied = b?.can_push === false
  const forceBlocked = !b
    ? undefined
    : b.default
      ? '默认分支不能强制回滚，请使用安全回滚'
      : b.protected
        ? '受保护分支不能强制回滚，请使用安全回滚（或先在「设置」里取消保护）'
        : pushDenied
          ? '你没有这个分支的推送权限'
          : undefined
  useEffect(() => {
    if (forceBlocked && mode === 'force') setMode('safe')
  }, [forceBlocked, mode])

  const list: ListDir = async (sha, path) => {
    const items = await getAll<TreeEntry>(`/projects/${projectId}/repository/tree`, { ref: sha, path: path || undefined }, MAX_DIR_ENTRIES / 100)
    if (items.length >= MAX_DIR_ENTRIES) throw new Error(`目录「${path || '/'}」下条目超过 ${MAX_DIR_ENTRIES} 个，无法通过 API 回滚`)
    return items
  }

  const ensureHeadUnchanged = async (headSha: string) => {
    const now = await get<Branch>(branchPath)
    if (now.commit?.id !== headSha) {
      throw new Error(`分支在此期间有了新提交（现在是 ${short(now.commit?.id ?? '')}），为避免覆盖别人的改动已取消，请重新打开后再试`)
    }
  }

  const finish = async () => {
    await Promise.all(refreshKeys(projectId).map((queryKey) => qc.invalidateQueries({ queryKey })))
    onClose()
  }

  const runSafe = async (headSha: string, targetSha: string) => {
    setProgress({ text: '正在比对文件树…' })
    const plan = await planRestore(list, targetSha, headSha, (n) => setProgress({ text: `正在比对文件树（已比较 ${n} 个目录）…` }))
    if (plan.unsupported.length) {
      const items = [...new Map(plan.unsupported.map((u) => [u.path, u])).values()]
      modal.warning({
        title: '包含子模块或符号链接的变更，无法安全回滚',
        width: 560,
        content: (
          <>
            <div style={{ marginBottom: 8 }}>GitLab 提交接口不能创建或修改这些条目，请在本地用 git 处理：</div>
            <ul style={{ paddingLeft: 20, maxHeight: 260, overflow: 'auto' }}>
              {items.map((u) => (
                <li key={u.path}>
                  {u.path}（{u.reason}）
                </li>
              ))}
            </ul>
          </>
        )
      })
      return
    }
    const fileCount = plan.writes.length + plan.deletes.length + plan.chmods.length
    if (fileCount === 0) {
      message.info('分支内容已经和目标提交一致，无需回滚')
      return
    }

    const contents = new Map<string, string>()
    let read = 0
    setProgress({ text: `正在读取目标版本的文件 0/${plan.writes.length}`, percent: 0 })
    await mapLimit(plan.writes, 6, async (w) => {
      const f = await get<RepoFile>(`/projects/${projectId}/repository/files/${encodeURIComponent(w.path)}`, { ref: targetSha })
      contents.set(w.path, f.content)
      read++
      setProgress({
        text: `正在读取目标版本的文件 ${read}/${plan.writes.length}`,
        percent: Math.round((read / plan.writes.length) * 100)
      })
    })

    setProgress({ text: '正在确认分支没有新提交…' })
    await ensureHeadUnchanged(headSha)
    setProgress({ text: `正在提交（${fileCount} 个文件）…` })
    let created: Commit
    try {
      created = await post<Commit>(`/projects/${projectId}/repository/commits`, {
        branch,
        commit_message: commitMessage,
        actions: buildActions(plan, contents)
      })
    } catch (e) {
      // 大提交可能在客户端超时后仍在服务端完成，确认一下，避免用户重复提交
      const after = await get<Branch>(branchPath).catch(() => null)
      if (!after?.commit || after.commit.id === headSha || !(await sameTree(list, after.commit.id, targetSha).catch(() => false))) throw e
      created = after.commit
    }
    setProgress({ text: '正在校验结果…' })
    const ok = await sameTree(list, created.id, targetSha).catch(() => false)
    await finish()
    const content = (
      <Space direction="vertical">
        <span>
          新提交 <Typography.Text code copyable={{ text: created.id }}>{short(created.id)}</Typography.Text>，共改动 {fileCount} 个文件。
        </span>
        <span>
          如需撤销这次回滚，可以对新提交执行「撤销此提交」，或回滚到原分支头{' '}
          <Typography.Text code copyable={{ text: headSha }}>{short(headSha)}</Typography.Text>。
        </span>
      </Space>
    )
    if (ok) modal.success({ title: `已将 ${branch} 安全回滚到 ${short(targetSha)}`, width: 520, content })
    else modal.warning({ title: '提交已创建，但校验发现文件树与目标提交仍有差异', width: 520, content })
  }

  const runForce = async (headSha: string, targetSha: string) => {
    setProgress({ text: '正在确认分支没有新提交…' })
    await ensureHeadUnchanged(headSha)
    setProgress({ text: '正在删除旧分支…' })
    await del(branchPath)
    setProgress({ text: '正在从目标提交重建分支…' })
    const create = (ref: string) => post(`/projects/${projectId}/repository/branches`, { branch, ref })
    let createError: Error | undefined
    try {
      await create(targetSha)
    } catch (e) {
      createError = e as Error
    }
    if (createError) {
      let restored = true
      try {
        await create(headSha)
      } catch {
        restored = false
      }
      await finish()
      const sha = (
        <Typography.Text code copyable={{ text: headSha }}>
          {headSha}
        </Typography.Text>
      )
      if (restored) {
        modal.error({ title: '重建分支失败，已恢复到原来的分支头', width: 560, content: <>{createError.message}。分支仍指向 {sha}。</> })
      } else {
        modal.error({
          title: `分支 ${branch} 已删除，但重建失败`,
          width: 600,
          content: (
            <>
              {createError.message}。请立即在「分支」页用「新建分支」以 {sha} 为来源重建 {branch}。
            </>
          )
        })
      }
      return
    }
    await finish()
    modal.success({
      title: `已将 ${branch} 强制回滚到 ${short(targetSha)}`,
      width: 600,
      content: (
        <>
          原分支头为{' '}
          <Typography.Text code copyable={{ text: headSha }}>
            {headSha}
          </Typography.Text>
          ，如需恢复，可用「新建分支」以它为来源重建。
        </>
      )
    })
  }

  const start = async () => {
    if (!head || !t) return
    try {
      if (mode === 'safe') await runSafe(head.id, t.id)
      else await runForce(head.id, t.id)
    } catch (e) {
      modal.error({ title: '回滚失败', width: 520, content: (e as Error).message })
    } finally {
      setProgress(null)
    }
  }

  const okDisabled =
    !ready ||
    running ||
    (mode === 'safe' && (pushDenied || !commitMessage.trim())) ||
    (mode === 'force' && (!!forceBlocked || confirmText !== branch))

  return (
    <Modal
      open
      title="回滚分支"
      width={760}
      onCancel={() => !running && onClose()}
      maskClosable={false}
      closable={!running}
      okText={mode === 'force' ? '强制回滚' : '开始回滚'}
      okButtonProps={{ danger: mode === 'force', disabled: okDisabled, loading: running }}
      cancelButtonProps={{ disabled: running }}
      onOk={() => void start()}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {notBranch && !branch && <Alert type="info" showIcon message={`「${notBranch}」不是分支，请选择要回滚的分支`} />}
        <Descriptions size="small" column={1} bordered styles={{ label: { width: 110 } }}>
          <Descriptions.Item label="分支">
            <BranchPicker
              projectId={projectId}
              value={branch}
              onChange={(v) => {
                setBranch(v)
                setConfirmText('')
                if (!initialTarget) setTarget(undefined)
              }}
            />
          </Descriptions.Item>
          <Descriptions.Item label="当前分支头">
            {branchQ.isLoading && branch ? <Spin size="small" /> : head ? <CommitLine c={head} /> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="回滚到">
            <Select
              showSearch
              value={target}
              placeholder={branch ? '选择提交，或粘贴提交 SHA' : '请先选择分支'}
              style={{ width: '100%' }}
              loading={commitsQ.isFetching}
              options={commitOptions}
              onSearch={setShaInput}
              filterOption={(input, o) => String(o?.label ?? '').toLowerCase().includes(input.toLowerCase()) || String(o?.value).startsWith(input.toLowerCase())}
              onChange={(v) => {
                setTarget(v)
                setShaInput('')
              }}
            />
            {t && (
              <div style={{ marginTop: 6 }}>
                <CommitLine c={t} />
              </div>
            )}
            {targetQ.error && <Typography.Text type="danger">{(targetQ.error as Error).message}</Typography.Text>}
          </Descriptions.Item>
        </Descriptions>

        {branchQ.error && !notBranch && <Alert type="error" showIcon message={(branchQ.error as Error).message} />}
        {head && t && head.id === t.id && <Alert type="info" showIcon message="目标提交就是当前分支头，无需回滚" />}
        {notAncestor && (
          <Alert
            type="warning"
            showIcon
            message="目标提交不在这个分支的历史中"
            description="回滚后分支的文件内容会变成该提交的内容，但它并不是该分支的祖先，请确认没有选错分支或提交。"
          />
        )}
        {pushDenied && <Alert type="error" showIcon message="你没有这个分支的推送权限，无法回滚" />}

        {ready &&
          (compareQ.isLoading ? (
            <Spin />
          ) : compareQ.error ? (
            <Alert type="error" showIcon message={`对比失败：${(compareQ.error as Error).message}`} />
          ) : (
            cmp && (
              <>
                <Collapse
                  size="small"
                  items={[
                    {
                      key: 'commits',
                      label: notAncestor
                        ? `分支上有 ${undone.length} 个提交不在目标提交中`
                        : `将撤销目标之后的 ${undone.length} 个提交`,
                      children: (
                        <div style={{ maxHeight: 220, overflow: 'auto' }}>
                          {undone.map((c) => (
                            <div key={c.id} style={{ padding: '2px 0' }}>
                              <CommitLine c={c} />
                            </div>
                          ))}
                        </div>
                      )
                    }
                  ]}
                />
                <Typography.Text type="secondary">
                  相对目标提交，当前分支新增了 {summary.added} 个、删除了 {summary.deleted} 个、修改了 {summary.modified} 个
                  {summary.renamed ? `、重命名了 ${summary.renamed} 个` : ''}文件，回滚会把它们全部恢复原样。
                  {cmp.compare_timeout && ' GitLab 对比超时，以上统计可能不完整，执行时会逐个目录精确比对。'}
                </Typography.Text>
              </>
            )
          ))}

        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} disabled={running}>
          <Space direction="vertical">
            <Radio value="safe">
              <b>安全回滚（推荐）</b>
              <div style={{ color: 'rgba(0,0,0,0.45)' }}>
                在分支上新建一个提交，让文件内容回到目标提交时的样子。之前的提交记录全部保留，别人拉取不受影响，随时可以再撤销。
              </div>
            </Radio>
            <Radio value="force" disabled={!!forceBlocked}>
              <b>强制回滚（改写历史）</b>
              <div style={{ color: 'rgba(0,0,0,0.45)' }}>
                删除分支后从目标提交重建，目标之后的提交会从分支上消失。已拉取该分支的人需要强制同步。
                {forceBlocked && <div style={{ color: '#faad14' }}>{forceBlocked}</div>}
              </div>
            </Radio>
          </Space>
        </Radio.Group>

        {mode === 'safe' && (
          <div>
            <div style={{ marginBottom: 4 }}>提交信息</div>
            <Input.TextArea
              rows={2}
              value={commitMessage}
              disabled={running}
              onChange={(e) => {
                setCommitMessage(e.target.value)
                setMessageTouched(true)
              }}
            />
          </div>
        )}

        {mode === 'force' && head && (
          <Alert
            type="error"
            showIcon
            message="此操作会改写分支历史"
            description={
              <Space direction="vertical" style={{ width: '100%' }}>
                <span>目标之后的 {undone.length} 个提交会从分支上丢弃。它们暂时仍可通过 SHA 找回，请先记下原分支头：</span>
                <Typography.Text code copyable={{ text: head.id }}>
                  {head.id}
                </Typography.Text>
                {!!mrsQ.data?.length && (
                  <span>
                    有 {mrsQ.data.length} 个以此分支为源的打开中的合并请求会受影响（变更内容会随之变化）：
                    {mrsQ.data.map((mr) => `!${mr.iid} ${mr.title}`).join('；')}
                  </span>
                )}
                <span>
                  请输入分支名 <Typography.Text code>{branch}</Typography.Text> 确认：
                </span>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={running} placeholder={branch} />
              </Space>
            }
          />
        )}

        {progress && (
          <div>
            <div>{progress.text}</div>
            {progress.percent !== undefined && <Progress percent={progress.percent} size="small" />}
          </div>
        )}
      </Space>
    </Modal>
  )
}

export function RevertCommitModal({
  projectId,
  commit,
  branch: initialBranch,
  onClose
}: {
  projectId: number
  commit: Commit
  branch?: string
  onClose: () => void
}) {
  const run = useAction()
  const [branch, setBranch] = useState(initialBranch && !isSha(initialBranch) ? initialBranch : undefined)
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    const ok = await run(
      () => post(`/projects/${projectId}/repository/commits/${commit.id}/revert`, { branch }),
      `已在 ${branch} 上创建撤销提交`,
      refreshKeys(projectId)
    )
    setLoading(false)
    if (ok) onClose()
  }
  return (
    <Modal
      open
      title="撤销提交"
      okText="撤销"
      onCancel={onClose}
      okButtonProps={{ disabled: !branch, loading }}
      onOk={() => void submit()}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <CommitLine c={commit} />
        <Typography.Text type="secondary">
          会在所选分支上新建一个提交，反向应用这个提交的改动，其它提交不受影响。如果后续提交改过相同的代码，可能因冲突而失败。
        </Typography.Text>
        <div>在分支</div>
        <BranchPicker projectId={projectId} value={branch} onChange={setBranch} />
      </Space>
    </Modal>
  )
}
