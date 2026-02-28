/**
 * GitHub 仓库管理 Composable
 * 
 * 功能：
 * - 获取用户个人仓库和组织仓库
 * - 获取用户所属组织列表
 * - 仓库搜索和过滤
 * - 数据缓存和错误处理
 */
import type {
  GitHubRepository,
  GitHubOrganization,
  GitHubUser,
  RepoSelectorOption,
  RepoOwnerType,
  RepoOwner,
  RepoSearchParams,
  ApiResponse,
} from '~/types/github'

interface UseGitHubReposOptions {
  /** 是否自动获取数据 */
  autoFetch?: boolean
  /** 缓存时间（毫秒） */
  cacheTime?: number
}

export function useGitHubRepos(options: UseGitHubReposOptions = {}) {
  const { autoFetch = false, cacheTime = 5 * 60 * 1000 } = options // 默认缓存5分钟
  
  const { user } = useTcbAuth()
  const toast = useToast()

  // 状态管理
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  // 数据缓存
  const userRepos = ref<GitHubRepository[]>([])
  const orgRepos = ref<Record<string, GitHubRepository[]>>({})
  const organizations = ref<GitHubOrganization[]>([])
  const currentUser = ref<GitHubUser | null>(null)
  
  // 缓存时间戳
  const cacheTimestamps = ref<Record<string, number>>({})
  
  // 当前选中的拥有者
  const currentOwner = ref<RepoOwner | null>(null)

  /**
   * 获取GitHub访问令牌
   */
  function getGitHubToken(): string | null {
    if (!user.value?.identities) return null
    
    const githubIdentity = user.value.identities.find(
      identity => user.value?.providers?.includes('github') && identity.accessToken
    )
    
    return githubIdentity?.accessToken || null
  }

  /**
   * 检查缓存是否有效
   */
  function isCacheValid(key: string): boolean {
    const timestamp = cacheTimestamps.value[key]
    if (!timestamp) return false
    return Date.now() - timestamp < cacheTime
  }

  /**
   * 设置缓存时间戳
   */
  function setCacheTimestamp(key: string): void {
    cacheTimestamps.value[key] = Date.now()
  }

  /**
   * GitHub API 请求封装
   */
  async function githubRequest<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const token = getGitHubToken()
    if (!token) {
      throw new Error('未找到GitHub访问令牌，请先绑定GitHub账号')
    }

    try {
      const response = await $fetch<T>(`https://api.github.com${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'YunLeFun-App',
          ...options.headers,
        },
      })

      return {
        data: response,
        success: true,
      }
    } catch (err: any) {
      console.error('GitHub API 请求失败:', err)
      
      let errorMessage = '请求失败'
      if (err.data?.message) {
        errorMessage = err.data.message
      } else if (err.message) {
        errorMessage = err.message
      }

      // 处理常见错误
      if (err.status === 401) {
        errorMessage = 'GitHub访问令牌已过期，请重新绑定GitHub账号'
      } else if (err.status === 403) {
        errorMessage = 'GitHub API访问受限，请稍后重试'
      } else if (err.status === 404) {
        errorMessage = '请求的资源不存在'
      }

      return {
        data: null as T,
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * 获取当前用户信息
   */
  async function fetchCurrentUser(): Promise<void> {
    if (isCacheValid('currentUser') && currentUser.value) return

    try {
      loading.value = true
      error.value = null

      const response = await githubRequest<GitHubUser>('/user')
      if (response.success) {
        currentUser.value = response.data
        setCacheTimestamp('currentUser')
        
        // 设置默认拥有者为当前用户
        if (!currentOwner.value) {
          currentOwner.value = {
            type: 'user',
            login: response.data.login,
            name: response.data.name || response.data.login,
            avatarUrl: response.data.avatar_url,
          }
        }
      } else {
        throw new Error(response.error || '获取用户信息失败')
      }
    } catch (err: any) {
      error.value = err.message
      toast.add({
        title: '获取GitHub用户信息失败',
        description: err.message,
        color: 'error',
      })
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取用户个人仓库
   */
  async function fetchUserRepos(params: RepoSearchParams = {}): Promise<void> {
    const cacheKey = `userRepos_${JSON.stringify(params)}`
    if (isCacheValid(cacheKey) && userRepos.value.length > 0) return

    try {
      loading.value = true
      error.value = null

      const queryParams = new URLSearchParams({
        type: params.type || 'owner',
        sort: params.sort || 'updated',
        direction: params.direction || 'desc',
        per_page: String(params.per_page || 100),
        page: String(params.page || 1),
      })

      const response = await githubRequest<GitHubRepository[]>(`/user/repos?${queryParams}`)
      if (response.success) {
        userRepos.value = response.data
        setCacheTimestamp(cacheKey)
      } else {
        throw new Error(response.error || '获取仓库列表失败')
      }
    } catch (err: any) {
      error.value = err.message
      toast.add({
        title: '获取个人仓库失败',
        description: err.message,
        color: 'error',
      })
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取用户所属组织
   */
  async function fetchOrganizations(): Promise<void> {
    if (isCacheValid('organizations') && organizations.value.length > 0) return

    try {
      loading.value = true
      error.value = null

      const response = await githubRequest<GitHubOrganization[]>('/user/orgs')
      if (response.success) {
        organizations.value = response.data
        setCacheTimestamp('organizations')
      } else {
        throw new Error(response.error || '获取组织列表失败')
      }
    } catch (err: any) {
      error.value = err.message
      // 组织获取失败不显示错误提示，因为用户可能没有加入任何组织
      console.warn('获取组织列表失败:', err.message)
    } finally {
      loading.value = false
    }
  }

  /**
   * 获取组织仓库
   */
  async function fetchOrgRepos(orgLogin: string, params: RepoSearchParams = {}): Promise<void> {
    const cacheKey = `orgRepos_${orgLogin}_${JSON.stringify(params)}`
    if (isCacheValid(cacheKey) && orgRepos.value[orgLogin]?.length > 0) return

    try {
      loading.value = true
      error.value = null

      const queryParams = new URLSearchParams({
        type: params.type || 'all',
        sort: params.sort || 'updated',
        direction: params.direction || 'desc',
        per_page: String(params.per_page || 100),
        page: String(params.page || 1),
      })

      const response = await githubRequest<GitHubRepository[]>(`/orgs/${orgLogin}/repos?${queryParams}`)
      if (response.success) {
        if (!orgRepos.value[orgLogin]) {
          orgRepos.value[orgLogin] = []
        }
        orgRepos.value[orgLogin] = response.data
        setCacheTimestamp(cacheKey)
      } else {
        throw new Error(response.error || '获取组织仓库失败')
      }
    } catch (err: any) {
      error.value = err.message
      toast.add({
        title: '获取组织仓库失败',
        description: err.message,
        color: 'error',
      })
    } finally {
      loading.value = false
    }
  }

  /**
   * 切换仓库拥有者
   */
  async function switchOwner(owner: RepoOwner): Promise<void> {
    currentOwner.value = owner
    
    if (owner.type === 'user') {
      await fetchUserRepos()
    } else {
      await fetchOrgRepos(owner.login)
    }
  }

  /**
   * 获取当前拥有者的仓库列表
   */
  const currentRepos = computed<GitHubRepository[]>(() => {
    if (!currentOwner.value) return []
    
    if (currentOwner.value.type === 'user') {
      return userRepos.value
    } else {
      return orgRepos.value[currentOwner.value.login] || []
    }
  })

  /**
   * 搜索仓库
   */
  function searchRepos(query: string): GitHubRepository[] {
    if (!query.trim()) return currentRepos.value

    const lowerQuery = query.toLowerCase()
    return currentRepos.value.filter(repo => 
      repo.name.toLowerCase().includes(lowerQuery) ||
      repo.full_name.toLowerCase().includes(lowerQuery) ||
      (repo.description && repo.description.toLowerCase().includes(lowerQuery))
    )
  }

  /**
   * 将仓库转换为选择器选项
   */
  function reposToOptions(repos: GitHubRepository[]): RepoSelectorOption[] {
    return repos.map(repo => ({
      value: repo.full_name,
      label: repo.name,
      description: repo.description || undefined,
      icon: repo.private ? 'i-lucide-lock' : 'i-lucide-book-open',
      private: repo.private,
      language: repo.language,
      updatedAt: repo.updated_at,
    }))
  }

  /**
   * 获取拥有者选项列表
   */
  const ownerOptions = computed<RepoOwner[]>(() => {
    const options: RepoOwner[] = []
    
    // 添加当前用户
    if (currentUser.value) {
      options.push({
        type: 'user',
        login: currentUser.value.login,
        name: currentUser.value.name || currentUser.value.login,
        avatarUrl: currentUser.value.avatar_url,
      })
    }
    
    // 添加组织
    organizations.value.forEach(org => {
      options.push({
        type: 'organization',
        login: org.login,
        name: org.description || org.login,
        avatarUrl: org.avatar_url,
      })
    })
    
    return options
  })

  /**
   * 检查GitHub是否已绑定
   */
  const isGitHubConnected = computed(() => {
    return !!getGitHubToken()
  })

  /**
   * 初始化数据
   */
  async function initialize(): Promise<void> {
    if (!isGitHubConnected.value) return

    try {
      await fetchCurrentUser()
      await Promise.all([
        fetchUserRepos(),
        fetchOrganizations(),
      ])
    } catch (err) {
      console.error('初始化GitHub数据失败:', err)
    }
  }

  /**
   * 刷新所有数据
   */
  async function refresh(): Promise<void> {
    // 清除缓存
    cacheTimestamps.value = {}
    userRepos.value = []
    orgRepos.value = {}
    organizations.value = []
    currentUser.value = null
    
    await initialize()
  }

  // 自动初始化
  if (autoFetch) {
    onMounted(() => {
      initialize()
    })
  }

  return {
    // 状态
    loading: readonly(loading),
    error: readonly(error),
    isGitHubConnected,
    
    // 数据
    userRepos: readonly(userRepos),
    orgRepos: readonly(orgRepos),
    organizations: readonly(organizations),
    currentUser: readonly(currentUser),
    currentOwner: readonly(currentOwner),
    currentRepos,
    ownerOptions,
    
    // 方法
    fetchCurrentUser,
    fetchUserRepos,
    fetchOrganizations,
    fetchOrgRepos,
    switchOwner,
    searchRepos,
    reposToOptions,
    initialize,
    refresh,
  }
}