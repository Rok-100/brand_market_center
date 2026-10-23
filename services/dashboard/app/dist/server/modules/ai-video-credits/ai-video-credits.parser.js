"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAiVideoCredits = parseAiVideoCredits;
const SOURCE_YEAR = 2026;
const MONTH_TOTAL_COLUMN = 64;
const FIRST_DATE_COLUMN = 8;
const LAST_DATE_COLUMN = 62;
const SOURCE_URL = 'https://jqx28l0j4lx.feishu.cn/wiki/LOeCwprSAigXuckRtPJcVWO6nOP' +
    '?from=from_copylink&sheet=Y1s02K';
function parseCsv(input) {
    const normalized = input.replace(/^\[row=\d+\] /gmu, '');
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < normalized.length; index += 1) {
        const character = normalized[index];
        const nextCharacter = normalized[index + 1];
        if (character === '"') {
            if (quoted && nextCharacter === '"') {
                cell += '"';
                index += 1;
            }
            else {
                quoted = !quoted;
            }
            continue;
        }
        if (character === ',' && !quoted) {
            row.push(cell);
            cell = '';
            continue;
        }
        if ((character === '\n' || character === '\r') && !quoted) {
            if (character === '\r' && nextCharacter === '\n')
                index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        cell += character;
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function nullableNumber(value) {
    const normalized = String(value ?? '')
        .replace(/,/gu, '')
        .trim();
    if (!normalized)
        return null;
    const numberValue = Number(normalized);
    return Number.isFinite(numberValue) ? numberValue : null;
}
function nullableText(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}
function platformFromCell(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    if (normalized === '可灵')
        return 'kling';
    if (normalized === 'libtv')
        return 'libtv';
    return null;
}
function dateFromHeading(value) {
    const match = String(value ?? '')
        .trim()
        .match(/^(\d{1,2})[.](\d{1,2})$/u);
    if (!match)
        return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    return `${SOURCE_YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthlyPeriod(rows) {
    const label = String(rows[0]?.[MONTH_TOTAL_COLUMN] ?? '');
    const match = label.match(/(\d{1,2})月总/u);
    const month = match ? Number(match[1]) : 7;
    return `${SOURCE_YEAR}-${String(month).padStart(2, '0')}`;
}
function parsedAccounts(rows) {
    const accounts = [];
    for (const cells of rows.slice(2)) {
        const platform = platformFromCell(cells[0]);
        const monthlyCredits = nullableNumber(cells[MONTH_TOTAL_COLUMN]);
        if (!platform || monthlyCredits === null)
            continue;
        const owner = nullableText(cells[6]);
        const account = {
            platform,
            center: nullableText(cells[3]),
            accountId: nullableText(cells[4]),
            accountName: nullableText(cells[5]),
            owner: owner?.replace(/^@/u, '') ?? null,
            monthlyCredits,
            balanceSnapshotCredits: nullableNumber(cells[7]),
        };
        accounts.push({ account, cells });
    }
    return accounts;
}
function platformSummary(accounts, platform) {
    const platformAccounts = accounts.filter((item) => item.account.platform === platform);
    const monthlyValues = platformAccounts
        .map((item) => item.account.monthlyCredits)
        .filter((value) => value !== null);
    const balanceValues = platformAccounts
        .map((item) => item.account.balanceSnapshotCredits)
        .filter((value) => value !== null);
    return {
        platform,
        monthlyCredits: monthlyValues.length > 0
            ? monthlyValues.reduce((sum, value) => sum + value, 0)
            : null,
        reportedAccounts: monthlyValues.length,
        balanceSnapshotCredits: balanceValues.length > 0
            ? balanceValues.reduce((sum, value) => sum + value, 0)
            : null,
        balanceReportedAccounts: balanceValues.length,
    };
}
function coverageForDate(accounts, platform, dailyColumn) {
    const platformAccounts = accounts.filter((item) => item.account.platform === platform);
    const values = platformAccounts
        .map((item) => nullableNumber(item.cells[dailyColumn]))
        .filter((value) => value !== null);
    return {
        credits: values.length > 0
            ? values.reduce((sum, value) => sum + value, 0)
            : null,
        reportedAccounts: values.length,
        trackedAccounts: platformAccounts.length,
    };
}
function trendPoints(rows, accounts) {
    const trends = [];
    for (let column = FIRST_DATE_COLUMN; column <= LAST_DATE_COLUMN; column += 2) {
        const date = dateFromHeading(rows[0]?.[column]);
        if (!date)
            continue;
        trends.push({
            date,
            kling: coverageForDate(accounts, 'kling', column + 1),
            libtv: coverageForDate(accounts, 'libtv', column + 1),
        });
    }
    return trends;
}
function parseAiVideoCredits(input) {
    const rows = parseCsv(input.annotatedCsv);
    if (rows.length < 3 || rows[0].length <= MONTH_TOTAL_COLUMN) {
        throw new Error('AI video credits sheet structure is incomplete');
    }
    const accountRows = parsedAccounts(rows);
    if (accountRows.length === 0) {
        throw new Error('AI video credits sheet has no mapped platform accounts');
    }
    const trends = trendPoints(rows, accountRows);
    const dataThroughDate = trends.length > 0
        ? (trends
            .map((item) => item.date)
            .sort()
            .at(-1) ?? null)
        : null;
    const snapshotTime = new Date(input.fetchedAt).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
    });
    return {
        monthlyPeriod: monthlyPeriod(rows),
        summaries: [
            platformSummary(accountRows, 'kling'),
            platformSummary(accountRows, 'libtv'),
        ],
        trends,
        accounts: accountRows.map((item) => item.account),
        source: {
            mode: input.mode,
            spreadsheetTitle: '品营AI工具账号管理',
            sheetName: '积分消耗情况（7月）',
            sheetId: 'Y1s02K',
            range: input.range,
            revision: input.revision,
            fetchedAt: input.fetchedAt,
            dataThroughDate,
            sourceUrl: SOURCE_URL,
            notice: input.mode === 'live'
                ? '当前数据由正式应用实时读取飞书来源表；空白单元格保持缺失，不按 0 参与汇总。'
                : `正式应用暂未取得实时读取结果，当前展示 ${snapshotTime} 核验快照；空白单元格未补 0。`,
        },
    };
}
