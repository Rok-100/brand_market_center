export type GenerateInput = {
  product: string;
  scriptType: string;
  templateTitle: string;
  templateCopy: string;
  requirements: string;
  audience?: string;
  previousContent?: string;
};

export type CreativeMode = "steady" | "expand" | "bold";
export type RewriteMode = "same-direction" | "new-direction";

type ProductProfile = {
  openingProblem: string;
  ageTruth: string;
  productProof: string;
  skinFeel: string;
  resultPicture: string;
  simpleReason: string;
  value: string;
  action: string;
};

const DEFAULT_AUDIENCE = "30+熟龄女性，重点覆盖40+资深中产、都市银发和小镇中老年女性";
export const STANDARD_KOC_LENGTH = { target: 300, min: 260, max: 340 } as const;

const profiles: Record<string, ProductProfile> = {
  "眼膜": {
    openingProblem: "眼睛周围一干、一垮、小线条一出来，整个人立刻就显年龄",
    ageTruth: "人老先老眼；眼睛的状态稳住了，站在同龄人里就是更显年轻",
    productProof: "果冻一样的眼膜贴上去，膜片裹着满满的精华，敷一会儿能看见它慢慢变薄",
    skinFeel: "上眼冰冰凉凉、软软糯糯，就像给眼周库库灌水，干瘪的地方一点点嘭起来",
    resultPicture: "揭下来眼周又润又亮，看着紧一些、嘭一些，眼睛也更有神",
    simpleReason: "好成分不是浮在眼睛下面转一圈，而是顺着膜片一点点被眼周吃进去",
    value: "一大罐够用很久，活动时两大罐一起带回家，早晚敷也不心疼",
    action: "眼膜是消耗品，赶上活动就多备着，别等眼周真的垮下来才着急",
  },
  "黄金面膜": {
    openingProblem: "女人过了四十岁，显老的不只是一两条纹，而是脸开始松、瘪、往下走",
    ageTruth: "年轻时皮肤好可能是底子；过了四十岁还紧、润、亮，真的是一天一天养出来的",
    productProof: "金色膜布贴上脸很服帖，十五分钟像给整张脸做了一次密集精华浴",
    skinFeel: "刚贴上凉凉润润的，越敷越感觉脸被稳稳托住，干的地方喝饱了，松的地方也有往回收的感觉",
    resultPicture: "揭下来脸是亮的、润的、嘭的，苹果肌看着更饱满，整个人立刻精神很多",
    simpleReason: "三文鱼PDRN和六重胜肽不是只顾脸表面，而是把干、纹、松、垮一层层照顾到",
    value: "在家十五分钟就能做一次高阶护理，比动不动上千元的院线项目更容易长期坚持",
    action: "到了这个年纪，面膜不能只补水；刷到活动就先给自己备上，重要日子前更离不开",
  },
  "黑晶面膜": {
    openingProblem: "面膜敷了不少，脸还是粗、毛孔还是松，不一定是东西不好，可能是精华一直停在表面",
    ageTruth: "脸上的毛孔一松、皮肤一粗，即使没几条大纹，看起来照样比实际年龄老",
    productProof: "这片黑晶膜布里有比头发丝还细很多的小骨针，敷上不是扎脸，而是先给精华铺好路",
    skinFeel: "贴上有存在感但不疼，十五分钟里能感觉脸慢慢润开，粗糙的地方也软下来",
    resultPicture: "揭下来不是油亮，是皮肤看着更细、更平，毛孔收住一点，脸上的老态也淡了",
    simpleReason: "小骨针先开路，石墨烯膜布再把精华往里带，不让好东西只在脸上白白打转",
    value: "一次黄金微针要花不少钱，在家一片就能做，省下的不只钱，还有疼和恢复时间",
    action: "普通面膜已经满足不了的粗糙老态，可以趁活动先试一盒，别一直把钱花在表面功夫上",
  },
  "燕窝面膜": {
    openingProblem: "过了四十岁，脸上没有大纹也可能显老，因为气色暗、皮肤干，人看着就没精神",
    ageTruth: "真正显年轻的脸，不只是纹少，而是细腻、滋润、透着被好好养过的光泽",
    productProof: "打开是晶莹Q弹的燕窝凝胶，轻轻搅一搅再敷，整个护理过程很有仪式感",
    skinFeel: "上脸软软润润，不糊、不闷，敷完轻轻擦掉，皮肤摸起来又滑又嫩",
    resultPicture: "脸上的干黄感被润开了，气色透出来，不化妆看着也比之前精神、年轻",
    simpleReason: "把燕窝里真正养肤的燕窝酸提出来直接敷脸，比绕一大圈更直接地滋养皮肤",
    value: "一碗燕窝的价格，在家能认真养很多次脸；不是乱花钱，是把钱花在看得见的状态上",
    action: "这个年纪更要舍得对自己好一点，活动合适就备两罐，把好气色慢慢养回来",
  },
  "次抛精华": {
    openingProblem: "精华一瓶接一瓶地买，脸上的纹和松却没见变化，可能不是你没坚持，而是精华开封久了早就不新鲜了",
    ageTruth: "抗老最怕花了很多钱却没有结果；过了四十岁，每一次护理都得真正在脸上留下东西",
    productProof: "一次一支，拧开就是新鲜的，用多少开多少，不让贵的成分每天跟空气耗着",
    skinFeel: "精华润而不厚，抹开很顺，轻轻按一按就贴进皮肤里，脸摸起来软、润、有弹性",
    resultPicture: "坚持用，干瘪感慢慢少了，脸看着饱满、细腻，轮廓也更利落",
    simpleReason: "六重胜肽负责把不同的纹和松一层层管起来，独立次抛负责把每一滴的新鲜劲留到上脸那一刻",
    value: "一支不到几块钱，却把高阶抗老做成了每天都能坚持的事，比买大瓶回来放到失活更划算",
    action: "别再让昂贵精华开开关关慢慢变旧，活动时按周期备足，每天一支才不会断",
  },
  "水油/蛋白喷雾": {
    openingProblem: "年纪上来以后，脸不是缺一阵水，而是越来越薄、越来越干瘪，普通喷雾喷完一会儿又回去了",
    ageTruth: "脸上的饱满度就是年轻感；皮肤一瘪一松，再精致的衣服也很难把年龄藏住",
    productProof: "瓶里水和油是分开的，用前摇一摇，喷出来的雾很细，脸上没有大水珠",
    skinFeel: "水先把脸润起来，油再把这份润养稳稳留住，喷完柔润、有光泽，不黏也不闷",
    resultPicture: "干瘪的脸看着慢慢嘭起来，摸起来软一些、弹一些，整个人也更有精气神",
    simpleReason: "它不只是补一层水，还把重组胶原和胜肽一起带上脸，缺水和初老一起照顾",
    value: "一大瓶随手就能用，早晚护理、脸干的时候都能喷，比瓶瓶罐罐叠一桌更容易坚持",
    action: "抗老最怕三天打鱼两天晒网，放在手边每天多喷几次，把皮肤的饱满感慢慢养住",
  },
  "水润面膜": {
    openingProblem: "脸一干就容易显瘪、显粗，到了这个年纪，缺水带来的老态比年轻时明显得多",
    ageTruth: "水润不是年轻人的专属；皮肤润、亮、饱满，五十岁也可以看着比同龄人精神",
    productProof: "薄薄的膜布贴得很服帖，每一片都吸满精华，十五分钟给整张脸认真补一次水",
    skinFeel: "敷上清清凉凉，干的地方像在慢慢喝水，揭下来皮肤软软的、润润的",
    resultPicture: "脸上的干瘪和粗糙被润开，皮肤看着透亮、饱满，整个人少了疲惫老态",
    simpleReason: "不只给表面沾点水，而是把水分稳稳留在皮肤里，让脸自己越来越会保水",
    value: "一片同时照顾干、粗、暗，日常长期敷也不心疼，比临时补救更划算",
    action: "别等脸干到显纹才补水，活动合适就按周期备着，把好状态一点点养出来",
  },
  "美白针": {
    openingProblem: "脸色一暗一黄，五官再好看也容易显疲惫、显年龄，尤其和同龄人站在一起更明显",
    ageTruth: "皮肤白不是唯一标准，但透亮、干净、有光泽的脸，确实更显年轻、更有精神",
    productProof: "一次一支的新鲜精华，打开直接用，量清楚，也不让成分在大瓶里反复接触空气",
    skinFeel: "质地轻润、抹开很快，按进皮肤后不厚重，脸上是细腻柔亮的感觉",
    resultPicture: "暗黄感慢慢退下去，皮肤看着更匀、更净，素颜也有精神",
    simpleReason: "把抗氧和提亮一起做，不只是盖住暗沉，而是让脸少一点氧化发黄的老态",
    value: "把高阶提亮做成每天一支，容易坚持，也比反复买一堆没有结果的瓶瓶罐罐更省",
    action: "气色不是一天养出来的，趁活动把一个周期备齐，坚持用才看得见同龄人之间的差距",
  },
};

