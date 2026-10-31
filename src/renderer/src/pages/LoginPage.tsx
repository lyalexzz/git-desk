import { useEffect, useState } from 'react'
import { Alert, App as AntApp, Button, Card, Collapse, Divider, Form, Input, Select, Space, Switch, Tabs, Typography } from 'antd'
import { GlobalOutlined, KeyOutlined, UserOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { openExternal } from '../api'
import { platforms, productName } from '../labels'
import type { LoginResult, LoginServer, Platform } from '../../../shared/types'

interface ServerForm {
  platform: Platform
  baseUrl: string
  ignoreTls: boolean
  oauthClientId: string
  oauthSecret?: string
}

export default function LoginPage({ onCancel }: { onCancel?: () => void }) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [server] = Form.useForm<ServerForm>()
  const [account] = Form.useForm<{ username: string; password: string }>()
  const [tokenForm] = Form.useForm<{ token: string }>()
  const [busy, setBusy] = useState<'password' | 'web' | 'token' | null>(null)
  const [tab, setTab] = useState('password')
  const cfg = useQuery({ queryKey: ['config'], queryFn: () => window.desktop.getConfig() })
  const redirectUri = useQuery({ queryKey: ['redirect-uri'], queryFn: () => window.desktop.oauthRedirectUri() })

  const platform = Form.useWatch('platform', server)
  const baseUrl: string = (Form.useWatch('baseUrl', server) ?? '').replace(/\/+$/, '')
  const preset = platforms.find((p) => p.value === platform)
  const isGithub = platform === 'github'
  const product = productName(platform || 'gitlab', platform === 'jihu' || platform === 'jihulab')
  // jihulab.com 和 gitlab.com 已关闭 OAuth 密码模式，只能走网页登录
  const isSaas = Boolean(preset?.url) && !isGithub
  const appPage = isSaas ? `${baseUrl}/-/user_settings/applications` : `${baseUrl}/admin/applications/new`

  useEffect(() => {
    if (cfg.data && !onCancel) {
      server.setFieldsValue({
        platform: cfg.data.platform,
        baseUrl: cfg.data.baseUrl,
        ignoreTls: cfg.data.ignoreTls,
        oauthClientId: cfg.data.oauthClientId,
        oauthSecret: ''
      })
    }
  }, [cfg.data, server, onCancel])

  useEffect(() => {
    if (isGithub) setTab('token')
  }, [isGithub])

  const onPlatformChange = (value: Platform) => {
    const p = platforms.find((x) => x.value === value)
    if (p?.url) server.setFieldsValue({ baseUrl: p.url, ignoreTls: false })
    else if (platforms.some((x) => x.url && x.url === server.getFieldValue('baseUrl'))) server.setFieldsValue({ baseUrl: '' })
  }

  const toServer = (s: ServerForm): LoginServer => ({
    platform: s.platform,
    baseUrl: s.baseUrl.replace(/\/+$/, ''),
    ignoreTls: s.ignoreTls,
    oauthClientId: s.oauthClientId,
    oauthSecret: s.oauthSecret
  })

  const run = async (kind: 'password' | 'web' | 'token', login: (s: LoginServer) => Promise<LoginResult>) => {
    let s: ServerForm
    try {
      s = await server.validateFields()
    } catch {
      return
    }
    setBusy(kind)
    try {
      // 不改写当前已登录会话：登录成功由主进程 upsert 账号
      const r = await login(toServer(s))
      if (r.ok) {
        message.success(`登录成功，欢迎你，${r.user.name}`)
        qc.clear()
        await qc.invalidateQueries()
        onCancel?.()
      } else {
        message.error({ content: r.error, duration: 6 })
      }
    } finally {
      setBusy(null)
    }
  }

  const loginPassword = async () => {
    const v = await account.validateFields().catch(() => null)
    if (v) await run('password', (s) => window.desktop.loginWithPassword(v.username, v.password, s))
  }

  const loginToken = async () => {
    const v = await tokenForm.validateFields().catch(() => null)
    if (v) await run('token', (s) => window.desktop.loginWithToken(v.token, s))
  }

  const tokenHelp = isGithub ? (
    <span>
      在 GitHub：Settings → Developer settings → Personal access tokens，新建令牌并勾选 <b>repo</b>、<b>read:user</b>
      {baseUrl && (
        <Typography.Link onClick={() => openExternal(`${baseUrl}/settings/tokens`)}>
          {' '}
          直接打开令牌页面
        </Typography.Link>
      )}
      。企业版可把上方地址改成你的 GitHub Enterprise 主机。
    </span>
  ) : (
    <span>
      在 {product} 网页：右上角头像 → 偏好设置 → 访问令牌，新建令牌并勾选 <b>api</b> 权限。
      {baseUrl && (
        <Typography.Link onClick={() => openExternal(`${baseUrl}/-/user_settings/personal_access_tokens`)}>
          {' '}
          直接打开令牌页面
        </Typography.Link>
      )}
    </span>
  )

  return (
    <div className="login-wrapper no-scrollbar">
      <Card
        title={onCancel ? `添加账号 · ${product}` : `登录 ${product}`}
        style={{ maxWidth: 640, margin: '0 auto' }}
        extra={
          onCancel ? (
            <Button type="link" onClick={onCancel}>
              返回
            </Button>
          ) : undefined
        }
      >
        <Form form={server} layout="vertical" requiredMark={false} initialValues={{ platform: 'gitlab', ignoreTls: false }}>
          <Form.Item label="平台" name="platform">
            <Select options={platforms} onChange={onPlatformChange} />
          </Form.Item>
          <Form.Item
            label="服务器地址"
            name="baseUrl"
            rules={[
              { required: true, message: '请填写服务器地址' },
              { pattern: /^https?:\/\/.+/i, message: '需以 http:// 或 https:// 开头' }
            ]}
          >
            <Input
              disabled={Boolean(preset?.url) && platform !== 'github'}
              placeholder={
                isGithub
                  ? '例如 https://github.com 或企业版 https://github.company.com'
                  : platform === 'jihu' || platform === 'jihulab'
                    ? '例如 https://jihu.company.local'
                    : '例如 http://gitlab.company.local'
              }
            />
          </Form.Item>
          {(!preset?.url || isGithub) && (
            <Form.Item label="忽略 HTTPS 证书校验（内网自签证书时开启）" name="ignoreTls" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}

          {!isGithub && (
            <Collapse
              size="small"
              style={{ marginBottom: 16 }}
              items={[
                {
                  key: 'oauth',
                  label: '高级设置：OAuth 应用（账号密码登录、网页登录需要）',
                  forceRender: true,
                  children: (
                    <>
                      <Alert
                        type="info"
                        style={{ marginBottom: 16 }}
                        message={
                          <div>
                            <div>
                              {isSaas
                                ? `先在 ${product} 网页的「偏好设置 → 应用」新建一个应用：`
                                : `由管理员在 ${product} 的「管理中心 → 应用」新建一次即可，全公司共用：`}
                            </div>
                            <div>
                              · 回调地址填 <Typography.Text code copyable>{redirectUri.data ?? ''}</Typography.Text>
                            </div>
                            <div>· 权限范围勾选 api；取消勾选“机密”后可以不填密钥</div>
                            {baseUrl && (
                              <Typography.Link onClick={() => openExternal(appPage)}>打开新建应用页面</Typography.Link>
                            )}
                          </div>
                        }
                      />
                      <Form.Item label="应用 ID（Application ID）" name="oauthClientId">
                        <Input />
                      </Form.Item>
                      <Form.Item label="密钥（Secret）" name="oauthSecret">
                        <Input.Password placeholder={cfg.data?.hasOAuthSecret ? '已保存，留空则不修改' : '非机密应用可不填'} />
                      </Form.Item>
                    </>
                  )
                }
              ]}
            />
          )}
        </Form>

        {isGithub ? (
          <Form form={tokenForm} layout="vertical" requiredMark={false} onFinish={loginToken}>
            <Alert type="info" style={{ marginBottom: 16 }} message={tokenHelp} />
            <Alert
              type="warning"
              style={{ marginBottom: 16 }}
              message="第一期仅支持个人访问令牌（PAT）。网页 OAuth 登录将在后续版本提供。"
            />
            <Form.Item label="访问令牌" name="token" rules={[{ required: true, message: '请填写访问令牌' }]}>
              <Input.Password placeholder="ghp_xxxxxxxx 或 github_pat_xxxxxxxx" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy === 'token'} disabled={busy !== null}>
              登录
            </Button>
          </Form>
        ) : (
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'password',
                label: '账号密码',
                icon: <UserOutlined />,
                children: isSaas ? (
                  <>
                    <Alert
                      type="info"
                      style={{ marginBottom: 16 }}
                      message={`${product} 云服务不允许在客户端里直接输入密码，请点击下方按钮，在 ${product} 官方登录页输入账号密码（支持手机号、双因素认证）。首次使用需在“高级设置”里填写 OAuth 应用 ID。`}
                    />
                    <Button
                      type="primary"
                      block
                      icon={<GlobalOutlined />}
                      loading={busy === 'web'}
                      disabled={busy !== null}
                      onClick={() => run('web', (s) => window.desktop.loginWithWeb(s))}
                    >
                      打开 {product} 登录页
                    </Button>
                  </>
                ) : (
                  <>
                    <Form form={account} layout="vertical" requiredMark={false} onFinish={loginPassword}>
                      <Form.Item label="用户名或邮箱" name="username" rules={[{ required: true, message: '请填写用户名或邮箱' }]}>
                        <Input autoComplete="username" />
                      </Form.Item>
                      <Form.Item label="密码" name="password" rules={[{ required: true, message: '请填写密码' }]}>
                        <Input.Password autoComplete="current-password" />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" block loading={busy === 'password'} disabled={busy !== null}>
                        登录
                      </Button>
                    </Form>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
                      密码只用于换取登录令牌，不会保存在本机。新版 GitLab 已不支持在客户端里直接输入密码登录，
                      开启了双因素认证或使用 LDAP、手机号、单点登录的账号，请用下面的网页登录。
                    </Typography.Paragraph>
                    <Divider plain>或者</Divider>
                    <Button
                      block
                      icon={<GlobalOutlined />}
                      loading={busy === 'web'}
                      disabled={busy !== null}
                      onClick={() => run('web', (s) => window.desktop.loginWithWeb(s))}
                    >
                      网页登录（在 {product} 登录页输入账号密码）
                    </Button>
                  </>
                )
              },
              {
                key: 'token',
                label: '个人访问令牌',
                icon: <KeyOutlined />,
                children: (
                  <Form form={tokenForm} layout="vertical" requiredMark={false} onFinish={loginToken}>
                    <Alert type="info" style={{ marginBottom: 16 }} message={tokenHelp} />
                    <Form.Item label="访问令牌" name="token" rules={[{ required: true, message: '请填写访问令牌' }]}>
                      <Input.Password placeholder="glpat-xxxxxxxxxxxxxxxxxxxx" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" block loading={busy === 'token'} disabled={busy !== null}>
                      登录
                    </Button>
                  </Form>
                )
              }
            ]}
          />
        )}

        {onCancel && (
          <Space style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">登录成功后会切换到新账号；原账号会话仍会保留，可随时在顶栏切换。</Typography.Text>
          </Space>
        )}
      </Card>
    </div>
  )
}
