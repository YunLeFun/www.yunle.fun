# Cloud App Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public `/explore` page that presents every official public app as an accessible cloud atlas and a searchable application grid.

**Architecture:** The page remains the only CloudBase-aware unit and passes normalized `ExplorerApp` records to presentation components. Pure utilities merge display metadata, filter records, and calculate deterministic cloud positions/routes; DOM links provide the interactive cloud islands while a single decorative SVG renders routes. Existing `SkyScene`, Nuxt UI, and project design tokens provide the visual system.

**Tech Stack:** Nuxt 4, Vue 3 Composition API, TypeScript, Nuxt UI, Tailwind CSS 4, CloudBase Web SDK, Vitest, `@nuxt/test-utils`.

## Global Constraints

- Display only `getOfficialApps()` results; do not change production database records or security rules.
- Do not add Three.js, OGL, Cobe, Canvas icon clouds, `motion-v`, or `@inspira-ui/plugins`.
- Reuse `SkyScene`; light mode is clear daylight and dark mode is blue-purple dusk.
- Cloud islands and cards must be real links with keyboard-visible focus states.
- Respect `prefers-reduced-motion: reduce`; no essential information may depend on animation or hover.
- Keep existing `apps.yunle.fun` menu destination; only the homepage “开始探索” CTA changes to `/explore`.
- Preserve unrelated dirty files under `cloudfunctions/` and `tests/ai-gateway/`.
- Any commit uses Conventional Commits.

---

### Task 1: Explorer data model, metadata, and filters

**Files:**
- Create: `app/types/app-explorer.ts`
- Create: `app/config/app-explorer.ts`
- Create: `app/utils/app-explorer.ts`
- Create: `tests/utils/appExplorer.test.ts`

**Interfaces:**
- Consumes: existing `AppRecord` from `app/types/app.ts`.
- Produces: `ExplorerApp`, `ExplorerCategory`, `normalizeExplorerApps(apps)`, `filterExplorerApps(apps, query, category)`, and `getExplorerCategories(apps)`.

- [ ] **Step 1: Write failing normalization and filter tests**

```ts
import { describe, expect, it } from 'vitest'
import { filterExplorerApps, getExplorerCategories, normalizeExplorerApps } from '../../app/utils/app-explorer'

const app = (slug: string, overrides = {}) => ({
  _id: slug,
  _openid: 'owner',
  ownerId: 'owner',
  ownerLogin: 'YunYouJun',
  name: slug,
  slug,
  isPublic: true,
  createdAt: 1,
  updatedAt: 2,
  ...overrides,
})

it('merges configured metadata and falls back safely', () => {
  const result = normalizeExplorerApps([app('ai-sfc'), app('unknown')])
  expect(result[0]).toMatchObject({ category: 'inspiration', featured: true })
  expect(result[1]).toMatchObject({ category: 'other', tags: [], featured: false })
})

it('combines category and case-insensitive text search', () => {
  const apps = normalizeExplorerApps([
    app('ai-sfc', { name: 'AI 春联', description: '生成春联' }),
    app('fc', { name: 'FC 红白机' }),
  ])
  expect(filterExplorerApps(apps, '春联', 'inspiration').map(item => item.slug)).toEqual(['ai-sfc'])
  expect(getExplorerCategories(apps).map(item => item.id)).toEqual(['inspiration', 'play'])
})
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `pnpm vitest run tests/utils/appExplorer.test.ts`

Expected: FAIL because `app/utils/app-explorer.ts` does not exist.

- [ ] **Step 3: Implement types and the pure data pipeline**

Define exact contracts:

```ts
export type ExplorerCategoryId = 'inspiration' | 'creative' | 'developer' | 'play' | 'life' | 'community' | 'other'

export interface ExplorerCategory {
  id: ExplorerCategoryId
  label: string
  description: string
  icon: string
  anchor: { x: number, y: number }
}

