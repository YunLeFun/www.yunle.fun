/**
 * 云朵收藏：站内任何一朵可戳的云被戳时调用 collect()，计数存在 localStorage。
 * 到 10 / 50 / 100 下时写入 milestone，由 app.vue 里的 CloudCollectorBadge 展示。
 * 计数只在挂载后读取（load），服务端和首帧都是 0，不会引起 hydration 不一致。
 */
export function useCloudCollection() {
  const count = useState('cloud-pokes', () => 0)
  const milestone = useState<number | null>('cloud-milestone', () => null)

  function load() {
    count.value = Math.max(count.value, readCloudPokes())
  }

  /** 记一次戳云；传入元素时顺带 Q 弹一下（用独立 scale，不打断元素原有动画） */
  function collect(el?: Element | null) {
    // 重新读一次，多个标签页一起戳也不会互相覆盖；存储不可用时退回内存计数
    const next = Math.max(count.value, readCloudPokes()) + 1
    writeCloudPokes(next)
    count.value = next
    milestone.value = cloudMilestone(next) ?? milestone.value

    if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      (el as HTMLElement).style.transformOrigin = '50% 85%'
      el.animate(
        { scale: ['1', '1.08 0.86', '0.95 1.07', '1.02 0.98', '1'], offset: [0, 0.18, 0.42, 0.66, 1] },
        { duration: 640, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      )
    }
  }

  return { count, milestone, load, collect }
}
