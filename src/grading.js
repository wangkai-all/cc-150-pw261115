// 成绩处理：把同一门课的多次修读（正考/补考/重修）按方案规则折叠为有效成绩
import { compareTerm } from './terms.js';

/**
 * @param {Array<{term:string,courseId:string,score:number,type:string}>} records
 * @param {{retakePolicy:{scoreRule:string}, makeupPolicy:{cap:number|null}}} program
 * @param {Map<string, {id:string,credits:number,name:string}>} catalogMap
 * @returns {Map<string, object>} key=courseId
 */
export function buildEffectiveGrades(records, program, catalogMap) {
  const byCourse = new Map();
  for (const r of records) {
    if (!byCourse.has(r.courseId)) byCourse.set(r.courseId, []);
    byCourse.get(r.courseId).push(r);
  }

  const result = new Map();
  for (const [courseId, attempts] of byCourse) {
    const sorted = [...attempts].sort((a, b) => compareTerm(a.term, b.term));
    const policy = program.retakePolicy || { scoreRule: 'max' };
    const makeupCap = program.makeupPolicy?.cap ?? 60;

    // 有效成绩：按方案规则在全部尝试中取值
    let effectiveScore;
    let basis;
    if (policy.scoreRule === 'last') {
      // 重修按最近一次成绩计
      const last = sorted[sorted.length - 1];
      effectiveScore = last.type === 'makeup' && last.score > makeupCap
        ? makeupCap
        : last.score;
      basis = last.type === 'makeup' ? 'makeup-cap' : 'last-attempt';
    } else {
      // 默认 max：重修取历次最高分（补考超上限仍按封顶）
      const scored = sorted.map((a) => ({
        attempt: a,
        value: a.type === 'makeup' && a.score > makeupCap ? makeupCap : a.score,
      }));
      scored.sort((x, y) => y.value - x.value || compareTerm(x.attempt.term, y.attempt.term));
      effectiveScore = scored[0].value;
      basis = scored[0].attempt.type === 'makeup' ? 'makeup-cap' : 'max-attempt';
    }

    const failed = sorted.filter((a) => a.score < 60);
    const passed = effectiveScore >= 60;
    result.set(courseId, {
      courseId,
      effectiveScore,
      passed,
      basis,
      scoreRule: policy.scoreRule,
      makeupCap,
      attempts: sorted.map((a) => ({
        term: a.term,
        score: a.score,
        type: a.type,
        counted: a.score === effectiveScore,
      })),
      hasRetake: sorted.some((a) => a.type === 'retake'),
      hasMakeup: sorted.some((a) => a.type === 'makeup'),
      failedAttempts: failed.length,
      inCatalog: catalogMap.has(courseId),
    });
  }
  return result;
}
