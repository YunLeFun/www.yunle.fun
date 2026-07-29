import type {
  AppRecord,
  MyWorkshopOverview,
  WorkshopAccess,
  WorkshopPublicInfo,
  WorkshopSurface,
} from '~/types/app'

interface WorkshopManagement {
  workshop: WorkshopPublicInfo & { ownerUid: string }
  pending: unknown[]
  guests: unknown[]
  blocked: unknown[]
}

interface WorkshopView {
  surface: 'workshop'
  access: WorkshopAccess
  workshop: WorkshopPublicInfo
  apps: AppRecord[]
}

export default defineEventHandler(async (event): Promise<MyWorkshopOverview> => {
  disableSessionResponseCaching(event)
  const accessToken = await requireAppsPlatformAccessToken(event)
  const [mineResponse, joinedResponse] = await Promise.all([
    fetchAppsPlatform<{ management: WorkshopManagement | null }>(
      event,
      '/api/workshops/mine',
      accessToken,
    ),
    fetchAppsPlatform<{ items: WorkshopPublicInfo[] }>(
      event,
      '/api/workshops/joined',
      accessToken,
    ),
  ])

  const ownedWorkshop = mineResponse.management?.workshop
  const summaries = [
    ...(ownedWorkshop ? [ownedWorkshop] : []),
    ...joinedResponse.items,
  ]
  const uniqueSummaries = Array.from(
    new Map(summaries.map(workshop => [workshop._id, workshop])).values(),
  )
  const views = await Promise.all(
    uniqueSummaries.map(workshop =>
      fetchAppsPlatform<WorkshopView>(
        event,
        `/api/workshops/${encodeURIComponent(workshop._id)}`,
        accessToken,
      ),
    ),
  )
  const viewById = new Map(views.map(view => [view.workshop._id, view]))

  const toSurface = (
    workshop: WorkshopPublicInfo,
    expectedAccess: 'active' | 'owner',
  ): WorkshopSurface => {
    const view = viewById.get(workshop._id)
    return {
      access: view?.access === 'owner' || view?.access === 'active'
        ? view.access
        : expectedAccess,
      workshop: view?.workshop || workshop,
      apps: view?.apps || [],
    }
  }

  const owned = ownedWorkshop
    ? {
        ...toSurface(ownedWorkshop, 'owner'),
        guestCount: mineResponse.management?.guests.length || 0,
        pendingCount: mineResponse.management?.pending.length || 0,
      }
    : null

  return {
    owned,
    joined: joinedResponse.items
      .filter(workshop => workshop._id !== ownedWorkshop?._id)
      .map(workshop => toSurface(workshop, 'active')),
  }
})
