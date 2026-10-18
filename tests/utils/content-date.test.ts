import { describe, expect, it } from 'vitest'
import { formatContentDate } from '../../app/utils/content'

describe('formatContentDate', () => {
  it('formats date-only frontmatter as the same calendar day in every timezone', () => {
    expect(formatContentDate('2023-01-30')).toBe('2023年1月30日')
  })

  it('returns the raw value when the date cannot be parsed', () => {
    expect(formatContentDate('soon')).toBe('soon')
  })
})
