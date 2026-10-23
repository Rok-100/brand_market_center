const REMAKE_HISTORY_ADMIN_NAMES = Object.freeze([
  "古广妹",
  "舒豪",
  "何雨庭"
]);

const HIDDEN_PRODUCT_IDS = Object.freeze([
  "wis-ningyan-anti-aging-set"
]);

const historyAdminNames = new Set(REMAKE_HISTORY_ADMIN_NAMES);
const hiddenProductIds = new Set(HIDDEN_PRODUCT_IDS);

function normalizedDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function isRemakeHistoryAdmin(user = {}) {
  return historyAdminNames.has(normalizedDisplayName(user.name || user.realName));
}

function isVisibleProduct(product = {}) {
  const id = String(product.id || "").trim();
  const name = String(product.name || product.platformName || product.shortName || "").trim();
  return !hiddenProductIds.has(id) && !name.includes("凝颜");
}

function normalizeRecipeTags(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,，\n]/);
  return [...new Set(raw
    .map((item) => String(item || "").trim().replace(/\s+/g, " ").slice(0, 30))
    .filter(Boolean))]
    .slice(0, 12);
}

module.exports = {
  REMAKE_HISTORY_ADMIN_NAMES,
  HIDDEN_PRODUCT_IDS,
  normalizedDisplayName,
  isRemakeHistoryAdmin,
  isVisibleProduct,
  normalizeRecipeTags
};
