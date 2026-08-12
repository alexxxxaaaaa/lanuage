import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '@/api'
import type {
  AdminExpressionRow,
  AdminFolderRow,
  AdminNoteDetail,
  AdminNoteRow,
  AdminUserDetail,
  AdminWordRow,
} from '@/types/api'

interface ListState<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  loading: boolean
}

const initList = <T,>(): ListState<T> => ({
  rows: [],
  total: 0,
  page: 1,
  pageSize: 20,
  loading: false,
})

export default function UserDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] = useState<AdminUserDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [tab, setTab] = useState('words')
  const [words, setWords] = useState<ListState<AdminWordRow>>(initList())
  const [exprs, setExprs] = useState<ListState<AdminExpressionRow>>(initList())
  const [notes, setNotes] = useState<ListState<AdminNoteRow>>(initList())
  const [folders, setFolders] = useState<ListState<AdminFolderRow>>(initList())
  const [viewNote, setViewNote] = useState<AdminNoteDetail | null>(null)

  const loadDetail = async () => {
    setDetailLoading(true)
    try {
      setDetail(await adminApi.getUserDetail(id))
    } finally {
      setDetailLoading(false)
    }
  }

  const loadWords = async (page = words.page, pageSize = words.pageSize) => {
    setWords((s) => ({ ...s, loading: true }))
    try {
      const res = await adminApi.listWords({ userId: id, page, pageSize })
      setWords({ rows: res.rows, total: res.total, page, pageSize, loading: false })
    } catch {
      setWords((s) => ({ ...s, loading: false }))
    }
  }

  const loadExprs = async (page = exprs.page, pageSize = exprs.pageSize) => {
    setExprs((s) => ({ ...s, loading: true }))
    try {
      const res = await adminApi.listExpressions({ userId: id, page, pageSize })
      setExprs({ rows: res.rows, total: res.total, page, pageSize, loading: false })
    } catch {
      setExprs((s) => ({ ...s, loading: false }))
    }
  }

  const loadNotes = async (page = notes.page, pageSize = notes.pageSize) => {
    setNotes((s) => ({ ...s, loading: true }))
    try {
      const res = await adminApi.listNotes({ userId: id, page, pageSize })
      setNotes({ rows: res.rows, total: res.total, page, pageSize, loading: false })
    } catch {
      setNotes((s) => ({ ...s, loading: false }))
    }
  }

  const loadFolders = async (page = folders.page, pageSize = folders.pageSize) => {
    setFolders((s) => ({ ...s, loading: true }))
    try {
      const res = await adminApi.listFolders({ userId: id, page, pageSize })
      setFolders({ rows: res.rows, total: res.total, page, pageSize, loading: false })
    } catch {
      setFolders((s) => ({ ...s, loading: false }))
    }
  }

  useEffect(() => {
    if (!id) return
    loadDetail()
    loadWords(1)
    loadExprs(1)
    loadNotes(1)
    loadFolders(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!id) return <Empty description="缺少用户 id" />

  return (
    <Spin spinning={detailLoading && !detail}>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/users')}>
          返回用户列表
        </Button>
        <Button icon={<ReloadOutlined />} onClick={loadDetail}>
          刷新基本信息
        </Button>
      </Space>

      {detail && (
        <Card style={{ marginBottom: 16 }}>
          <Descriptions
            title={
              <Space>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  {detail.username}
                </Typography.Title>
                <Tag>{dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm')} 注册</Tag>
              </Space>
            }
            column={{ xs: 1, sm: 2, md: 3 }}
            size="small"
          >
            <Descriptions.Item label="用户 ID">
              <code style={{ fontSize: 12 }}>{detail.id}</code>
            </Descriptions.Item>
          </Descriptions>

          <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
            <Col xs={12} sm={6}>
              <Statistic title="单词分类" value={detail.folderCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="单词" value={detail.wordCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="口语分类" value={detail.expressionFolderCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="口语表达" value={detail.expressionCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="笔记" value={detail.noteCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="AI 调用" value={detail.aiUsageCount} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="AI Tokens" value={detail.aiTotalTokens} />
            </Col>
            <Col xs={12} sm={6}>
              <Statistic title="Prompt / Completion" value={`${detail.aiPromptTokens} / ${detail.aiCompletionTokens}`} />
            </Col>
          </Row>
        </Card>
      )}

      <Card>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'words',
              label: `单词 (${words.total})`,
              children: (
                <Table
                  rowKey="id"
                  loading={words.loading}
                  dataSource={words.rows}
                  pagination={{
                    current: words.page,
                    pageSize: words.pageSize,
                    total: words.total,
                    showSizeChanger: true,
                    onChange: (p, ps) => loadWords(p, ps),
                  }}
                  scroll={{ x: 1100 }}
                  columns={[
                    { title: '单词', dataIndex: 'word', width: 160, fixed: 'left' },
                    { title: '读音', dataIndex: 'reading', width: 120 },
                    {
                      title: '词性',
                      dataIndex: 'partOfSpeech',
                      width: 90,
                      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
                    },
                    { title: '词义', dataIndex: 'meaning', ellipsis: true },
                    { title: '例句', dataIndex: 'example', ellipsis: true },
                    {
                      title: '语言',
                      dataIndex: 'language',
                      width: 80,
                      render: (v: string) => <Tag>{v}</Tag>,
                    },
                    { title: '分类', dataIndex: 'folderName', width: 140 },
                    {
                      title: '加入时间',
                      dataIndex: 'createdAt',
                      width: 160,
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'expressions',
              label: `口语表达 (${exprs.total})`,
              children: (
                <Table
                  rowKey="id"
                  loading={exprs.loading}
                  dataSource={exprs.rows}
                  pagination={{
                    current: exprs.page,
                    pageSize: exprs.pageSize,
                    total: exprs.total,
                    showSizeChanger: true,
                    onChange: (p, ps) => loadExprs(p, ps),
                  }}
                  scroll={{ x: 1100 }}
                  columns={[
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
                      render: (v: boolean) =>
                        v ? <Tag color="green">是</Tag> : <Tag>否</Tag>,
                    },
                    { title: '分类', dataIndex: 'folderName', width: 140 },
                    {
                      title: '加入时间',
                      dataIndex: 'createdAt',
                      width: 160,
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'notes',
              label: `笔记 (${notes.total})`,
              children: (
                <Table
                  rowKey="id"
                  loading={notes.loading}
                  dataSource={notes.rows}
                  pagination={{
                    current: notes.page,
                    pageSize: notes.pageSize,
                    total: notes.total,
                    showSizeChanger: true,
                    onChange: (p, ps) => loadNotes(p, ps),
                  }}
                  columns={[
                    { title: '标题', dataIndex: 'title', ellipsis: true },
                    {
                      title: '标签',
                      dataIndex: 'tag',
                      width: 160,
                      render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
                    },
                    {
                      title: '时间',
                      dataIndex: 'noteAt',
                      width: 120,
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
                    },
                    { title: '关联单词', dataIndex: 'wordCount', width: 100 },
                    {
                      title: '创建时间',
                      dataIndex: 'createdAt',
                      width: 160,
                      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
                    },
                    {
                      title: '操作',
                      width: 100,
                      render: (_v, row) => (
                        <a
                          onClick={async () =>
                            setViewNote(await adminApi.getNoteDetail(row.id))
                          }
                        >
                          查看
                        </a>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'folders',
              label: `单词分类 (${folders.total})`,
              children: (
                <Table
                  rowKey="id"
                  loading={folders.loading}
                  dataSource={folders.rows}
                  pagination={{
                    current: folders.page,
                    pageSize: folders.pageSize,
                    total: folders.total,
                    showSizeChanger: true,
                    onChange: (p, ps) => loadFolders(p, ps),
                  }}
                  columns={[
                    { title: '名称', dataIndex: 'name' },
                    {
                      title: '语言',
                      dataIndex: 'language',
                      width: 100,
                      render: (v: string) => <Tag>{v || '-'}</Tag>,
                    },
                    { title: '单词数', dataIndex: 'wordCount', width: 100 },
                    {
                      title: '操作',
                      width: 140,
                      render: (_v, row) => (
                        <Popconfirm
                          title="删除该分类？分类下的单词会一起删除"
                          okText="删除"
                          okType="danger"
                          cancelText="取消"
                          onConfirm={async () => {
                            await adminApi.deleteFolder(row.id)
                            message.success('已删除')
                            loadFolders(folders.page)
                            loadWords(1)
                            loadDetail()
                          }}
                        >
                          <a style={{ color: '#ff4d4f' }}>删除</a>
                        </Popconfirm>
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        open={!!viewNote}
        onClose={() => setViewNote(null)}
        title={viewNote?.title}
        styles={{ wrapper: { width: 720 } }}
      >
        {viewNote && (
          <>
            <Space style={{ marginBottom: 12 }}>
              {viewNote.tag && <Tag>标签：{viewNote.tag}</Tag>}
              <Tag>时间：{dayjs(viewNote.noteAt).format('YYYY-MM-DD')}</Tag>
              <Tag>{dayjs(viewNote.createdAt).format('YYYY-MM-DD HH:mm')}</Tag>
            </Space>
            <div
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: 16,
                background: '#fafafa',
                whiteSpace: 'pre-wrap',
              }}
            >
              {viewNote.contentText}
            </div>
          </>
        )}
      </Drawer>

    </Spin>
  )
}
