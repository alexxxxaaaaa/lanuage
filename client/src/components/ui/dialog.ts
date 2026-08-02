import type { ReactNode } from 'react'

// Imperative confirm/alert queue backing <DialogHost />.
//
// HeroUI has no equivalent of antd's `Modal.confirm({...})`, but the call sites
// genuinely want a one-shot question rather than a piece of page state. So we
// keep a module-level queue that the host renders, and hand callers a promise
// instead of antd's onOk/onCancel callbacks — `if (await confirm(...))` reads
// better than nesting the rest of the handler inside a callback.
//
// Kept separate from the component so Fast Refresh still works on the host.

export type DialogStatus = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export type DialogOptions = {
  title: ReactNode
  content?: ReactNode
  okText?: string
  cancelText?: string
  status?: DialogStatus
}

export type DialogRequest = DialogOptions & {
  id: number
  /** Alerts render a single dismiss button; confirms render ok + cancel. */
  kind: 'alert' | 'confirm'
  settle: (ok: boolean) => void
}

let nextId = 0
let queue: DialogRequest[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function push(request: Omit<DialogRequest, 'id'>): void {
  queue = [...queue, { ...request, id: nextId++ }]
  emit()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function head(): DialogRequest | null {
  return queue[0] ?? null
}

/** Resolves the front-most dialog and advances the queue. */
export function settleHead(ok: boolean): void {
  const [first, ...rest] = queue
  if (!first) return
  queue = rest
  emit()
  first.settle(ok)
}

/** Resolves true when confirmed, false when cancelled or dismissed. */
export function confirm(options: DialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    push({ ...options, kind: 'confirm', settle: resolve })
  })
}

function alertWith(status: DialogStatus, options: DialogOptions): Promise<void> {
  return new Promise((resolve) => {
    push({ status, ...options, kind: 'alert', settle: () => resolve() })
  })
}

/** Mirrors antd's Modal.info/success/warning/error. */
export const alertDialog = {
  info: (options: DialogOptions) => alertWith('accent', options),
  success: (options: DialogOptions) => alertWith('success', options),
  warning: (options: DialogOptions) => alertWith('warning', options),
  error: (options: DialogOptions) => alertWith('danger', options),
}
