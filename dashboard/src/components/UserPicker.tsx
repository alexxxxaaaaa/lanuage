import { useEffect, useState } from 'react'
import { Select } from 'antd'
import { adminApi } from '@/api'

interface Props {
  value?: string
  onChange?: (v: string | undefined) => void
  width?: number | string
  placeholder?: string
}

export function UserPicker({ value, onChange, width = 220, placeholder = '筛选用户' }: Props) {
  const [options, setOptions] = useState<{ value: string; label: string }[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    adminApi
      .listUsers({ page: 1, pageSize: 200 })
      .then((res) =>
        setOptions(res.rows.map((u) => ({ value: u.id, label: u.username }))),
      )
      .finally(() => setLoading(false))
  }, [])

  return (
    <Select
      allowClear
      showSearch
      loading={loading}
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      style={{ width }}
      optionFilterProp="label"
    />
  )
}
