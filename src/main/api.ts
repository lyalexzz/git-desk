import { getConfig } from './config'
import { gitlabRequest, cancelGitlab, cancelAllGitlab } from './gitlab'
import { githubRequest } from './github'
import type { ApiRequest, ApiResult } from '../shared/types'

export { cancelGitlab as cancelApi, cancelAllGitlab as cancelAllApi }

export async function apiRequest<T = unknown>(req: ApiRequest): Promise<ApiResult<T>> {
  const cfg = getConfig()
  if (cfg.provider === 'github') return githubRequest<T>(req)
  return gitlabRequest<T>(req)
}
