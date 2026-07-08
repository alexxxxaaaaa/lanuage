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
import { adminApi } from '@/api'
import { UserPicker } from '@/components/UserPicker'
import type { AdminFolderRow } from '@/types/api'

export default function FoldersPage() {
  const [data, setData] = useState<AdminFolderRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [userId, setUserId] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listFolders({
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

  const onDelete = async (row: AdminFolderRow) => {
    await adminApi.deleteFolder(row.id)
    message.success('已删除')
    load()
  }

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          单词分类
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
            placeholder="搜索分类名"
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
        columns={[
          { title: '所属用户', dataIndex: 'username', width: 160 },
          { title: '分类名', dataIndex: 'name' },
          {
            title: '语言',
            dataIndex: 'language',
            width: 100,
            render: (v: string) => <Tag>{v || '-'}</Tag>,
          },
          { title: '单词数', dataIndex: 'wordCount', width: 100 },
          {
            title: '操作',
            width: 120,
            render: (_v, row) => (
              <Popconfirm
                title="删除该分类？分类下的单词也会被一并删除"
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
