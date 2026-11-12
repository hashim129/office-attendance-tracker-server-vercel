import { Employee } from '../types';

export interface ParsedSmartQuery {
  rawQuery: string;
  matchedEmployee: Employee | null;
  matchedEmployees: Employee[];
  confidence: 'exact' | 'partial' | 'fuzzy' | 'none';
  targetDate: string | null;
  alternativeDate: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  dateLabel: string;
  suggestedRangeKey: '7d' | '14d' | '30d' | 'this_month' | 'last_month' | 'custom' | null;
}

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const WEEKDAY_ALIASES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  wednes: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTH_ALIASES: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const FILLER_WORDS = new Set([
  'search',
  'find',
  'show',
  'give',
  'me',
  'get',
  'fetch',
  'check',
  'tell',
  'look',
  'up',
  'view',
  'see',
  'open',
  'generate',
  'attendance',
  'insights',
  'insight',
  'report',
  'reports',
  'stats',
  'statistics',
  'status',
  'details',
  'detail',
  'record',
  'records',
  'log',
  'logs',
  'punctuality',
  'graph',
  'graphs',
  'summary',
  'timesheet',
  'of',
  'for',
  'about',
  'on',
  'in',
  'at',
  'by',
  'with',
  'from',
  'to',
  'the',
  'a',
  'an',
  'please',
  'this',
  'last',
  'previous',
  'prev',
  'past',
  'employee',
  'staff',
  'worker',
  'person',
  'all',
  'is',
  'was',
  'did',
  'how',
  'many',
  'hours',
  'day',
  'days',
  'date',
  'dated',
]);

