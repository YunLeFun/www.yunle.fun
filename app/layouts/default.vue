<template>
  <div>
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:ring-2 focus:ring-ring"
    >
      跳至主要内容
    </a>

    <AppHeader />

    <main id="main-content" tabindex="-1">
      <slot />
    </main>

    <AppFooter />
  </div>
</template>
