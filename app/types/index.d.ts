import type { Avatar, Badge, Link } from '#ui/types'

export interface BlogPost {
  path?: string
  title: string
  description: string
  date: string
  image?: HTMLImageElement
  badge?: Badge
  authors?: ({
    name: string
    description?: string
    avatar: Avatar
  } & Link)[]
}
