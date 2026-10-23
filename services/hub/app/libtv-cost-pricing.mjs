const SCALE = 10000n;
const QUOTA = 132000n * SCALE;

// Points use 1/10,000 point units; money uses 1/10,000,000 yuan units.
// All pricing, aggregation and rounding stays in integer arithmetic.
export function pointUnits(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error('消耗积分格式无效，金额暂不可用');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}
export function pointsText(units) {
  return `${units / SCALE}.${String(units % SCALE).padStart(4, '0')}`;
}
export function moneyText(units, divisor = 1) {
  if (units === null) return null;
  const denominator = BigInt(divisor) * 100000n;
  const cents = (units + denominator / 2n) / denominator;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function cycleStart(date) {
  if (Number(date.slice(8,10)) >= 16) return `${date.slice(0,7)}-16`;
  const month = new Date(`${date.slice(0,7)}-01T00:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  return `${month.toISOString().slice(0,7)}-16`;
}

export function priceRows(rows, historyStart = null) {
  const ordered = [...rows].sort((a,b) => a.consumedAt.localeCompare(b.consumedAt)
    || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
  const seen = new Set(), totals = new Map(), groups = new Map();
  for (const row of ordered) {
    if (seen.has(String(row.id))) throw new Error('流水主键重复，金额暂不可用');
    seen.add(String(row.id));
    const date = row.consumedAt.slice(0,10), cycle = cycleStart(date);
    const q = pointUnits(row.points), previous = totals.get(cycle) || 0n;
    const remaining = QUOTA > previous ? QUOTA - previous : 0n;
    const included = q < remaining ? q : remaining;
    const amount = included * 19n + (q - included) * 35n;
    totals.set(cycle, previous + q);
    const incomplete = Boolean(historyStart && cycle < historyStart.slice(0,10));
    const key = JSON.stringify([date,row.team_member || null,row.model_name || null]);
    const group = groups.get(key) || { date, team_member: row.team_member || null, model_name: row.model_name || null, q:0n, amount:0n, transactionCount:0, cycleStart:cycle, pricingComplete:!incomplete };
    group.q += q; group.amount += amount; group.transactionCount++;
    groups.set(key,group);
  }
  return [...groups.values()].map(g => ({
    date:g.date, team_member:g.team_member, model_name:g.model_name,
    consumed:pointsText(g.q), transactionCount:g.transactionCount,
    estimatedUnits:g.pricingComplete ? String(g.amount) : null,
    cycleStart:g.cycleStart, pricingComplete:g.pricingComplete,
  }));
}
