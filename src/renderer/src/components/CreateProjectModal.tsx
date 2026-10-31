import { useEffect, useMemo, useRef, useState } from 'react'
import { Checkbox, Form, Input, Modal, Radio, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { get, post, useAction, useMe } from '../api'
import { visibilityText } from '../labels'
import type { Group, Namespace, Project } from '../types'

interface FormValues {
  name: string
  path?: string
  description?: string
  visibility: 'private' | 'internal' | 'public'
  namespace_id?: number
  initialize_with_readme: boolean
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
}

/** GitLab / 极狐：个人命名空间 + 有创建权限的组 */
function GitlabNamespaceSelect({
  value,
  onChange,
  username
}: {
  value?: number
  onChange?: (v?: number) => void
  username?: string
}) {
  const [input, setInput] = useState('')
  const list = useQuery({
    queryKey: ['create-project-namespaces', input],
    queryFn: ({ signal }) =>
      get<Namespace[]>(
        '/namespaces',
        {
          search: input || undefined,
          min_access_level: 30,
          per_page: 50
        },
        signal
      )
  })

  const options = useMemo(() => {
    const items = list.data ?? []
    return items.map((n) => ({
      value: n.id,
      label: n.kind === 'user' ? `${n.full_path}（个人）` : n.full_path,
      title: n.name
    }))
  }, [list.data])

  const defaulted = useRef(false)
  useEffect(() => {
    defaulted.current = false
  }, [username])
  // 列表加载后若未选，默认个人命名空间
  useEffect(() => {
    if (defaulted.current || value != null || !list.data?.length) return
    const mine =
      list.data.find((n) => n.kind === 'user' && (n.path === username || n.full_path === username)) ||
      list.data.find((n) => n.kind === 'user') ||
      list.data[0]
    if (mine) {
      defaulted.current = true
      onChange?.(mine.id)
    }
  }, [list.data, value, username, onChange])

  return (
    <Select
      showSearch
      value={value}
      placeholder="选择个人空间或组"
      filterOption={false}
      onSearch={setInput}
      onChange={(v) => {
        setInput('')
        onChange?.(v)
      }}
      loading={list.isFetching}
      options={options}
      notFoundContent={list.isFetching ? '加载中…' : '没有可创建项目的命名空间'}
    />
  )
}

/** GitHub：个人（空）或组织 */
function GithubOrgSelect({ value, onChange }: { value?: number; onChange?: (v?: number) => void }) {
  const [input, setInput] = useState('')
  const list = useQuery({
    queryKey: ['create-project-orgs', input],
    queryFn: ({ signal }) =>
      get<Group[]>(
        '/groups',
        {
          search: input || undefined,
          per_page: 50
        },
        signal
      )
  })

  const options = useMemo(() => {
    const orgs = (list.data ?? []).map((g) => ({ value: g.id, label: g.full_path, title: g.full_name }))
    return [{ value: 0, label: '个人账号' }, ...orgs]
  }, [list.data])

  return (
    <Select
      showSearch
      value={value ?? 0}
      placeholder="个人账号或组织"
      filterOption={false}
      onSearch={setInput}
      onChange={(v) => {
        setInput('')
        onChange?.(v === 0 ? undefined : v)
      }}
      loading={list.isFetching}
      options={options}
      notFoundContent={list.isFetching ? '加载中…' : '没有可写的组织'}
    />
  )
}

export default function CreateProjectModal({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (project: Project) => void
}) {
  const run = useAction()
  const me = useMe()
  const [form] = Form.useForm<FormValues>()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig(), enabled: open })
  const isGithub = cfg.data?.provider === 'github'
  const noun = isGithub ? '仓库' : '项目'
  const name = Form.useWatch('name', form)
  const [pathTouched, setPathTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setPathTouched(false)
    form.setFieldsValue({
      name: '',
      path: '',
      description: '',
      visibility: 'private',
      namespace_id: undefined,
      initialize_with_readme: true
    })
  }, [open, form, isGithub])

  useEffect(() => {
    if (!open || pathTouched || isGithub) return
    form.setFieldValue('path', slugify(name || ''))
  }, [name, pathTouched, open, isGithub, form])

  const onOk = async () => {
    const v = await form.validateFields()
    const path = isGithub ? undefined : (v.path || slugify(v.name)).trim()
    if (!isGithub && !path) {
      form.setFields([{ name: 'path', errors: ['请填写路径'] }])
      return
    }
    if (!isGithub && v.namespace_id == null) {
      form.setFields([{ name: 'namespace_id', errors: ['请选择命名空间'] }])
      return
    }
    let created: Project | null = null
    const ok = await run(
      async () => {
        created = await post<Project>('/projects', {
          name: v.name.trim(),
          path,
          description: v.description?.trim() || undefined,
          visibility: isGithub && v.visibility === 'internal' ? 'private' : v.visibility,
          namespace_id: v.namespace_id,
          initialize_with_readme: v.initialize_with_readme
        })
        return created
      },
      `${noun}已创建`,
      [['projects']]
    )
    if (ok && created) {
      onClose()
      onCreated(created)
    }
  }

  const visibilityOptions = isGithub
    ? [
        { value: 'private' as const, label: visibilityText.private },
        { value: 'public' as const, label: visibilityText.public }
      ]
    : [
        { value: 'private' as const, label: visibilityText.private },
        { value: 'internal' as const, label: visibilityText.internal },
        { value: 'public' as const, label: visibilityText.public }
      ]

  return (
    <Modal
      title={`新建${noun}`}
      open={open}
      onCancel={onClose}
      onOk={() => void onOk()}
      okText="创建"
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="名称"
          name="name"
          rules={[
            { required: true, message: `请填写${noun}名称` },
            { max: 255, message: '名称过长' }
          ]}
        >
          <Input placeholder={isGithub ? '例如 my-repo' : '例如 我的项目'} maxLength={255} />
        </Form.Item>
        {!isGithub && (
          <Form.Item
            label="路径（URL 中的标识）"
            name="path"
            rules={[
              { required: true, message: '请填写路径' },
              {
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
                message: '只能以字母或数字开头，可含 . _ -'
              }
            ]}
            extra="会用于仓库地址，创建后一般不要改"
          >
            <Input placeholder="my-project" onChange={() => setPathTouched(true)} />
          </Form.Item>
        )}
        <Form.Item
          label={isGithub ? '归属' : '命名空间'}
          name="namespace_id"
          rules={isGithub ? [] : [{ required: true, message: '请选择命名空间' }]}
        >
          {isGithub ? (
            <GithubOrgSelect />
          ) : (
            <GitlabNamespaceSelect username={me.data?.username} />
          )}
        </Form.Item>
        <Form.Item label="可见性" name="visibility" rules={[{ required: true }]}>
          <Radio.Group options={visibilityOptions} optionType="button" />
        </Form.Item>
        <Form.Item label="说明" name="description">
          <Input.TextArea rows={3} placeholder="可选" maxLength={2000} showCount />
        </Form.Item>
        <Form.Item name="initialize_with_readme" valuePropName="checked">
          <Checkbox>用 README 初始化仓库（创建后可直接浏览）</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  )
}
