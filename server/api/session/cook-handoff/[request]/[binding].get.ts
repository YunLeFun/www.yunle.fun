import { COOK_HANDOFF_TOKEN, cookHandoffConfig } from '../../../../utils/cook-web-handoff'

export default defineEventHandler((event) => {
  cookHandoffConfig(event)
  const request = getRouterParam(event, 'request')
  const binding = getRouterParam(event, 'binding')
  if (!request || !binding || !COOK_HANDOFF_TOKEN.test(request) || !COOK_HANDOFF_TOKEN.test(binding))
    throw createError({ statusCode: 400, statusMessage: 'Invalid account handoff request' })
  return sendRedirect(event, `/auth/cook-account?request=${request}&binding=${binding}`, 303)
})
