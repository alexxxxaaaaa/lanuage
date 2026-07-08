import { useEffect, useState } from 'react'
import {
  Button,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '@/api'
import { UserPicker } from '@/components/UserPicker'
import type { AdminExpressionRow } from '@/types/api'

export default function ExpressionsPage() {
  const [data, setData] = useState<AdminExpressionRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [userId, setUserId] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listExpressions({
        page,
        pageSize,
        userId,
        keyword: keyword || undefined,
      })
      setData(res.rows)
      setTotal(res.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, userId])

  const onDelete = async (row: AdminExpressionRow) => {
    await adminApi.deleteExpression(row.id)
    message.success('已删除')
    load()
  }

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          口语表达
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
            placeholder="搜索中 / 英 / 日"
            allowClear
            style={{ width: 220 }}
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

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
        scroll={{ x: 1200 }}
        columns={[
          { title: '所属用户', dataIndex: 'username', width: 140, fixed: 'left' },
          { title: '中文', dataIndex: 'zhText', width: 240, ellipsis: true },
          { title: 'English', dataIndex: 'enCasual', ellipsis: true },
          { title: '日本語', dataIndex: 'jpCasual', ellipsis: true },
          {
            title: '场景',
            dataIndex: 'sceneTag',
            width: 120,
            render: (v: string) => (v ? <Tag color="purple">{v}</Tag> : '-'),
          },
          {
            title: '已掌握',
            dataIndex: 'isMastered',
            width: 90,
            render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
          },
          { title: '分类', dataIndex: 'folderName', width: 140 },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: '操作',
            width: 100,
            fixed: 'right',
            render: (_v, row) => (
              <Popconfirm
                title="删除该表达？"
                okText="删除"
                okType="danger"
                cancelText="取消"
                onConfirm={() => onDelete(row)}
              >
                <a style={{ color: '#ff4d4f' }}>删除</a>
              </Popconfirm>
            ),
          },
        ]}
      />
    </>
  )
}