export interface ExplorerApp extends AppRecord {
  category: ExplorerCategoryId
  categoryLabel: string
  tags: string[]
  featured: boolean
  accent: string
}
```

Populate `APP_EXPLORER_META` for the 22 currently public slugs read from the production `apps` collection. Keep `other` fallback automatic so future applications still appear. Search across name, description, slug, category label, tags, and owner login after `toLocaleLowerCase('zh-CN')` normalization.

- [ ] **Step 4: Run the data tests**

Run: `pnpm vitest run tests/utils/appExplorer.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the data layer**

```bash
git add app/types/app-explorer.ts app/config/app-explorer.ts app/utils/app-explorer.ts tests/utils/appExplorer.test.ts
git commit -m "feat(explore): add application discovery model"
```

### Task 2: Deterministic cloud layout and route generation

**Files:**
- Create: `app/utils/app-cloud-layout.ts`
- Create: `tests/utils/appCloudLayout.test.ts`

**Interfaces:**
- Consumes: `ExplorerApp[]`, category anchors from `APP_EXPLORER_CATEGORIES`.
- Produces: `layoutCloudApps(apps, options?) => CloudIsland[]` and `buildCloudRoutes(islands) => CloudRoute[]`.

- [ ] **Step 1: Write deterministic layout tests**

```ts
it('returns stable bounded positions independent of input order', () => {
  const first = layoutCloudApps(apps)
  const second = layoutCloudApps([...apps].reverse())
  expect(second).toEqual(first)
  expect(first.every(item => item.x >= 8 && item.x <= 92 && item.y >= 12 && item.y <= 88)).toBe(true)
})

it('creates one core route per visible category and short intra-group routes', () => {
  const islands = layoutCloudApps(apps)
  const routes = buildCloudRoutes(islands)
  expect(routes.some(route => route.kind === 'core')).toBe(true)
  expect(routes.every(route => route.from !== route.to)).toBe(true)
})
```

- [ ] **Step 2: Verify the missing module failure**

Run: `pnpm vitest run tests/utils/appCloudLayout.test.ts`

Expected: FAIL because `app/utils/app-cloud-layout.ts` does not exist.

- [ ] **Step 3: Implement stable placement**

Sort applications by `category` then `slug`. Use FNV-1a for a stable angle seed, each category anchor as the center, and golden-angle offsets. Apply four deterministic collision-relaxation passes, clamp positions to `{ x: 8..92, y: 12..88 }`, and emit percentage coordinates. Featured applications use size `featured`; all others use `default`.

```ts
export interface CloudIsland {
  app: ExplorerApp
  x: number
  y: number
  size: 'featured' | 'default'
}

export interface CloudRoute {
  id: string
  from: string
  to: string
  kind: 'core' | 'group'
  start: { x: number, y: number }
  end: { x: number, y: number }
}
```

- [ ] **Step 4: Run layout tests**

Run: `pnpm vitest run tests/utils/appCloudLayout.test.ts`

Expected: PASS with deterministic snapshots across repeated runs.

- [ ] **Step 5: Commit the layout engine**

```bash
git add app/utils/app-cloud-layout.ts tests/utils/appCloudLayout.test.ts
git commit -m "feat(explore): add deterministic cloud layout"
```

### Task 3: Explorer state composable and discovery controls

**Files:**
- Create: `app/composables/useAppExplorer.ts`
- Create: `app/components/apps/AppDiscoveryToolbar.vue`
- Create: `tests/components/AppDiscoveryToolbar.nuxt.test.ts`

**Interfaces:**
- Consumes: `Ref<AppRecord[]>` and pure utilities from Task 1.
- Produces: `query`, `selectedCategory`, `normalizedApps`, `filteredApps`, `categories`, `clearFilters`, and toolbar `update:query` / `update:category` events.

- [ ] **Step 1: Write the toolbar interaction test**

Mount the toolbar with two categories, type `AI`, click a category button, and assert exact emitted values:

```ts
expect(wrapper.emitted('update:query')?.at(-1)).toEqual(['AI'])
expect(wrapper.emitted('update:category')?.at(-1)).toEqual(['inspiration'])
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm vitest run tests/components/AppDiscoveryToolbar.nuxt.test.ts`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement composable and toolbar**

