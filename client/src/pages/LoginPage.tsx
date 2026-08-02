import { useState } from 'react'
import { Button, Input } from '@heroui/react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { login } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import { getErrorMessage } from '../api/error'

export function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setSession = useAuthStore((state) => state.setSession)
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
      setError(getErrorMessage(err, '登录失败'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center bg-linear-135 from-slate-50 to-indigo-50 px-4 py-8">
      <div className="w-full max-w-[380px] rounded-2xl bg-white px-7 py-8 shadow-[0_12px_32px_rgba(15,23,42,0.08)]">
        <h1 className="mt-0 mb-1 text-2xl font-semibold text-slate-900">登录</h1>
        <p className="mt-0 mb-6 text-sm text-slate-500">登录后访问你的词汇库</p>
        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-[13px] text-slate-700">
            <span>用户名</span>
            <Input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] text-slate-700">
            <span>密码</span>
            <Input type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="m-0 text-[13px] text-red-600">{error}</p> : null}
          <Button className="mt-2 w-full" type="submit" isDisabled={isSubmitting}>
            {isSubmitting ? '登录中…' : '登录'}
          </Button>
        </form>
        <p className="mx-0 mt-4.5 mb-0 text-center text-[13px] text-slate-500 [&_a]:text-indigo-500 [&_a]:no-underline">
          没有账户？<Link to="/register">立即注册</Link>
        </p>
      </div>
    </section>
  )
}
