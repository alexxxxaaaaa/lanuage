import { useMemo } from 'react'
import { Layout, Menu, Dropdown, Avatar, Space, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  ApiOutlined,
  BookOutlined,
  DashboardOutlined,
  FileTextOutlined,
  FolderOutlined,
  LogoutOutlined,
  MessageOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'

const { Sider, Header, Content } = Layout

const menuItems: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/users', icon: <TeamOutlined />, label: '用户' },
  { key: '/folders', icon: <FolderOutlined />, label: '单词分类' },
  { key: '/words', icon: <BookOutlined />, label: '单词' },
  { key: '/notes', icon: <FileTextOutlined />, label: '课程笔记' },
  { key: '/expressions', icon: <MessageOutlined />, label: '口语表达' },
  { key: '/ai-usage', icon: <ApiOutlined />, label: 'AI 用量' },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const selectedKey = useMemo(() => {
    const item = menuItems?.find(
      (m) => m && 'key' in m && location.pathname.startsWith(String(m.key)),
    )
    return item ? String((item as { key: string }).key) : '/dashboard'
  }, [location.pathname])

  const userMenu: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: () => {
        logout()
        navigate('/login', { replace: true })
      },
    },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={64} theme="dark">
        <div className="layout-logo">WORD SPRINT</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="layout-header">
          <Typography.Text strong>管理后台</Typography.Text>
          <Dropdown menu={{ items: userMenu }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.username}</span>
            </Space>
          </Dropdown>
        </Header>
        <Content className="layout-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
