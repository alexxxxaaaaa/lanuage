import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { CopyOutlined, EyeOutlined, KeyOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '@/api'
import type { AdminUserRow } from '@/types/api'

export default function UsersPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [showHash, setShowHash] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resetUser, setResetUser] = useState<AdminUserRow | null>(null)
  const [resetForm] = Form.useForm<{ password: string }>()

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listUsers({
        page,
        pageSize,
        keyword: keyword || undefined,
        includeHash: showHash,
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
  }, [page, pageSize, showHash])

  const onSearch = (v: string) => {
    setKeyword(v)
    setPage(1)
    load()
  }

  const onDelete = async (row: AdminUserRow) => {
    await adminApi.deleteUser(row.id)
    message.success(`已删除用户 ${row.username} 及其全部数据`)
    load()
  }

  const onResetSubmit = async () => {
    if (!resetUser) return
    const { password } = await resetForm.validateFields()
    await adminApi.resetUserPassword(resetUser.id, password)
    message.success(`已重置 ${resetUser.username} 的密码`)
    setResetUser(null)
    resetForm.resetFields()
    if (showHash) load()
  }

  const copyHash = (hash?: string) => {
    if (!hash) return
    navigator.clipboard.writeText(hash)
    message.success('已复制哈希')
  }

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          用户
        </Typography.Title>
        <Space>
          <Tooltip title="bcrypt 单向哈希，不能反推出原密码；可作为账号身份指纹。">
            <Space size={4}>
              <span>显示密码哈希</span>
              <Switch checked={showHash} onChange={setShowHash} />
            </Space>
          </Tooltip>
          <Input.Search
            placeholder="搜索用户名"
            allowClear
            style={{ width: 240 }}
            onSearch={onSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="密码以 bcrypt 哈希存储，无法显示明文。若要给某账号设置新密码，点该行的「重置密码」。"
      />

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
        scroll={{ x: 1100 }}
        columns={[
          { title: '用户名', dataIndex: 'username', width: 160, fixed: 'left' },
          ...(showHash
            ? [
                {
                  title: '密码哈希',
                  dataIndex: 'passwordHash',
                  ellipsis: true,
                  render: (v?: string) =>
                    v ? (
                      <Space size={4}>
                        <code style={{ fontSize: 12 }}>{v}</code>
                        <Button
                          size="small"
                          type="text"
                          icon={<CopyOutlined />}
                          onClick={() => copyHash(v)}
                        />
                      </Space>
                    ) : (
                      '-'
                    ),
                },
              ]
            : []),
          {
            title: '注册时间',
            dataIndex: 'createdAt',
            width: 160,
            render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: '分类',
            dataIndex: 'folderCount',
            width: 80,
            render: (v: number) => <Tag>{v}</Tag>,
          },
          {
            title: '笔记',
            dataIndex: 'noteCount',
            width: 80,
            render: (v: number) => <Tag>{v}</Tag>,
          },
          {
            title: '口语分类',
            dataIndex: 'expressionFolderCount',
            width: 100,
            render: (v: number) => <Tag>{v}</Tag>,
          },
          {
            title: 'AI 调用',
            dataIndex: 'aiUsageCount',
            width: 100,
            render: (v: number) => <Tag>{v}</Tag>,
          },
          {
            title: '播客',
            dataIndex: 'canSeePodcast',
            width: 90,
            render: (v: boolean, row) => (
              <Switch
                size="small"
                checked={v}
                onChange={async (checked) => {
                  await adminApi.updateUserPermissions(row.id, { canSeePodcast: checked })
                  setData((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, canSeePodcast: checked } : r)),
                  )
                  message.success(checked ? '已开放播客' : '已关闭播客')
                }}
              />
            ),
          },
          {
            title: '操作',
            width: 260,
            fixed: 'right',
            render: (_v, row) => (
              <Space>
                <a onClick={() => navigate(`/users/${row.id}`)}>
                  <EyeOutlined /> 详情
                </a>
                <a onClick={() => setResetUser(row)}>
                  <KeyOutlined /> 重置密码
                </a>
                <Popconfirm
                  title={`删除用户 ${row.username}？`}
                  description="将连同该用户的全部 folders / words / notes / expressions / 评分 / AI 日志一起删除，不可恢复"
                  okText="确认删除"
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

      <Modal
        open={!!resetUser}
        onCancel={() => setResetUser(null)}
        onOk={onResetSubmit}
        title={resetUser ? `重置 ${resetUser.username} 的密码` : '重置密码'}
        destroyOnHidden
      >
        <Form form={resetForm} layout="vertical" preserve={false}>
          <Form.Item
            label="新密码"
            name="password"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 个字符' },
            ]}
          >
            <Input.Password placeholder="至少 6 个字符" />
          </Form.Item>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            提交后服务端会用 bcrypt 重新散列并覆盖原 hash。
          </div>
        </Form>
      </Modal>
    </>
  )
}
