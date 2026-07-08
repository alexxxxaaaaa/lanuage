import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Input,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '@/api'
import { UserPicker } from '@/components/UserPicker'
import type { AdminAiUsageResponse } from '@/types/api'

export default function AiUsagePage() {
  const [data, setData] = useState<AdminAiUsageResponse | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [userId, setUserId] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listAiUsage({
        page,
        pageSize,
        userId,
        keyword: keyword || undefined,
      })
      setData(res)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, userId])

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          AI 用量
        </Typography.Title>
        <Space>
          <UserPicker
            value={userId}
            onChange={(v) => {
              setUserId(v)
              setPage(1)
            }}
          />
          <Input.Search
            placeholder="搜索单词"
            allowClear
            style={{ width: 200 }}
            onSearch={(v) => {
              setKeyword(v)
              setPage(1)
              load()
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </Space>
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="筛选范围 · 总 Tokens" value={data?.totals.totalTokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Prompt Tokens" value={data?.totals.promptTokens ?? 0} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="Completion Tokens" value={data?.totals.completionTokens ?? 0} />
          </Card>
        </Col>
      </Row>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data?.rows ?? []}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
        scroll={{ x: 1100 }}
        columns={[
          { title: '用户', dataIndex: 'username', width: 140, fixed: 'left' },
          { title: '单词 / 输入', dataIndex: 'word', ellipsis: true },
          {
            title: '语言',
            dataIndex: 'language',
            width: 80,
            render: (v: string) => <Tag>{v || '-'}</Tag>,
          },
          { title: '模型', dataIndex: 'model', width: 140 },
          {
            title: '功能',
            dataIndex: 'feature',
            width: 140,
            render: (v: string) => <Tag color="blue">{v}</Tag>,
          },
          { title: 'Prompt', dataIndex: 'promptTokens', width: 90 },
          { title: 'Completion', dataIndex: 'completionTokens', width: 110 },
          { title: '合计', dataIndex: 'totalTokens', width: 90 },
          {
            title: '时间',
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
          },
        ]}
      />
    </>
  )
}
