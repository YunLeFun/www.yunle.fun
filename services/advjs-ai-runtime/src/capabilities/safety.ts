import { CapabilitySafetyError } from './errors.js'

const MINOR_SEXUAL_PATTERNS = [
  /(?:未成年|幼女|幼童|儿童|小学生|初中生|未满\s*18).{0,48}(?:色情|性交|性行为|裸照|性描写)/su,
  /(?:色情|性交|性行为|裸照|性描写).{0,48}(?:未成年|幼女|幼童|儿童|小学生|初中生|未满\s*18)/su,
  /\b(?:minor|underage|child|preteen).{0,48}(?:sex|sexual|porn|nude)\b/isu,
  /\b(?:sex|sexual|porn|nude).{0,48}(?:minor|underage|child|preteen)\b/isu,
]

const NON_CONSENSUAL_PATTERNS = [
  /强奸|强暴|迷奸|非自愿性行为|强迫(?:[其她他]|对方)?发生性关系/u,
  /\b(?:rape|raping|non[- ]consensual sex|forced sex)\b/iu,
]

const POLICY_PATTERNS = [
  /(?:真实|现实)(?:儿童|未成年人).{0,32}(?:裸照|色情影像)/su,
]

export function assertContentSafety(text: string): void {
  if (MINOR_SEXUAL_PATTERNS.some(pattern => pattern.test(text)))
    throw new CapabilitySafetyError('CONTENT_BLOCKED_MINOR')
  if (NON_CONSENSUAL_PATTERNS.some(pattern => pattern.test(text)))
    throw new CapabilitySafetyError('CONTENT_BLOCKED_NON_CONSENSUAL')
  if (POLICY_PATTERNS.some(pattern => pattern.test(text)))
    throw new CapabilitySafetyError('CONTENT_BLOCKED_POLICY')
}
