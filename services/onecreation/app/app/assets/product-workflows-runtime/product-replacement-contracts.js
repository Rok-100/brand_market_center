"use strict";

const PRODUCT_PROFILE_CATALOG = require("./product-profiles.json");

const PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION = "2026.08.24-v1";
const PRODUCT_PROFILE_SCHEMA_VERSION = PRODUCT_PROFILE_CATALOG.schemaVersion;
const PRODUCT_PROFILES = PRODUCT_PROFILE_CATALOG.products;

function profileFor(productId) {
  return PRODUCT_PROFILES[String(productId || "")] || null;
}

function profileName(productId) {
  return profileFor(productId)?.platformName || String(productId || "目标产品");
}

function profileDimensions(productId, layerKey) {
  return profileFor(productId)?.dimensionsCm?.[layerKey] || {};
}

const COMMON_LOCALIZATION_RULES = Object.freeze([
  "目标产品参考图张数只代表素材视角和证据数量，绝不等于画面产品数量；产品数量、层数和排列以原片当前物理状态与连续镜头组库存为准；其中，原片明确只有一个产品对象时一对一替换为一个目标产品；原片为多个、成组、堆叠、抱持或陈列时，保持原片当前占用区域、量感、密度、重心和遮挡，按目标产品真实尺寸、承托范围与人体可持握能力自动计算自然数量，不机械照搬旧产品件数；只有真实的拿出、放入、消耗或补充动作才允许改变数量。",
  "先在原片当前时间点定位真正的原产品对象，记录其中心点、落脚面、朝向、识别面、遮挡边界、手部接触点和可见轮廓；运输纸箱、快递箱、防震材料、桌面和背景道具均不是原产品。",
  "替换时保持原产品的接触点、承托面、重心和遮挡顺序，但不得机械继承旧产品外框；必须按目标产品真实长宽高、形状和当前透视重新计算可见轮廓。",
  "优先让目标产品最明显的品牌识别面朝向原片原产品的主要识别方向；若受手部遮挡，只保留符合原片握持关系的可见区域，不得为了露出LOGO改变手势或让产品穿过手指。",
  "同一sourceShot内保持目标产品尺寸、位置、朝向和状态连续；只允许由真实运镜、景深、遮挡和透视产生画面占比变化。"
]);

const COMMON_SCENE_RULES = Object.freeze([
  "运输纸箱、快递外箱、气泡膜、防震纸、桌面和收纳容器属于场景容器或道具，默认原样保留，不替换成目标产品包装。",
  "只有被原片证据判定为零售外盒、直接容器、单片包装或实际内容物的对象才进入换品范围；无法确认时不得猜测扩大替换范围。",
  "当原产品动作与目标产品物理结构不兼容时，保留镜头功能、人物、节奏和手部因果，改写为目标产品可执行的等价动作，禁止把撕袋动作强套给圆罐，也禁止把开盖动作强套给单片袋。"
]);

