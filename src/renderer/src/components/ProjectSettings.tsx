import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ApiError, del, getAll, post, put, request, useAction, useMe } from '../api'
import { protectLevels } from '../labels'
import type { Branch, CiVariable, ProjectSettingsInfo, ProtectedAccessLevel, ProtectedBranch, ProtectedTag, RepoTag } from '../types'

const enc = encodeURIComponent
const MASK = '••••••••'

function NoPermission() {
  return (
    <Result
      status="403"
      title="需要项目维护者或所有者权限"
      subTitle="这些设置只有项目的维护者（Maintainer）或所有者（Owner）才能查看和修改。如需调整，请联系项目负责人或 GitLab 管理员提升你的权限。"
    />
  )
}

function LoadError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.status === 403) return <NoPermission />
  return <Result status="error" title="加载失败" subTitle={(error as Error).message} />
}

function useBranches(projectId: number) {
  return useQuery({
    queryKey: ['settings-branches', projectId],
    queryFn: ({ signal }) => getAll<Branch>(`/projects/${projectId}/repository/branches`, {}, 20, signal),
    staleTime: 60_000
  })
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
}

const isRole = (a: ProtectedAccessLevel) => !a.user_id && !a.group_id && !a.deploy_key_id

/** 规则里按角色授权的级别；只有指定用户/群组时视为“不允许任何角色” */
function roleLevel(levels: ProtectedAccessLevel[]): number {
  return levels.find(isRole)?.access_level ?? 0
}

function LevelTags({ levels }: { levels: ProtectedAccessLevel[] }) {
  if (!levels.length) return <Tag>不允许任何人</Tag>
  return (
    <Space size={4} wrap>
      {levels.map((a, i) => {
        const role = isRole(a) ? protectLevels.find((l) => l.value === (a.access_level ?? 0)) : undefined
        return (
          <Tag key={a.id ?? i} color={role?.value === 0 ? undefined : 'blue'}>
            {role?.label ?? a.access_level_description}
          </Tag>
        )
      })}
    </Space>
  )
}

const levelSelect = <Select options={protectLevels} style={{ width: 200 }} />

type BranchRuleForm = { name: string; push: number; merge: number; force: boolean }

