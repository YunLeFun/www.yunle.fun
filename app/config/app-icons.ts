import advjsStudioIcon from '@yunlefun/icons/svg/advjs-studio-app-icon?url'
import cmsIcon from '@yunlefun/icons/svg/cms-app-icon?url'
import cookIcon from '@yunlefun/icons/svg/cook-app-icon?url'
import fcIcon from '@yunlefun/icons/svg/fc-app-icon?url'
import homeIcon from '@yunlefun/icons/svg/home-app-icon?url'
import playIcon from '@yunlefun/icons/svg/play-app-icon?url'
import smapIcon from '@yunlefun/icons/svg/smap-app-icon?url'
import supportIcon from '@yunlefun/icons/svg/support-app-icon?url'
import wentaIcon from '@yunlefun/icons/svg/wenta-app-icon?url'
import driveIcon from '~/assets/icons/drive-app-icon.svg?url'

// Full app icons include their own background and optical spacing. The card
// applies the display mask once, without adding another layer of padding.
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
