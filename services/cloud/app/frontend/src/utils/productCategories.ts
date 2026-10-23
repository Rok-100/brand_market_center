// Keep the two explicit product names consistent across editable forms.
export const CLEANSER_PRODUCT_CATEGORIES = ['凝颜洁面', '极润洁面'] as const

export const MATERIAL_PRODUCT_CATEGORIES = [
  '其他 WIS 素材', '黑晶面膜', '肌活蛋白喷雾', '晶润眼膜', '隐形水润面膜',
  '深海次抛', '燕窝面膜', '美白针', '通用', '黄金面膜', '凝颜洁面', '极润洁面', '颈膜', 'WIS隐形水润面膜',
] as const

// Product options are a catalog, never inferred from the number of stored files.
export function materialProductNames(existing: string[] = []) {
  const normalize = (name: string) => name === '燕窝胜肽面膜' ? '燕窝面膜' : name === '清洁泥膜' ? '其他 WIS 素材' : name
  return Array.from(new Set([...MATERIAL_PRODUCT_CATEGORIES, ...existing.map(normalize)]))
    .filter(name => Boolean(name) && name !== '待分类')
}
