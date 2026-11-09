import assert from 'node:assert/strict'
import { getTradeNoForIndex, normalizeYipayPaymentMethod, resolveRechargePaymentMethod } from '../src/lib/recharge-reliability.js'

assert.equal(getTradeNoForIndex('ORDER-1', null), '__NO_TRADE_NO__ORDER-1')
assert.equal(getTradeNoForIndex('ORDER-1', undefined), '__NO_TRADE_NO__ORDER-1')
assert.equal(getTradeNoForIndex('ORDER-1', '  trade-123  '), 'trade-123')

assert.equal(normalizeYipayPaymentMethod('USDT_TRC20'), 'usdt.tron')
assert.equal(normalizeYipayPaymentMethod('usdt-trc-20'), 'usdt.tron')
assert.equal(resolveRechargePaymentMethod('yipay', ['USDT_TRC20'], 'USDT_TRC20'), 'usdt.tron')
assert.equal(resolveRechargePaymentMethod('yipay', ['alipay', 'usdt.tron'], 'usdt.tron'), 'usdt.tron')
assert.throws(
  () => resolveRechargePaymentMethod('yipay', ['alipay'], 'usdt.tron'),
  /所选支付方式不可用/
)
assert.throws(
  () => resolveRechargePaymentMethod('yipay', ['unsupported'], undefined),
  /不支持的支付方式/
)
console.log('Recharge reliability checks passed')
