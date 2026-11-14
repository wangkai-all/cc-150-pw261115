// 学期工具：学期字符串 "YYYY-YYYY-N"（N=1 秋 / 2 春，可选 3 暑期）
const TERM_RE = /^(\d{4})-(\d{4})-([123])$/;

export function parseTerm(term) {
  const m = TERM_RE.exec(String(term ?? ''));
  if (!m) return null;
  const start = Number(m[1]);
  if (Number(m[2]) !== start + 1) return null;
  return { start, index: Number(m[3]), key: term };
}

export function isValidTerm(term) {
  return parseTerm(term) !== null;
}

// 可比较的学期序号：同一年内 1 < 2 < 3，再跨年
export function termOrder(term) {
  const p = parseTerm(term);
  if (!p) return Number.POSITIVE_INFINITY;
  return p.start * 10 + p.index;
}

export function compareTerm(a, b) {
  return termOrder(a) - termOrder(b);
}

export function nextTerm(term) {
  const p = parseTerm(term);
  if (!p) return null;
  if (p.index === 1) return `${p.start}-${p.start + 1}-2`;
  return `${p.start + 1}-${p.start + 2}-1`;
}
