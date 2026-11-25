import advjsStudioIcon from '@yunlefun/icons/svg/advjs-studio-app-icon?url&no-inline'
import cmsIcon from '@yunlefun/icons/svg/cms-app-icon?url&no-inline'
import cookIcon from '@yunlefun/icons/svg/cook-app-icon?url&no-inline'
import fcIcon from '@yunlefun/icons/svg/fc-app-icon?url&no-inline'
import homeIcon from '@yunlefun/icons/svg/home-app-icon?url&no-inline'
import playIcon from '@yunlefun/icons/svg/play-app-icon?url&no-inline'
import smapIcon from '@yunlefun/icons/svg/smap-app-icon?url&no-inline'
import supportIcon from '@yunlefun/icons/svg/support-app-icon?url&no-inline'
import wentaIcon from '@yunlefun/icons/svg/wenta-app-icon?url&no-inline'
import driveIcon from '~/assets/icons/drive-app-icon.svg?url&no-inline'

// Full app icons include their own background and optical spacing. The card
// applies the display mask once, without adding another layer of padding.
// Use cacheable URLs because the same icons repeat in the prerendered homepage.
export const appIcons: Readonly<Record<string, string>> = {
  'advjs-studio': advjsStudioIcon,
  'cms': cmsIcon,
  'cook': cookIcon,
  'drive': driveIcon,
  'fc': fcIcon,
  'home': homeIcon,
  'play': playIcon,
  'smap': smapIcon,
  'support': supportIcon,
  'wenta': wentaIcon,
}

// Drive owns its complete app icon. The local copy comes from
// YunLeFun/drive/packages/ui/assets/drive-app-icon.svg and supports previews
// and offline fallback while the stable hosted URL follows product releases.
export const registryAppIconIds: ReadonlySet<string> = new Set(['drive'])
