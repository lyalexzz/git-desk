import type { Provider } from './types'

export interface Capabilities {
  todos: boolean
  audit: boolean
  adminUsers: boolean
  pipelines: boolean
  projectSettings: boolean
  aiReview: boolean
  mrApprovals: boolean
  passwordLogin: boolean
  webLogin: boolean
}

export function capabilities(provider: Provider): Capabilities {
  if (provider === 'github') {
    return {
      todos: false,
      audit: false,
      adminUsers: false,
      pipelines: false,
      projectSettings: false,
      aiReview: false,
      mrApprovals: false,
      passwordLogin: false,
      webLogin: false
    }
  }
  return {
    todos: true,
    audit: true,
    adminUsers: true,
    pipelines: true,
    projectSettings: true,
    aiReview: true,
    mrApprovals: true,
    passwordLogin: true,
    webLogin: true
  }
}
