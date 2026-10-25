<script setup lang="ts">
defineProps<{ security?: boolean }>()
</script>

<template>
  <div class="paper-art" aria-hidden="true">
    <svg v-if="security" viewBox="0 0 360 240">
      <g transform="translate(4 6)">
        <circle class="sun" cx="257" cy="66" r="32" />
        <path class="green" d="M69 174c-35-15-40-48-29-68 27 8 40 32 29 68Z" />
        <path class="cyan" d="M74 172c-12-38 8-61 30-66 7 29-3 51-30 66Z" />
        <path class="paper-edge" d="M52 181c-18-28 5-48 29-45 1-39 57-49 74-19 22-35 77-29 83 11 35-10 57 12 52 35 23-3 35 8 35 24 0 19-17 29-38 29H74c-23 0-34-19-22-35Z" />
        <path class="paper-cloud" d="M44 168c-13-25 6-45 31-42 1-39 57-49 74-19 22-35 77-29 83 11 35-10 57 12 52 35 23-3 35 8 35 24 0 19-17 29-38 29H66c-23 0-32-21-22-38Z" />
        <g transform="rotate(-9 173 108)">
          <path class="blue-shade" d="m125 63 51-16 51 16v53c0 42-51 62-51 62s-51-20-51-62Z" />
          <path class="blue" d="m117 54 51-16 51 16v53c0 42-51 62-51 62s-51-20-51-62Z" />
          <path class="blue-light" d="m127 62 41-13 41 13v45c0 31-41 51-41 51s-41-20-41-51Z" />
          <path class="blue" d="m168 49 41 13v45c0 31-41 51-41 51Z" />
          <path d="m146 103 15 15 27-31" fill="none" stroke="var(--ylf-cloud-highlight)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" />
        </g>
        <g transform="rotate(14 243 162)">
          <rect x="205" y="143" width="83" height="55" rx="7" class="coral-shade" />
          <rect class="coral" x="201" y="137" width="83" height="55" rx="7" />
          <path d="m204 142 39 29 38-29" class="coral-light" />
          <path d="m202 190 29-27m53 27-29-27" fill="none" stroke="var(--paper-coral-shade)" stroke-width="2.5" />
        </g>
        <g transform="rotate(-31 98 151)">
          <circle class="sun-shade" cx="96" cy="137" r="24" />
          <circle class="sun" cx="92" cy="132" r="24" />
          <circle class="paper-edge" cx="92" cy="132" r="10" />
          <path class="sun-shade" d="M88 151h17v62H89v-15h-9v-12h9Z" />
          <path class="sun" d="M84 150h17v58H85v-14h-9v-12h9Z" />
        </g>
        <path class="paper-white" d="M83 194c-8-14 3-27 17-25 8-18 33-18 41 0 15-4 25 8 22 19 19-10 40-2 43 12H96c-10 0-14-2-13-6Z" />
        <path class="pink" d="m277 106 8-8 8 8-8 8Z" />
        <path class="coral" d="m55 70 5-10 5 10 10 5-10 5-5 10-5-10-10-5Z" />
      </g>
    </svg>
    <svg v-else viewBox="0 0 360 240">
      <path class="paper-edge" d="M75 170c-20-32 6-62 38-55 4-50 73-63 97-22 44-14 77 18 68 52 41-1 48 53 4 55H103c-30 0-41-16-28-30Z" />
      <path class="paper-cloud" d="M65 156c-20-32 6-62 38-55 4-50 73-63 97-22 44-14 77 18 68 52 41-1 48 53 4 55H93c-30 0-41-16-28-30Z" />
    </svg>
  </div>
</template>

<style scoped>
.paper-art {
  --paper-coral-shade: color-mix(in srgb, var(--ylf-palette-coral) 80%, var(--ylf-palette-blue));

  pointer-events: none;
}
.paper-art svg {
  width: 100%;
  height: 100%;
}
.paper-cloud {
  fill: var(--ylf-cloud-body);
}
.paper-edge {
  fill: var(--ylf-cloud-shade);
}
.paper-white {
  fill: var(--ylf-cloud-highlight);
}
.blue {
  fill: var(--ylf-palette-blue);
}
.cyan {
  fill: var(--ylf-palette-cyan);
}
.sun {
  fill: var(--ylf-palette-sun);
}
.coral {
  fill: var(--ylf-palette-coral);
}
.pink {
  fill: var(--ylf-palette-pink);
}
.green {
  fill: var(--ylf-palette-green);
}
.blue-shade {
  fill: color-mix(in srgb, var(--ylf-palette-blue) 85%, var(--ylf-palette-cyan));
}
.blue-light {
  fill: color-mix(in srgb, var(--ylf-palette-blue) 65%, white);
}
.coral-shade {
  fill: var(--paper-coral-shade);
}
.coral-light {
  fill: color-mix(in srgb, var(--ylf-palette-coral) 60%, white);
}
.sun-shade {
  fill: color-mix(in srgb, var(--ylf-palette-sun) 80%, var(--ylf-palette-coral));
}
</style>
