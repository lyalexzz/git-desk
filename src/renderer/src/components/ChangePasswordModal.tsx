import { useState } from 'react'
import { Alert, App as AntApp, Form, Modal, Segmented, Space, Typography } from 'antd'
import { put, useMe } from '../api'
import { isLdapUser, passwordError } from '../password'
import NewPasswordFields, { type NewPassword } from './NewPasswordFields'

type Mode = 'admin' | 'web'

const tokenNote = '桌面端的登录一般不受影响（GitLab 改密码不会吊销访问令牌）；如之后提示登录失效，重新登录即可。'

export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { modal } = AntApp.useApp()
  const me = useMe()
  const u = me.data
  const ldap = isLdapUser(u)
  const [mode, setMode] = useState<Mode>(u?.is_admin ? 'admin' : 'web')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [form] = Form.useForm<NewPassword>()
  const providers = (u?.identities ?? []).map((i) => i.provider).filter((p) => !/^ldap/i.test(p))

  const openWeb = async () => {
    setBusy(true)
    const r = await window.desktop.openPasswordPage()
    setBusy(false)
    if (r.ok) {
      onClose()
      modal.success({ title: '密码已修改', content: `GitLab 网页端已退出登录，下次请用新密码登录。${tokenNote}` })
    } else if (!r.cancelled) {
      setError(r.error)
    }
  }

  const saveAsAdmin = async (v: NewPassword) => {
    if (!u) return
    setBusy(true)
    setError(undefined)
    try {
      await put(`/users/${u.id}`, { password: v.password })
    } catch (e) {
      setError(passwordError((e as Error).message))
      return
    } finally {
      setBusy(false)
    }
    onClose()
    modal.success({
      title: '密码已修改',
      content: `已通过管理员权限设置新密码。GitLab 网页端可能需要用新密码重新登录。${tokenNote}`
    })
  }

  return (
    <Modal
      open
      title="修改密码"
      width={560}
      maskClosable={false}
      onCancel={() => !busy && onClose()}
      okText={mode === 'admin' ? '保存新密码' : '打开修改密码页面'}
      okButtonProps={{ loading: busy, disabled: !u, style: ldap ? { display: 'none' } : undefined }}
      cancelText={ldap ? '关闭' : '取消'}
      onOk={() => (mode === 'admin' ? form.submit() : void openWeb())}
    >
      {ldap ? (
        <Alert
          type="warning"
          showIcon
          message="账号由 LDAP/单点登录管理，请到公司统一身份系统修改密码"
          description="GitLab 不保存这类账号的密码，在统一身份系统改完后直接用新密码登录 GitLab 即可。"
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {u?.is_admin && (
            <Segmented<Mode>
              block
              value={mode}
              onChange={(v) => {
                setMode(v)
                setError(undefined)
              }}
              options={[
                { label: '管理员直接设置', value: 'admin' },
                { label: '在 GitLab 网页中修改', value: 'web' }
              ]}
            />
          )}
          {providers.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={`账号还关联了 ${providers.join('、')} 登录方式，这里修改的只是 GitLab 本地密码，不影响这些外部账号的密码`}
            />
          )}
          {mode === 'admin' ? (
            <>
              <Typography.Text type="secondary">
                你是管理员，将通过管理员接口直接为自己设置新密码。GitLab 接口无法校验当前密码，所以这里不需要输入当前密码。
              </Typography.Text>
              <Form form={form} layout="vertical" onFinish={saveAsAdmin} requiredMark={false}>
                <NewPasswordFields user={u} />
              </Form>
            </>
          ) : (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              GitLab 不允许普通用户通过接口修改密码，将在应用内打开 GitLab 网页的「修改密码」页面，需要输入当前密码。
              如果网页尚未登录，会先显示登录页，登录后会回到修改页面。保存成功后 GitLab 会退出网页登录，窗口自动关闭。
            </Typography.Paragraph>
          )}
          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      )}
    </Modal>
  )
}