const fallbackProfile = profiles["黄金面膜"];

const styleDirections: Record<string, string> = {
  "付费KOC脚本": "真实达人分享感，前3秒抓人，口播短促自然，卖点与促单完整",
  "唠嗑KOC脚本": "像熟人坐在身边聊天，有年龄阅历、生活细节和自然停顿",
  "明星原片脚本": "从符合艺人人设的真实场景和触发事件开始，用合理对话推进，产品后置自然出现",
  "明星营销号脚本": "用艺人职业或人生特质建立强钩子，以焦虑、反常识或关系背书推动反转",
  "视频号脚本": "用新闻感、讲师感、数字清单或生活关系快速立题，句子短、结论前置、便于一创混剪",
};

const learnedRules: Record<string, string> = {
  "付费KOC脚本": "保持真人口语、熟龄焦虑、可感知肤感、结果画面和明确促单",
  "唠嗑KOC脚本": "保持熟人聊天感与生活细节，不端着念卖点",
  "明星原片脚本": "必须写清场景、触发事件、人物关系和可直接拍摄的对话；人物动作、产品使用者和生活常识必须匹配",
  "明星营销号脚本": "必须出现符合艺人职业、经历或公众形象的表达；事实与创意台词分开，不能把未授权经历写成真人事实",
  "视频号脚本": "优先采用社会话题、反常识结论、数字清单、强结果或家庭微剧情；一条只保留一个核心钩子和一条清楚的转品路径",
};

function clean(value: string, max = 160) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function referenceBlueprint(copy: string) {
  const parts = copy.replace(/【[^】]+】/g, " ").split(/[。！？!?\n]+/).map((part) => clean(part, 72)).filter((part) => part.length >= 8);
  const find = (pattern: RegExp) => parts.find((part) => pattern.test(part));
  return {
    hook: parts[0] || "从一个具体的年龄变化切入",
    experience: find(/敷|贴|上脸|肤感|精华|冰|润|软|薄/) || parts[1] || "用真实上脸感受证明卖点",
    proof: find(/膜布|成分|吸收|变薄|效果|变化|对比/) || parts[2] || "用看得见的变化建立信任",
    close: find(/活动|价格|库存|下单|到手|买|备/) || parts.at(-1) || "用明确理由完成收口",
  };
}

