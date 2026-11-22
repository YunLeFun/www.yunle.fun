import type { CookHandoffReply } from '~~/shared/utils/cook-web-handoff'
import { isAnonymousSession } from '@yunlefun/sso'
import { useTcbAuthSession } from './useAuthSession'
import { useServerSession } from './useServerSession'

const TOKEN = /^[\w-]{43}$/

type ViewState = 'opening' | 'switch' | 'switching' | 'cancelled' | 'failed'

export function useCookAccountHandoff() {
  const { auth } = useCloudbase()
  const { user, checkAuthStatus } = useTcbAuthSession()
  const { bootstrapFromCookie } = useServerSession()
  const config = useRuntimeConfig()
  const router = useRouter()
  const state = shallowRef<ViewState>('opening')
  const abort = new AbortController()
  let request = ''
  let confirmation = ''
  let destination = '/settings?tab=account'

  async function browserAccessToken() {
    let { data, error } = await auth.getSession()
    // The SDK can discard an expired refresh token and still report that first
    // read as an error. Re-read so an unknown identity is never treated as absent.
    if (error && !abort.signal.aborted)
      ({ data, error } = await auth.getSession())
    // The SDK returns this exact error when there are no local credentials.
    if (!data?.session && error?.code === 'unauthenticated' && error.message === 'credentials not found')
      return ''
    if (error)
      throw new Error('Could not check the browser session')
    return data?.session && !isAnonymousSession(data.session) ? data.session.access_token : ''
  }

  async function complete(confirmed: string) {
    try {
      const deadline = Date.now() + 20_000
      while (!abort.signal.aborted) {
        const accessToken = await browserAccessToken()
        const reply = await $fetch<CookHandoffReply>('/api/session/cook-handoff', {
          method: 'POST',
          body: { request, confirmation: confirmed },
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
          retry: 0,
          timeout: 12_000,
          signal: abort.signal,
        })
        if (abort.signal.aborted)
          return
        if (reply.state === 'pending') {
          if (Date.now() >= deadline)
            break
          await new Promise(resolve => setTimeout(resolve, 750))
          continue
        }
        if (reply.state === 'switch') {
          confirmation = reply.confirmation
          state.value = 'switch'
          return
        }

        const subject = reply.subject
        if (reply.state === 'issued') {
          // Recheck after the request so a concurrent tab switch isn't silently overwritten.
          if (await browserAccessToken() !== accessToken || abort.signal.aborted)
            break
          let ticket: string | undefined = reply.ticket
          await auth.signInWithCustomTicket(async () => {
            if (!ticket)
              throw new Error('Account handoff ticket already used')
            const value = ticket
            ticket = undefined
            return value
          })
        }
        await checkAuthStatus()
        if (abort.signal.aborted)
          return
        if (user.value?.id !== subject)
          break
        await router.replace(destination)
        return
      }
    }
    catch {
      // Do not emit fetch errors: the browser Authorization header is sensitive.
      if (abort.signal.aborted)
        return
    }
    state.value = 'failed'
  }

  async function open() {
    try {
      // The production SDK stores tokens in memory. A new Safari document must
      // restore its own existing website session before comparing accounts.
      if (config.public.cookieSession && !await browserAccessToken())
        await bootstrapFromCookie()
      if (!abort.signal.aborted)
        await complete('')
    }
    catch {
      if (!abort.signal.aborted)
        state.value = 'failed'
    }
  }

  onMounted(() => {
    const params = new URLSearchParams(window.location.search)
    // A fixed client-side marker keeps the two handoff proofs and the redeem API unchanged.
    if (window.location.hash === '#membership')
      destination = '/pricing'
    window.history.replaceState(window.history.state, '', window.location.pathname)
    const requests = params.getAll('request')
    const bindings = params.getAll('binding')
    if (params.size !== 2 || requests.length !== 1 || bindings.length !== 1
      || !TOKEN.test(requests[0]!) || !TOKEN.test(bindings[0]!)) {
      state.value = 'failed'
      return
    }
    request = requests[0]!
    void open()
  })

  onScopeDispose(() => abort.abort())

  function switchAccount() {
    if (state.value !== 'switch')
      return
    state.value = 'switching'
    void complete(confirmation)
  }

  function cancelSwitch() {
    if (state.value === 'switch')
      state.value = 'cancelled'
  }

  return { state: readonly(state), switchAccount, cancelSwitch }
}
