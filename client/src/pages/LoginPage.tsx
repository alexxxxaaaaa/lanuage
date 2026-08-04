import {
  Button,
  Card,
  FieldError,
  Form,
  InputGroup,
  Label,
  Spinner,
  TextField,
} from '@heroui/react'
import { AlertCircle, Lock, User } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'

import { login } from '../api/auth'
import { getErrorMessage } from '../api/error'
import { LocaleSwitcher } from '../components/layout/LocaleSwitcher'
import { ThemeToggle } from '../components/layout/ThemeToggle'
import { useI18n } from '../i18n'
import { useAuthStore } from '../store/authStore'

export function LoginPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setSession = useAuthStore((state) => state.setSession)
  const token = useAuthStore((state) => state.token)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await login(username.trim(), password)
      setSession(result.token, result.user)
      const redirect = params.get('redirect')
      navigate(redirect && redirect.startsWith('/') ? redirect : '/', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, t('auth.failed')))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Already signed in — /login has nothing to offer, send them onward.
  if (token) {
    const redirect = params.get('redirect')
    return <Navigate to={redirect && redirect.startsWith('/') ? redirect : '/'} replace />
  }

  return (
    // `background-tertiary` rather than `surface-secondary` for the far stop:
    // the surface tokens are translucent washes now, and a gradient fading to
    // one would fade to whatever sits behind <main> instead of to a colour.
    <main className="relative flex h-full items-center justify-center overflow-hidden bg-linear-to-br from-background via-background to-background-tertiary px-4 py-12">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        <ThemeToggle />
        <LocaleSwitcher />
      </div>

      {/* Decorative aurora orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-accent/22 blur-3xl"
      />
      {/* One gold orb against two blue ones — the login screen is where the
          two brand colours get to introduce themselves. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -bottom-32 size-[28rem] rounded-full bg-gold/18 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 left-1/2 size-72 -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      {/* Subtle grid overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04] [background-image:linear-gradient(to_right,currentColor_1px,transparent_1px),linear-gradient(to_bottom,currentColor_1px,transparent_1px)] [background-size:40px_40px] dark:opacity-[0.06]"
      />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center gap-8">
        <Card className="w-full gap-6 border border-border bg-surface/80 p-6 shadow-2xl backdrop-blur-xl">
          <Card.Header>
            <Card.Title className="text-2xl font-semibold">Word Sprint</Card.Title>
            <Card.Description>{t('auth.subtitle')}</Card.Description>
          </Card.Header>
          <Card.Content>
            <Form onSubmit={handleSubmit} className="space-y-5" validationBehavior="aria">
              <TextField
                isRequired
                autoFocus
                value={username}
                onChange={setUsername}
                name="username"
                className="w-full space-y-1.5"
              >
                <Label className="text-sm font-medium">{t('auth.username')}</Label>
                <InputGroup fullWidth>
                  {/* `.input-group__prefix` 自带一条 inline-end 边框当图标与输入区的
                      分隔线。登录页要的是「图标贴着输入框」的干净外观，用 border-e-0
                      抹掉——HeroUI 的组件样式在 components 层，工具类在 utilities 层，
                      层级更高，不需要 `!` 强制覆盖。 */}
                  <InputGroup.Prefix className="border-e-0">
                    <User className="size-4 text-muted" aria-hidden />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    type="text"
                    autoComplete="username"
                    placeholder={t('auth.usernamePlaceholder')}
                  />
                </InputGroup>
                <FieldError className="text-xs text-danger" />
              </TextField>

              <TextField
                isRequired
                value={password}
                onChange={setPassword}
                name="password"
                className="w-full space-y-1.5"
              >
                <Label className="text-sm font-medium">{t('auth.password')}</Label>
                <InputGroup fullWidth>
                  <InputGroup.Prefix className="border-e-0">
                    <Lock className="size-4 text-muted" aria-hidden />
                  </InputGroup.Prefix>
                  <InputGroup.Input
                    type="password"
                    autoComplete="current-password"
                    placeholder={t('auth.passwordPlaceholder')}
                  />
                </InputGroup>
                <FieldError className="text-xs text-danger" />
              </TextField>

              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                isDisabled={isSubmitting}
                className="mt-4 h-11 font-semibold transition-transform active:scale-[0.98]"
              >
                {isSubmitting ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner /> {t('auth.submitting')}
                  </span>
                ) : (
                  t('auth.submit')
                )}
              </Button>
            </Form>
          </Card.Content>
        </Card>

        <p className="text-center text-xs text-muted">
          © {new Date().getFullYear()} Word Sprint
        </p>
      </div>
    </main>
  )
}
