import { useEffect, useState } from 'react'
import { Card, Col, Row, Spin, Statistic, Typography } from 'antd'
import {
  BookOutlined,
  FileTextOutlined,
  FolderOutlined,
  MessageOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { adminApi } from '@/api'
import type { AdminStats } from '@/types/api'

export default function DashboardPage() {
  const [loading, setLoading] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)

  useEffect(() => {
    setLoading(true)
    adminApi
      .stats()
      .then(setStats)
      .finally(() => setLoading(false))
  }, [])

  return (
    <Spin spinning={loading}>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        概览 · 全部用户
      </Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="用户总数"
              value={stats?.users ?? 0}
              prefix={<TeamOutlined />}
              suffix={
                stats ? (
                  <span style={{ fontSize: 12, color: '#52c41a', marginLeft: 8 }}>
                    +{stats.last7DaysNewUsers} 近 7 天
                  </span>
                ) : null
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="单词分类"
              value={stats?.folders ?? 0}
              prefix={<FolderOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="单词总数"
              value={stats?.words ?? 0}
              prefix={<BookOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="笔记篇数"
              value={stats?.notes ?? 0}
              prefix={<FileTextOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="口语表达"
              value={stats?.expressions ?? 0}
              prefix={<MessageOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={8}>
          <Card className="stat-card">
            <Statistic
              title="AI Tokens 累计"
              value={stats?.aiTotalTokens ?? 0}
              prefix={<ThunderboltOutlined />}
            />
          </Card>
        </Col>
      </Row>
    </Spin>
  )
}
