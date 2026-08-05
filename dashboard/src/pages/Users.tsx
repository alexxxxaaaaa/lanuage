import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { EyeOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { adminApi } from '@/api'
import type { AdminUserRow } from '@/types/api'

/** 和服务端 lib/credentials.ts 同一套规则，在这里先挡一道，省一个来回。 */
const USERNAME_RULES = [
  { required: true, message: '请输入用户名' },
  { min: 2, max: 32, message: '用户名需为 2-32 个字符' },
  {
    pattern: /^[a-zA-Z0-9_\-.]+$/,
    message: '只能包含字母、数字、下划线、点或连字符',
  },
]
const PASSWORD_RULES = [
  { required: true, message: '请输入密码' },
  { min: 6, max: 128, message: '密码需为 6-128 个字符' },
]

export default function UsersPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetUser, setResetUser] = useState<AdminUserRow | null>(null)
  const [resetForm] = Form.useForm<{ password: string }>()
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm] = Form.useForm<{ username: string; password: string }>()

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.listUsers({
        page,
        pageSize,
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
  }, [page, pageSize])

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

  const onCreateSubmit = async () => {
    const values = await createForm.validateFields()
    await adminApi.createUser(values.username, values.password)
    message.success(`已创建用户 ${values.username}`)
    setCreateOpen(false)
    createForm.resetFields()
    setPage(1)
    load()
  }

  const onResetSubmit = async () => {
    if (!resetUser) return
    const { password } = await resetForm.validateFields()
    await adminApi.resetUserPassword(resetUser.id, password)
    message.success(`已重置 ${resetUser.username} 的密码，该账号已在所有设备上退出登录`)
    setResetUser(null)
    resetForm.resetFields()
  }

  return (
    <>
      <Space style={{ justifyContent: 'space-between', display: 'flex', marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          用户
        </Typography.Title>
        <Space>
          <Input.Search
            placeholder="搜索用户名"
            allowClear
            style={{ width: 240 }}
            onSearch={onSearch}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建用户
          </Button>
        </Space>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="用户端没有注册入口，账号只能在这里创建。密码单向散列存储，任何地方都读不出来；忘了密码就用「重置密码」设一个新的。"
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
                  description="将连同该用户的词单 / 单词 / 笔记 / 口语 / 语法 / 播客 / 刷题记录 / 复习进度 / AI 日志一起删除，不可恢复"
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
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={onCreateSubmit}
        title="新建用户"
        okText="创建"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item label="用户名" name="username" rules={USERNAME_RULES}>
            <Input placeholder="字母、数字、下划线、点或连字符" autoComplete="off" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={PASSWORD_RULES}>
            <Input.Password placeholder="至少 6 个字符" autoComplete="new-password" />
          </Form.Item>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            用户名不区分大小写，一律按小写存。创建后把密码交给本人，让 TA 自己去登录页登录。
          </div>
        </Form>
      </Modal>

      <Modal
        open={!!resetUser}
        onCancel={() => setResetUser(null)}
        onOk={onResetSubmit}
        title={resetUser ? `重置 ${resetUser.username} 的密码` : '重置密码'}
        destroyOnHidden
      >
        <Form form={resetForm} layout="vertical" preserve={false}>
          <Form.Item label="新密码" name="password" rules={PASSWORD_RULES}>
            <Input.Password placeholder="至少 6 个字符" autoComplete="new-password" />
          </Form.Item>
          <div style={{ color: '#8c8c8c', fontSize: 12 }}>
            该账号已登录的设备会立即失效，需要用新密码重新登录。
          </div>
        </Form>
      </Modal>
    </>
  )
}
