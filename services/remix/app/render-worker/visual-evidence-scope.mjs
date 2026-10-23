// Shared instructions only: no verdict rewriting, key migration, resubmission,
// or claims that a transcription has been independently heard/verified.
export const VISUAL_EVIDENCE_SCOPE = [
 '证据口径：sourceText以及timeline/contextTimeline中的文本可能来自自动ASR；ASR转写不等于实际画面字幕，也不是已经核对无误的逐字音频事实。不得把转写里的疑似同音字、品牌拼写或专名差异直接认定为画面字幕错字。实际字幕以所给图片中清楚可见的文字为准；没有提供音频时不得声称听过声音、确认口播错读或漏词。',
 'sourceTextComplete=true只说明选入时间边界的文本范围完整，不保证ASR转写正确，不证明实际字幕或音频完整，更不代表本成片已经通过审核。若sourceTextComplete明确为false（sourceTextComplete=false），说明已选入边界存在文本缺口或完整性依据不足；须保留sourceTextStatus所指明的边界证据缺口并待复核，不能将邻文补成实际口播。旧记录未提供该字段不等于false，仍按已有证据检查。',
 '动态字幕可能逐字出现、逐句替换或分多屏展示，不要求一个静态帧同时显示sourceText中的整句及前后句。禁止仅因单帧没有显示整句、前一句或后一句，就判断成片截断、缺句、行动引导不完整或字幕错误；一个抽样时点未见某句，不等于该句在整段缺失。若提供同clip多个时间点，须按时间顺序联合核对，不得把正常字幕变化当作相互冲突。',
 '不得自动纠正ASR、改写画面文字或推断未展示的句子确实存在。明确可见的错字、真实遮挡或裁掉字形、字幕内容冲突，以及有选入边界或多时点证据支持的缺失仍必须报告；关键字看不清或关键完整性仍无法判断时保留待复核，具体区分“看到的问题”和“尚缺的证据”。问题应给出clip/时间点和实际可见文字，不能只引用ASR猜测。上述证据区分不是通过依据，不降低置信度门槛，也不把不确定改成pass。'
].join('');
