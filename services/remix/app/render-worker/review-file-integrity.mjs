const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validPath = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');

// Audit server-owned batchOutputInput snapshots both before and after model
// work. Never populate missing provenance, mutate the input or retain hashes
// between calls: the bytes may change while the asynchronous review runs.
// Access/SKU/approval and snapshot checks remain the caller's responsibility.
export async function verifyReviewFiles(input, {hashFile} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return '审核文件输入缺失；保留原成片，未自动放行。';
  if (typeof hashFile !== 'function')
    return '审核文件校验器不可用；保留原成片，未自动放行。';
  if (!validPath(input.filePath))
    return '成片文件路径缺失或无效；保留原成片，未自动放行。';
  if (!validSha(input.sha256))
    return '成片缺少有效的 SHA-256 摘要；保留原成片，未自动放行。';
  if (!Array.isArray(input.sourceFiles) || input.sourceFiles.length === 0)
    return '来源文件清单缺失；保留原成片，未自动放行。';

  // Copy path/hash primitives before the first await. Mutating a library or
  // input object during hashing must not change the expected bytes mid-call.
  const files = [];
  for (let index = 0; index < input.sourceFiles.length; index += 1) {
    const source = input.sourceFiles[index];
    const label = `来源文件（第 ${index + 1} 个）`;
    if (!source || !validPath(source.filePath))
      return `${label}路径缺失或无效；保留原成片，未自动放行。`;
    if (!validSha(source.sha256))
      return `${label}缺少有效的 SHA-256 摘要；保留原成片，未自动放行。`;
    files.push({label, filePath: source.filePath, sha256: source.sha256});
  }
  files.push({label: '成片文件', filePath: input.filePath, sha256: input.sha256});

  const expectedByPath = new Map();
  for (const file of files) {
    if (expectedByPath.has(file.filePath) && expectedByPath.get(file.filePath) !== file.sha256)
      return `${file.label}与同路径文件的审核摘要冲突；保留原成片，未自动放行。`;
    expectedByPath.set(file.filePath, file.sha256);
  }
  const checked = new Set();
  for (const {label, filePath, sha256} of files) {
    if (checked.has(filePath)) continue;
    let actual;
    try {
      actual = await hashFile(filePath);
    } catch {
      // Do not expose disk paths or provider exceptions in public review state.
      return `${label}无法读取或校验；保留原成片，未自动放行。`;
    }
    if (!validSha(actual))
      return `${label}校验未返回有效的 SHA-256 摘要；保留原成片，未自动放行。`;
    if (actual !== sha256)
      return `${label}内容与已核验摘要不符；保留原成片，未自动放行。`;
    checked.add(filePath);
  }
  return null;
}
