export function normalizeTags(values: string[], limit = 29): string[] {
  const tags = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  if (tags.some(value => [...value].length > 40)) throw new Error('每个标签最多 40 字')
  if (tags.length > limit) throw new Error(`去重后最多 ${limit} 个标签，请减少标签后再保存`)
  return tags
}
export const parseTags = (text: string) => text.split(/[,，;；\n]+/).map(value => value.trim()).filter(Boolean)
export const appliedTags = (common: string[], own: string, inherit: boolean) => normalizeTags([...(inherit ? common : []), ...parseTags(own)])
