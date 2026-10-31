/** Shared pagination contract: invalid input must never become SQLite LIMIT -1. */
export function queryPage(options = {}, maxLimit = 2000) {
  const integer = (value, fallback, name, minimum) => {
    if (value === undefined) return fallback
    const acceptable = typeof value === 'number'
      || (typeof value === 'string' && /^\d+$/.test(value.trim()))
    const number = acceptable ? Number(value) : NaN
    if (!Number.isSafeInteger(number) || number < minimum) {
      throw new TypeError(`${name} must be a safe integer >= ${minimum}`)
    }
    return number
  }
  return {
    limit: Math.min(integer(options.limit, 200, 'limit', 1), maxLimit),
    offset: integer(options.offset, 0, 'offset', 0),
  }
}

export function pageMetadata(total, returned, { limit, offset }) {
  const hasMore = returned > 0 && returned < total - offset
  return { limit, offset, returned, hasMore, nextOffset: hasMore ? offset + returned : null }
}
