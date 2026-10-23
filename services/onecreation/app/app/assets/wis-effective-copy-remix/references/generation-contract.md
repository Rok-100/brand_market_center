# 生成契约

## 输入

推荐输入结构：

```json
{
  "sku": {
    "id": "商品唯一标识",
    "name": "完整商品名",
    "spoken_name": "已审核口播简称",
    "category": "面膜/眼膜/涂抹面膜/精华/其他"
  },
  "channel": "抖音千川",
  "duration_seconds": 20,
  "counts": {"stable": 2, "balanced": 2, "bold": 1},
  "mother": {
    "transcript": "完整逐字稿",
    "speaker_perspective": "谁在说、采用什么人称",
    "scene_context": "人物和场景关系",
    "shot_functions": [],
    "must_keep": []
  },
  "truth": {
    "verified_claims": [],
    "verified_evidence": [],
    "usage": [],
    "offer_spoken": "",
    "offer_verified_at": "",
    "authorized_entities": []
  },
  "constraints": {
    "forbidden_terms": [],
    "required_terms": [],
    "variation_request": ""
  }
}
```

如果 `offer_spoken` 为空，不生成任何具体价格、盒数、片数、赠品、库存、截止时间或“恢复原价”表述。

## 输出

输出可读文案时使用以下顺序：

1. 母版诊断
2. 继承的不变量
3. 允许变化的变量
4. 文案版本
5. 风险与待确认项

工作台或脚本调用时使用JSON：

```json
{
  "schema_version": "1.0",
  "sku_id": "string",
  "mother_pattern": {
    "primary": "pattern-id",
    "secondary": "pattern-id or empty",
    "reason": "为什么匹配"
  },
  "invariants": [],
  "variables": [],
  "variants": [
    {
      "id": "stable-01",
      "tier": "stable",
      "template_id": "S1",
      "hook": "前三秒口播",
      "voiceover": "完整口播",
      "spoken_rhythm": ["按口播顺序切分的停顿段"],
      "logic_map": [
        {"beat": "hook", "mother_function": "母版功能", "new_line": "本版对应表达"}
      ],
      "innovation": "本版只改变什么",
      "evidence_shots": ["口播需要的画面证据"],
      "evidence_sources": ["商品真值字段或历史结构来源"],
      "risk_flags": [],
      "pending_fields": []
    }
  ],
  "batch_risks": [],
  "human_review_required": true
}
```

## 三档定义

| 档位 | 必须保持 | 可变化 | 不应出现 |
| --- | --- | --- | --- |
| stable | 节点、顺序、视角、角色、情绪、主要句式 | 商品真值、机制和少量措辞 | 新增人设、新增剧情、新卖点 |
| balanced | 节点、顺序、视角、角色、核心证据 | 一个主要创新轴，局部句式 | 同时改钩子、证据、剧情和机制 |
| bold | 心理功能、人物功能、动作因果、成交顺序 | 原句、场景和表现形式 | 只靠夸张、伪事实或换序制造“创新” |

## 口播长度

默认以每秒4至5个有效汉字估算，叙事或双人对话取下限，单人急促信息流可接近上限。口播必须给停顿、反应和产品镜留时间。若母版本身语速异常快，不能把异常当作继续压缩的依据。

## 质量评分

每项0至2分，总分16分：

- 前三秒相关性
- 痛点具体度
- 母版逻辑保真
- 商品真值一致
- 证据可拍性
- 口语自然度
- 创新单一且清晰
- 机制与风险控制

任一“商品真值一致”或“机制与风险控制”为0分，不得直接进入视频生成。总分低于12分返回修改。

## 文案批次要求

- 同批每条必须有不同的主要创新轴
- 不得只替换称呼、语气词或同义词
- 不得连续三条使用相同开头句法
- 相邻版本不应重复同一生活场景和同一证据镜头
- 每条都要标明“为什么仍然是这条母版的二创”
