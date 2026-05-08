import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { register } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import { getErrorMessage } from '../api/error'

export function RegisterPage() {
  const navigate = useNavigate()
  const setSession = useAuthStore((state) => state.setSession)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError('两次密码输入不一致')
      return
    }
    setIsSubmitting(true)
    try {
      const result = await register(username.trim(), password)
      setSession(result.token, result.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(getErrorMessage(err, '注册失败'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">注册</h1>
        <p className="auth-subtitle">创建账户开始你的学习之旅</p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>用户名</span>
            <input
              autoFocus
              required
              minLength={2}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="字母、数字、下划线"
            />
          </label>
          <label className="auth-field">
            <span>密码</span>
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="至少 6 位"
            />
          </label>
          <label className="auth-field">
            <span>确认密码</span>
            <input
              required
              minLength={6}
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button type="submit" className="primary-button" disabled={isSubmitting}>
            {isSubmitting ? '注册中…' : '注册并登录'}
          </button>
        </form>
        <p className="auth-footer">
          已有账户？<Link to="/login">直接登录</Link>
        </p>
      </div>
    </section>
  )
}
