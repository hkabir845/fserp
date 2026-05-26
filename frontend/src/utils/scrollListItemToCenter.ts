/**
 * Scroll a child element to the vertical center of a scrollable container.
 * Used by Reports (left report list) and the ERP sidebar menubar.
 */
export function scrollElementToVerticalCenter(
  container: HTMLElement,
  element: HTMLElement,
  behavior: ScrollBehavior = 'smooth'
): void {
  const containerRect = container.getBoundingClientRect()
  const elementRect = element.getBoundingClientRect()
  const relativeTop = elementRect.top - containerRect.top + container.scrollTop
  const targetScroll =
    relativeTop - container.clientHeight / 2 + elementRect.height / 2
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
  container.scrollTo({
    top: Math.min(maxScroll, Math.max(0, targetScroll)),
    behavior,
  })
}

export function scrollActiveChildToCenter(
  container: HTMLElement | null,
  activeSelector: string,
  behavior: ScrollBehavior = 'smooth'
): void {
  if (!container) return
  const active = container.querySelector<HTMLElement>(activeSelector)
  if (!active) return
  scrollElementToVerticalCenter(container, active, behavior)
}

/** Run after layout so measurements are correct (same pattern as Reports display panel). */
export function scrollActiveChildToCenterAfterLayout(
  container: HTMLElement | null,
  activeSelector: string,
  behavior: ScrollBehavior = 'smooth'
): void {
  if (typeof window === 'undefined' || !container) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollActiveChildToCenter(container, activeSelector, behavior)
    })
  })
}
