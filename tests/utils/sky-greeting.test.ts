import { describe, expect, it } from 'vitest'
import { getSkyGreeting } from '../../app/utils/skyGreeting'

describe('getSkyGreeting', () => {
  it.each([
    [5, '早上好'],
    [10, '早上好'],
    [11, '中午好'],
    [14, '下午好'],
    [18, '晚上好'],
    [22, '晚上好'],
    [23, '夜深了，早点休息'],
    [0, '夜深了，早点休息'],
    [4, '夜深了，早点休息'],
  ])('greets hour %i with %s', (hour, text) => {
    expect(getSkyGreeting(hour).text).toBe(text)
  })
})
