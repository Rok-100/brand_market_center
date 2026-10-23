// Only confirmed catalog names are automatic rules. Ambiguous business aliases
// (for example 微针) deliberately stay unclassified until confirmed.
export const normalizeProduct = (name: string) => name === '燕窝胜肽面膜' ? '燕窝面膜' : name === '清洁泥膜' ? '其他 WIS 素材' : name
export const historyKey = (number: string) => `wis:upload-product:v1:${encodeURIComponent(number)}`
export function initialCategory(context: string | undefined, history: string | null, options: string[], fallback: string) {
  return [context, history].map(value => normalizeProduct(value || '')).find(value => options.includes(value) && value !== '待分类') || fallback
}
