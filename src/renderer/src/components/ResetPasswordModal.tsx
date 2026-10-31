import { useState } from 'react'
import { Alert, App as AntApp, Button, Form, Modal, Space, Typography } from 'antd'
import { put, useMe } from '../api'
import { generatePassword, passwordError } from '../password'
import NewPasswordFields, { type NewPassword } from './NewPasswordFields'
import type { User } from '../types'

export default function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const { modal } = AntApp.useApp()
  const me = useMe()
  const self = me.data?.id === user.id
  const [form] = Form.useForm<NewPassword>()
  const [generated, setGenerated] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const generate = () => {
    const pw = generatePassword()
    setGenerated(pw)
    form.setFieldsValue({ password: pw, confirm: pw })
    void form.validateFields(['password', 'confirm'])
  }

  const save = async (v: NewPassword) => {
    setBusy(true)
    setError(undefined)
    try {
      await put(`/users/${user.id}`, { password: v.password })
    } catch (e) {
      setError(passwordError((e as Error).message))
      return
    } finally {
      setBusy(false)
    }
    onClose()
    modal.success({
      title: `已重置 ${user.name} 的密码`,
      width: 520,
      content: (
        <Space direction="vertical">
          <span>新密码：</span>
          <Typography.Text code copyable={{ text: v.password }}>
            {v.password}
          </Typography.Text>
          <span>
            {self
              ? '这是你自己的账号，密码不会被标记为过期。'
              : '请通过安全渠道告知对方。对方下次登录 GitLab 网页时会被要求先设置自己的新密码。'}
          </span>
        </Space>
      )
    })
  }

  return (
    <Modal
      open
      title={`重置密码：${user.name}（${user.username}）`}
      width={560}
      maskClosable={false}
      onCancel={() => !busy && onClose()}
      okText="重置密码"
      okButtonProps={{ danger: true, loading: busy }}
      onOk={() => form.submit()}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={
            self
              ? '将直接为你自己设置新密码，不需要当前密码。'
              : '管理员设置的密码会被 GitLab 标记为已过期：对方用它登录网页后必须立即改成自己的密码，在此之前无法用密码进行 HTTPS 方式的 Git 操作。GitLab 还会发邮件通知对方密码已被管理员修改。'
          }
        />
        <Form form={form} layout="vertical" onFinish={save} requiredMark={false}>
          <NewPasswordFields
            user={user}
            extra={
              <Button type="link" size="small" style={{ height: 'auto', padding: 0 }} onClick={generate}>
                生成随机密码
              </Button>
            }
          />
        </Form>
        {generated && (
          <Typography.Text type="secondary">
            已生成 16 位随机密码：
            <Typography.Text code copyable={{ text: generated }}>
              {generated}
            </Typography.Text>
          </Typography.Text>
        )}
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Modal>
  )
}
