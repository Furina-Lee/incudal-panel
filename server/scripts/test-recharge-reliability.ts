import assert from 'node:assert/strict'
import { getTradeNoForIndex } from '../src/lib/recharge-reliability.js'

assert.equal(getTradeNoForIndex('ORDER-1', null), '__NO_TRADE_NO__ORDER-1')
assert.equal(getTradeNoForIndex('ORDER-1', undefined), '__NO_TRADE_NO__ORDER-1')
assert.equal(getTradeNoForIndex('ORDER-1', '  trade-123  '), 'trade-123')
console.log('Recharge reliability checks passed')
