<script setup lang="ts">
const route = useRoute()
const searchQuery = ref('')

const { data: page } = await useAsyncData(route.path, () => getDocPage(route.path))
const { data: searchIndex } = await useAsyncData('docs-search-index', () => getDocSearchIndex())

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}

const title = page.value.seo?.title || page.value.title
const description = page.value.seo?.description || page.value.description

const pageAnchors = computed(() => {
  const links = page.value?.toc?.links as Array<{ id?: string, text?: string }> | undefined

  return (links || [])
    .filter(link => link.id && link.text)
    .map(link => ({
      label: link.text!,
      to: `#${link.id}`,
    }))
})

const searchResults = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN')

  if (!query)
    return []

  return (searchIndex.value || [])
    .filter(item => item.searchText.includes(query))
    .slice(0, 6)
})

const helpLinks = [
  {
    label: '开始使用',
    description: '认识云乐坊与推荐使用路径',
    icon: 'i-lucide-house',
    to: '/docs/getting-started',
  },
  {
    label: '使用指南',
    description: '了解账号、应用与会员',
    icon: 'i-lucide-compass',
    to: '/docs/getting-started/usage',
  },
  {
    label: '联系支持',
    description: '问题反馈、退款与客诉',
    icon: 'i-lucide-life-buoy',
    to: '/docs/contact',
  },
  {
    label: '开发者文档',
    description: '应用接入与开放规范',
    icon: 'i-lucide-braces',
    to: 'https://docs.yunle.fun',
    target: '_blank',
  },
]

useSeoMeta({
  title,
  ogTitle: title,
  description,
  ogDescription: description,
})
</script>

<template>
  <div v-if="page" class="docs-page">
    <AppContainer class="docs-shell">
      <nav class="docs-breadcrumb" aria-label="面包屑导航">
        <NuxtLink to="/docs/getting-started">
          帮助
        </NuxtLink>
        <Icon name="i-lucide-chevron-right" aria-hidden="true" />
        <span aria-current="page">{{ page.title }}</span>
      </nav>

      <header class="docs-header">
        <div class="docs-header__copy">
          <p>
            <Icon name="i-lucide-circle-help" aria-hidden="true" />
            云乐坊帮助
          </p>
          <h1>{{ page.title }}</h1>
          <span v-if="page.description">{{ page.description }}</span>
        </div>

        <div class="docs-search">
          <label for="docs-search">搜索帮助内容</label>
          <AppInput
            id="docs-search"
            v-model="searchQuery"
            type="search"
            icon="i-lucide-search"
            placeholder="输入关键词"
            autocomplete="off"
            size="xl"
          />

          <div v-if="searchQuery.trim()" class="docs-search__results" aria-live="polite">
            <ul v-if="searchResults.length">
              <li v-for="result in searchResults" :key="result.path">
                <NuxtLink :to="result.path">
                  <span>
                    <strong>{{ result.title }}</strong>
                    <small v-if="result.description">{{ result.description }}</small>
                  </span>
                  <Icon name="i-lucide-arrow-right" aria-hidden="true" />
                </NuxtLink>
              </li>
            </ul>
            <p v-else>
              没有找到相关帮助内容。你可以换一个关键词，或前往
              <NuxtLink to="/docs/contact">
                联系支持
              </NuxtLink>。
            </p>
          </div>
        </div>
      </header>

      <nav
        v-if="pageAnchors.length"
        class="docs-outline docs-outline--mobile"
        aria-label="本页内容"
      >
        <span>本页内容</span>
        <div>
          <NuxtLink v-for="link in pageAnchors" :key="link.to" :to="link.to">
            {{ link.label }}
          </NuxtLink>
        </div>
      </nav>

      <div class="docs-layout">
        <article class="docs-article">
          <AppPageBody class="mt-0 pb-0">
            <MDCRenderer
              v-if="page.body"
              :body="page.body"
              :data="page"
              class="docs-prose"
            />
          </AppPageBody>
        </article>

        <aside class="docs-aside" aria-label="帮助导航">
          <div v-if="pageAnchors.length" class="docs-aside__section">
            <p>本页内容</p>
            <AppPageAnchors :links="pageAnchors" />
          </div>

          <div class="docs-aside__section">
            <p>帮助入口</p>
            <NuxtLink
              v-for="link in helpLinks"
              :key="link.to"
              :to="link.to"
              :target="link.target"
              :rel="link.target === '_blank' ? 'noopener noreferrer' : undefined"
              class="docs-resource"
            >
              <Icon :name="link.icon" aria-hidden="true" />
              <span>
                <strong>{{ link.label }}</strong>
                <small>{{ link.description }}</small>
                <span v-if="link.target === '_blank'" class="sr-only">，在新标签页打开</span>
              </span>
              <Icon
                v-if="link.target === '_blank'"
                name="i-lucide-external-link"
                class="docs-resource__external"
                aria-hidden="true"
              />
            </NuxtLink>
          </div>
        </aside>
      </div>
    </AppContainer>
  </div>
</template>

<style scoped>
.docs-page {
  min-height: 70vh;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-primary) 5%, var(--ui-bg)), var(--ui-bg) 18rem);
}

.docs-shell {
  padding-top: clamp(1.5rem, 4vw, 2.75rem);
  padding-bottom: clamp(4rem, 8vw, 7rem);
}

.docs-breadcrumb {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  color: var(--ui-text-muted);
  font-size: 0.8rem;
}

.docs-breadcrumb a {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  color: var(--ui-primary);
  font-weight: 700;
}

.docs-breadcrumb svg {
  width: 0.85rem;
  height: 0.85rem;
}

.docs-header {
  display: grid;
  gap: 2rem;
  align-items: start;
  border-bottom: 1px solid var(--ui-border);
  padding-block: 1.25rem clamp(2rem, 5vw, 3.5rem);
}

