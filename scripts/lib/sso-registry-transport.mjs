/** Parse the JSON payload emitted by CloudBase CLI around progress output. */
export function parseCliJson(output) {
  const trimmed = output.trim()
  const firstObject = trimmed.indexOf('{')
  const lastObject = trimmed.lastIndexOf('}')
  const candidates = [
    trimmed,
    firstObject >= 0 && lastObject > firstObject ? trimmed.slice(firstObject, lastObject + 1) : '',
    ...trimmed.split(/\r?\n/).reverse(),
  ]
  for (const candidate of candidates) {
    if (!candidate.startsWith('{') && !candidate.startsWith('['))
      continue
    try {
      return JSON.parse(candidate)
    }
    catch (error) {
      void error
    }
  }
  throw new Error('CloudBase CLI returned no JSON result')
}

/** Extract an Event Function business response from CloudBase CLI wrappers. */
export function unwrapFunctionResult(value) {
  let current = value
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current === 'string') {
      try {
        current = JSON.parse(current)
        continue
      }
      catch {
        break
      }
    }
    if (current && typeof current === 'object' && 'InvokeResult' in current && Number(current.InvokeResult) !== 0)
      throw new Error(`Registry admin invocation failed: ${current.ErrMsg || 'unknown_error'}`)
    if (current && typeof current === 'object' && typeof current.RetMsg === 'string') {
      current = current.RetMsg
      continue
    }
    if (current && typeof current === 'object' && ('result' in current || 'Result' in current)) {
      current = current.result ?? current.Result
      continue
    }
    if (current && typeof current === 'object' && ('response' in current || 'Response' in current)) {
      current = current.response ?? current.Response
      continue
    }
    if (current && typeof current === 'object' && 'data' in current && !('ok' in current)) {
      current = current.data
      continue
    }
    break
  }
  if (!current || typeof current !== 'object')
    throw new Error('Registry admin returned an invalid result')
  if (current.ok === false)
    throw new Error(`Registry admin rejected the request: ${current.error || 'unknown_error'}`)
  return current.ok === true ? current.data : current
}
