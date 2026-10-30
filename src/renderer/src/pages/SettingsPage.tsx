import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Form, Input, InputNumber, Popconfirm, Space, Switch, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { openExternal } from '../api'
import type { SaveConfigInput } from '../../../shared/types'
import type { User } from '../types'

export default function SettingsPage({ firstRun }: { firstRun?: boolean }) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [form] = Form.useForm<SaveConfigInput>()
  const [saving, setSaving] = useState(false)
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const baseUrl = Form.useWatch('baseUrl', form)

  useEffect(() => {
    if (cfg.data) {
      form.setFieldsValue({
        baseUrl: cfg.data.baseUrl,
        ignoreTls: cfg.data.ignoreTls,
        notify: cfg.data.notify,
        pollMinutes: cfg.data.pollMinutes,
        token: ''
      })
    }
  }, [cfg.data, form])

  const onFinish = async (values: SaveConfigInput) => {
    setSaving(true)
    try {
      await window.desktop.saveConfig(values)
      const r = await window.desktop.request<User>({ path: '/user' })
      if (r.ok) message.success(`连接成功，欢迎你，${r.data.name}`)
      else message.error(`已保存，但连接失败：${r.error}`)
      await qc.invalidateQueries()
    } finally {
      setSaving(false)
    }
  }

  const logout = async () => {
    await window.desktop.logout()
    qc.clear()
    await qc.invalidateQueries({ queryKey: ['config'] })
  }

  const tokenPage = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/-/user_settings/personal_access_tokens` : ''

  return (
    <div style={{ maxWidth: 720, margin: firstRun ? '60px auto' : undefined }}>
      <Card title={firstRun ? '欢迎使用 GitLab 桌面版，请先连接你的 GitLab' : '连接设置'}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
          message="如何获取访问令牌"
          description={
            <span>
              登录 GitLab 网页 → 右上角头像 → 偏好设置 → 访问令牌，新建令牌并勾选 <b>api</b> 权限。
              {tokenPage && (
                <Typography.Link onClick={() => openExternal(tokenPage)}> 直接打开令牌页面</Typography.Link>
              )}
            </span>
          }
        />
        <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            label="GitLab 地址"
            name="baseUrl"
            rules={[
              { required: true, message: '请填写 GitLab 地址' },
              { pattern: /^https?:\/\/.+/i, message: '需以 http:// 或 https:// 开头' }
            ]}
          >
            <Input placeholder="例如 http://gitlab.company.local" />
          </Form.Item>
          <Form.Item
            label="个人访问令牌"
            name="token"
            rules={[{ required: !cfg.data?.hasToken, message: '请填写访问令牌' }]}
          >
            <Input.Password placeholder={cfg.data?.hasToken ? '已保存（加密存储），留空则不修改' : 'glpat-xxxx'} />
          </Form.Item>
          <Form.Item label="忽略 HTTPS 证书校验（内网自签证书时开启）" name="ignoreTls" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="桌面通知（待审核、流水线失败、被 @ 等）" name="notify" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="检查新消息的间隔（分钟）" name="pollMinutes">
            <InputNumber min={1} max={60} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存并测试连接
            </Button>
            {cfg.data?.hasToken && (
              <Popconfirm title="确定退出登录并清除已保存的令牌？" onConfirm={logout}>
                <Button danger>退出登录</Button>
              </Popconfirm>
            )}
          </Space>
        </Form>
      </Card>
    </div>
  )
}