The toolbar uses a labeled `UInput` with search icon, filter buttons with `aria-pressed`, a live result count, and a clear button only when a filter is active. Do not keep duplicate internal state; emit changes to the parent/composable.

- [ ] **Step 4: Run the toolbar test**

Run: `pnpm vitest run tests/components/AppDiscoveryToolbar.nuxt.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit controls**

```bash
git add app/composables/useAppExplorer.ts app/components/apps/AppDiscoveryToolbar.vue tests/components/AppDiscoveryToolbar.nuxt.test.ts
git commit -m "feat(explore): add discovery filters"
```

### Task 4: Accessible application cards and grid states

**Files:**
- Create: `app/components/apps/AppExplorerIcon.vue`
- Create: `app/components/apps/AppDiscoveryCard.vue`
- Create: `app/components/apps/AppDiscoveryGrid.vue`
- Create: `tests/components/AppDiscoveryGrid.nuxt.test.ts`

**Interfaces:**
- Consumes: `ExplorerApp[]`, `loading`, `error`, and `hasFilters`.
- Produces: semantic cards linking to `/apps/:slug`, optional external “打开应用”, `retry`, and `clear` events.

- [ ] **Step 1: Write grid-state and link tests**

Test loading skeletons, error retry, no applications, filtered empty state, correct detail links, and icon fallback after dispatching an image `error` event.

- [ ] **Step 2: Verify the component test fails**

Run: `pnpm vitest run tests/components/AppDiscoveryGrid.nuxt.test.ts`

Expected: FAIL because the grid components do not exist.

- [ ] **Step 3: Implement card spotlight and states**

Adapt the Inspira UI Card Spotlight pointer-relative radial gradient into `AppDiscoveryCard.vue`; keep attribution in a source comment. The card remains fully readable without pointer movement and uses `focus-within` for keyboard glow. `AppExplorerIcon` fallback order is image → Emoji → `i-lucide-cloud`.

- [ ] **Step 4: Run component tests**

Run: `pnpm vitest run tests/components/AppDiscoveryGrid.nuxt.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the grid**

```bash
git add app/components/apps/AppExplorerIcon.vue app/components/apps/AppDiscoveryCard.vue app/components/apps/AppDiscoveryGrid.vue tests/components/AppDiscoveryGrid.nuxt.test.ts
git commit -m "feat(explore): add application discovery grid"
```

### Task 5: Cloud atlas visualization

**Files:**
- Create: `app/components/apps/AppCloudRoutes.vue`
- Create: `app/components/apps/AppCloudMap.vue`
- Create: `app/components/apps/AppExplorerHero.vue`
- Create: `tests/components/AppCloudMap.nuxt.test.ts`

**Interfaces:**
- Consumes: filtered `ExplorerApp[]`, layout utilities, selected/focused slug.
- Produces: real `/apps/:slug` links, focus/hover preview, decorative single-SVG routes, and scroll-to-grid event.

- [ ] **Step 1: Write accessibility and reduced-motion tests**

Assert every application becomes a link with its accessible name, focus updates the preview, decorative routes have `aria-hidden="true"`, and a `reducedMotion` prop suppresses moving beam classes.

- [ ] **Step 2: Verify the test fails**

Run: `pnpm vitest run tests/components/AppCloudMap.nuxt.test.ts`

Expected: FAIL because cloud map components do not exist.

- [ ] **Step 3: Implement the single-SVG routes**

Render static quadratic paths plus a small number of animated gradient overlays. Use one SVG and one gradient definition. Adapt only the Animated Beam idea; add an MIT/source comment. Set `aria-hidden="true"` and `pointer-events-none`.

- [ ] **Step 4: Implement cloud islands and hero**

Wrap `SkyScene` in a rounded, isolated cloud atlas surface. Render islands as absolutely positioned `NuxtLink` elements in stable DOM order, using percentage coordinates from Task 2. Use `AppExplorerIcon`, a central brand cloud, category labels, a hover/focus preview, and a visible “浏览应用” control.