const CONTRACTS = Object.freeze({
  "wis-black-crystal-mask": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-black-crystal-mask",
    productName: profileName("wis-black-crystal-mask"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "content_unit",
        label: "黑晶膜布",
        evidenceKeywords: ["膜布", "面膜纸", "贴片面膜", "揭膜", "撕膜", "敷面膜", "上脸", "贴合", "展开膜布", "取下面膜"],
        assetKeywords: ["膜布", "内容物", "展开", "材质"],
        assetRequired: true,
        sizingMode: "anatomical_reference",
        physicalSize: "展开尺寸暂缺；按脸部覆盖关系与黑晶膜布参考图处理",
        geometry: "黑色、极薄、湿润柔软的脸型膜布；展开后覆盖额头、鼻部、双颊和下巴，眼鼻口开孔服从面部结构",
        identity: "表面均匀覆盖炭灰色/灰黑色蜂窝状或六边形网格纹理，湿润水光清晰；不能是纯黑无纹理膜、白膜、透明膜或眼膜",
        recognitionSurface: "蜂窝/六边形湿润纹理与完整脸型开孔是主要识别面",
        stateRules: [
          "膜布必须是黑色、湿润、平整服帖，并保留克制清晰的蜂窝/六边形纹理。",
          "刚从单片袋取出时必须是近方形折叠薄片，边缘略弧、湿润、有蜂窝纹理；不能瞬间变为完全展开脸型膜布。",
          "只有后续明确展开、上脸、贴合时才允许从折叠方片变为完整脸型膜布。",
          "原片只出现脸部与膜布时，不得凭产品参考图新增面膜盒、单片袋、瓶罐或其他包装；不得新增面膜盒、单片袋、瓶罐或其他包装。",
          "不得新增原片证据中没有的液体拉丝、滴液、精华流动或无来源特效。",
          "禁止生成白色、透明、半透明、浅灰色或普通无纺布面膜。"
        ],
        negative: ["白色膜布", "透明膜布", "半透明膜布", "普通无纺布", "眼膜", "纯黑无纹理", "刚出袋即完整展开", "一团黑布", "长条湿巾"]
      }),
      Object.freeze({
        id: "single_sachet",
        label: "黑晶面膜单片袋",
        evidenceKeywords: ["单片袋", "袋装", "开袋", "撕袋", "包装袋", "从袋中", "抽出内容物"],
        assetKeywords: ["单片正面", "单片背面", "袋"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-black-crystal-mask", "singleSachet"),
        geometry: "近正方形、极薄的黑色单片袋，正面16cm×16cm",
        identity: "黑色单片袋，+WIS+品牌和固有标签区域服从参考图",
        recognitionSurface: "单片袋正面品牌识别面优先朝向镜头",
        stateRules: ["与外盒处于相近距离和同一视觉平面时，正面宽高约为外盒正面的95%，差异主要是单片袋极薄。"],
        negative: ["迷你小样袋", "窄长袋", "竖版小包装", "厚盒", "单片袋明显小于外盒"]
      }),
      Object.freeze({
        id: "retail_outer_box",
        label: "黑晶面膜零售外盒",
        evidenceKeywords: ["零售外盒", "面膜盒", "包装盒", "方盒", "盒装", "产品盒"],
        assetKeywords: ["盒正面", "盒背面", "盒顶部", "盒左侧", "盒右侧"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-black-crystal-mask", "retailOuterBox"),
        geometry: "正面16.4cm×16.4cm、厚4cm的近正方形黑色盒装",
        identity: "黑色盒装，+WIS+标识和固有正面标签区服从参考图，正面不拉伸、不压扁",
        recognitionSurface: "零售外盒正面为主要产品识别面",
        stateRules: ["同款外盒在同一视频中保持同一物理模板；数量感只能通过排布、遮挡和景深体现。"],
        negative: ["竖版高盒", "横版扁盒", "无厚度薄片", "同款外盒大小不一", "缩小包装制造数量"]
      })
    ]),
    actionMappings: Object.freeze([
      "旧产品包装类型只用于定位删除对象；目标包装层级仅由当次用户选定的目标产品图确认。",
      "源动作是开盖圆罐时，不能直接映射为黑晶单片袋；应在原节奏位置改为拿取单片、撕开袋口或展开膜布中的等价动作。"
    ]),
    negativeConstraints: Object.freeze(["把运输纸箱替换成黑晶外盒", "产品比例沿用旧产品外框", "包装与膜布层级混用", "新增原片不存在的滴液或拉丝"])
  }),

  "wis-crystal-firming-eye-mask": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-crystal-firming-eye-mask",
    productName: profileName("wis-crystal-firming-eye-mask"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "content_unit",
        label: "凝胶眼膜单片",
        evidenceKeywords: ["眼膜片", "眼贴", "眼周", "贴敷", "夹取膜片", "水凝膜", "凝胶膜片", "下眼睑"],
        assetKeywords: ["眼膜片", "膜片", "眼贴", "透明底"],
        sizingMode: "anatomical_reference",
        physicalSize: "单片展开尺寸暂缺；按下眼睑—颧骨覆盖关系与眼膜参考图处理",
        geometry: "轻薄透明的弹力水凝膜，极淡冰蓝或近透明冷白，按眼下弧线贴合，边缘只有细浅蓝透明轮廓",
        identity: "薄到透出肤色、掌纹和背景轮廓；柔软有轻微回弹，表面均匀水光，不是厚硅胶垫或果冻块",
        recognitionSurface: "月牙/眼贴轮廓、极薄透明度和下眼睑贴合关系共同构成识别面",
        stateRules: [
          "贴眼周时沿下眼睑至颧骨上缘自然铺展，左右眼分别服从人体结构，不得变成整脸面膜。",
          "精华只允许沿边缘形成1-2颗小滴并短距离缓慢滴落，可短暂断续拉丝，不形成长水柱。"
        ],
        negative: ["整脸面膜", "厚硅胶片", "厚果冻块", "硬塑料片", "完全不透明", "持续细长水柱", "胶水拉丝"]
      }),
      Object.freeze({
        id: "primary_container",
        label: "眼膜低矮圆罐",
        evidenceKeywords: ["眼膜罐", "圆罐", "罐装", "开盖", "罐内", "勺取", "夹取"],
        assetKeywords: ["眼膜纯正面", "眼膜新包装", "眼膜仰视", "晶润眼膜", "罐"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-crystal-firming-eye-mask", "primaryContainer"),
        geometry: "直径7.7cm、高4.1cm的低矮圆罐，高度约为直径的一半",
        identity: "蓝白银产品体系，+WIS+标签区域与固有包装文字服从参考图；不能变成高筒瓶、方盒或赠品小样",
        recognitionSurface: "圆罐正面蓝色+WIS+标签区优先朝向镜头",
        stateRules: ["同款圆罐在同一视频中保持同一物理模板，不能通过缩小罐体制造数量感。"],
        negative: ["高筒瓶", "细长瓶", "方盒", "眼霜小样罐", "同款圆罐大小不一"]
      }),
      Object.freeze({
        id: "retail_outer_box",
        label: "眼膜零售外盒",
        evidenceKeywords: ["零售外盒", "眼膜盒", "包装盒", "盒装", "产品盒"],
        assetKeywords: ["盒", "新包装", "头图"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-crystal-firming-eye-mask", "retailOuterBox"),
        geometry: "正面宽8cm、高4.4cm，顶部与底部8cm×8cm、深8cm的横向扁长方盒",
        identity: "蓝白银色调的横向扁长方盒，+WIS+与固有标签区域服从参考图；不是正面8cm×8cm的方盒、16cm面膜大盒或大礼盒",
        recognitionSurface: "零售外盒正面品牌与标签区为主要识别面",
        stateRules: ["眼膜罐直径约为外盒正面宽度的96%，罐高约为外盒正面高度的93%；同框时外盒平面轮廓略宽，盒体与圆罐高度接近。"],
        negative: ["16cm大盒", "大礼盒", "正面8×8正方形盒", "竖版高盒", "外盒明显大于圆罐"]
      })
    ]),
    actionMappings: Object.freeze([
      "旧产品包装类型只用于定位删除对象；目标包装层级仅由当次用户选定的目标产品图确认，运输纸箱不参与换品。",
      "源动作是撕开单片袋时，目标眼膜应改为开罐、夹取眼膜片或贴敷眼周的等价动作；不能让圆罐被撕开。"
    ]),
    negativeConstraints: Object.freeze(["把运输纸箱替换成眼膜盒", "把低矮眼膜罐生成高瓶", "眼膜盒与圆罐体量差异过大", "眼膜片变整脸面膜"])
  }),

  "wis-birds-nest-peptide-revitalizing-mask": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-birds-nest-peptide-revitalizing-mask",
    productName: profileName("wis-birds-nest-peptide-revitalizing-mask"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡（50g，外盒5.4×5.4×高8.2cm） > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "content_unit",
        label: "燕窝胜肽凝胶",
        evidenceKeywords: ["凝胶", "燕窝冻", "燕窝丝", "搅拌", "勺取", "拉丝", "涂抹", "厚敷", "清理", "洗净", "擦拭"],
        assetKeywords: ["质地", "罐口", "凝胶", "勺取", "拉丝"],
        sizingMode: "rheology_reference",
        physicalSize: "无固定展开尺寸；按50g产品容量、勺具、罐口、面部涂抹范围与质地参考图处理",
        geometry: "乳白偏透明、可带轻微黄琥珀感的软糯高粘度凝胶，具有内部折射、细小气泡、湿润镜面光和细丝纹理",
        identity: "燕窝冻般晶莹软糯、顺滑、慢回弹，勺取时缓慢滑落并形成连续胶丝，上脸后铺成清透水光膜层",
        recognitionSurface: "半透明燕窝冻质地、细丝纹理、慢回弹和清透涂抹膜层是内容物识别特征",
        stateRules: [
          "上脸必须避开眼周和唇部，不能变成贴片面膜、眼膜、泥膜或白色厚膏。",
          "产品规格按更新资料卡锁定为净含量50g；凝胶取用量服从罐口、勺具和面部比例，不凭空放大。"
        ],
        negative: ["贴片面膜", "眼膜", "泥膜", "面霜", "白色厚膏", "水状液体", "硬果冻块", "胶水鼻涕状夸张拉丝"]
      }),
      Object.freeze({
        id: "primary_container",
        label: "燕窝面膜透明高身圆罐",
        evidenceKeywords: ["圆罐", "罐装", "罐身", "金盖", "开盖", "罐口", "搅拌", "勺取"],
        assetKeywords: ["罐正面", "罐侧面", "罐背面", "金色瓶盖", "罐口"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-birds-nest-peptide-revitalizing-mask", "primaryContainer"),
        geometry: "直径4.9cm、高7.8cm的透明厚底高身圆柱罐，明显窄于且高于眼膜低矮圆罐",
        identity: "透明厚底罐身、金色圆盖、蓝金标签、+WIS+标识和白色燕窝图案服从参考图；不能变成滴管瓶或眼霜矮罐",
        recognitionSurface: "蓝金正面标签、+WIS+和白色燕窝图案优先朝向镜头",
        stateRules: ["同款圆罐在同一视频中保持直径4.9cm、高7.8cm的固定模板；允许透视变化，不允许罐型漂移。"],
        negative: ["眼霜矮罐", "宽矮圆罐", "精华滴管瓶", "细长高筒瓶", "不透明罐身", "金盖丢失"]
      }),
      Object.freeze({
        id: "retail_outer_box",
        label: "燕窝面膜零售外盒",
        evidenceKeywords: ["零售外盒", "燕窝盒", "包装盒", "盒装", "方柱盒", "产品盒"],
        assetKeywords: ["盒正面", "盒立体", "盒侧面", "盒背面"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-birds-nest-peptide-revitalizing-mask", "retailOuterBox"),
        geometry: "宽5.4cm、高8.2cm、深5.4cm的小型方柱盒",
        identity: "深海军蓝盒身、金色logo与金色底边、白色燕窝图案；不能变成扁盒、大礼盒或16cm面膜大方盒",
        recognitionSurface: "深蓝金零售外盒正面与白色燕窝图案为主要识别面",
        stateRules: ["外盒用于品牌识别，透明圆罐用于真实使用；同框时不得把外盒画得巨大或把圆罐画成赠品小样。"],
        negative: ["扁盒", "大礼盒", "16cm大方盒", "外盒巨大", "盒身无厚度"]
      })
    ]),
    actionMappings: Object.freeze([
      "旧产品包装类型只用于定位删除对象；目标包装层级仅由当次用户选定的目标产品图确认，运输纸箱不参与换品。",
      "源动作是撕开单片袋或展开膜布时，目标燕窝面膜应在相同节奏位置改为开罐、搅拌、勺取或涂抹凝胶，禁止把燕窝面膜生成贴片。"
    ]),
    negativeConstraints: Object.freeze(["把运输纸箱替换成燕窝外盒", "把燕窝高身圆罐生成眼膜矮胖罐", "沿用旧产品外框导致比例失真", "把凝胶生成贴片面膜"])
  }),

  "wis-hydra-peptide-mask": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-hydra-peptide-mask",
    productName: profileName("wis-hydra-peptide-mask"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "content_unit",
        label: "隐形水润膜布",
        evidenceKeywords: ["膜布", "面膜纸", "取出", "展开", "贴脸", "揭保护膜"],
        assetKeywords: ["膜布", "内容物", "展开", "珠光保护膜"],
        assetRequired: true,
        sizingMode: "physical_and_anatomical_reference",
        dimensionsCm: profileDimensions("wis-hydra-peptide-mask", "foldedContent"),
        geometry: "折叠时约6.5×10.5cm、展开后贴合完整脸型的0.21mm轻薄近透明湿润膜布，并带可揭除珠光保护膜",
        identity: "膜布薄、近透明、湿润柔软；珠光保护膜是独立可分离层，贴脸后必须揭除",
        recognitionSurface: "近乎隐形的贴肤膜布与可分离珠光保护膜共同构成内容物结构",
        stateRules: ["出袋时保留膜布与珠光保护膜双层关系。", "贴脸后明确揭下珠光保护膜，只保留近乎隐形的湿润膜布。"],
        negative: ["漏掉珠光保护膜", "厚白棉布", "干燥起毛膜布", "硬塑料片"]
      }),
      Object.freeze({
        id: "single_sachet",
        label: "隐形水润面膜单片袋",
        evidenceKeywords: ["单片袋", "袋装", "撕袋", "开袋"],
        assetKeywords: ["单片正面", "单片背面", "袋"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-hydra-peptide-mask", "singleSachet"),
        geometry: "宽12.5cm、高18.2cm的竖向薄袋",
        identity: "单片袋品牌、固有文字、主色和开口结构服从目标产品参考图",
        recognitionSurface: "单片袋正面品牌识别面优先朝向镜头",
        stateRules: ["单片袋接近外盒正面尺寸但极薄，不得生成小样袋。"],
        negative: ["掌心小袋", "横向扁袋", "厚盒"]
      }),
      Object.freeze({
        id: "retail_outer_box",
        label: "隐形水润面膜零售外盒",
        evidenceKeywords: ["零售外盒", "面膜盒", "包装盒", "盒装"],
        assetKeywords: ["盒正面", "盒背面", "盒侧面", "盒顶部"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-hydra-peptide-mask", "retailOuterBox"),
        geometry: "宽13.5cm、高18.5cm、深4cm的竖向大盒",
        identity: "正式品名为WIS隐形水润面膜；包装外观、标签和材质服从目标产品参考图",
        recognitionSurface: "零售外盒正面为主要识别面",
        stateRules: ["手掌只覆盖盒面中央约55%–60%宽度，不能缩成掌心小盒。", "开盒库存固定10片。"],
        negative: ["掌心小盒", "横版扁盒", "无厚度薄片", "名称增加水光肽"]
      })
    ]),
    actionMappings: Object.freeze(["源动作为开罐或按压瓶时，应改写为开盒、取单片袋、撕袋、展开并揭保护膜的等价动作。"]),
    negativeConstraints: Object.freeze(["把运输纸箱替换成零售外盒", "漏掉珠光保护膜", "包装比例沿用旧产品外框", "名称增加水光肽"])
  }),

  "wis-deep-sea-refining-tender-essence-classic": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-deep-sea-refining-tender-essence-classic",
    productName: profileName("wis-deep-sea-refining-tender-essence-classic"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "content_unit",
        label: "深海次抛单支",
        evidenceKeywords: ["次抛", "单支", "联排", "掰断", "挤出", "精华"],
        assetKeywords: ["单支", "联排", "五支", "掰断", "出液"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-deep-sea-refining-tender-essence-classic", "singleAmpoule"),
        geometry: "宽约1.8cm、高8.7cm的细长次抛，由可掰断帽盖、透明液体仓和蓝色标签尾部组成",
        identity: "透明硬质液体仓内为透明凝露；不是白色内容仓、玻璃安瓶或注射器",
        recognitionSurface: "蓝色标签尾部、透明液体仓和可掰断顶部共同构成识别结构",
        stateRules: ["每5支为一组联排，完整盒内固定6组、共30支。", "开启方式为掰断帽盖，不得旋拧或剪开。"],
        negative: ["白色液体仓", "玻璃安瓶", "注射器", "旋拧瓶盖", "剪开开启"]
      }),
      Object.freeze({
        id: "retail_outer_box",
        label: "深海次抛零售外盒",
        evidenceKeywords: ["零售外盒", "次抛盒", "包装盒", "盒装", "抱持", "堆叠"],
        assetKeywords: ["盒正面", "盒背面", "盒侧面", "外盒"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-deep-sea-refining-tender-essence-classic", "retailOuterBox"),
        geometry: "宽13.6cm、高10cm、深6.4cm的横向中大型扁长方盒，长边水平",
        identity: "经典款零售外盒，品牌、固有文字、颜色和结构服从参考图",
        recognitionSurface: "横向外盒正面品牌区优先朝向镜头",
        stateRules: ["单手只能从侧边持握，不能轻松包过另一侧。", "原片8瓶小产品的抱持画面优先重构为2列×2行共4盒。"],
        negative: ["竖直摆放长边", "缩成掌心小盒", "机械保留8盒", "盒内不是30支"]
      })
    ]),
    actionMappings: Object.freeze(["小瓶或安瓶动作只能迁移其功能；目标产品开启必须改写为从联排取下一支并掰断帽盖。"]),
    negativeConstraints: Object.freeze(["把次抛生成医疗针剂", "机械保持旧产品件数", "盒内库存不是6组×5支", "目标外盒缩小制造数量感"])
  }),

  "wis-whitening-ampoule": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-whitening-ampoule",
    productName: profileName("wis-whitening-ampoule"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡中的既有wis-whitening-ampoule产品 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "primary_container",
        label: "美白针精华瓶",
        evidenceKeywords: ["美白针", "精华瓶", "拔盖", "按压", "尖嘴", "出液"],
        assetKeywords: ["瓶正面", "瓶背面", "透明瓶", "拔盖", "按压", "出液"],
        sizingMode: "hand_reference",
        physicalSize: "闭合瓶体总长约等于一只成年亚洲女性完整手长，瓶身直径约两个手指宽",
        geometry: "带透明外盖的细长圆柱精华瓶，拔盖后露出银色肩环与按压式尖嘴",
        identity: "正式产品名为+WIS+ 光感微珠美白精华液，平台显示名WIS美白针；瓶内微珠事实必须服从真实素材",
        recognitionSurface: "瓶身品牌和固有标签区域为主要识别面",
        stateRules: ["平台简称“美白针”仅是商品简称，绝不代表针剂结构。", "未取得真实素材前不得虚构微珠颜色、数量、大小或涂开状态。"],
        negative: ["注射器", "针头", "医疗安瓿", "胶头滴管", "虚构微珠"]
      }),
      Object.freeze({
        id: "dispensing_tip",
        label: "美白针按压式尖嘴",
        evidenceKeywords: ["尖嘴", "按压", "出液", "拔盖"],
        assetKeywords: ["尖嘴", "按压", "出液", "拔盖"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-whitening-ampoule", "dispensingTip"),
        geometry: "约2cm长的按压式出液尖嘴",
        identity: "尖嘴属于护肤精华出液结构，不是针头、喷雾泵或胶头滴管",
        recognitionSurface: "拔下透明外盖后可见的银色肩环与尖嘴",
        stateRules: ["必须先拔外盖，再按压顶部真实出液。"],
        negative: ["针头", "喷雾泵", "胶头滴管", "旋拧瓶盖"]
      })
    ]),
    actionMappings: Object.freeze(["源动作按目标瓶体结构改写为拔下透明外盖、按压顶部、从尖嘴出液；禁止任何注射动作。"]),
    negativeConstraints: Object.freeze(["另建错误产品ID", "使用不存在的旧误称", "生成针头或注射器", "虚构微珠属性"])
  }),

  "wis-skin-revitalizing-protein-spray": Object.freeze({
    schemaVersion: PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
    productId: "wis-skin-revitalizing-protein-spray",
    productName: profileName("wis-skin-revitalizing-protein-spray"),
    productProfileVersion: PRODUCT_PROFILE_SCHEMA_VERSION,
    sourcePriority: "统一产品资料卡 > 当次用户选定目标产品图 > SKU其他文字",
    layers: Object.freeze([
      Object.freeze({
        id: "primary_container",
        label: "肌活蛋白喷雾瓶",
        evidenceKeywords: ["喷雾瓶", "瓶身", "水油分层", "摇匀", "喷洒"],
        assetKeywords: ["瓶正面", "瓶背面", "静置", "摇匀", "喷雾"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-skin-revitalizing-protein-spray", "assembled"),
        geometry: "瓶身直径5.3cm，含盖整瓶高约22.5cm的250ml高挑圆柱喷雾瓶",
        identity: `正式产品名为${profileFor("wis-skin-revitalizing-protein-spray").formalName}，平台显示名${profileName("wis-skin-revitalizing-protein-spray")}；内容物静置为水油双相`,
        recognitionSurface: "瓶身品牌标签、水油分层和高挑圆柱比例共同构成识别面",
        stateRules: ["静置时必须有清晰水油双相，使用前摇匀后才暂时融合。", "整瓶约1.3–1.4个完整女性手长，不得缩成小喷瓶。"],
        negative: ["小喷瓶", "香水瓶", "气雾罐", "静置无分层"]
      }),
      Object.freeze({
        id: "spray_pump",
        label: "喷雾按压泵",
        evidenceKeywords: ["喷头", "喷泵", "按压", "细雾", "拔盖"],
        assetKeywords: ["喷头", "喷泵", "喷雾", "拔盖"],
        sizingMode: "physical",
        dimensionsCm: profileDimensions("wis-skin-revitalizing-protein-spray", "sprayPump"),
        geometry: "直径约1.5cm、高约2.9cm的按压式喷泵",
        identity: "按压后形成细密均匀雾化，不是水柱、滴管或气雾阀",
        recognitionSurface: "拔盖后露出的细长按压泵",
        stateRules: ["距面部约10–15cm喷出细密扇形或云雾状喷雾。"],
        negative: ["水柱", "大水滴", "滴管", "气雾阀"]
      })
    ]),
    actionMappings: Object.freeze(["源动作改写为摇匀、拔盖、距面部10–15cm按压喷雾；喷洒前后保持水油状态连续。"]),
    negativeConstraints: Object.freeze(["瓶体缩成小样", "静置状态没有水油分层", "喷成水柱", "把平台名误改为旧称或其他产品名"])
  })
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sourceEvidence(source = {}) {
  const sourceShots = Array.isArray(source?.sourceShots) ? source.sourceShots : [];
  const units = Array.isArray(source?.units) ? source.units : Array.isArray(source?.sourceUnits) ? source.sourceUnits : [];
  return [
    source?.summary,
    source?.title,
    source?.action,
    source?.actionGeometry,
    source?.productExposure,
    source?.sourceProductRole,
    source?.sourceProductEvidence,
    source?.productLocator?.evidence,
    ...sourceShots.flatMap((shot) => [shot?.title, shot?.action, shot?.actionGeometry, shot?.productExposure, shot?.sourceProductRole, shot?.sourceProductEvidence]),
    ...units.flatMap((unit) => [unit?.title, unit?.action, unit?.actionGeometry, unit?.productExposure, unit?.sourceProductRole, unit?.sourceProductEvidence])
  ].filter(Boolean).join(" ").toLowerCase();
}

function sourceProductRoles(source = {}) {
  const nested = [
    ...(Array.isArray(source?.sourceShots) ? source.sourceShots : []),
    ...(Array.isArray(source?.units) ? source.units : []),
    ...(Array.isArray(source?.sourceUnits) ? source.sourceUnits : [])
  ];
  return [source?.sourceProductRole, ...nested.map((item) => item?.sourceProductRole)]
    .map((role) => String(role || "").trim())
    .filter(Boolean);
}

function productReplacementContract(productOrId) {
  const id = typeof productOrId === "string" ? productOrId : String(productOrId?.id || productOrId?.productId || "");
  const builtIn = CONTRACTS[id];
  const profile = profileFor(id);
  const supplied = typeof productOrId === "object" && productOrId?.replacementContract && typeof productOrId.replacementContract === "object"
    ? productOrId.replacementContract
    : null;
  if (!builtIn && !supplied) return null;
  return clone({
    ...(builtIn || {}),
    ...(supplied || {}),
    productName: profile?.platformName || supplied?.productName || builtIn?.productName,
    productProfileVersion: profile ? PRODUCT_PROFILE_SCHEMA_VERSION : supplied?.productProfileVersion || builtIn?.productProfileVersion,
    layers: supplied?.layers || builtIn?.layers || []
  });
}

function productProfile(productOrId) {
  const id = typeof productOrId === "string" ? productOrId : String(productOrId?.id || productOrId?.productId || "");
  return clone(profileFor(id));
}

function formatProductScaleReference(productOrId) {
  const profile = productProfile(productOrId);
  if (!profile?.scaleReference?.prompt) return "";
  return `产品人体比例锚点（${PRODUCT_PROFILE_CATALOG.scaleReferenceSubject}，${profile.scaleReference.anchor}）：${profile.scaleReference.prompt}`;
}

function formatProductQuantityStrategy(productOrId) {
  const profile = productProfile(productOrId);
  if (!profile?.quantityStrategy?.prompt) return "";
  const defaults = PRODUCT_PROFILE_CATALOG.quantityStrategyDefaults?.rules || [];
  return [
    ...defaults,
    profile.quantityStrategy.prompt
  ].filter(Boolean).join("；");
}

function assetDescriptor(asset = {}) {
  return [asset.title, asset.fileName, asset.localPath, asset.angleLabel, asset.name].filter(Boolean).join(" ").toLowerCase();
}

function activeReplacementLayers(productOrId, source = {}, targetAssets = []) {
  const contract = productReplacementContract(productOrId);
  if (!contract) return [];
  const role = String(source?.sourceProductRole || "").trim();
  if (["transport_container", "none"].includes(role)) return [];
  const roles = sourceProductRoles(source);
  if (roles.length && roles.every((item) => ["transport_container", "none"].includes(item))) return [];
  const selectedTargetAssets = Array.isArray(targetAssets) ? targetAssets.filter(Boolean) : [];
  if (selectedTargetAssets.length) {
    const targetLayers = contract.layers.filter((layer) => (layer.assetKeywords || []).some((keyword) => (
      selectedTargetAssets.some((asset) => assetDescriptor(asset).includes(String(keyword).toLowerCase()))
    )));
    // The source role describes what must be removed, not which target package layer must be generated.
    // If selected target assets cannot be classified from metadata, keep the images as the only target truth
    // instead of falling back to a same-name source layer such as box -> box.
    return targetLayers;
  }
  // Old-product roles and SKU metadata may locate the object to remove, but they are not
  // evidence for the target package layer. Without selected target-image evidence, stay generic.
  return [];
}

function dimensionText(layer = {}) {
  const dimensions = layer.dimensionsCm || {};
  if (Number.isFinite(dimensions.diameter)) return `真实尺寸：直径${dimensions.diameter}cm、高${dimensions.height}cm`;
  if (Number.isFinite(dimensions.width)) return `真实尺寸：宽${dimensions.width}cm、高${dimensions.height}cm${Number.isFinite(dimensions.depth) ? `、深${dimensions.depth}cm` : ""}`;
  return layer.physicalSize || "尺寸服从人体部位与参考图";
}

function formatProductReplacementContract(productOrId, source = {}, options = {}) {
  const contract = productReplacementContract(productOrId);
  if (!contract) return "";
  const targetAssets = Array.isArray(options.targetAssets) ? options.targetAssets.filter(Boolean) : [];
  const layers = activeReplacementLayers(productOrId, source, targetAssets);
  const productName = contract.productName || (typeof productOrId === "object" ? productOrId.name : "目标产品");
  const phase = options.phase === "quality" ? "成片验收" : options.phase === "anchor" ? "首帧/关键帧生成" : "视频生成";
  const sourceRole = String(source?.sourceProductRole || "").trim();
  const roles = sourceProductRoles(source);
  const noReplaceableProduct = ["transport_container", "none"].includes(sourceRole)
    || (roles.length > 0 && roles.every((item) => ["transport_container", "none"].includes(item)));
  const identityLockLabel = layers.some((layer) => layer.id === "content_unit") ? "目标产品身份硬锁｜" : "";
  return [
    `${identityLockLabel}产品替换契约（${contract.schemaVersion}，${phase}）：目标SKU=${productName}；统一资料版本=${contract.productProfileVersion || "未登记"}；资料优先级=${contract.sourcePriority}。`,
    ...COMMON_LOCALIZATION_RULES,
    ...COMMON_SCENE_RULES,
    noReplaceableProduct ? "" : formatProductScaleReference(productOrId),
    noReplaceableProduct ? "" : `目标产品数量策略：${formatProductQuantityStrategy(productOrId)}`,
    noReplaceableProduct
      ? "本镜头原片证据只显示运输/场景容器，没有可替换的原产品：必须保留容器、人物、手部和构图，不得凭目标产品参考图新增任何目标产品或零售包装。"
      : targetAssets.length
        ? layers.length
          ? `目标产品层级由本次已选参考图确定为：${layers.map((layer) => layer.label).join("、")}；旧产品的盒/瓶/罐/袋/片类型只用于定位待删除对象，不得强制映射为同名目标层级。`
          : "目标产品层级、形状和包装状态只服从本次已选参考图；旧产品的盒/瓶/罐/袋/片类型只用于定位待删除对象，禁止据此反推或重新设计目标包装。"
        : "未取得已选目标产品图的可验证层级证据：目标对象统一称为“目标产品”，不得从旧产品角色、动作、SKU名称或契约默认值推断零售外盒、直接容器、单片包装、内袋或内容物层级。",
    ...layers.flatMap((layer) => [
      `【${layer.label}】${dimensionText(layer)}；几何=${layer.geometry}；身份=${layer.identity}；主要识别面=${layer.recognitionSurface}。`,
      ...(layer.stateRules || []).map((rule) => `【${layer.label}状态】${rule}`)
    ]),
    "动作映射只迁移原片的拿、抱、托、放、堆叠、取出和展示等物理功能；目标对象的包装层级、几何与数量策略服从已选目标产品图，不执行机械的盒换盒、瓶换瓶或片换片。",
    "目标产品图负责身份、结构、颜色、标签和材质真值；原片负责人物、场景、动作时间、接触点、遮挡与机位。两者冲突时不能照抄旧产品外框，必须围绕原接触点按目标产品真实几何重建。"
  ].filter(Boolean).join("\n");
}

function productReplacementNegative(productOrId, source = {}, targetAssets = []) {
  const contract = productReplacementContract(productOrId);
  if (!contract) return "";
  const layers = activeReplacementLayers(productOrId, source, targetAssets);
  return [...new Set([
    ...(contract.negativeConstraints || []),
    ...(productProfile(productOrId)?.negativeConstraints || []),
    ...layers.flatMap((layer) => layer.negative || []),
    "误替换运输纸箱",
    "把运输纸箱当零售外盒",
    "沿用旧产品外框导致目标产品比例错误",
    "目标产品识别面朝向错误",
    "手部接触点漂移",
    "产品悬空",
    "遮挡层级错误"
  ])].join("，");
}

function filterReplacementAssets(productOrId, source = {}, assets = []) {
  const rows = Array.isArray(assets) ? assets : [];
  const layers = activeReplacementLayers(productOrId, source, rows);
  const roles = sourceProductRoles(source);
  const noReplaceableProduct = roles.length > 0 && roles.every((role) => ["transport_container", "none"].includes(role));
  if (noReplaceableProduct) return { assets: [], layers, matched: false, requiredMissing: false, noReplaceableProduct: true };
  if (!layers.length || !rows.length) return { assets: rows, layers, matched: false, requiredMissing: false, noReplaceableProduct: false };
  const keywords = [...new Set(layers.flatMap((layer) => layer.assetKeywords || []))];
  const matched = rows.filter((asset) => keywords.some((keyword) => assetDescriptor(asset).includes(String(keyword).toLowerCase())));
  const requiredLayers = layers.filter((layer) => layer.assetRequired === true);
  const requiredKeywords = [...new Set(requiredLayers.flatMap((layer) => layer.assetKeywords || []))];
  const requiredMatches = rows.filter((asset) => requiredKeywords.some((keyword) => assetDescriptor(asset).includes(String(keyword).toLowerCase())));
  const requiredMissing = requiredLayers.length > 0 && !requiredMatches.length;
  if (requiredLayers.length) {
    return {
      assets: requiredMatches.length ? requiredMatches : rows,
      layers,
      matched: requiredMatches.length > 0,
      requiredMissing,
      noReplaceableProduct: false
    };
  }
  // Every explicitly selected same-SKU image remains an upstream truth asset. Matching is used only
  // to validate required layers; it must never discard a user's layout/quantity reference image.
  return { assets: rows, layers, matched: matched.length > 0, requiredMissing, noReplaceableProduct: false };
}

module.exports = {
  PRODUCT_PROFILE_CATALOG,
  PRODUCT_PROFILE_SCHEMA_VERSION,
  PRODUCT_PROFILES,
  PRODUCT_REPLACEMENT_CONTRACT_SCHEMA_VERSION,
  PRODUCT_REPLACEMENT_CONTRACTS: CONTRACTS,
  activeReplacementLayers,
  filterReplacementAssets,
  formatProductQuantityStrategy,
  formatProductReplacementContract,
  formatProductScaleReference,
  productProfile,
  productReplacementContract,
  productReplacementNegative,
  sourceEvidence
};
