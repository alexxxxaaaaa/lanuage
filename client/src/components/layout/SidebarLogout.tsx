import { LogOut } from 'lucide-react'
import { useNavigate } from 'react-router'

import { SidebarRow } from './SidebarRow'
import { useI18n } from '../../i18n'
import { useAuthStore } from '../../store/authStore'

export function SidebarLogout({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n()
  const navigate = useNavigate()

  return (
    <SidebarRow
      as="button"
      type="button"
      tone="danger"
      collapsed={collapsed}
      icon={<LogOut className="size-4" aria-hidden />}
      label={t('auth.logout')}
      onClick={() => {
        useAuthStore.getState().clearSession()
        navigate('/login', { replace: true })
      }}
    />
  )
}
