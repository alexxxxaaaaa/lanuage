/**
 * The dashboard shell is `fixed inset-0` with `<main>` as the only scrolling
 * element, so `window.scrollTo` is a no-op inside the app. Pages that want to
 * jump back to the top — pagination, switching a filter — go through here.
 */
export const APP_SCROLLER_ID = 'app-scroller'

function getAppScroller(): HTMLElement | null {
  return document.getElementById(APP_SCROLLER_ID)
}

export function scrollAppToTop(behavior: ScrollBehavior = 'smooth'): void {
  // Falls back to the window for the auth shell, which has no app scroller.
  const el = getAppScroller()
  if (el) el.scrollTo({ top: 0, behavior })
  else window.scrollTo({ top: 0, behavior })
}
