export interface User {
  id: number
  username: string
  name: string
  email?: string
  state: string
  is_admin?: boolean
  web_url: string
  last_activity_on?: string | null
  created_at?: string
}

export interface Project {
  id: number
  name: string
  name_with_namespace: string
  path_with_namespace: string
  description: string | null
  default_branch?: string
  web_url: string
  star_count: number
  last_activity_at: string
  visibility?: string
  http_url_to_repo?: string
  ssh_url_to_repo?: string
  empty_repo?: boolean
}

export interface Pipeline {
  id: number
  project_id: number
  status: string
  ref: string
  sha: string
  web_url: string
  created_at: string
  updated_at: string
  source?: string
  user?: User
  duration?: number | null
}

export interface MergeRequest {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  state: string
  author: User
  assignees: User[]
  reviewers?: User[]
  source_branch: string
  target_branch: string
  web_url: string
  created_at: string
  updated_at: string
  draft?: boolean
  detailed_merge_status?: string
  has_conflicts: boolean
  references: { full: string }
  user_notes_count: number
  head_pipeline?: Pipeline | null
}

export interface Issue {
  id: number
  iid: number
  project_id: number
  title: string
  description: string | null
  state: string
  author: User
  assignees: User[]
  labels: string[]
  web_url: string
  created_at: string
  updated_at: string
  references: { full: string }
  user_notes_count: number
  due_date?: string | null
  milestone?: { title: string } | null
}

export interface Job {
  id: number
  name: string
  stage: string
  status: string
  duration: number | null
  created_at: string
  web_url: string
  allow_failure: boolean
}

export interface Note {
  id: number
  body: string
  author: User
  created_at: string
  system: boolean
}

export interface Todo {
  id: number
  action_name: string
  target_type: string
  target_url: string
  body: string
  created_at: string
  author: User
  project?: { id: number; name_with_namespace: string }
  target?: { iid?: number; title?: string; project_id?: number }
}

export interface Member {
  id: number
  username: string
  name: string
  access_level: number
  state: string
  expires_at?: string | null
}

export interface UserEvent {
  id: number
  action_name: string
  target_type: string | null
  created_at: string
  project_id?: number
  push_data?: { commit_count: number; ref: string }
}

export interface Commit {
  id: string
  short_id: string
  title: string
  message: string
  author_name: string
  author_email: string
  created_at: string
  committed_date: string
  parent_ids?: string[]
  web_url?: string
  stats?: { additions: number; deletions: number; total: number }
}

export interface Branch {
  name: string
  default: boolean
  protected?: boolean
  merged?: boolean
  commit?: Commit
}

export interface RepoTag {
  name: string
  message: string | null
  commit: Commit
}

export interface TreeItem {
  id: string
  name: string
  type: 'tree' | 'blob' | 'commit'
  path: string
}

export interface RepoFile {
  file_name: string
  file_path: string
  size: number
  encoding: string
  content: string
}

export interface Diff {
  old_path: string
  new_path: string
  diff: string
  new_file: boolean
  deleted_file: boolean
  renamed_file: boolean
}

export interface ProjectSettingsInfo extends Project {
  merge_method?: 'merge' | 'rebase_merge' | 'ff'
  squash_option?: 'never' | 'always' | 'default_on' | 'default_off'
  only_allow_merge_if_pipeline_succeeds?: boolean
  allow_merge_on_skipped_pipeline?: boolean
  only_allow_merge_if_all_discussions_are_resolved?: boolean
  remove_source_branch_after_merge?: boolean
  approvals_before_merge?: number
  permissions?: {
    project_access?: { access_level: number } | null
    group_access?: { access_level: number } | null
  }
}

export interface ProtectedAccessLevel {
  id?: number
  access_level: number | null
  access_level_description: string
  user_id?: number | null
  group_id?: number | null
  deploy_key_id?: number | null
}

export interface ProtectedBranch {
  id: number
  name: string
  push_access_levels: ProtectedAccessLevel[]
  merge_access_levels: ProtectedAccessLevel[]
  allow_force_push: boolean
}

export interface ProtectedTag {
  name: string
  create_access_levels: ProtectedAccessLevel[]
}

export interface CiVariable {
  key: string
  value: string | null
  variable_type: 'env_var' | 'file'
  protected: boolean
  masked: boolean
  hidden?: boolean
  raw?: boolean
  environment_scope: string
  description?: string | null
}
