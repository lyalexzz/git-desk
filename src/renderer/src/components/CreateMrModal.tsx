import { useEffect } from 'react'
import { Checkbox, Form, Input, Modal, Select } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { getAll, post, useAction, useMe } from '../api'
import ProjectSelect from './ProjectSelect'
import type { Branch, MergeRequest } from '../types'

interface FormValues {
  projectId: number
  source_branch: string
  target_branch: string
  title: string
  description?: string
  draft: boolean
  assignToMe: boolean
  remove_source_branch: boolean
}

export default function CreateMrModal({
  open,
  defaultProjectId,
  onClose,
  onCreated
}: {
  open: boolean
  defaultProjectId?: number
  onClose: () => void
  onCreated: (mr: MergeRequest) => void
}) {
  const me = useMe()
  const run = useAction()
  const [form] = Form.useForm<FormValues>()
  const projectId = Form.useWatch('projectId', form)

  const branches = useQuery({
    queryKey: ['branches-create-mr', projectId],
    queryFn: ({ signal }) => getAll<Branch>(`/projects/${projectId}/repository/branches`, {}, 20, signal),
    enabled: open && !!projectId
  })

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({
      projectId: defaultProjectId,
      draft: false,
      assignToMe: true,
      remove_source_branch: true
    })
  }, [open, defaultProjectId, form])

  useEffect(() => {
    if (!branches.data?.length) return
    const def = branches.data.find((b) => b.default)?.name || branches.data[0]?.name
    if (!form.getFieldValue('target_branch') && def) form.setFieldValue('target_branch', def)
  }, [branches.data, form])

  const onOk = async () => {
    const v = await form.validateFields()
    let created: MergeRequest | null = null
    const ok = await run(
      async () => {
        created = await post<MergeRequest>(`/projects/${v.projectId}/merge_requests`, {
          source_branch: v.source_branch,
          target_branch: v.target_branch,
          title: v.draft && !v.title.startsWith('Draft:') ? `Draft: ${v.title}` : v.title,
          description: v.description,
          assignee_ids: v.assignToMe && me.data ? [me.data.id] : [],
          remove_source_branch: v.remove_source_branch
        })
        return created
      },
      '合并请求已创建',
      [['mrs']]
    )
    if (ok && created) {
      form.resetFields()
      onClose()
      onCreated(created)
    }
  }

  const opts = (branches.data ?? []).map((b) => ({ value: b.name, label: b.default ? `${b.name}（默认）` : b.name }))

  return (
    <Modal title="新建合并请求" open={open} onCancel={onClose} onOk={() => void onOk()} okText="创建" width={640} destroyOnClose>
      <Form form={form} layout="vertical">
        <Form.Item label="项目" name="projectId" rules={[{ required: true, message: '请选择项目' }]}>
          <ProjectSelect />
        </Form.Item>
        <Form.Item label="源分支" name="source_branch" rules={[{ required: true, message: '请选择源分支' }]}>
          <Select showSearch options={opts} loading={branches.isLoading} placeholder="要合并的分支" />
        </Form.Item>
        <Form.Item label="目标分支" name="target_branch" rules={[{ required: true, message: '请选择目标分支' }]}>
          <Select showSearch options={opts} loading={branches.isLoading} placeholder="合并到" />
        </Form.Item>
        <Form.Item label="标题" name="title" rules={[{ required: true, message: '请填写标题' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea rows={5} placeholder="支持 Markdown" />
        </Form.Item>
        <Form.Item name="draft" valuePropName="checked">
          <Checkbox>创建为草稿</Checkbox>
        </Form.Item>
        <Form.Item name="assignToMe" valuePropName="checked">
          <Checkbox>指派给我</Checkbox>
        </Form.Item>
        <Form.Item name="remove_source_branch" valuePropName="checked">
          <Checkbox>合并后删除源分支</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  )
}
