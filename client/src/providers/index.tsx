import { Toast } from '@heroui/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router'

import { AriaLocaleProvider } from './AriaLocaleProvider'
import { AriaRouterProvider } from './AriaRouterProvider'
import { BreadcrumbOverrideProvider } from './BreadcrumbOverrideProvider'
import { I18nProvider } from './I18nProvider'
import { ThemeProvider } from './ThemeProvider'
import { DialogHost } from '../components/ui/DialogHost'

/** Every app-wide provider, in one place, outermost first. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        {/* 读得到语言之后才能转发给 react-aria，所以套在 I18nProvider 里面。 */}
        <AriaLocaleProvider>
          <BrowserRouter>
            {/* 要用 useNavigate，所以在 BrowserRouter 里面。 */}
            <AriaRouterProvider>
              <BreadcrumbOverrideProvider>
                {children}
                <Toast.Provider />
                <DialogHost />
              </BreadcrumbOverrideProvider>
            </AriaRouterProvider>
          </BrowserRouter>
        </AriaLocaleProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
