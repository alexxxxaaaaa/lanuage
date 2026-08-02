import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toast } from '@heroui/react'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n'
import { DialogHost } from './components/ui/DialogHost'

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <BrowserRouter>
      <App />
      <Toast.Provider />
      <DialogHost />
    </BrowserRouter>
  </I18nProvider>,
)
