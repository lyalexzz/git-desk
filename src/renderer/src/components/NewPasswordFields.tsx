import type { ReactNode } from 'react'
import { Form, Input, Progress } from 'antd'
import { passwordProblem, passwordStrength, strengthText } from '../password'
import type { User } from '../types'

export interface NewPassword {
  password: string
  confirm: string
}

const colors = ['#ff4d4f', '#ff4d4f', '#faad14', '#52c41a', '#389e0d']

/** 新密码 + 确认，需放在 Form<NewPassword> 里 */
export default function NewPasswordFields({ user, extra }: { user?: User; extra?: ReactNode }) {
  const form = Form.useFormInstance<NewPassword>()
  const pw = Form.useWatch('password', form) ?? ''
  const score = passwordStrength(pw)
  return (
    <>
      <Form.Item
        label="新密码"
        name="password"
        extra={
          pw ? (
            <Progress
              size="small"
              steps={4}
              percent={score * 25}
              strokeColor={colors[score]}
              format={() => strengthText[score]}
            />
          ) : (
            '8-128 位，建议 12 位以上并混合大小写字母、数字和符号；不能包含用户名、姓名、邮箱或 gitlab 等常见词'
          )
        }
        rules={[
          { required: true, message: '请填写新密码' },
          { validator: (_, v: string) => (!v || !passwordProblem(v, user) ? Promise.resolve() : Promise.reject(new Error(passwordProblem(v, user)!))) }
        ]}
      >
        <Input.Password autoComplete="new-password" addonAfter={extra} />
      </Form.Item>
      <Form.Item
        label="确认新密码"
        name="confirm"
        dependencies={['password']}
        rules={[
          { required: true, message: '请再输入一次' },
          ({ getFieldValue }) => ({
            validator: (_, v) => (!v || v === getFieldValue('password') ? Promise.resolve() : Promise.reject(new Error('两次输入不一致')))
          })
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </>
  )
}
