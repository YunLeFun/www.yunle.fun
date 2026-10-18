import { describe, expect, it } from 'vitest'
import { estimateReadingMinutes } from '../../app/utils/readingTime'

function body(...texts: string[]) {
  return {
    type: 'root',
    children: texts.map(value => ({ type: 'element', tag: 'p', children: [{ type: 'text', value }] })),
  }
}

describe('estimateReadingMinutes', () => {
  it('rounds short or empty content up to one minute', () => {
    expect(estimateReadingMinutes(undefined)).toBe(1)
    expect(estimateReadingMinutes(body('你好'))).toBe(1)
  })

  it('counts chinese characters at about 400 per minute', () => {
    expect(estimateReadingMinutes(body('云'.repeat(1200)))).toBe(3)
  })

  it('counts english words at about 200 per minute', () => {
    expect(estimateReadingMinutes(body(Array.from({ length: 600 }).fill('cloud').join(' ')))).toBe(3)
  })
})