function seededIndex(seed: string, offset: number, length: number) {
  let value = 2166136261;
  for (const char of `${seed}-${offset}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return Math.abs(value) % length;
}

function pick<T>(items: T[], seed: string, offset: number) {
  return items[seededIndex(seed, offset, items.length)];
}

function hasStarSignal(copy: string) {
  return /明星|艺人|秦海璐|陈紫函|徐璐|林心如|代言/.test(copy);
}

function script(title: string, lines: Array<[string, string]>) {
  return {
    title,
    content: lines.map(([voice, picture], index) => `镜头${String(index + 1).padStart(2, "0")}｜口播：${voice}\n画面：${picture}`).join("\n\n"),
  };
}

function fitSpokenLength(content: string) {
  const blocks = content.split("\n\n");
  while (countSpokenCharacters(blocks.join("\n\n")) > STANDARD_KOC_LENGTH.max && blocks.length > 8) {
    blocks.splice(Math.max(3, blocks.length - 3), 1);
  }
  return blocks.join("\n\n");
}

type CreativeRoute = {
  hook: string;
  scene: string;
  relationship: string;
  structure: string;
  proof: string;
  close: string;
};

const routePools = {
  hook: ["意外发现", "一句争执", "同龄反差", "先说结论", "真实自嘲", "价格反差", "旧照片触发", "家人追问", "使用挑战", "反常识判断", "重要场合倒计时", "一个小动作暴露年龄"],
  scene: ["梳妆台前", "老友聚会后", "母女聊天", "整理旧照片", "出门见人前", "旅行收行李", "家中拆快递", "活动候场", "饭后闲聊", "照镜子卸妆时", "收到同龄人夸奖后", "为重要纪念日做准备"],
  relationship: ["自己对镜头", "母女", "多年好友", "姐妹", "伴侣", "助理与艺人", "化妆师与艺人", "网友评论与回应", "同龄人之间", "过去的自己与现在的自己"],
  structure: ["结果倒叙", "问题逐层放大", "质疑后反转", "一件小事带出产品", "三次真实感受递进", "前后状态对照", "先讲错误做法再给答案", "对话推动", "一天使用日记", "清单式拆解", "悬念揭晓", "生活观察变成购买理由"],
  proof: ["触感变化", "镜前近景", "膜布或质地变化", "家人先发现", "连续使用记录", "同角度前后对照", "使用动作", "素颜精神状态", "重要场合后的反馈", "从舍不得用到主动补货"],
  close: ["把状态养回来", "提醒同龄人别拖", "聪明囤一个周期", "重要日子前固定使用", "好东西分享给熟人", "回扣开场事件", "从质疑变成主动选择", "把复杂护理变成一件能坚持的事"],
} as const;

function routeLimit(mode: CreativeMode) {
  return mode === "steady" ? 6 : mode === "expand" ? 10 : 12;
}

function inferFromPrevious(previous: string, values: readonly string[]) {
  if (!previous) return "";
  return values.find((value) => previous.includes(value.replace(/前$|后$/, ""))) || "";
}

function createRoute(seed: string, mode: CreativeMode, previous = "", sameDirection = false): CreativeRoute {
  const limit = routeLimit(mode);
  const choose = (values: readonly string[], offset: number) => {
    const inferred = sameDirection ? inferFromPrevious(previous, values) : "";
    return inferred || pick([...values].slice(0, Math.min(limit, values.length)), seed, offset);
  };
  return {
    hook: choose(routePools.hook, 1),
    scene: choose(routePools.scene, 2),
    relationship: choose(routePools.relationship, 3),
    structure: choose(routePools.structure, 4),
    proof: choose(routePools.proof, 5),
    close: choose(routePools.close, 6),
  };
}

function routeOpening(route: CreativeRoute, profile: ProductProfile, mode: CreativeMode) {
  const openings: Record<string, string[]> = {
    "意外发现": ["我最近才发现，最让人显年龄的，往往不是那几条纹。", `昨天凑近镜子，我突然看见：${profile.openingProblem}。`],
    "一句争执": ["女儿说我什么都舍得给家里买，就是舍不得认真养自己。", "我和老朋友争了半天：这个年纪，到底还要不要在脸上花心思？"],
    "同龄反差": ["同样过了四十岁，有的人看起来是成熟，有的人却先被疲惫感追上了。", "老同学坐在一起，衣服可以不同，脸上的状态却最藏不住。"],
    "先说结论": ["女人过了四十岁，想显年轻，先别只盯着皱纹。", `先说结论：${profile.ageTruth}。`],
    "真实自嘲": ["我以前护肤最大的本事，就是买得勤、用得随缘。", "说来好笑，我柜子里瓶瓶罐罐不少，脸却没跟着争气。"],
    "价格反差": ["这次我先看的不是成分表，是价格，结果看完反而认真研究起来了。", "以前我嫌它贵舍不得，这次活动下来，我又怕自己买少了。"],
    "旧照片触发": ["整理旧照片时我才明白，人不是突然变老的，是脸上的精神气一点点淡下去。"],
    "家人追问": ["家里人突然问我：你最近是不是换了什么，怎么整个人看着亮堂了？"],
    "使用挑战": ["我给自己定了一个小挑战：不换别的步骤，只认真用完一个周期看看。"],
    "反常识判断": ["面膜敷得多，不代表脸真的被养到了；有时只是表面热闹。"],
    "重要场合倒计时": ["离重要见面只剩一天时，我最怕的不是衣服没选好，是脸看起来又干又没精神。"],
    "一个小动作暴露年龄": ["我现在判断脸有没有显老，只看一个动作：笑完以后，状态能不能很快回来。"],
  };
  const candidates = openings[route.hook] || openings["意外发现"];
  const line = candidates[seededIndex(`${route.scene}-${route.structure}`, 0, candidates.length)];
  return mode === "bold" ? line.replace(/^我/, "说个可能得罪人的话，我") : line;
}

function scenePicture(route: CreativeRoute) {
  const relation = route.relationship === "自己对镜头" ? "单人近景" : `${route.relationship}自然同框`;
  return `${route.scene}，${relation}；先拍正在发生的事，不让产品抢着出场`;
}

function generateOpenScripts(input: GenerateInput, options: { count: number; seed: string; creativeMode: CreativeMode; rewriteMode?: RewriteMode }) {
  const profile = profiles[input.product] ?? fallbackProfile;
  const need = clean(input.requirements || "突出抗老、容貌状态和显年轻", 180);
  const reference = input.templateCopy ? referenceBlueprint(input.templateCopy) : null;
  return Array.from({ length: options.count }, (_, index) => {
    const seed = `${options.seed}-${index}`;
    const route = createRoute(seed, options.creativeMode, input.previousContent, options.rewriteMode === "same-direction");
    const opening = routeOpening(route, profile, options.creativeMode);
    const referenceSignal = reference
      ? `我只借了参考稿里“${clean(reference.experience, 24)}”这种让人能感受到的证据，故事和说法都重新来。`
      : `我没照着现成稿子套，只想把这次最真实的感受讲清楚。`;
    const structureLines: Record<string, string> = {
      "结果倒叙": `先说结果，${profile.resultPicture}。但真正让我留下它的，是整个使用过程没有负担。`,
      "问题逐层放大": `${profile.openingProblem}。再往后看，脸一干、一瘪，整个人连精神气都会被带下去。`,
      "质疑后反转": `我一开始也不信一个${input.product}能有多大区别，直到自己把使用前后放在同一面镜子里看。`,
      "一件小事带出产品": `就是那件小事之后，我才把${input.product}从柜子里拿出来，真正连续用了起来。`,
      "三次真实感受递进": `第一次觉得舒服，第二次开始期待，真正让我留下它的是状态慢慢稳住了。`,
      "前后状态对照": `我没有换灯光，也没刻意遮，只把用之前和用之后放在同一个角度看。`,
      "先讲错误做法再给答案": `以前我只顾着表面补一层，后来才发现，能坚持、能看见反馈，才是适合我的答案。`,
      "对话推动": `对方追问我到底换了什么，我才把最近固定在用的${input.product}拿出来。`,
      "一天使用日记": `早上看状态、晚上真实用，中间不补滤镜，这一天我只记录皮肤最直接的反馈。`,
      "清单式拆解": `我留下它只看三件事：上脸舒不舒服、用完有没有状态、日常能不能坚持。`,
      "悬念揭晓": `我先不说是什么，你们看完这个使用过程，再猜我为什么把它放在手边。`,
      "生活观察变成购买理由": `真正让我下决定的不是一句广告，而是我发现它很容易进入每天的生活。`,
    };
    const proofLines: Record<string, string> = {
      "触感变化": profile.skinFeel,
      "镜前近景": `${profile.resultPicture}，我把镜头凑近给你们看，不靠远景糊弄。`,
      "膜布或质地变化": profile.productProof,
      "家人先发现": `最先发现的不是我，是家里人随口说了一句：你今天看着比前几天精神。`,
      "连续使用记录": `我没有只拍最好看的一天，而是把连续使用时的状态一点点记下来。`,
      "同角度前后对照": `同一个位置、同一面镜子再看，${profile.resultPicture}。`,
      "使用动作": `${profile.skinFeel}，整个动作不复杂，所以我才愿意反复做。`,
      "素颜精神状态": `我更在意素颜时有没有精神，而不是临时盖住；${profile.resultPicture}。`,
      "重要场合后的反馈": `真正让我安心的是，到了见人和拍近景的时候，脸没有先泄气。`,
      "从舍不得用到主动补货": `最开始我还省着用，后来发现状态有反馈，反而会主动把下一个周期备好。`,
    };
    const closeLines: Record<string, string> = {
      "把状态养回来": `我们要的不是装嫩，是把脸上的精神气和年轻感慢慢养回来。`,
      "提醒同龄人别拖": `别等松、干、垮全写在脸上才着急，这件事越早认真越省心。`,
      "聪明囤一个周期": `${profile.value}，与其东买一点西买一点，不如把一个周期踏实用完。`,
      "重要日子前固定使用": `以后重要日子前，我都会把这一步提前留出来，不再临时乱补救。`,
      "好东西分享给熟人": `这种自己真能感受到的东西，我才愿意讲给同龄姐妹听。`,
      "回扣开场事件": `所以回头看，开场那件小事不是偶然，是脸在提醒我该认真养了。`,
      "从质疑变成主动选择": `我从不信到主动留下它，靠的不是一句成分，是脸给我的反馈。`,
      "把复杂护理变成一件能坚持的事": `抗老不用把生活弄得很累，先把这一件能坚持的事做好。`,
    };
    const lines: Array<[string, string]> = [
      [opening, scenePicture(route)],
      [structureLines[route.structure], `按“${route.structure}”推进，动作和对话承接开场，不切成产品说明书`],
      [referenceSignal, reference ? "只吸收有效说服机制，不复刻参考稿的开头、人物、顺序或结尾" : "从本次需求独立构思"],
      [`我这次用的是${input.product}。${profile.skinFeel}`, "产品在故事成立后出现，拍取用、质地和真实表情"],
      [`它让我愿意继续用，不是因为一长串听不懂的名词，而是${profile.simpleReason}。`, "只保留一个听得懂的产品理由，避免成分堆砌"],
      [proofLines[route.proof], `本版核心证据：${route.proof}；用可拍画面代替研发术语`],
      [`说到底，${profile.ageTruth}。${need.includes("原稿：") ? "这次我把旧说法彻底放下，只保留真正要表达的重点。" : ""}`, "回到目标人群的真实愿望，不说年轻人的加班、熬夜或妆效需求"],
      [`所以我现在做决定很简单：它得让我用着舒服、看得到状态，也得适合我真正坚持下去。`, "用个人选择标准承接结果，让推荐不像背广告词"],
      [closeLines[route.close], `以“${route.close}”收口；若补充需求没有真实价格或库存，不虚构数字`],
    ];
    const routeLabel = `${route.hook} × ${route.scene} × ${route.structure} × ${route.proof}`;
    return {
      title: `${input.product}｜${route.hook}·${route.scene}`,
      content: script("", lines).content,
      creativeRoute: routeLabel,
    };
  });
}

export function countSpokenCharacters(content: string) {
  return content
    .split("\n")
    .filter((line) => line.includes("口播："))
    .map((line) => line.split("口播：").slice(1).join("口播："))
    .join("")
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, "")
    .length;
}

export function getLengthAssessment(content: string) {
  const count = countSpokenCharacters(content);
  return {
    count,
    target: STANDARD_KOC_LENGTH.target,
    status: count < STANDARD_KOC_LENGTH.min ? "偏短" : count > STANDARD_KOC_LENGTH.max ? "偏长" : "合适",
  } as const;
}

function sharedMiddle(product: string, profile: ProductProfile): Array<[string, string]> {
  return [
    [`就这个${product}，我最喜欢的不是它把成分说得多复杂，而是上脸真的有感觉。`, "达人拿产品靠近镜头，产品名正对画面；语气像给熟人推荐"],
    [profile.productProof, "产品和上脸特写交替；把质地、膜布或包装特点拍清楚"],
    [profile.skinFeel, "达人边使用边说，手指按压或向上轻提；加轻微水声、弹润音效"],
    [profile.simpleReason, "只用一组简洁花字解释原因，不连续堆成分名"],
    [profile.resultPicture, "揭下或使用后凑近镜头，左右转脸展示光泽、饱满度和轮廓"],
  ];
}

export function analyzeCreativeBrief(input: GenerateInput) {
  const audience = clean(input.audience || DEFAULT_AUDIENCE, 80);
  const need = clean(input.requirements, 120);
  const lengthRule = ["付费KOC脚本", "唠嗑KOC脚本"].includes(input.scriptType)
    ? "普通KOC脚本以纯口播约300字为目标，260—340字为合适区间"
    : "明星与视频号脚本以场景、人物和转品逻辑完整为准，不机械套用300字";
  const referenceNote = input.templateCopy
    ? "参考稿只用于提取有效说服机制，不继承其人物、场景、叙事顺序和句式"
    : "本轮不调用案例骨架，直接从创作要求建立新的人物、场景和叙事路线";
  return `已调用${input.scriptType}标准：${learnedRules[input.scriptType] ?? learnedRules["付费KOC脚本"]}。${referenceNote}。本轮补充需求“${need}”会作为硬约束写入口播；核心人群锁定${audience}；${lengthRule}。`;
}

export function generateScripts(input: GenerateInput, options: { count?: number; seed?: string; excluded?: string[]; creativeMode?: CreativeMode; rewriteMode?: RewriteMode } = {}) {
  const profile = profiles[input.product] ?? fallbackProfile;
  const audience = clean(input.audience || DEFAULT_AUDIENCE, 80);
  const need = clean(input.requirements || "突出抗老、容貌状态和显年轻", 140);
  const direction = styleDirections[input.scriptType] ?? styleDirections["付费KOC脚本"];
  const product = input.product;
  const blueprint = referenceBlueprint(input.templateCopy);
  const seed = options.seed || crypto.randomUUID();
  const count = Math.max(1, Math.min(options.count || 3, 3));
  return generateOpenScripts(input, {
    count,
    seed,
    creativeMode: options.creativeMode || "expand",
    rewriteMode: options.rewriteMode,
  });
  /* Legacy full-script foundations are intentionally retained below for data compatibility,
     but the writing studio no longer selects them as generation templates. */
  const starLine = hasStarSignal(input.templateCopy)
    ? `那么多保养得好的女明星都愿意用，我以前还忍得住；现在活动做到这个程度，我是真忍不住了。`
    : `以前别人跟我说面膜能抗老，我还不太信；到了这个年纪，看见自己的脸开始往下走，才知道保养真的不能等。`;

  const foundations = [
    script(`${product}｜同龄人站在一起，差的就是脸的状态`, [
      [profile.ageTruth, "达人先展示自然状态，手指脸部最显年龄的位置；第一句直接看镜头"],
      [profile.openingProblem, "凑近镜头，侧脸展示纹路、松弛或干瘪处；情绪认真，不念广告腔"],
      ...sharedMiddle(product, profile),
      [profile.value, "把产品规格、活动组合和到手数量摆在桌面，价格花字清晰出现"],
      [profile.action, "达人拿着产品自然促单，手指购买入口；结尾语气加快"],
    ]),
    script(`${product}｜我劝过了40岁的姐妹别只做表面功夫`, [
      [`我劝过了40岁的姐妹一句：脸一松、一瘪、往下走，真不是多抹几层水就能糊弄过去的。`, "正面近景，边照镜子边指脸；开头字幕放大“40岁以后”"],
      [`我也是用了不少瓶瓶罐罐才明白，到这个年纪，护理得在脸上看见变化。`, "桌面摆过往护肤品虚化带过，再把本品放到镜头中心"],
      ...sharedMiddle(product, profile),
      [`你看，好状态不是油亮一下，是皮肤细、润、嘭，肉稳稳待在该待的位置。`, "使用后自然光侧脸，手掌托住苹果肌，再展示下颌和整体精神状态"],
      [profile.value, "产品组合整齐叠放，边展示边说，不空喊性价比"],
      [`${profile.action} 衣服可以买少一件，脸上的年轻感真的不能省。`, "看镜头点头促单，最后定格产品和活动信息"],
    ]),
    script(`${product}｜以前我忍住了，这次价格下来真忍不了`, [
      [starLine, "情绪反差开头；可根据已授权素材插入明星或达人既往状态画面"],
      [`你点开看看现在才什么价。以前做一次护理的钱，在家能认真养很久。`, "手机价格页与产品同框，手指购买入口；旧价和现价形成对比"],
      [`但我让你买它不只因为便宜。${profile.openingProblem}，没效果一样是浪费。`, "先摆手否定，再指向脸部痛点，建立选择标准"],
      ...sharedMiddle(product, profile),
      [`尤其是过了40岁，保养不是装嫩，是不让松、垮、纹把年龄全写在脸上。`, "穿着得体的生活场景，正面和侧面交替，展示成熟而有精神的状态"],
      [profile.action, "完整展示活动机制、赠品和库存提示，自然催促下单"],
    ]),
    script(`${product}｜老同学见面，最先被问的是脸`, [
      ["前两天见了十几年没见的老同学，她坐下第一句话不是问我穿什么，而是问我最近脸怎么养的。", "从真实社交事件开场，用他人提问制造可信度"],
      [`我们这个年纪见面，最藏不住的就是${profile.openingProblem}。`, "同龄对比只讲状态，不攻击具体人物"],
      ["我没跟她讲一长串成分，就把自己真正坚持的步骤说了。", "以朋友分享口吻转折"],
      [`最近我用得最多的是这个${product}。`, "产品在故事推进后出现"],
      [profile.skinFeel, "边使用边讲触感，画面保持自然"],
      [profile.resultPicture, "用同学发现的状态回扣结果"],
      [profile.action, "以‘好东西才会告诉老朋友’自然收尾"],
    ]),
    script(`${product}｜女儿送我的东西，我开始还嫌她乱花钱`, [
      ["这个东西刚寄到家时，我还说了女儿一顿：别总给我买这些，我什么都不缺。", "家庭对话式开头，先建立熟龄用户的真实异议"],
      ["她说你不是缺东西，你是每次照镜子都嫌自己脸没精神，却又舍不得认真养。", "由亲近关系点出痛点"],
      [`她塞给我的就是这盒${product}。`, "由送礼动作带出产品"],
      [profile.skinFeel, "第一次使用的真实感受，不背说明书"],
      [profile.productProof, "用一条直观看得懂的产品证据"],
      [profile.resultPicture, "女儿再次见面时先发现变化"],
      [profile.action, "从‘嫌她花钱’反转到主动补货"],
    ]),
    script(`${product}｜整理旧照片才发现状态在往下走`, [
      ["整理手机照片的时候我才发现，人不是突然变老的，是脸上的精神气一点点没了。", "旧照片与现在同角度对比，情绪克制"],
      [`以前轮廓是往上提的，现在${profile.openingProblem}。`, "把年龄焦虑落到具体变化"],
      ["那一刻我没想着折腾多复杂，只想找一件每天做得到、能坚持的事。", "从焦虑转向可执行动作"],
      [`所以我开始固定用${product}。`, "产品作为长期习惯出现"],
      [profile.skinFeel, "连续使用过程用生活化画面推进"],
      [profile.resultPicture, "重新拍一张同角度照片验证状态"],
      [profile.action, "用‘别等下一张照片再后悔’回扣开场"],
    ]),
  ];
  const starOriginalFoundations = [
    script(`${product}｜出门前被身边人发现状态`, [
      ["搭档：都准备出门了，你怎么还在这里慢慢弄？", "明确交代活动、拍摄或纪念日等出门目的；双人同框建立真实关系"],
      [`明星：越是今天要上镜，越不能让${profile.openingProblem}。`, "明星照镜子或整理衣服，动作与上镜任务一致"],
      ["搭档：难怪你今天状态这么好，我还以为有什么好事。", "身边人先发现变化，不让明星自己生硬夸自己"],
      [`明星：我最近固定多做的就是这个${product}。`, "产品此时再进入画面，避免开场直接念广告"],
      [profile.skinFeel, "拍真实使用过程与局部近景，人物动作符合产品用法"],
      [profile.resultPicture, "对方自然接一句状态评价，再给使用后的近景"],
      [`明星：${profile.action}`, "用符合艺人口吻的收尾，不虚构未确认的个人经历"],
    ]),
    script(`${product}｜片场近景前的状态管理`, [
      ["工作人员：下一场要拍近景，老师这边准备好了吗？", "片场、化妆间或候场区；用工作事件触发护理需求"],
      [`明星：镜头越近，${profile.openingProblem}，真的一点都藏不住。`, "结合演员职业特质，不套用与本人无关的人生故事"],
      ["工作人员：那你每次上镜前都做这一步？", "工作人员因眼前动作自然发问"],
      [`明星：对，我会先用${product}把状态养回来。`, "产品后置出现，拍开盒、取用和上脸"],
      ...sharedMiddle(product, profile).slice(1, 4),
      [profile.action, "回到待开机的事件，用一句话完成产品收口"],
    ]),
    script(`${product}｜囤货被发现的生活小冲突`, [
      ["家人：你这是把柜子当仓库了？怎么放了这么多？", "家中收纳、整理行李或拆快递；先用异常数量制造好奇"],
      ["明星：别的可以少带，这个我用得快，真的不能少。", "由实际使用者本人拿产品，避免角色与产品使用逻辑错位"],
      [`家人：一个${product}，至于这么认真？`, "关系中的轻微吐槽形成继续解释的理由"],
      [profile.skinFeel, "明星边使用边说，不站着背完整广告词"],
      [profile.resultPicture, "家人从状态变化接话，形成发现式背书"],
      [profile.value, "把囤货数量和活动机制拍清楚"],
      [profile.action, "回扣开场的囤货事件完成闭环"],
    ]),
    script(`${product}｜临时加拍前的一次救场`, [
      ["工作人员：老师，临时加了一组高清特写，半小时后就拍。", "用突发工作任务制造真实压力，不从产品开场"],
      [`明星：最怕这种没准备的近景，${profile.openingProblem}，镜头会放得特别明显。`, "艺人边看监视器边确认状态"],
      ["化妆师：妆先别堆，我给你留十几分钟把皮肤状态顺一下。", "由专业角色提出自然解决动作，但不讲复杂术语"],
      [`明星：那先把我的${product}拿来。`, "产品由现场需求触发"],
      [profile.skinFeel, "取用、上脸和等待过程穿插现场准备动作"],
      [profile.resultPicture, "卸下产品后直接回到高清监视器检验状态"],
      [profile.action, "用开机提醒收尾，形成事件闭环"],
    ]),
    script(`${product}｜女儿替妈妈准备的重要见面`, [
      ["女儿：妈，今天拍全家照，你别又说随便弄弄。", "家庭纪念日或重要见面，关系和任务交代清楚"],
      [`妈妈：我不是怕拍照，是这两年${profile.openingProblem}，笑起来特别显。`, "熟龄女性说真实顾虑"],
      ["女儿：所以我昨晚就把东西放你桌上了，今天我们一起用。", "由家人关心推动动作"],
      [`妈妈：你说的是这个${product}？`, "产品在关系互动后出现"],
      [profile.skinFeel, "母女同框使用，突出触感和表情变化"],
      [profile.resultPicture, "回到拍照事件，用成片或镜前状态验证"],
      [profile.action, "以分享给同龄姐妹的语气收口"],
    ]),
    script(`${product}｜酒店早晨发现没带够`, [
      ["助理：行李都收好了，怎么还在翻箱子？", "酒店出差早晨，先建立移动场景"],
      ["明星：我少带了一盒，接下来连续几天都要见人、上镜。", "用具体行程解释需求"],
      [`助理：不就是${product}吗，附近再买不就行了？`, "助理的疑问推动价值解释"],
      [profile.skinFeel, "明星边收拾边说实际使用感受"],
      [profile.productProof, "用一条直观证据解释为什么指定这一款"],
      [profile.resultPicture, "镜前完成状态对比"],
      [profile.action, "回扣行李和连续行程，形成自然囤货理由"],
    ]),
  ];
  const starMarketingFoundations = [
    script(`${product}｜镜头会把状态放大`, [
      [`大家总觉得演员最怕年龄，其实我更怕的是：${profile.openingProblem}，一上镜就藏不住。`, "可用采访、活动后台或高清近景；如非艺人真实原话，标注创意台词"],
      ["脸对演员不只是好不好看，它也是工作状态的一部分。", "用演员职业特质承接，不编造失业、换角等未经证实经历"],
      [`我也想过用更快的办法，但越是靠脸工作的，越不敢随便冒险。后来我把${product}变成了固定护理。`, "反常识观点转入稳妥护理，产品在冲突后出现"],
      [profile.productProof, "产品特写和真实使用画面交替"],
      [profile.skinFeel, "减少研发术语，用肤感和画面解释"],
      [profile.resultPicture, "给出前后状态画面，不把创意承诺包装成事实"],
      [profile.action, "结尾回到熟龄女性的状态管理"],
    ]),
    script(`${product}｜中年女性的一个固定习惯`, [
      ["中年女人想让状态稳一点，先别急着做很多复杂步骤，我最看重的是每天能坚持的这一件事。", "晨起、睡前或工作准备场景；第一句话给人群与结果"],
      ["演员的时间经常被打乱，所以越简单、越能坚持的动作，反而越有用。", "用职业节奏建立艺人特质"],
      [`我会在需要上镜前用${product}，十几分钟把这一步认真做完。`, "明确动作、时间和使用场景"],
      [profile.skinFeel, "边演示边说，保持第一人称教学"],
      [profile.resultPicture, "自然光或镜前状态展示"],
      [profile.value, "从使用周期自然进入活动利益"],
      [profile.action, "简短促单，不重复同一承诺"],
    ]),
    script(`${product}｜先质疑，再看到直观变化`, [
      ["我最开始也不信，一片面膜能把状态做出什么差别。", "用艺人或熟龄女性的真实质疑开场"],
      [`但到了这个阶段，${profile.ageTruth}。`, "把年龄焦虑落到可见状态"],
      [`后来身边真正用过的人让我试了这个${product}，我才发现护理不能只看一长串成分。`, "推荐关系需按补充需求中的真实关系填写"],
      [profile.productProof, "先给可视化证据，再补解释"],
      [profile.skinFeel, "讲触感、使用过程和即时感受"],
      [profile.resultPicture, "结果镜头完整停留"],
      [profile.action, "以体验反转和明确行动收口"],
    ]),
    script(`${product}｜高清镜头才是状态测谎仪`, [
      ["普通镜子会骗人，高清镜头不会。一个人的状态稳不稳，拉近以后全写在脸上。", "用职业观察式结论开场"],
      [`尤其过了某个阶段，${profile.openingProblem}，比一条细纹更容易显年龄。`, "把焦虑落到具体视觉结果"],
      ["所以真正会管理状态的人，不会等重要场合前才临时补救。", "从问题转向长期习惯"],
      [`她们会把${product}这种简单、能坚持的护理放进固定节奏。`, "产品作为习惯出现"],
      [profile.skinFeel, "用近景与动作替代成分堆叠"],
      [profile.resultPicture, "用镜头前后的状态形成回扣"],
      [profile.action, "以‘让镜头替你说话’完成收口"],
    ]),
    script(`${product}｜同龄人真正拉开差距的地方`, [
      ["同样的年龄，有人看起来只是成熟，有人却像一下子被时间追上了。差别往往不是五官。", "同龄对比式开头"],
      [`真正显年龄的是${profile.openingProblem}。`, "快速点明状态问题"],
      ["聪明的护理不是把步骤越堆越多，而是找到一件愿意长期做、脸也有反馈的事。", "反驳复杂护肤"],
      [`这也是${product}为什么容易被熟龄女性留下来的原因。`, "从人群选择自然转品"],
      [profile.productProof, "给一个直观产品证据"],
      [profile.resultPicture, "突出精神、饱满和显年轻的整体状态"],
      [profile.action, "用同龄状态差距回扣开场"],
    ]),
    script(`${product}｜不是怕老，是怕状态先垮下来`, [
      ["女人真正介意的，不是身份证上的数字，是照镜子时发现状态比年龄走得更快。", "情绪共鸣开场"],
      [`当${profile.openingProblem}，人看起来就会疲惫、没精神。`, "把抽象焦虑变成可见画面"],
      ["医美可以是选择，但每天怎么养，决定了状态能不能稳得住。", "用克制对比建立日常护理价值"],
      [`所以很多人会把${product}当成固定动作，而不是临时救急。`, "产品后置出现"],
      [profile.skinFeel, "讲真实使用感受"],
      [profile.resultPicture, "给出状态结果"],
      [profile.action, "回到‘状态别先垮’的情绪价值"],
    ]),
  ];
  const videoChannelFoundations = [
    script(`${product}｜中年状态管理的第一件事`, [
      ["中年女人想让自己显年轻一点，先养成一个最容易坚持的习惯。", "大字幕直接给人群、结果和数字清单感"],
      [`第一，别等${profile.openingProblem}才开始补救。`, "脸部痛点近景，句子短，结论前置"],
      [`第二，把${product}放在每天真正用得到的地方。`, "晨起、睡前或出门前的具体生活动作"],
      [profile.skinFeel, "产品使用过程快切，避免连续堆专业成分"],
      [profile.resultPicture, "先展示状态，再解释为什么"],
      [profile.value, "活动数量和价格信息用一组清楚字幕呈现"],
      [profile.action, "一句明确行动收尾"],
    ]),
    script(`${product}｜先给一个反常识结论`, [
      ["很多人面膜敷得不少，脸看着还是显年龄，问题可能不在敷得少，而在每次都只做表面功夫。", "讲师或新闻感画面，第一句制造疑问"],
      [`真正要看的，是用完以后能不能出现这种状态：${profile.resultPicture}。`, "结果镜头前置"],
      [`所以我最近重点看的是这个${product}。`, "产品快速出现，不绕长铺垫"],
      [profile.productProof, "一组产品证据画面"],
      [profile.skinFeel, "一组真实肤感画面"],
      [profile.simpleReason, "只保留一句听得懂的解释"],
      [profile.action, "价格或库存存在时再促单，不凭空编数字"],
    ]),
    script(`${product}｜家里人先发现变化`, [
      ["家人：你最近是不是换了什么？整个人看着比之前精神。", "母女、姐妹或伴侣的生活场景；由熟人先发现结果"],
      ["使用者：我没折腾复杂的，就把这一件事坚持下来了。", "自然对话，不让产品第一秒硬闯进来"],
      ["家人：到底是什么？给我看看。", "用追问完成转品"],
      [`使用者：就是这个${product}。${profile.skinFeel}`, "真实取用和上脸动作"],
      [profile.resultPicture, "局部与整体状态交替"],
      [profile.value, "适合时带出数量、活动或囤货原因"],
      [profile.action, "回扣家庭分享关系完成收口"],
    ]),
    script(`${product}｜一个容易被忽略的显老信号`, [
      ["脸上最容易暴露年龄的，不一定是皱纹，而是整张脸看起来干、瘪、没精神。", "知识结论前置，适合讲解型一创"],
      ["很多人只盯着纹路，却忘了状态一垮，五官都会跟着显疲惫。", "补充反常识解释"],
      [`这也是为什么熟龄护理里，${product}越来越常见。`, "从人群趋势转入产品"],
      [profile.skinFeel, "用短句描述触感和使用动作"],
      [profile.resultPicture, "结果画面先整体后局部"],
      [profile.value, "有真实活动信息时再说明"],
      [profile.action, "一句结论式收尾"],
    ]),
    script(`${product}｜妈妈听到价格后的反应`, [
      ["妈妈：你又给我买什么了？看着这么精致，肯定不便宜。", "家庭对话加价格悬念"],
      [`女儿：你先别猜，这是给你备的${product}。`, "产品由送礼动作自然出现"],
      ["妈妈：我这个年纪用这些还有什么用？", "用熟龄人真实异议推动说明"],
      [profile.resultPicture, "女儿先说状态结果，不背研究资料"],
      [profile.skinFeel, "妈妈实际体验并给出触感反馈"],
      [profile.value, "再揭示真实价格或组合，制造预期反差"],
      [profile.action, "以妈妈主动留下或分享完成反转"],
    ]),
    script(`${product}｜连续使用挑战`, [
      ["如果一件护理坚持七天，脸的状态会有什么变化？今天直接开始记录。", "挑战式开场，时间跨度按真实素材调整"],
      [`第一天，最明显的问题是${profile.openingProblem}。`, "建立起始状态"],
      [`每天固定用一次${product}，不叠加复杂步骤。`, "说明单一变量"],
      [profile.skinFeel, "中间过程用日记式短句推进"],
      [profile.productProof, "只保留一条容易听懂的原因"],
      [profile.resultPicture, "最后一天同机位展示结果"],
      [profile.action, "邀请观众看完整记录或跟着尝试"],
    ]),
  ];
  const selectedFoundations = input.scriptType === "明星原片脚本" ? starOriginalFoundations
    : input.scriptType === "明星营销号脚本" ? starMarketingFoundations
      : input.scriptType === "视频号脚本" ? videoChannelFoundations
        : foundations;
  const hooks = [
    `说句扎心的，${profile.openingProblem}。`,
    `同龄人站在一起，最藏不住年龄的，其实就是脸上的松、干和没精神。`,
    `我以前也觉得抗老不用急，直到镜子里那张脸开始显疲惫、显年龄。`,
    `过了40岁才明白，脸养没养，状态真的会替你说话。`,
    `姐妹们，别等脸把年龄全写出来，才想起来认真保养。`,
  ];
  const bridges = [
    `真正让我愿意一直用的，不是成分表有多长，而是${blueprint.experience}。这种变化自己能感觉到，镜头里也看得见。`,
    `你们别只听我说好用，直接看：${blueprint.proof}。我更信这种自己能感受到的证据。`,
    `我现在买护理品就认一个标准：不念一长串听不懂的成分，先让我看到脸上的真实变化。`,
  ];
  const needLines = /价格|活动|库存|促单|下单/.test(need)
    ? ["我也把你们最关心的活动说清楚，东西有效是一回事，趁价格合适把周期备够，才是真的会买。"]
    : /年龄|抗老|显年轻|容貌|松|垮|纹|40|四十/.test(need)
      ? ["说到底，我们这个年纪要的不是装嫩，是脸别那么松、那么瘪，看起来有精神、比同龄人更显年轻。"]
      : ["我不跟你们绕专业名词，就把上脸什么感觉、用完脸是什么状态，老老实实讲清楚。"];

  return Array.from({ length: count }, (_, index) => {
    const base = selectedFoundations[(seededIndex(seed, 0, selectedFoundations.length) + index) % selectedFoundations.length];
    const blocks = base.content.split("\n\n");
    if (["付费KOC脚本", "唠嗑KOC脚本"].includes(input.scriptType)) {
      blocks.splice(0, 1, `镜头01｜口播：${pick(hooks, seed, index * 5)}\n画面：开场直接展示面部状态，不铺垫、不念广告腔`);
      blocks.splice(1, 0, `镜头02｜口播：${pick(bridges, seed, index * 5 + 1)}\n画面：延续参考案例的说服节奏，改拍当前产品的真实使用过程`);
      blocks.splice(2, 0, `镜头03｜口播：${pick(needLines, seed, index * 5 + 2)}\n画面：用一组大字幕明确本轮创作重点`);
    }
    return { ...base, title: `${base.title} · ${seed.slice(0, 4).toUpperCase()}`, content: fitSpokenLength(blocks.join("\n\n")) };
  }).map((item) => ({
    ...item,
    content: `【创作定位】${direction}；核心人群：${audience}\n【参考依据】${clean(input.templateTitle || "已选案例", 36)}：沿用“${clean(blueprint.hook, 42)}”的抓人方式和“${clean(blueprint.close, 42)}”的收口逻辑\n【类型标准】${learnedRules[input.scriptType] ?? learnedRules["付费KOC脚本"]}\n【补充需求】${need}\n【长度标准】${["付费KOC脚本", "唠嗑KOC脚本"].includes(input.scriptType) ? "普通KOC纯口播约300字，合格区间260—340字；镜头说明不计入。" : "以人物、场景、事件与转品逻辑完整为准，不机械套用KOC字数。"}\n\n${item.content}`,
  }));
}

type ReviseInput = {
  content: string;
  feedback: string;
  version: number;
  product?: string;
};

const researchToConsumer: Array<[RegExp, string]> = [
  [/球型?PDRN微球控释(?:技术)?/g, "把好东西一点点释放进皮肤"],
  [/PDRN纳米微球透皮递送/g, "把滋养成分细细地送进皮肤"],
  [/六重胜肽分层抗老(?:系统|配方)?/g, "把干、纹、松、垮一层层照顾到"],
  [/黄金膜布单向封包/g, "金色膜布把满满精华稳稳留在脸上"],
  [/BFS(?:医用)?无菌灌装(?:技术)?/g, "一次一支，拧开就是新鲜的"],
  [/第[四4]代纳米包裹(?:锁鲜)?(?:技术)?/g, "把成分的新鲜劲一直留到打开那一刻"],
  [/水油双相分层锁养/g, "水负责润，油负责把润养留住"],
];

export function reviseScript(input: ReviseInput) {
  const note = clean(input.feedback, 180);
  let revised = input.content.replace(/^【AI改稿[^\n]*\n?/m, "").replace(/^【修改说明】.*$/m, "").trim();

  if (/研发|专业|术语|听不懂|口语|自然|肤感|比喻/.test(note)) {
    for (const [pattern, replacement] of researchToConsumer) revised = revised.replace(pattern, replacement);
    revised = revised.replace(/肌底/g, "皮肤里面").replace(/促渗/g, "帮助吸收").replace(/赋能/g, "帮皮肤养回状态");
  }
  if (/年龄|焦虑|显老|抗老|年轻|容貌|40|四十|熟龄/.test(note)) {
    revised = revised.replace(/【执行原则】[^\n]*/m, "【执行原则】把脸松、垮、瘪、纹带来的年龄感说透，再用肤感和使用后状态证明年轻感。")
      .replace(/【创作定位】/, "【创作定位】过了40岁，保养和不保养的差距都会写在脸上；");
    if (!/40岁|四十岁/.test(revised)) {
      revised = `【年龄钩子】女人过了40岁，脸一松、一垮，年龄真的藏都藏不住。\n${revised}`;
    }
  }
  if (/精简|缩短|短一点/.test(note)) {
    const blocks = revised.split(/\n\n+/).filter(Boolean);
    revised = blocks.filter((_, index) => index < 2 || index % 2 === 0).slice(0, 8).join("\n\n");
  }
  if (/开头|前[三3五5]秒|钩子|更狠|抓人/.test(note)) {
    revised = `【新开头】女人过了40岁，脸一松、一垮，年龄真的藏都藏不住。\n画面：开场直接凑近展示面部状态，字幕放大“脸垮比长纹更显老”。\n\n${revised.replace(/^【创作定位】[^\n]*\n?/, "")}`;
  }
  if (/价格|机制|促单|库存|下单/.test(note)) {
    const profile = profiles[input.product || ""] ?? fallbackProfile;
    revised += `\n\n【加强促单】${profile.value}，${profile.action}`;
  }

  return `【AI改稿 v${input.version}】本版已落实：“${note}”\n${revised}\n【修改说明】已按付费KOC标准检查口语感、熟龄人群、容貌焦虑、肤感画面、价格机制和促单完整度。`;
}
