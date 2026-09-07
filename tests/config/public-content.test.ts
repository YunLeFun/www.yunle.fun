import { describe, expect, it } from 'vitest'
import { announcementRevision, validateContent, visibleAnnouncements } from '../../shared/public-content'

const item = {
  id: 'maintenance',
  title: '维护通知',
  body: '预计十分钟',
  url: '',
  linkLabel: '',
  placement: 'home' as const,
  startsAt: '2026-09-07T00:00:00Z',
  endsAt: '2026-09-07T01:00:00Z',
  enabled: true,
}
describe('announcement display policy', () => {
  it('honors enablement, route and exact time boundaries', () => {
    const now = Date.parse(item.startsAt)
    expect(visibleAnnouncements({ items: [item] }, '/', now)).toHaveLength(1)
    expect(visibleAnnouncements({ items: [item] }, '/download', now)).toHaveLength(0)
    expect(visibleAnnouncements({ items: [{ ...item, placement: 'site' }] }, '/download', now)).toHaveLength(1)
    expect(visibleAnnouncements({ items: [item] }, '/', now - 1)).toHaveLength(0)
    expect(visibleAnnouncements({ items: [item] }, '/', Date.parse(item.endsAt))).toHaveLength(0)
    expect(visibleAnnouncements({ items: [{ ...item, enabled: false }] }, '/', now)).toHaveLength(0)
  })
  it('dismissal follows notice content, not unrelated publication version', () => {
    expect(announcementRevision(item)).toBe(announcementRevision({ ...item }))
    expect(announcementRevision(item)).not.toBe(announcementRevision({ ...item, body: '已恢复' }))
  })
  it('rejects duplicate IDs and ambiguous or reversed times', () => {
    expect(() => validateContent('announcements', { items: [item, item] })).toThrow()
    expect(() => validateContent('announcements', { items: [{ ...item, endsAt: item.startsAt }] })).toThrow()
    expect(() => validateContent('announcements', { items: [{ ...item, startsAt: '2026-09-07T00:00:00' }] })).toThrow()
  })
})
