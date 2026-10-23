// Delivery admission limits are separate from generation targets and platform budgets.
export function normalizeQianchuanDeliveryLimits(value = {}) {
  const unlimited = value.deliveryLimitMode === 'unlimited';
  const quantityUnlimited = value.deliveryLimitMode === 'quantity_unlimited';
  return {
    deliveryLimitMode: unlimited ? 'unlimited' : quantityUnlimited ? 'quantity_unlimited' : 'limited',
    dailyMaterialLimit: unlimited || quantityUnlimited ? null : Math.min(20, Math.max(1, Math.trunc(Number(value.dailyMaterialLimit) || 1))),
    dailySpendGuardYuan: unlimited ? null : Number.isFinite(Number(value.dailySpendGuardYuan)) && Number(value.dailySpendGuardYuan) > 0
      ? Number(value.dailySpendGuardYuan) : null,
  };
}

export function assertQianchuanDeliveryLimits(config) {
  if (config.deliveryLimitMode !== 'unlimited' && !config.dailySpendGuardYuan) {
    throw new Error('启用真实千川投放前必须配置每日消耗护栏，或明确选择不额外限制。');
  }
}