- [ ] **Step 5: Run visualization tests**

Run: `pnpm vitest run tests/components/AppCloudMap.nuxt.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the atlas**

```bash
git add app/components/apps/AppCloudRoutes.vue app/components/apps/AppCloudMap.vue app/components/apps/AppExplorerHero.vue tests/components/AppCloudMap.nuxt.test.ts
git commit -m "feat(explore): add interactive cloud atlas"
```

### Task 6: Public explore page and homepage entry

**Files:**
- Create: `app/pages/explore.vue`
- Modify: `app/config/home.ts`
- Modify: `nuxt.config.ts`
- Create: `tests/pages/explore.nuxt.test.ts`

**Interfaces:**
- Consumes: `useApps().getOfficialApps()`, `useAppExplorer`, hero, cloud map, toolbar, and grid.
- Produces: `/explore`, retry behavior, SEO metadata, shared filters, and homepage navigation.

- [ ] **Step 1: Write the page integration test**

Mock `getOfficialApps()` with two public apps. Assert the page loads once on mount, renders both cloud links and cards, filtering updates both result regions, retry calls the loader again, and homepage config points to `/explore` without changing the site menu.

- [ ] **Step 2: Verify the page test fails**

Run: `pnpm vitest run tests/pages/explore.nuxt.test.ts`

Expected: FAIL because `/explore` does not exist and the CTA still points to the external application site.

- [ ] **Step 3: Implement page orchestration**

Use explicit state:

```ts
const apps = ref<AppRecord[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function loadApps() {
  loading.value = true
  error.value = null
  try {
    apps.value = await getOfficialApps()
  }
  catch {
    error.value = '云端应用暂时走散了，请稍后重试。'
  }
  finally {
    loading.value = false
  }
}

onMounted(loadApps)
```

Keep the server-rendered shell and SEO title. Add `/explore` to the explicit Nitro prerender route list so the static shell is generated; data still hydrates from CloudBase on the client.

- [ ] **Step 4: Change the homepage CTA**

Change only `homePage.hero.links[0]` to `to: '/explore'` and remove its `_blank` target.

- [ ] **Step 5: Run page integration test**

Run: `pnpm vitest run tests/pages/explore.nuxt.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit page integration**

```bash
git add app/pages/explore.vue app/config/home.ts nuxt.config.ts tests/pages/explore.nuxt.test.ts
git commit -m "feat(explore): publish cloud application atlas"
```

### Task 7: Final verification and documentation

**Files:**
- Modify only if verification exposes a scoped defect in the files above.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified implementation with no unrelated staged changes.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run tests/utils/appExplorer.test.ts tests/utils/appCloudLayout.test.ts tests/components/AppDiscoveryToolbar.nuxt.test.ts tests/components/AppDiscoveryGrid.nuxt.test.ts tests/components/AppCloudMap.nuxt.test.ts tests/pages/explore.nuxt.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run static verification**

Run:

```bash
pnpm eslint app/pages/explore.vue app/components/apps app/composables/useAppExplorer.ts app/config/app-explorer.ts app/utils/app-explorer.ts app/utils/app-cloud-layout.ts app/types/app-explorer.ts tests/utils/appExplorer.test.ts tests/utils/appCloudLayout.test.ts tests/components/AppDiscoveryToolbar.nuxt.test.ts tests/components/AppDiscoveryGrid.nuxt.test.ts tests/components/AppCloudMap.nuxt.test.ts tests/pages/explore.nuxt.test.ts
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`

Expected: all existing and new tests PASS; unrelated AI Gateway work remains unstaged and untouched.

- [ ] **Step 4: Build the application**

Run: `pnpm build`

Expected: Nuxt build exits 0 and prerenders `/explore` without attempting a server-side CloudBase query.

- [ ] **Step 5: Review final diff and dependency boundary**

Run:

```bash
git diff --check
git status --short
git diff -- package.json pnpm-lock.yaml
```

Expected: no whitespace errors, no new graphics dependencies, and only the user's pre-existing AI Gateway files remain unrelated.
