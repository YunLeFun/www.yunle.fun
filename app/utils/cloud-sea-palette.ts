export const cloudPaletteKeys = ['sky-top', 'sky-horizon', 'light', 'shade', 'deep', 'rail'] as const
export type CloudPalette = Record<typeof cloudPaletteKeys[number], [number, number, number]>

/** CSS 是 banner 与 Shader 的唯一色源，避免两套时辰算法/色板逐渐偏离。 */
export function readCloudSeaPalette(element: Element): CloudPalette {
  const css = getComputedStyle(element)
  return Object.fromEntries(cloudPaletteKeys.map((key) => {
    const hex = css.getPropertyValue(`--cloud-${key}`).trim().replace('#', '')
    return [key, [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)]
  })) as CloudPalette
}
