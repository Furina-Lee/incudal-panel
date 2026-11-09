import assert from 'node:assert/strict'
import { calculatePlanChangeDetails } from '../src/lib/billing-calc.js'
import { mergeHeleketPaymentDetails, readRechargePaymentDetails } from '../src/lib/recharge-payment-details.js'

const quote = calculatePlanChangeDetails(10, 1, 20, 1, 15)
assert.equal(quote.isUpgrade, true)
assert.equal(quote.remainingValue, 4.84)
assert.equal(quote.newPlanCost, 9.68)
assert.equal(quote.priceDiff, 4.84)

const downgrade = calculatePlanChangeDetails(20, 1, 10, 1, 15)
assert.equal(downgrade.isUpgrade, false)
assert.equal(downgrade.priceDiff, -4.84)

const upgradeDetails = mergeHeleketPaymentDetails({
  kind: 'plan_upgrade',
  upgradeOrderNo: 'UPGRADE-1',
  recharge: { payableAmount: 5.12 }
}, {
  order_id: 'UPGRADE-1',
  status: 'paid',
  amount: '5.12',
  uuid: 'payment-1'
}, { currency: 'CNY', lifetimeSeconds: 3600 }, { orderNo: 'UPGRADE-1', invoiceAmount: 5.12 })
const parsed = readRechargePaymentDetails(upgradeDetails)
assert.equal(parsed.kind, 'plan_upgrade')
assert.equal(parsed.upgradeOrderNo, 'UPGRADE-1')
assert.equal(parsed.recharge?.payableAmount, 5.12)

console.log('plan upgrade pricing and payment marker tests passed')
