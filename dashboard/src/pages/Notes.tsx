import { useEffect, useState } from 'react'
import {
  Button,
  Drawer,
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
import type { AdminNoteDetail, AdminNoteRow } from '@/types/api'

export default function NotesPage() {
  const [data, setData] = useState<AdminNoteRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [userId, setUserId] = useState<string | undefined>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [viewNote, setViewNote] = useState<AdminNoteDetail | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listNotes({
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

  const onView = async (row: AdminNoteRow) => {
    const full = await adminApi.getNoteDetail(row.id)
    setViewNote(full)
  }

  const onDelete = async (row: AdminNoteRow) => {
    await adminApi.deleteNote(row.id)
    message.success('已删除')
    load()
  }

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          课程笔记
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
            placeholder="搜索标题 / 课节"
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
        columns={[
          { title: '所属用户', dataIndex: 'username', width: 160 },
          { title: '标题', dataIndex: 'title', ellipsis: true },
          {
            title: '课程',
            dataIndex: 'course',
            width: 160,
            render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
          },
          { title: '课节', dataIndex: 'lesson', width: 120 },
          { title: '关联单词', dataIndex: 'wordCount', width: 100 },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: '操作',
            width: 140,
            render: (_v, row) => (
              <Space>
                <a onClick={() => onView(row)}>查看</a>
                <Popconfirm
                  title="删除该笔记？"
                  okText="删除"
                  okType="danger"
                  cancelText="取消"
                  onConfirm={() => onDelete(row)}
                >
                  <a style={{ color: '#ff4d4f' }}>删除</a>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        open={!!viewNote}
        onClose={() => setViewNote(null)}
        title={viewNote?.title}
        styles={{ wrapper: { width: 720 } }}
      >
        {viewNote && (
          <>
            <Space style={{ marginBottom: 12 }}>
              <Tag color="blue">{viewNote.user?.username ?? viewNote.username}</Tag>
              {viewNote.course && <Tag>课程：{viewNote.course}</Tag>}
              {viewNote.lesson && <Tag>课节：{viewNote.lesson}</Tag>}
              <Tag>{dayjs(viewNote.createdAt).format('YYYY-MM-DD HH:mm')}</Tag>
            </Space>
            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: 16,
                background: '#fafafa',
              }}
              dangerouslySetInnerHTML={{ __html: viewNote.content }}
            />
          </>
        )}
      </Drawer>
    </>
  )
}
