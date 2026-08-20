import { useMemo } from 'react'
import { Calendar, DateField, DatePicker } from '@heroui/react'
import { CalendarDate, getLocalTimeZone } from '@internationalized/date'

import { useI18n } from '../../i18n'

/**
 * 笔记时间。
 *
 * 存的是 ISO 时刻，界面上只到「天」—— 所以两边转换都锚在**本地**时区：读的时候
 * 取本地年月日，写回去用 `toDate(getLocalTimeZone())`，同一个时区进出，不会出现
 * 「选了 3 号存成 2 号」这种时差漂移。
 */
function toCalendarDate(iso: string): CalendarDate | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

type Props = {
  value: string
  onChange: (iso: string) => void
}

export function NoteDateField({ value, onChange }: Props) {
  const { t } = useI18n()
  const dateValue = useMemo(() => toCalendarDate(value), [value])

  return (
    <DatePicker
      aria-label={t('notes.noteAt')}
      value={dateValue}
      onChange={(next) => {
        if (next) onChange(next.toDate(getLocalTimeZone()).toISOString())
      }}
    >
      <DateField.Group fullWidth variant="secondary">
        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover>
        <Calendar aria-label={t('notes.noteAt')}>
          <Calendar.Header>
            <Calendar.YearPickerTrigger>
              <Calendar.YearPickerTriggerHeading />
              <Calendar.YearPickerTriggerIndicator />
            </Calendar.YearPickerTrigger>
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>
              {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
            </Calendar.GridHeader>
            <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
          </Calendar.Grid>
          <Calendar.YearPickerGrid>
            <Calendar.YearPickerGridBody>
              {({ year }) => <Calendar.YearPickerCell year={year} />}
            </Calendar.YearPickerGridBody>
          </Calendar.YearPickerGrid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  )
}
