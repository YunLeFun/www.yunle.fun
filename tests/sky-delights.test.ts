import { describe, expect, it } from 'vitest'
import { cloudMilestone, readCloudPokes, writeCloudPokes } from '../app/utils/cloudCollection'
import { getSkyPhase } from '../app/utils/skyGreeting'

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [['ylf:cloud-pokes', initial]])
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

describe('getSkyPhase', () => {
  it.each([
    [4, 'night'],
    [5, 'dawn'],
    [7, 'dawn'],
    [8, 'day'],
    [15, 'day'],
    [16, 'golden'],
    [18, 'golden'],
    [19, 'night'],
    [23, 'night'],
    [0, 'night'],
  ])('%i 时是 %s', (hour, phase) => {
    expect(getSkyPhase(hour)).toBe(phase)
  })
})

describe('cloud collection', () => {
  it('读写本地计数，坏数据按 0 处理', () => {
    const store = memoryStorage()
    expect(readCloudPokes(store)).toBe(0)
    writeCloudPokes(12, store)
    expect(readCloudPokes(store)).toBe(12)
    expect(readCloudPokes(memoryStorage('oops'))).toBe(0)
    expect(readCloudPokes(memoryStorage('-3'))).toBe(0)
  })

  it('存储不可用时不抛错', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(readCloudPokes(broken)).toBe(0)
    expect(() => writeCloudPokes(1, broken)).not.toThrow()
    expect(readCloudPokes(undefined)).toBe(0)
  })

  it('只在 10 / 50 / 100 下报里程碑', () => {
    expect([9, 10, 11, 50, 99, 100, 101].map(cloudMilestone)).toEqual([undefined, 10, undefined, 50, undefined, 100, undefined])
  })
})
