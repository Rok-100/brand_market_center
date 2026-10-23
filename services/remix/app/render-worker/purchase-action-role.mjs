// Text role suggestion only: never creates or changes an approval/proof.
export function purchaseActionSignal(value) {
  const clauses = String(value || '').split(/[，,。.!！?？;；\n]+/u).map(text => text.replace(/\s+/gu, '')).filter(Boolean);
  let suppressed = false;
  for (const text of clauses) {
    const avoidWrongPurchase = /(?:别|不要|千万别)买(?:错|贵)/u.test(text);
    const negative = !avoidWrongPurchase && (
      /(?:不要|别|不必|无需|不用|不能|不建议|不推荐|千万别)(?:再|去|急着|急于)?(?:买|购买|下单|拍下)/u.test(text) ||
      /(?:不想|不打算|没有想|没想)(?:再|去)?买|不是让.{0,5}(?:买|下单)/u.test(text) ||
      /(?:不要|别|不必|无需|不用|不建议|不推荐).{0,8}(?:直播间|链接)/u.test(text));
    const narrated = /以前|之前|曾经|当时|去年|过去|上次|前几天|原本|本来/u.test(text) ||
      /^(?:我|他|她|他们|她们)(?:也|还|就)?(?:想买|想要买|买过|说|觉得)/u.test(text);
    const currentInvitation = /(?:现在|今天|这次).{0,8}(?:大家|你们|各位|可以|赶紧|立即)|(?:大家|你们|各位).{0,8}(?:现在|今天|这次)/u.test(text);
    const purchaseWords = /买|购买|下单|链接|直播间|拍下|点击/u.test(text);
    if (negative || (narrated && purchaseWords && !currentInvitation)) {
      suppressed = true;
      continue;
    }
    const conditionalInvitation = /(?:你们|大家|各位|姐妹们?|宝宝们?|朋友们?|你)(?:要是|如果|也|还|有|是|真的|特别|非常|都|就|想|要|需要|感兴趣){0,6}(?:想买|要买|购买|下单|拍下)/u.test(text);
    const visitToAct = /(?:去|到|进|进入|来|点开|点进).{0,12}直播间.{0,8}(?:看|逛|选|买|拍|下单|领|了解|搜)/u.test(text);
    // Retain established action vocabulary, but never let negation or a past
    // narrative pass this branch just because it contains “购买/链接”.
    const establishedAction = /下单|购买|链接|库存|最后|赶紧|立即|点击|拍下/u.test(text);
    if (avoidWrongPurchase || conditionalInvitation || visitToAct || establishedAction)
      return {intent: true, suppressPositionalCta: false};
  }
  return {intent: false, suppressPositionalCta: suppressed};
}