function ProtectedBranches({ project }: { project: ProjectSettingsInfo }) {
  const run = useAction()
  const { modal } = AntApp.useApp()
  const [editing, setEditing] = useState<ProtectedBranch | 'new' | null>(null)
  const [form] = Form.useForm<BranchRuleForm>()
  const base = `/projects/${project.id}/protected_branches`
  const key = ['protected-branches', project.id]
  const refresh = [key, ['branch-list', project.id], ['branches', project.id], ['settings-branches', project.id]]
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => getAll<ProtectedBranch>(base, {}, undefined, signal) })
  const branches = useBranches(project.id)
  const branchNames = useMemo(() => (branches.data ?? []).map((b) => b.name), [branches.data])
  const nameInput = Form.useWatch('name', form) ?? ''

  const close = () => {
    setEditing(null)
    form.resetFields()
  }

  const open = (rule: ProtectedBranch | 'new') => {
    setEditing(rule)
    form.setFieldsValue(
      rule === 'new'
        ? { name: '', push: 40, merge: 40, force: false }
        : {
            name: rule.name,
            push: roleLevel(rule.push_access_levels),
            merge: roleLevel(rule.merge_access_levels),
            force: rule.allow_force_push
          }
    )
  }

  const patchForce = (rule: ProtectedBranch, on: boolean) =>
    run(
      () => request({ method: 'PATCH', path: `${base}/${enc(rule.name)}`, body: { allow_force_push: on } }),
      on ? '已允许强制推送' : '已禁止强制推送',
      refresh
    )

  const toggleForce = (rule: ProtectedBranch, on: boolean) => {
    if (!on) return void patchForce(rule, false)
    modal.confirm({
      title: `允许向 ${rule.name} 强制推送？`,
      content: '强制推送（git push --force）会改写分支历史，可能导致别人的提交丢失。一般只在个人分支上开启，主分支不建议开启。',
      okText: '允许',
      okButtonProps: { danger: true },
      onOk: () => patchForce(rule, true)
    })
  }

  const save = async (v: BranchRuleForm) => {
    const body = { name: v.name.trim(), push_access_level: v.push, merge_access_level: v.merge, allow_force_push: v.force }
    if (editing === 'new') {
      if (await run(() => post(base, body), '已设为受保护分支', refresh)) close()
      return
    }
    const old = editing!
    const levelsChanged = v.push !== roleLevel(old.push_access_levels) || v.merge !== roleLevel(old.merge_access_levels)
    if (!levelsChanged) {
      if (v.force === old.allow_force_push) return close()
      if (await patchForce(old, v.force)) close()
      return
    }
    // CE 的 PATCH 接口不支持修改角色权限（allowed_to_push 等是付费版功能），只能先取消保护再重新保护
    const custom = [...old.push_access_levels, ...old.merge_access_levels].some((a) => !isRole(a))
    modal.confirm({
      title: '修改推送/合并权限',
      width: 520,
      content: (
        <>
          <p>GitLab 不支持直接修改这两项权限，将先取消保护、再按新设置重新保护（中间间隔不到一秒）。</p>
          {custom && (
            <Alert
              type="warning"
              showIcon
              message="这条规则里有单独指定的用户、群组或部署密钥，重新保护后这些设置会丢失，需要到网页上重新添加。"
            />
          )}
        </>
      ),
      okText: '确认修改',
      onOk: async () => {
        const ok = await run(
          async () => {
            await del(`${base}/${enc(old.name)}`)
            try {
              await post(base, body)
            } catch (e) {
              throw new Error(`已取消保护，但重新保护失败（${(e as Error).message}），请重新添加这条规则`)
            }
          },
          '权限已更新',
          refresh
        )
        if (ok) close()
      }
    })
  }

  if (list.error) return <LoadError error={list.error} />

  const matched = editing === 'new' && nameInput.includes('*') ? branchNames.filter((n) => globToRegExp(nameInput.trim()).test(n)) : []

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="什么是受保护分支？"
        description={
          <>
            受保护的分支不能被删除，并且只有指定角色的人才能直接推送或合并进去，常用来保护 main / master / release 等重要分支。
            默认分支（{project.default_branch ?? '无'}）通常已经受保护：开发者不能直接推送，只能通过合并请求合并。
            分支名可以用通配符，例如 <Typography.Text code>release/*</Typography.Text> 会保护所有 release/ 开头的分支。
          </>
        }
      />
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => open('new')}>
        保护分支
      </Button>
      <Table<ProtectedBranch>
        rowKey="id"
        size="small"
        loading={list.isLoading || list.isFetching}
        dataSource={list.data ?? []}
        pagination={false}
        locale={{ emptyText: '还没有受保护的分支' }}
        columns={[
          {
            title: '分支',
            render: (_, b) => {
              const wildcard = b.name.includes('*')
              const count = wildcard ? branchNames.filter((n) => globToRegExp(b.name).test(n)).length : 0
              return (
                <Space wrap>
                  <Typography.Text strong>{b.name}</Typography.Text>
                  {b.name === project.default_branch && <Tag color="blue">默认分支</Tag>}
                  {wildcard && <Tag>通配符 · 匹配 {count} 个分支</Tag>}
                </Space>
              )
            }
          },
          { title: '允许合并', render: (_, b) => <LevelTags levels={b.merge_access_levels} /> },
          { title: '允许推送', render: (_, b) => <LevelTags levels={b.push_access_levels} /> },
          {
            title: (
              <Tooltip title="强制推送会改写历史，一般不建议在重要分支上开启">
                允许强制推送
              </Tooltip>
            ),
            width: 120,
            render: (_, b) => <Switch size="small" checked={b.allow_force_push} onChange={(on) => toggleForce(b, on)} />
          },
          {
            title: '操作',
            width: 130,
            render: (_, b) => (
              <Space>
                <a onClick={() => open(b)}>修改</a>
                <Popconfirm
                  title={`取消保护 ${b.name}？`}
                  description={
                    b.name === project.default_branch
                      ? '这是默认分支，取消保护后所有开发者都能直接推送、强推甚至删除它'
                      : '取消后有写权限的人都能直接推送或删除该分支'
                  }
                  okText="取消保护"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => run(() => del(`${base}/${enc(b.name)}`), '已取消保护', refresh)}
                >
                  <a style={{ color: '#ff4d4f' }}>取消保护</a>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={editing === 'new' ? '保护分支' : `修改受保护分支：${editing ? editing.name : ''}`}
        open={editing !== null}
        onCancel={close}
        onOk={() => form.submit()}
        okText="保存"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            label="分支名"
            name="name"
            rules={[{ required: true, whitespace: true, message: '请填写分支名' }]}
            extra={
              matched.length > 0
                ? `当前匹配 ${matched.length} 个分支：${matched.slice(0, 5).join('、')}${matched.length > 5 ? ' 等' : ''}`
                : '可从列表选择，也可输入通配符，如 release/* 或 *-stable'
            }
          >
            <AutoComplete
              disabled={editing !== 'new'}
              options={branchNames.filter((n) => n.toLowerCase().includes(nameInput.toLowerCase())).slice(0, 50).map((n) => ({ value: n }))}
              placeholder="例如 main 或 release/*"
            />
          </Form.Item>
          <Form.Item label="允许合并" name="merge" extra="谁可以把合并请求合并进这个分支">
            {levelSelect}
          </Form.Item>
          <Form.Item label="允许推送" name="push" extra="谁可以直接 git push 到这个分支；选「不允许任何人」则只能通过合并请求修改">
            {levelSelect}
          </Form.Item>
          <Form.Item label="允许强制推送" name="force" valuePropName="checked" extra="允许有推送权限的人使用 git push --force 改写历史">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

type TagRuleForm = { name: string; create: number }

function ProtectedTags({ projectId }: { projectId: number }) {
  const run = useAction()
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm<TagRuleForm>()
  const base = `/projects/${projectId}/protected_tags`
  const key = ['protected-tags', projectId]
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => getAll<ProtectedTag>(base, {}, undefined, signal) })
  const tags = useQuery({
    queryKey: ['settings-tags', projectId],
    queryFn: ({ signal }) => getAll<RepoTag>(`/projects/${projectId}/repository/tags`, {}, undefined, signal),
    staleTime: 60_000
  })
  const nameInput = Form.useWatch('name', form) ?? ''

  const save = async (v: TagRuleForm) => {
    const ok = await run(() => post(base, { name: v.name.trim(), create_access_level: v.create }), '已设为受保护标签', [key])
    if (ok) {
      setAdding(false)
      form.resetFields()
    }
  }

  if (list.error) return <LoadError error={list.error} />

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="受保护的标签只有指定角色才能创建、修改或删除，常用于保护发版标签（如 v*），防止版本号被误删或覆盖。"
      />
      <Button
        type="primary"
        style={{ marginBottom: 16 }}
        onClick={() => {
          form.setFieldsValue({ name: '', create: 40 })
          setAdding(true)
        }}
      >
        保护标签
      </Button>
      <Table<ProtectedTag>
        rowKey="name"
        size="small"
        loading={list.isLoading || list.isFetching}
        dataSource={list.data ?? []}
        pagination={false}
        locale={{ emptyText: '还没有受保护的标签' }}
        columns={[
          {
            title: '标签',
            render: (_, t) => (
              <Space>
                <Typography.Text strong>{t.name}</Typography.Text>
                {t.name.includes('*') && <Tag>通配符</Tag>}
              </Space>
            )
          },
          { title: '允许创建', render: (_, t) => <LevelTags levels={t.create_access_levels} /> },
          {
            title: '操作',
            width: 100,
            render: (_, t) => (
              <Popconfirm
                title={`取消保护标签 ${t.name}？`}
                okText="取消保护"
                okButtonProps={{ danger: true }}
                onConfirm={() => run(() => del(`${base}/${enc(t.name)}`), '已取消保护', [key])}
              >
                <a style={{ color: '#ff4d4f' }}>取消保护</a>
              </Popconfirm>
            )
          }
        ]}
      />
      <Modal title="保护标签" open={adding} onCancel={() => setAdding(false)} onOk={() => form.submit()} okText="保存" forceRender>
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            label="标签名"
            name="name"
            rules={[{ required: true, whitespace: true, message: '请填写标签名' }]}
            extra="可输入通配符，如 v* 保护所有 v 开头的标签"
          >
            <AutoComplete
              options={(tags.data ?? [])
                .map((t) => t.name)
                .filter((n) => n.toLowerCase().includes(nameInput.toLowerCase()))
                .slice(0, 50)
                .map((n) => ({ value: n }))}
              placeholder="例如 v*"
            />
          </Form.Item>
          <Form.Item label="允许创建" name="create" extra="谁可以创建匹配的标签">
            {levelSelect}
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

const visibilityOptions = [
  { value: 'private', label: '私有', desc: '只有项目成员能看到' },
  { value: 'internal', label: '内部', desc: '所有登录了这台 GitLab 的用户都能看到' },
  { value: 'public', label: '公开', desc: '任何人不需要登录就能看到' }
]

type GeneralForm = { name: string; description: string; default_branch?: string; visibility?: string }

function GeneralSettings({ project }: { project: ProjectSettingsInfo }) {
  const run = useAction()
  const [form] = Form.useForm<GeneralForm>()
  const [saving, setSaving] = useState(false)
  const branches = useBranches(project.id)

  const reset = () =>
    form.setFieldsValue({
      name: project.name,
      description: project.description ?? '',
      default_branch: project.default_branch,
      visibility: project.visibility
    })
  useEffect(reset, [project])

  const save = async (v: GeneralForm) => {
    setSaving(true)
    await run(() => put(`/projects/${project.id}`, v), '常规设置已保存', [
      ['project', project.id],
      ['branch-list', project.id],
      ['settings-branches', project.id]
    ])
    setSaving(false)
  }

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 640 }} onFinish={save}>
      <Form.Item label="项目名称" name="name" rules={[{ required: true, whitespace: true, message: '请填写项目名称' }]} extra="只改显示名称，仓库地址（路径）不会变">
        <Input />
      </Form.Item>
      <Form.Item label="项目描述" name="description">
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} placeholder="简单介绍一下这个项目" />
      </Form.Item>
      <Form.Item label="默认分支" name="default_branch" extra="打开项目时默认显示的分支，新建合并请求默认合并到这里">
        <Select
          showSearch
          loading={branches.isLoading}
          disabled={!project.default_branch}
          options={(branches.data ?? []).map((b) => ({ value: b.name, label: b.name }))}
          placeholder={project.default_branch ? undefined : '仓库为空，暂无分支'}
        />
      </Form.Item>
      <Form.Item label="可见性" name="visibility" extra="服务器管理员可能禁用了某些可见性级别，或上级群组的可见性更严格，这种情况下保存会报错">
        <Radio.Group>
          <Space direction="vertical">
            {visibilityOptions.map((o) => (
              <Radio key={o.value} value={o.value}>
                {o.label}
                <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                  {o.desc}
                </Typography.Text>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存
        </Button>
        <Button onClick={reset}>撤销修改</Button>
      </Space>
    </Form>
  )
}

const mergeMethods = [
  { value: 'merge', label: '普通合并', desc: '总是生成一个合并提交，保留完整分支历史（GitLab 默认）' },
  { value: 'rebase_merge', label: '变基后合并（半线性历史）', desc: '仍生成合并提交，但源分支必须先变基到目标分支最新代码，否则不能合并' },
  { value: 'ff', label: '仅快进合并', desc: '不生成合并提交，历史是一条直线；源分支落后时需要先变基' }
]

const squashOptions = [
  { value: 'never', label: '不允许压缩', desc: '合并时保留所有提交' },
  { value: 'default_off', label: '允许，默认不勾选', desc: '合并时可以选择把多个提交压缩成一个' },
  { value: 'default_on', label: '允许，默认勾选', desc: '合并时默认压缩，提交人可以取消' },
  { value: 'always', label: '总是压缩', desc: '合并时强制把所有提交压缩成一个' }
]

type MergeForm = Pick<
  ProjectSettingsInfo,
  | 'merge_method'
  | 'squash_option'
  | 'only_allow_merge_if_pipeline_succeeds'
  | 'allow_merge_on_skipped_pipeline'
  | 'only_allow_merge_if_all_discussions_are_resolved'
  | 'remove_source_branch_after_merge'
  | 'approvals_before_merge'
>

function MergeSettings({ project }: { project: ProjectSettingsInfo }) {
  const run = useAction()
  const [form] = Form.useForm<MergeForm>()
  const [saving, setSaving] = useState(false)
  const pipelineRequired = Form.useWatch('only_allow_merge_if_pipeline_succeeds', form)
  const hasApprovals = project.approvals_before_merge !== undefined
  const hasSkipped = project.allow_merge_on_skipped_pipeline !== undefined

  const reset = () =>
    form.setFieldsValue({
      merge_method: project.merge_method,
      squash_option: project.squash_option,
      only_allow_merge_if_pipeline_succeeds: project.only_allow_merge_if_pipeline_succeeds,
      allow_merge_on_skipped_pipeline: project.allow_merge_on_skipped_pipeline,
      only_allow_merge_if_all_discussions_are_resolved: project.only_allow_merge_if_all_discussions_are_resolved,
      remove_source_branch_after_merge: project.remove_source_branch_after_merge,
      approvals_before_merge: project.approvals_before_merge
    })
  useEffect(reset, [project])

  const save = async (v: MergeForm) => {
    setSaving(true)
    await run(() => put(`/projects/${project.id}`, v), '合并请求设置已保存', [['project', project.id]])
    setSaving(false)
  }

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 720 }} onFinish={save}>
      <Form.Item label="合并方式" name="merge_method">
        <Radio.Group>
          <Space direction="vertical">
            {mergeMethods.map((o) => (
              <Radio key={o.value} value={o.value}>
                {o.label}
                <div>
                  <Typography.Text type="secondary">{o.desc}</Typography.Text>
                </div>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Form.Item>
      <Form.Item label="合并时压缩提交（squash）" name="squash_option">
        <Select
          style={{ width: 360 }}
          options={squashOptions.map((o) => ({
            value: o.value,
            label: (
              <span>
                {o.label}
                <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  {o.desc}
                </Typography.Text>
              </span>
            )
          }))}
        />
      </Form.Item>
      <Form.Item label="合并前检查" style={{ marginBottom: 8 }}>
        <Space direction="vertical">
          <Form.Item name="only_allow_merge_if_pipeline_succeeds" valuePropName="checked" noStyle>
            <Checkbox>流水线必须成功才能合并</Checkbox>
          </Form.Item>
          {hasSkipped && pipelineRequired && (
            <Form.Item name="allow_merge_on_skipped_pipeline" valuePropName="checked" noStyle>
              <Checkbox style={{ marginLeft: 24 }}>流水线被跳过（如 [skip ci]）时也视为成功</Checkbox>
            </Form.Item>
          )}
          <Form.Item name="only_allow_merge_if_all_discussions_are_resolved" valuePropName="checked" noStyle>
            <Checkbox>所有讨论都已解决才能合并</Checkbox>
          </Form.Item>
          <Form.Item name="remove_source_branch_after_merge" valuePropName="checked" noStyle>
            <Checkbox>新建合并请求时默认勾选「合并后删除源分支」</Checkbox>
          </Form.Item>
        </Space>
      </Form.Item>
      {hasApprovals && (
        <Form.Item
          label="合并前需要的审批人数"
          name="approvals_before_merge"
          extra="0 表示不需要审批。审批规则属于付费版功能，社区版上修改可能不生效"
        >
          <InputNumber min={0} max={20} />
        </Form.Item>
      )}
      <Space style={{ marginTop: 8 }}>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存
        </Button>
        <Button onClick={reset}>撤销修改</Button>
      </Space>
    </Form>
  )
}

type VariableForm = {
  key: string
  value: string
  variable_type: 'env_var' | 'file'
  environment_scope: string
  protected: boolean
  masked: boolean
  raw: boolean
  description: string
}

const varId = (v: CiVariable) => `${v.key}@${v.environment_scope}`

function Variables({ projectId }: { projectId: number }) {
  const run = useAction()
  const [editing, setEditing] = useState<CiVariable | 'new' | null>(null)
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [form] = Form.useForm<VariableForm>()
  const base = `/projects/${projectId}/variables`
  const key = ['ci-variables', projectId]
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => getAll<CiVariable>(base, {}, undefined, signal) })
  const data = list.data ?? []
  const allShown = data.length > 0 && data.every((v) => revealed.has(varId(v)))

  const toggle = (id: string) =>
    setRevealed((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const open = (v: CiVariable | 'new') => {
    setEditing(v)
    form.setFieldsValue(
      v === 'new'
        ? { key: '', value: '', variable_type: 'env_var', environment_scope: '*', protected: false, masked: false, raw: false, description: '' }
        : {
            key: v.key,
            value: v.value ?? '',
            variable_type: v.variable_type,
            environment_scope: v.environment_scope,
            protected: v.protected,
            masked: v.masked,
            raw: v.raw ?? false,
            description: v.description ?? ''
          }
    )
  }

  const close = () => {
    setEditing(null)
    form.resetFields()
  }

  const save = async (f: VariableForm) => {
    const body = { ...f, environment_scope: f.environment_scope.trim() || '*', description: f.description }
    const ok =
      editing === 'new'
        ? await run(() => post(base, body), '变量已添加', [key])
        : await run(
            () =>
              request({
                method: 'PUT',
                path: `${base}/${enc(editing!.key)}`,
                query: { 'filter[environment_scope]': editing!.environment_scope },
                body
              }),
            '变量已保存',
            [key]
          )
    if (ok) close()
  }

  if (list.error) return <LoadError error={list.error} />

  const editingHidden = editing !== null && editing !== 'new' && editing.value === null

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="CI/CD 变量会在流水线运行时作为环境变量提供给作业，适合存放密码、令牌、服务器地址等不想写进代码的配置。"
      />
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" onClick={() => open('new')}>
          添加变量
        </Button>
        <Button
          icon={allShown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
          disabled={data.length === 0}
          onClick={() => setRevealed(allShown ? new Set() : new Set(data.map(varId)))}
        >
          {allShown ? '隐藏全部值' : '显示全部值'}
        </Button>
      </Space>
      <Table<CiVariable>
        rowKey={varId}
        size="small"
        loading={list.isLoading || list.isFetching}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: '还没有变量' }}
        columns={[
          {
            title: '键',
            render: (_, v) => (
              <Space direction="vertical" size={0}>
                <Typography.Text code copyable>
                  {v.key}
                </Typography.Text>
                {v.description && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v.description}</Typography.Text>}
              </Space>
            )
          },
          {
            title: '值',
            ellipsis: true,
            render: (_, v) => {
              if (v.value === null) return <Typography.Text type="secondary">已隐藏（不可查看）</Typography.Text>
              const shown = revealed.has(varId(v))
              return (
                <Space>
                  <a onClick={() => toggle(varId(v))}>{shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}</a>
                  {shown ? (
                    <Typography.Text code copyable style={{ whiteSpace: 'pre-wrap' }}>
                      {v.value}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">{MASK}</Typography.Text>
                  )}
                </Space>
              )
            }
          },
          {
            title: '环境',
            width: 120,
            render: (_, v) => (v.environment_scope === '*' ? <Tag>全部环境</Tag> : <Tag color="purple">{v.environment_scope}</Tag>)
          },
          {
            title: '属性',
            width: 200,
            render: (_, v) => (
              <Space size={4} wrap>
                {v.variable_type === 'file' && <Tag color="geekblue">文件</Tag>}
                {v.protected && (
                  <Tooltip title="只在受保护分支/标签的流水线中可用">
                    <Tag color="orange">受保护</Tag>
                  </Tooltip>
                )}
                {v.masked && (
                  <Tooltip title="作业日志里会显示为 [MASKED]">
                    <Tag color="green">已遮蔽</Tag>
                  </Tooltip>
                )}
                {v.hidden && <Tag>已隐藏</Tag>}
                {v.raw && (
                  <Tooltip title="值里的 $ 不会被当作变量引用展开">
                    <Tag>原样</Tag>
                  </Tooltip>
                )}
              </Space>
            )
          },
          {
            title: '操作',
            width: 110,
            render: (_, v) => (
              <Space>
                <a onClick={() => open(v)}>修改</a>
                <Popconfirm
                  title={`删除变量 ${v.key}？`}
                  description="正在使用该变量的流水线可能会失败"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    run(
                      () =>
                        request({
                          method: 'DELETE',
                          path: `${base}/${enc(v.key)}`,
                          query: { 'filter[environment_scope]': v.environment_scope }
                        }),
                      '变量已删除',
                      [key]
                    )
                  }
                >
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              </Space>
            )
          }
        ]}
      />
      <Modal
        title={editing === 'new' ? '添加变量' : `修改变量：${editing ? editing.key : ''}`}
        open={editing !== null}
        onCancel={close}
        onOk={() => form.submit()}
        okText="保存"
        width={600}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            label="键"
            name="key"
            rules={[
              { required: true, message: '请填写变量名' },
              { pattern: /^[A-Za-z0-9_]+$/, message: '只能包含字母、数字和下划线' }
            ]}
            extra={editing === 'new' ? '例如 DEPLOY_TOKEN，在脚本里用 $DEPLOY_TOKEN 引用' : '变量名不能修改，如需改名请删除后重新添加'}
          >
            <Input disabled={editing !== 'new'} />
          </Form.Item>
          <Form.Item
            label="值"
            name="value"
            rules={[{ required: true, message: '请填写变量值' }]}
            extra={editingHidden ? '该变量已隐藏，无法读取原值，请重新填写' : undefined}
          >
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 8 }} />
          </Form.Item>
          <Form.Item label="类型" name="variable_type" extra="「文件」类型会把值写进临时文件，环境变量里存的是文件路径，适合证书、kubeconfig 等">
            <Radio.Group
              options={[
                { value: 'env_var', label: '变量' },
                { value: 'file', label: '文件' }
              ]}
            />
          </Form.Item>
          <Form.Item label="环境范围" name="environment_scope" extra="填 * 表示所有环境；也可以填 production、review/* 等，只对对应环境的作业生效">
            <Input style={{ width: 240 }} />
          </Form.Item>
          <Form.Item label="说明" name="description" extra="可选，方便同事知道这个变量是干什么的（GitLab 16.2 及以上版本支持）">
            <Input />
          </Form.Item>
          <Space size={32} wrap>
            <Form.Item label="受保护" name="protected" valuePropName="checked" tooltip="开启后只在受保护分支/标签上运行的流水线能读到它，适合生产环境密钥">
              <Switch />
            </Form.Item>
            <Form.Item
              label="遮蔽"
              name="masked"
              valuePropName="checked"
              tooltip="开启后作业日志里会显示成 [MASKED]。要求值至少 8 个字符、单行，且不含空格等特殊字符"
            >
              <Switch />
            </Form.Item>
            <Form.Item label="原样（不展开）" name="raw" valuePropName="checked" tooltip="开启后值里的 $XXX 不会被当成其他变量展开">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

export default function ProjectSettings({ project }: { project: ProjectSettingsInfo }) {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  const section = params.get('section') ?? 'branches'

  if (me.isLoading) return <Spin />
  const perm = project.permissions
  const level = Math.max(perm?.project_access?.access_level ?? 0, perm?.group_access?.access_level ?? 0)
  // 继承自上级群组的权限可能不出现在 permissions 里，所以只在明确低于维护者时拦截，其余交给接口返回 403
  if (!me.data?.is_admin && level > 0 && level < 40) return <NoPermission />

  return (
    <Tabs
      tabPosition="left"
      activeKey={section}
      onChange={(k) => {
        const next = new URLSearchParams(params)
        next.set('section', k)
        setParams(next)
      }}
      items={[
        { key: 'branches', label: '受保护分支', children: <ProtectedBranches project={project} /> },
        { key: 'tags', label: '受保护标签', children: <ProtectedTags projectId={project.id} /> },
        { key: 'general', label: '常规设置', children: <GeneralSettings project={project} /> },
        { key: 'merge', label: '合并请求', children: <MergeSettings project={project} /> },
        { key: 'variables', label: 'CI/CD 变量', children: <Variables projectId={project.id} /> }
      ]}
    />
  )
}
