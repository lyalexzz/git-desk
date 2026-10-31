import { useEffect, useState } from 'react'
import { App as AntApp, Button, Card, Descriptions, Form, InputNumber, Popconfirm, Space, Switch } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMe } from '../api'
import { authMethodText, platforms } from '../labels'
import AiSettings from '../components/AiSettings'
import ChangePasswordModal from '../components/ChangePasswordModal'
import GitSshSettings from '../components/GitSshSettings'
import type { ConfigPatch } from '../../../shared/types'

export default function SettingsPage() {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [form] = Form.useForm<ConfigPatch>()
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const me = useMe()
  const c = cfg.data
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    if (c) form.setFieldsValue({ ignoreTls: c.ignoreTls, notify: c.notify, pollMinutes: c.pollMinutes })
  }, [c, form])

  const save = async (v: ConfigPatch) => {
    await window.desktop.saveConfig(v)
    message.success('设置已保存')
    await qc.invalidateQueries({ queryKey: ['config'] })
  }

  const logout = async () => {
    await window.desktop.logout()
    qc.clear()
    await qc.invalidateQueries({ queryKey: ['config'] })
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 760 }}>
      <Card
        title="当前账号"
        extra={
          <Space>
            <Button onClick={() => setChangingPassword(true)} disabled={!me.data}>
              修改密码
            </Button>
            <Popconfirm title="确定退出登录？" description="会清除本机保存的登录令牌" onConfirm={logout}>
              <Button danger>退出登录 / 切换账号</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="平台">{platforms.find((p) => p.value === c?.platform)?.label}</Descriptions.Item>
          <Descriptions.Item label="服务器">{c?.baseUrl}</Descriptions.Item>
          <Descriptions.Item label="版本">
            {c?.serverVersion ? `${c.isJihu ? '极狐 GitLab' : 'GitLab'} ${c.serverVersion}` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="用户">{me.data ? `${me.data.name}（${me.data.username}）` : '-'}</Descriptions.Item>
          <Descriptions.Item label="登录方式">{c?.authMethod ? authMethodText[c.authMethod] : '-'}</Descriptions.Item>
        </Descriptions>
        {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
      </Card>

      <Card title="偏好设置">
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item label="桌面通知（待审核、流水线失败、被 @ 等）" name="notify" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="检查新消息的间隔（分钟）" name="pollMinutes">
            <InputNumber min={1} max={60} />
          </Form.Item>
          <Form.Item label="忽略 HTTPS 证书校验（内网自签证书时开启）" name="ignoreTls" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            保存
          </Button>
        </Form>
      </Card>

      <GitSshSettings />

      <AiSettings />
    </Space>
  )
}
