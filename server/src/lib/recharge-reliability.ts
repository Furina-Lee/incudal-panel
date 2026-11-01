/**
 * Helpers shared by payment callback deduplication and its tests.
 */

/**
 * Return the stable database key used when a provider omits its trade number.
 * The order number is stable across retries; timestamps/random values are not.
 */
export function getTradeNoForIndex(orderNo: string, tradeNo: string | null | undefined): string {
  const normalizedTradeNo = tradeNo?.trim()
  return normalizedTradeNo || `__NO_TRADE_NO__${orderNo}`
}
