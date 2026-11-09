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

/** Normalize supported Yipay aliases before allowlist checks and PayLink creation. */
export function normalizeYipayPaymentMethod(method: string): string {
  const normalized = method.trim()
  const compact = normalized.toLowerCase().replace(/[._-]/g, '')
  return compact === 'usdttrc20' ? 'usdt.tron' : normalized
}

const YIPAY_METHOD_ALLOWLIST = new Set(['alipay', 'wxpay', 'qqpay', 'bank', 'jdpay', 'usdt.tron'])

export function resolveRechargePaymentMethod(
  providerType: string,
  methods: string[],
  requestedMethod?: string | null
): string | undefined {
  const normalizedRequested = requestedMethod?.trim()

  if (providerType === 'yipay') {
    const availableMethods = [...new Set(methods.map(normalizeYipayPaymentMethod))]
    if (availableMethods.some(method => !YIPAY_METHOD_ALLOWLIST.has(method))) {
      throw Object.assign(new Error('支付渠道配置包含不支持的支付方式'), { statusCode: 400 })
    }
    const allowedMethods = availableMethods.length > 0 ? availableMethods : ['alipay']
    if (normalizedRequested) {
      const normalizedMethod = normalizeYipayPaymentMethod(normalizedRequested)
      if (!YIPAY_METHOD_ALLOWLIST.has(normalizedMethod) || !allowedMethods.includes(normalizedMethod)) {
        throw Object.assign(new Error('所选支付方式不可用'), { statusCode: 400 })
      }
      return normalizedMethod
    }
    return allowedMethods[0]
  }

  if (providerType === 'heleket') {
    return normalizedRequested || undefined
  }

  return normalizedRequested || undefined
}
