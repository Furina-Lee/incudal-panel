import * as db from '../db/index.js'
import { createLog } from '../db/logs.js'
import { getTradeNoForIndex, isCallbackProcessed, markCallbackProcessed } from '../db/recharge-records.js'
import { createEpayClient, type EpayConfig, type EpayConfigV1, type EpayConfigV2, type EpayVersion } from '../lib/epay.js'
import {
  buildHeleketConfig,
  createHeleketClient,
  extractHeleketStatus,
  getHeleketInvoiceAmount,
  getHeleketPaymentState,
  getHeleketStatusDescription
} from '../lib/heleket.js'
import { getRechargePayableAmount, mergeHeleketPaymentDetails } from '../lib/recharge-payment-details.js'
import { resolveRechargeProviderConfigSnapshot } from '../lib/recharge-provider-snapshot.js'

const AMOUNT_TOLERANCE = 0.01

export type ReconciliationResult = {
  status: string
  reconciled: boolean
  reviewRequired?: boolean
  message: string
}

function buildEpayConfig(config: Record<string, unknown>): { epayConfig: EpayConfig; valid: boolean; error?: string } {
  if ((config.version as EpayVersion) === 'v1' || (!config.version && config.key && !config.platform_public_key)) {
    const epayConfig: EpayConfigV1 = {
      version: 'v1',
      apiurl: typeof config.apiurl === 'string' ? config.apiurl : '',
      pid: typeof config.pid === 'string' ? config.pid : '',
      key: typeof config.key === 'string' ? config.key : ''
    }
    return { epayConfig, valid: Boolean(epayConfig.apiurl && epayConfig.pid && epayConfig.key), error: '易支付配置不完整' }
  }

  const epayConfig: EpayConfigV2 = {
    version: 'v2',
    apiurl: typeof config.apiurl === 'string' ? config.apiurl : '',
    pid: typeof config.pid === 'string' ? config.pid : '',
    platform_public_key: typeof config.platform_public_key === 'string' ? config.platform_public_key : '',
    merchant_private_key: typeof config.merchant_private_key === 'string' ? config.merchant_private_key : ''
  }
  return {
    epayConfig,
    valid: Boolean(epayConfig.apiurl && epayConfig.pid && epayConfig.platform_public_key && epayConfig.merchant_private_key),
    error: '易支付配置不完整'
  }
}

