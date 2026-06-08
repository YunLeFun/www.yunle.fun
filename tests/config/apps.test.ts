import { describe, expect, it } from 'vitest'
import { isOfficialOwner, isOfficialUser } from '../../app/config/apps'

describe('isOfficialOwner (按登录名)', () => {
  it('命中官方登录名（大小写不敏感）', () => {
    expect(isOfficialOwner('YunYouJun')).toBe(true)
    expect(isOfficialOwner('yunyoujun')).toBe(true)
    expect(isOfficialOwner('YUNLEFUN')).toBe(true)
  })

  it('非官方登录名返回 false', () => {
    expect(isOfficialOwner('someone')).toBe(false)
  })

  it('空值返回 false', () => {
    expect(isOfficialOwner(null)).toBe(false)
    expect(isOfficialOwner(undefined)).toBe(false)
    expect(isOfficialOwner('')).toBe(false)
  })
})

describe('isOfficialUser (登录名或邮箱域名)', () => {
  it('登录名命中', () => {
    expect(isOfficialUser({ login: 'YunYouJun' })).toBe(true)
  })

  it('官方邮箱域名命中（含子域名、大小写不敏感）', () => {
    expect(isOfficialUser({ email: 'a@yunle.fun' })).toBe(true)
    expect(isOfficialUser({ email: 'b@yunyoujun.cn' })).toBe(true)
    expect(isOfficialUser({ email: 'c@mail.yunle.fun' })).toBe(true)
    expect(isOfficialUser({ email: 'D@YunLe.Fun' })).toBe(true)
  })

  it('登录名与邮箱都非官方时返回 false', () => {
    expect(isOfficialUser({ login: 'rando', email: 'x@gmail.com' })).toBe(false)
  })

  it('相近但不匹配的域名不应误判', () => {
    expect(isOfficialUser({ email: 'x@notyunle.fun' })).toBe(false)
    expect(isOfficialUser({ email: 'x@yunle.fun.evil.com' })).toBe(false)
  })

  it('空值返回 false', () => {
    expect(isOfficialUser(null)).toBe(false)
    expect(isOfficialUser(undefined)).toBe(false)
    expect(isOfficialUser({})).toBe(false)
  })
})
