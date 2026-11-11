/** Static hosting may canonicalize /explore to /explore/. Both use the same scene anchor. */
export function getCloudJourneyPath(path: string): '/' | '/explore' | null {
  const normalized = path.replace(/\/+$/, '') || '/'
  return normalized === '/' || normalized === '/explore' ? normalized : null
}