/** Query a provider and settle only positively verified payments. Unknown and underpaid states stay open for review. */
export async function reconcileRechargeRecord(
  record: any,
  source: 'admin_reconcile' | 'scheduled_reconcile',
  actorId?: number
): Promise<ReconciliationResult> {
  if (!record || !record.provider) return { status: record?.status || 'unknown', reconciled: false, reviewRequired: true, message: '支付渠道不存在' }
  if (record.status === 'completed') return { status: 'completed', reconciled: false, message: '订单已完成' }
  if (record.status !== 'pending' && record.status !== 'paid') {
    return { status: record.status, reconciled: false, reviewRequired: true, message: '订单状态需人工复核' }
  }
  if (record.expiredAt && record.expiredAt.getTime() <= Date.now()) {
    return { status: record.status, reconciled: false, reviewRequired: true, message: '订单已过期，需人工复核' }
  }

  const providerType = record.provider.type
  if (providerType !== 'yipay' && providerType !== 'heleket') {
    return { status: record.status, reconciled: false, reviewRequired: true, message: '该支付渠道不支持主动查询' }
  }

  const currentConfig = typeof record.provider.config === 'string'
    ? JSON.parse(record.provider.config)
    : (record.provider.config || {}) as Record<string, unknown>
  const { config, source: configSource } = resolveRechargeProviderConfigSnapshot(
    providerType,
    currentConfig,
    record.providerConfigSnapshot
  )
  const expectedAmount = getRechargePayableAmount({
    amount: record.amount,
    fee: record.fee,
    paymentDetails: record.paymentDetails
  })
  const creditedAmount = record.actualAmount !== null && record.actualAmount !== undefined
    ? Number(record.actualAmount)
    : Number(record.amount)
  let tradeNo = ''
  let callbackData: Record<string, unknown>
  let paymentDetails = record.paymentDetails as Record<string, unknown> | undefined

  if (providerType === 'yipay') {
    const { epayConfig, valid, error } = buildEpayConfig(config)
    if (!valid) return { status: record.status, reconciled: false, reviewRequired: true, message: error || '易支付配置不完整' }

    const result = await createEpayClient(epayConfig).queryOrder(record.orderNo)
    if (!result.success) return { status: record.status, reconciled: false, message: result.error || '支付平台查询暂不可用' }
    if (!result.paid) return { status: record.status, reconciled: false, message: '支付平台显示未支付' }
    if (result.out_trade_no && result.out_trade_no !== record.orderNo) {
      return { status: record.status, reconciled: false, reviewRequired: true, message: '支付平台订单号不匹配' }
    }

    const paidAmount = Number(result.money)
    if (!Number.isFinite(paidAmount) || paidAmount <= 0 || Math.abs(paidAmount - expectedAmount) > AMOUNT_TOLERANCE) {
      await createLog(record.userId, 'system', 'recharge.reconciliation_review',
        `Yipay amount mismatch: order ${record.orderNo}, expected ${expectedAmount}, received ${String(result.money)}`, 'warning')
      return { status: record.status, reconciled: false, reviewRequired: true, message: '支付金额异常，需人工复核' }
    }
    tradeNo = result.trade_no || ''
    callbackData = { source, queryResult: result.rawData || {}, configSource, ...(actorId ? { adminId: actorId } : {}) }
  } else {
    const { heleketConfig, valid, error } = buildHeleketConfig(config)
    if (!valid) return { status: record.status, reconciled: false, reviewRequired: true, message: error || 'Heleket 配置不完整' }

    const result = await createHeleketClient(heleketConfig).getPaymentInfo({ order_id: record.orderNo })
    const gatewayStatus = extractHeleketStatus(result)
    const state = getHeleketPaymentState(result)
    callbackData = { source, heleketStatus: gatewayStatus, queryResult: result, configSource, ...(actorId ? { adminId: actorId } : {}) }
    paymentDetails = mergeHeleketPaymentDetails(record.paymentDetails, result, heleketConfig, {
      orderNo: record.orderNo,
      invoiceAmount: expectedAmount
    }) as Record<string, unknown>

    if (state !== 'paid') {
      // Do not auto-cancel or fail from reconciliation; terminal and unknown provider states need review.
      if (state === 'pending') {
        const metadataTradeNo = result.uuid?.trim() || result.txid?.trim() || null
        await db.updateRechargeOrderMetadata(record.orderNo, { tradeNo: metadataTradeNo, paymentDetails })
      }
      return {
        status: record.status,
        reconciled: false,
        reviewRequired: state === 'cancelled' || state === 'failed',
        message: state === 'pending' ? getHeleketStatusDescription(gatewayStatus) : `支付平台状态 ${gatewayStatus || '未知'}，需人工复核`
      }
    }

    const invoiceAmount = getHeleketInvoiceAmount(result)
    if (invoiceAmount === undefined || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0 || invoiceAmount + AMOUNT_TOLERANCE < expectedAmount) {
      await db.updateRechargeOrderMetadata(record.orderNo, {
        tradeNo: result.uuid?.trim() || result.txid?.trim() || null,
        callbackData,
        paymentDetails
      })
      await createLog(record.userId, 'system', 'recharge.reconciliation_review',
        `Heleket payment amount requires review: order ${record.orderNo}, expected ${expectedAmount}, received ${String(result.amount)}`, 'warning')
      return { status: record.status, reconciled: false, reviewRequired: true, message: 'Heleket 支付金额不足或异常，需人工复核' }
    }

    tradeNo = result.uuid?.trim() || result.txid?.trim() || result.order_id?.trim() || record.orderNo
  }

  const indexedTradeNo = getTradeNoForIndex(record.orderNo, tradeNo)
  if (await isCallbackProcessed(record.providerId, record.orderNo, indexedTradeNo)) {
    const latest = await db.getRechargeRecordByOrderNo(record.orderNo)
    if (latest?.status === 'completed') return { status: 'completed', reconciled: false, message: '订单已完成' }
    return { status: latest?.status || record.status, reconciled: false, reviewRequired: true, message: '存在已处理的支付记录但订单未完成，需人工复核' }
  }

  await db.completeRecharge(record.orderNo, {
    tradeNo,
    actualAmount: creditedAmount,
    callbackData,
    paymentDetails
  })
  await markCallbackProcessed(record.providerId, record.orderNo, indexedTradeNo, source)
  await createLog(record.userId, 'system', 'recharge.reconciled',
    `Recharge reconciled via ${providerType}: order ${record.orderNo}, amount ${creditedAmount}, tradeNo ${tradeNo || 'N/A'}`, 'success')

  return { status: 'completed', reconciled: true, message: '支付已核实并入账' }
}