function addDaysUtc(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function getUtcDow(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreEmployeeMatch(emp: Employee, nameTokens: string[], fullCandidate: string): number {
  const empNameLower = emp.name.toLowerCase().trim();
  const empCodeLower = (emp.employeeCode || '').toLowerCase().trim();
  const empDeptLower = (emp.department || '').toLowerCase().trim();
  const empWords = empNameLower.split(/\s+/).filter(Boolean);

  if (fullCandidate && (empNameLower === fullCandidate || empCodeLower === fullCandidate)) {
    return 100;
  }

  let best = 0;

  if (fullCandidate.length >= 2) {
    if (empNameLower.startsWith(fullCandidate)) best = Math.max(best, 92);
    else if (empNameLower.includes(fullCandidate)) best = Math.max(best, 84);
    else if (empCodeLower.includes(fullCandidate)) best = Math.max(best, 88);
  }

  for (const tok of nameTokens) {
    if (tok.length < 2) continue;
    if (empCodeLower === tok) best = Math.max(best, 95);
    if (empWords.some((w) => w === tok)) {
      best = Math.max(best, 90);
    } else if (empWords.some((w) => w.startsWith(tok))) {
      best = Math.max(best, tok.length >= 3 ? 78 : 65);
    } else if (tok.length >= 3 && empNameLower.includes(tok)) {
      best = Math.max(best, 72);
    } else if (tok.length >= 4) {
      for (const w of empWords) {
        if (w.length >= 4) {
          const dist = levenshtein(tok, w);
          const maxAllowed = tok.length >= 6 ? 2 : 1;
          if (dist <= maxAllowed) {
            best = Math.max(best, 62 - dist * 5);
          }
        }
      }
    }
    if (tok.length >= 3 && empDeptLower.includes(tok)) {
      best = Math.max(best, 42);
    }
  }

  return best;
}

/**
 * Parses natural-language attendance queries like:
 * - "Search Attendance of Kashif for last wednesday"
 * - "give me attendance of Zonehra yesterday"
 * - "Hashim last 7 days"
 * - "Faisal 10 Nov"
 */
export function parseSmartAttendanceQuery(
  rawQuery: string,
  employees: Employee[],
  todayStr: string
): ParsedSmartQuery {
  const cleaned = rawQuery.trim();
  const result: ParsedSmartQuery = {
    rawQuery: cleaned,
    matchedEmployee: null,
    matchedEmployees: [],
    confidence: 'none',
    targetDate: null,
    alternativeDate: null,
    rangeStart: null,
    rangeEnd: null,
    dateLabel: '',
    suggestedRangeKey: null,
  };

  if (!cleaned) return result;

  let workingText = cleaned
    .toLowerCase()
    .replace(/['’]s\b/g, ' ')
    .replace(/[,?!.;:()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const [todayYear, todayMonth] = todayStr.split('-').map(Number);

  // 1. Explicit ISO date YYYY-MM-DD
  const isoMatch = workingText.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) {
      const ymd = formatYmd(y, m, d);
      result.targetDate = ymd;
      result.rangeStart = ymd;
      result.rangeEnd = ymd;
      result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd}`;
      workingText = workingText.replace(isoMatch[0], ' ');
    }
  }

  // 2. DD/MM/YYYY or DD-MM-YYYY
  if (!result.targetDate) {
    const dmyMatch = workingText.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
    if (dmyMatch) {
      const d = Number(dmyMatch[1]);
      const m = Number(dmyMatch[2]);
      const y = Number(dmyMatch[3]);
      if (isValidYmd(y, m, d)) {
        const ymd = formatYmd(y, m, d);
        result.targetDate = ymd;
        result.rangeStart = ymd;
        result.rangeEnd = ymd;
        result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd}`;
        workingText = workingText.replace(dmyMatch[0], ' ');
      }
    }
  }

  // 3. "10 Nov [2026]" or "Nov 10 [2026]"
  if (!result.targetDate) {
    const monthNamesPattern = Object.keys(MONTH_ALIASES).join('|');
    const dmRegex = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNamesPattern})(?:\\s+(\\d{4}))?\\b`);
    const mdRegex = new RegExp(`\\b(${monthNamesPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`);
    const dmMatch = workingText.match(dmRegex);
    const mdMatch = dmMatch ? null : workingText.match(mdRegex);
    if (dmMatch) {
      const d = Number(dmMatch[1]);
      const m = MONTH_ALIASES[dmMatch[2]];
      const y = dmMatch[3] ? Number(dmMatch[3]) : todayYear;
      if (isValidYmd(y, m, d)) {
        const ymd = formatYmd(y, m, d);
        result.targetDate = ymd;
        result.rangeStart = ymd;
        result.rangeEnd = ymd;
        result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd}`;
        workingText = workingText.replace(dmMatch[0], ' ');
      }
    } else if (mdMatch) {
      const m = MONTH_ALIASES[mdMatch[1]];
      const d = Number(mdMatch[2]);
      const y = mdMatch[3] ? Number(mdMatch[3]) : todayYear;
      if (isValidYmd(y, m, d)) {
        const ymd = formatYmd(y, m, d);
        result.targetDate = ymd;
        result.rangeStart = ymd;
        result.rangeEnd = ymd;
        result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd}`;
        workingText = workingText.replace(mdMatch[0], ' ');
      }
    }
  }

  // 4. Relative multi-day ranges: "last N days", "this week", "last week", "this month", "last month"
  if (!result.targetDate && !result.rangeStart) {
    const lastNDays = workingText.match(/\b(?:last|past)\s+(\d{1,2})\s+days?\b/);
    if (lastNDays) {
      const count = Math.max(1, Math.min(90, Number(lastNDays[1])));
      result.rangeStart = addDaysUtc(todayStr, -(count - 1));
      result.rangeEnd = todayStr;
      result.dateLabel = `Last ${count} Days (${result.rangeStart} to ${todayStr})`;
      result.suggestedRangeKey = count <= 7 ? '7d' : count <= 14 ? '14d' : count <= 30 ? '30d' : 'custom';
      workingText = workingText.replace(lastNDays[0], ' ');
    } else if (/\bthis\s+week\b/.test(workingText)) {
      const dow = getUtcDow(todayStr);
      const offsetToMon = dow === 0 ? 6 : dow - 1;
      result.rangeStart = addDaysUtc(todayStr, -offsetToMon);
      result.rangeEnd = todayStr;
      result.dateLabel = `This Week (${result.rangeStart} to ${todayStr})`;
      result.suggestedRangeKey = '7d';
      workingText = workingText.replace(/\bthis\s+week\b/, ' ');
    } else if (/\b(?:last|previous|past)\s+week\b/.test(workingText)) {
      const dow = getUtcDow(todayStr);
      const offsetToThisMon = dow === 0 ? 6 : dow - 1;
      const lastMon = addDaysUtc(todayStr, -(offsetToThisMon + 7));
      const lastSun = addDaysUtc(lastMon, 6);
      result.rangeStart = lastMon;
      result.rangeEnd = lastSun;
      result.dateLabel = `Last Week (${lastMon} to ${lastSun})`;
      result.suggestedRangeKey = 'custom';
      workingText = workingText.replace(/\b(?:last|previous|past)\s+week\b/, ' ');
    } else if (/\bthis\s+month\b/.test(workingText)) {
      const start = `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`;
      result.rangeStart = start;
      result.rangeEnd = todayStr;
      result.dateLabel = `This Month (${start} to ${todayStr})`;
      result.suggestedRangeKey = 'this_month';
      workingText = workingText.replace(/\bthis\s+month\b/, ' ');
    } else if (/\b(?:last|previous)\s+month\b/.test(workingText)) {
      const prevStart = new Date(Date.UTC(todayYear, todayMonth - 2, 1)).toISOString().slice(0, 10);
      const prevEnd = new Date(Date.UTC(todayYear, todayMonth - 1, 0)).toISOString().slice(0, 10);
      result.rangeStart = prevStart;
      result.rangeEnd = prevEnd;
      result.dateLabel = `Last Month (${prevStart} to ${prevEnd})`;
      result.suggestedRangeKey = 'last_month';
      workingText = workingText.replace(/\b(?:last|previous)\s+month\b/, ' ');
    }
  }

  // 5. "day before yesterday", "yesterday", "today"
  if (!result.targetDate && !result.rangeStart) {
    if (/\bday\s+before\s+yesterday\b/.test(workingText)) {
      const ymd = addDaysUtc(todayStr, -2);
      result.targetDate = ymd;
      result.rangeStart = ymd;
      result.rangeEnd = ymd;
      result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd} (2 days ago)`;
      workingText = workingText.replace(/\bday\s+before\s+yesterday\b/, ' ');
    } else if (/\byesterday\b/.test(workingText)) {
      const ymd = addDaysUtc(todayStr, -1);
      result.targetDate = ymd;
      result.rangeStart = ymd;
      result.rangeEnd = ymd;
      result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(ymd)]}, ${ymd} (Yesterday)`;
      workingText = workingText.replace(/\byesterday\b/, ' ');
    } else if (/\btoday\b/.test(workingText)) {
      result.targetDate = todayStr;
      result.rangeStart = todayStr;
      result.rangeEnd = todayStr;
      result.dateLabel = `${WEEKDAY_NAMES[getUtcDow(todayStr)]}, ${todayStr} (Today)`;
      workingText = workingText.replace(/\btoday\b/, ' ');
    }
  }

  // 6. Weekday match: "[last|previous|this|on] wednesday|wed..."
  if (!result.targetDate && !result.rangeStart) {
    const weekdayPattern = Object.keys(WEEKDAY_ALIASES).join('|');
    const wdRegex = new RegExp(
      `\\b(?:(last|previous|prev|past|this|on)\\s+)?(${weekdayPattern})\\b`
    );
    const wdMatch = workingText.match(wdRegex);
    if (wdMatch) {
      const modifier = wdMatch[1] || '';
      const targetDow = WEEKDAY_ALIASES[wdMatch[2]];
      const todayDow = getUtcDow(todayStr);

      let daysBack = (todayDow - targetDow + 7) % 7;
      if (daysBack === 0) {
        if (modifier === 'last' || modifier === 'previous' || modifier === 'prev' || modifier === 'past') {
          daysBack = 7;
        }
      }
      // If user said "last wednesday" on Thursday, daysBack is 1 (2026-11-11); also offer 1 week earlier (2026-11-04)
      const resolved = addDaysUtc(todayStr, -daysBack);
      result.targetDate = resolved;
      result.rangeStart = resolved;
      result.rangeEnd = resolved;
      const qualifier = modifier === 'last' || modifier === 'previous' || modifier === 'prev'
        ? `Last ${WEEKDAY_NAMES[targetDow]}`
        : daysBack === 0
        ? `Today (${WEEKDAY_NAMES[targetDow]})`
        : WEEKDAY_NAMES[targetDow];
      result.dateLabel = `${WEEKDAY_NAMES[targetDow]}, ${resolved} (${qualifier})`;
      if (daysBack > 0 && daysBack < 7) {
        result.alternativeDate = addDaysUtc(resolved, -7);
      }
      workingText = workingText.replace(wdMatch[0], ' ');
    }
  }

  // 7. Score employees against remaining tokens
  const remainingTokens = workingText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FILLER_WORDS.has(t));

  const candidatePhrase = remainingTokens.join(' ').trim();

  if (remainingTokens.length > 0) {
    const scored = employees
      .map((emp) => ({
        emp,
        score: scoreEmployeeMatch(emp, remainingTokens, candidatePhrase),
      }))
      .filter((x) => x.score >= 55)
      .sort((a, b) => b.score - a.score);

    result.matchedEmployees = scored.map((s) => s.emp);
    if (scored.length > 0) {
      result.matchedEmployee = scored[0].emp;
      result.confidence =
        scored[0].score >= 90 ? 'exact' : scored[0].score >= 70 ? 'partial' : 'fuzzy';
    }
  }

  return result;
}