.docs-header__copy {
  max-width: 46rem;
}

.docs-header__copy > p {
  display: inline-flex;
  gap: 0.45rem;
  align-items: center;
  color: var(--ui-primary);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.docs-header__copy > p svg {
  width: 1rem;
  height: 1rem;
}

.docs-header h1 {
  margin-top: 0.55rem;
  color: var(--ui-text-highlighted);
  font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 850;
  letter-spacing: -0.04em;
  line-height: 1.15;
  text-wrap: balance;
}

.docs-header__copy > span {
  display: block;
  max-width: 42rem;
  margin-top: 0.75rem;
  color: var(--ui-text-muted);
  font-size: 1rem;
  line-height: 1.7;
}

.docs-search {
  position: relative;
  width: 100%;
  max-width: 30rem;
}

.docs-search > label {
  display: block;
  margin-bottom: 0.55rem;
  color: var(--ui-text-toned);
  font-size: 0.8rem;
  font-weight: 750;
}

.docs-search :deep([data-slot='root']) {
  width: 100%;
}

.docs-search__results {
  margin-top: 0.75rem;
  border: 1px solid var(--ui-border);
  border-radius: 1rem;
  padding: 0.5rem;
  background: var(--ui-bg-elevated);
  box-shadow: 0 1.25rem 3.5rem -2.75rem color-mix(in srgb, var(--ui-text-highlighted) 38%, transparent);
}

.docs-search__results ul {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.docs-search__results a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  min-height: 3.5rem;
  border-radius: 0.75rem;
  padding: 0.65rem 0.75rem;
}

.docs-search__results a:hover {
  background: var(--ui-bg-muted);
}

.docs-search__results a > span {
  display: grid;
  gap: 0.15rem;
}

.docs-search__results strong {
  color: var(--ui-text-highlighted);
  font-size: 0.85rem;
}

.docs-search__results small {
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.docs-search__results svg {
  width: 0.9rem;
  height: 0.9rem;
  color: var(--ui-text-dimmed);
}

.docs-search__results > p {
  padding: 0.75rem;
  color: var(--ui-text-muted);
  font-size: 0.82rem;
  line-height: 1.6;
}

.docs-search__results > p a {
  display: inline;
  padding: 0;
  color: var(--ui-primary);
  font-weight: 700;
}

.docs-layout {
  display: grid;
  gap: clamp(2.5rem, 6vw, 4rem);
  align-items: start;
  padding-top: clamp(2rem, 5vw, 3.5rem);
}

.docs-article {
  min-width: 0;
  max-width: 52rem;
}

.docs-prose :deep(> p:first-child) {
  color: var(--ui-text-toned);
  font-size: 1.05rem;
  line-height: 1.85;
}

.docs-prose :deep(h2),
.docs-prose :deep(h3) {
  scroll-margin-top: calc(var(--ui-header-height) + 1.5rem);
  text-wrap: balance;
}

.docs-prose :deep(h2) {
  border-top: 1px solid var(--ui-border-muted);
  padding-top: 2rem;
}

.docs-prose :deep(a) {
  text-decoration-color: color-mix(in srgb, var(--ui-primary) 38%, transparent);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.docs-prose :deep(a:hover) {
  text-decoration-color: currentColor;
}

.docs-prose :deep(li::marker) {
  color: var(--ui-primary);
  font-weight: 700;
}

.docs-outline {
  border: 1px solid var(--ui-border-muted);
  border-radius: 1rem;
  padding: 1rem;
  background: var(--ui-bg-elevated);
}

.docs-outline > span {
  color: var(--ui-text-highlighted);
  font-size: 0.75rem;
  font-weight: 800;
}

.docs-outline > div {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.docs-outline a {
  display: inline-flex;
  align-items: center;
  min-height: 2.75rem;
  border-radius: 999px;
  padding: 0.45rem 0.75rem;
  background: var(--ui-bg-muted);
  color: var(--ui-text-toned);
  font-size: 0.78rem;
  font-weight: 650;
}

.docs-outline--mobile {
  margin-top: 1.5rem;
}

.docs-aside {
  display: none;
}

.docs-aside__section {
  border-left: 1px solid var(--ui-border);
  padding-left: 1rem;
}

.docs-aside__section + .docs-aside__section {
  margin-top: 1.75rem;
  padding-top: 0.25rem;
}

.docs-aside__section > p {
  margin-bottom: 0.65rem;
  color: var(--ui-text-highlighted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
}

.docs-resource {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.65rem;
  align-items: center;
  min-height: 3.75rem;
  border-radius: 0.75rem;
  padding: 0.55rem;
}

.docs-resource:hover {
  background: var(--ui-bg-muted);
}

.docs-resource > svg:first-child {
  width: 1rem;
  height: 1rem;
  color: var(--ui-primary);
}

.docs-resource > span {
  display: grid;
  gap: 0.1rem;
}

.docs-resource strong {
  color: var(--ui-text-highlighted);
  font-size: 0.8rem;
}

.docs-resource small {
  color: var(--ui-text-muted);
  font-size: 0.68rem;
  line-height: 1.4;
}

.docs-resource__external {
  width: 0.75rem;
  height: 0.75rem;
  color: var(--ui-text-dimmed);
}

@media (min-width: 768px) {
  .docs-header {
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.55fr);
  }
}

@media (min-width: 1024px) {
  .docs-layout {
    grid-template-columns: minmax(0, 1fr) 15rem;
  }

  .docs-aside {
    position: sticky;
    top: calc(var(--ui-header-height) + 2rem);
    display: block;
  }

  .docs-outline--mobile {
    display: none;
  }
}
</style>
