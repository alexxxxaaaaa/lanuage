import { useState } from 'react'
import { ComboBox, Input, ListBox } from '@heroui/react'

import { useI18n } from '../../i18n'

type Props = {
  value: string
  /** 这个用户已经用过的课程，按用得多的排前面。 */
  options: string[]
  onChange: (course: string) => void
}

/**
 * 课程标签。可以从用过的课程里挑，也可以直接敲一个新的 —— 课程不是一张单独
 * 的表，它就是笔记上的一个字符串，所以「新建」不需要任何额外动作。清空即取消
 * 归类。
 */
export function CourseField({ value, options, onChange }: Props) {
  const { t } = useI18n()
  const [inputValue, setInputValue] = useState(value)
  const [syncedValue, setSyncedValue] = useState(value)

  // 外面把课程换掉时（换了笔记，或保存结果跟本地不一样）跟上。在渲染里对齐而
  // 不是放进 effect：effect 里 setState 会多跑一帧，而且这中间输入框会闪一下旧值。
  if (syncedValue !== value) {
    setSyncedValue(value)
    setInputValue(value)
  }

  const commit = (next: string) => {
    const trimmed = next.trim()
    setInputValue(trimmed)
    if (trimmed !== value) onChange(trimmed)
  }

  return (
    <ComboBox
      allowsCustomValue
      aria-label={t('notes.course')}
      inputValue={inputValue}
      menuTrigger="focus"
      onInputChange={setInputValue}
      onSelectionChange={(key) => {
        if (key != null) commit(String(key))
      }}
    >
      <ComboBox.InputGroup>
        <Input
          placeholder={t('notes.coursePlaceholder')}
          onBlur={(event) => commit(event.target.value)}
        />
        <ComboBox.Trigger />
      </ComboBox.InputGroup>
      <ComboBox.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option} id={option} textValue={option}>
              {option}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  )
}
