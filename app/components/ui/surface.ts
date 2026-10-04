/** Visual contract shared by local Reka adapters and YunLeFun Design panels. */
export const panelSurface = 'border-border bg-popover text-popover-foreground shadow-[var(--ylf-shadow-panel)] backdrop-filter-[var(--ylf-glass-blur)]'

export const panelOverlay = 'bg-[var(--ylf-c-overlay)] backdrop-filter-[var(--ylf-overlay-blur)]'

/** Match Design's dropdown/select geometry and interaction states without replacing Reka behavior. */
export const menuSurface = `${panelSurface} rounded-[var(--ylf-radius)] [font-family:var(--ylf-font-body)]`

export const menuItem = 'min-h-9 pointer-coarse:min-h-11 gap-2 rounded-[var(--ylf-radius-sm)] px-3 py-2 text-[length:var(--ylf-text-sm)] leading-5 text-popover-foreground not-data-[variant=destructive]:data-highlighted:bg-[var(--ylf-c-brand-soft)] not-data-[variant=destructive]:data-highlighted:text-primary not-data-[variant=destructive]:data-highlighted:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ylf-c-brand)_12%,transparent)] [&[aria-current=true]]:bg-[var(--ylf-c-brand-soft)] [&[aria-current=true]]:text-primary cursor-pointer'
