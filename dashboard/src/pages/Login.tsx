import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Form, Input, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useAuthStore } from '@/store/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)
  const user = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)

  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true })
  }, [user, navigate])

  const onFinish = async (values: { username: string; password: string }) => {
    try {
      await login(values.username, values.password)
      message.success('登录成功')
      navigate('/dashboard', { replace: true })
    } catch {
      /* interceptor 已 toast */
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-title">Word Sprint 管理后台</div>
        <div className="login-subtitle">需用管理员账号登录</div>
        <Form layout="vertical" onFinish={onFinish} autoComplete="off">
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input size="large" prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password
              size="large"
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            登录
          </Button>
        </Form>
      </div>
    </div>
  )
}
