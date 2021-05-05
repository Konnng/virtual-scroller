//  TYPES
type Maybe<T> = T | null

// INTERFACES
interface ScrollerItemMeta<T = unknown> {
  index: number
  height: number
  data: T
}

interface ScrollerRange {
  start: number
  end: number
}

interface ScrollerLoading {
  top: number
  height: number
}

interface ScrollerVisibleItems {
  first: number
  last: number
}
