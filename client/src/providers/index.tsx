import { Toast } from '@heroui/react'
import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router'

import { BreadcrumbOverrideProvider } from './BreadcrumbOverrideProvider'
import { I18nProvider } from './I18nProvider'
import { ThemeProvider } from './ThemeProvider'
import { DialogHost } from '../components/ui/DialogHost'

/** Every app-wide provider, in one place, outermost first. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <BrowserRouter>
          <BreadcrumbOverrideProvider>
            {children}
            <Toast.Provider />
            <DialogHost />
          </BreadcrumbOverrideProvider>
        </BrowserRouter>
      </I18nProvider>
    </ThemeProvider>
  )
}
