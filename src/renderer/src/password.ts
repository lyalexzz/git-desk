import type { User } from './types'

export const isLdapUser = (u?: User) => !!u?.identities?.some((i) => /^ldap/i.test(i.provider))

const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?']

function randomInt(n: number): number {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / n) * n
  do {
    crypto.getRandomValues(buf)
  } while (buf[0] >= limit)
  return buf[0] % n
}

/** 大小写字母、数字、符号各至少一个，去掉 0/O、1/l/I 等易混字符 */
export function generatePassword(length = 16): string {
  const all = sets.join('')
  const chars = sets.map((s) => s[randomInt(s.length)])
  while (chars.length < length) chars.push(all[randomInt(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

/** 0-4 */
export function passwordStrength(pw: string): number {
  if (pw.length < 8) return 0
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((r) => r.test(pw)).length
  return Math.min(4, (pw.length >= 12 ? 2 : 1) + (classes >= 3 ? 1 : 0) + (classes === 4 || pw.length >= 16 ? 1 : 0))
}

export const strengthText = ['太弱', '弱', '一般', '较强', '强']

/** 对应 GitLab 默认规则；实例自定义的复杂度要求以服务器返回为准 */
export function passwordProblem(pw: string, user?: Pick<User, 'username' | 'name' | 'email'>): string | null {
  if (pw.length < 8) return '至少 8 位'
  if (pw.length > 128) return '最多 128 位'
  const lower = pw.toLowerCase()
  const parts = [user?.username, user?.name, user?.email?.split('@')[0], 'gitlab', 'devops']
  const hit = parts.find((p) => p && p.length >= 3 && lower.includes(p.toLowerCase()))
  if (hit) return `不能包含「${hit}」（GitLab 不允许密码包含用户名、姓名、邮箱或 gitlab 等常见词）`
  return null
}

const phrases: [RegExp, string][] = [
  [/must not contain commonly used combinations of words and letters/i, '过于常见，或包含了姓名、用户名、邮箱等信息'],
  [/is too short \(minimum is (\d+) characters?\)/i, '太短（至少 $1 位）'],
  [/is too long \(maximum is (\d+) characters?\)/i, '太长（最多 $1 位）'],
  [/requires at least one number/i, '至少包含一个数字'],
  [/requires at least one lowercase letter/i, '至少包含一个小写字母'],
  [/requires at least one uppercase letter/i, '至少包含一个大写字母'],
  [/requires at least one symbol character/i, '至少包含一个符号'],
  [/doesn't match password/i, '两次输入不一致'],
  [/can't be blank/i, '不能为空']
]

/** 把 GitLab 的英文校验信息（形如 {"password":["is too short ..."]}）转成中文 */
export function passwordError(message: string): string {
  const json = message.match(/\{.*\}$/s)?.[0]
  if (!json) return message
  let errors: Record<string, string[]>
  try {
    errors = JSON.parse(json)
  } catch {
    return message
  }
  const list = Object.entries(errors).flatMap(([field, msgs]) =>
    (Array.isArray(msgs) ? msgs : [String(msgs)]).map((m) => {
      const zh = phrases.reduce((s, [re, to]) => s.replace(re, to), m)
      return field.startsWith('password') ? zh : `${field} ${zh}`
    })
  )
  return list.length ? `密码不符合服务器要求：${list.join('；')}` : message
}
