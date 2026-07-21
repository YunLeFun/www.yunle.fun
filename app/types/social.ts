/** 用户公开资料 - 对应 CloudBase NoSQL 集合 `user_profiles` */
export interface UserProfile {
  /** 用户 ID（CloudBase uid，即文档 _id） */
  userId: string
  /** 用户名（可用于 /u/[login] 主页地址，未设置为 null） */
  login: string | null
  /** 昵称 */
  nickname: string
  /** 头像 URL */
  avatar: string | null
  /** 简介 */
  description: string
  /** 粉丝数 */
  followersCount: number
  /** 关注数 */
  followingCount: number
  /** 隐藏粉丝列表（仅本人可见） */
  hideFollowers: boolean
  /** 隐藏关注列表（仅本人可见） */
  hideFollowing: boolean
  /** 是否接收「被关注」通知（缺省视为开启） */
  notifyOnFollow: boolean
}

/** 本人可同步的资料字段（白名单，不含计数） */
export interface MyProfileInput {
  login?: string | null
  nickname?: string
  avatar?: string | null
  description?: string
  hideFollowers?: boolean
  hideFollowing?: boolean
  notifyOnFollow?: boolean
}

/** viewer 与某用户的关注关系 */
export interface FollowRelation {
  /** 我是否关注了 ta */
  isFollowing: boolean
  /** ta 是否关注了我 */
  isFollowedBy: boolean
}

/** 关注 / 取关结果 */
export interface FollowResult {
  following: boolean
  /** true 表示状态此前已是目标态，未变更计数（重放 / 幂等） */
  deduped: boolean
}

/** 关注 / 粉丝列表项（资料 + viewer 是否关注 ta） */
export interface FollowListItem {
  userId: string
  login: string | null
  nickname: string
  avatar: string | null
  followersCount: number
  followingCount: number
  /** 当前登录者是否已关注此人 */
  isFollowing: boolean
  followedAt: number
}

/** 关注 / 粉丝列表分页结果 */
export interface FollowListResult {
  items: FollowListItem[]
  /** 下一页游标；null 表示已到末页 */
  nextSkip: number | null
  /** 对方开启了隐私、列表不可见 */
  hidden?: boolean
}

/** 关注动态 Feed 项（MVP：关注的人发布的公开应用） */
export interface FeedItem {
  type: 'app'
  appId: string
  slug: string
  name: string
  icon: string
  description: string
  owner: {
    userId: string
    login: string | null
    nickname: string
    avatar: string | null
  }
  createdAt: number
  updatedAt: number
}

/** 关注动态分页结果 */
export interface FeedResult {
  items: FeedItem[]
  nextSkip: number | null
}

/** 关注通知 */
export interface FollowNotificationItem {
  id: string
  type: 'follow'
  read: boolean
  createdAt: number
  actor: {
    userId: string
    login: string | null
    nickname: string
    avatar: string | null
  }
}

/** 奖励到账通知（仅公开友好字段） */
export interface RewardNotificationItem {
  id: string
  type: 'reward'
  read: boolean
  createdAt: number
  reward: {
    grantId: string
    rewardName: string
    coinAmount: number
    membershipDays: number
  }
}

export type NotificationItem = FollowNotificationItem | RewardNotificationItem

/** 通知列表分页结果 */
export interface NotificationListResult {
  items: NotificationItem[]
  nextSkip: number | null
}
