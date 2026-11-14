// 课程等价：等价关系仅在指定方案 + 入学年份内有效，不能跨版本套用
/**
 * 为一名学生解析可使用的等价映射
 * @returns {{ map: Map<string,object>, rejected: Array<object> }}
 *   map: toCourseId -> { fromCourse, equivalence, reason }
 *   rejected: 学生成绩中出现但对该生无效的等价关系（用于缺口解释）
 */
export function resolveEquivalences(student, program, equivalences) {
  const map = new Map();
  const rejected = [];
  const taken = new Set(student.grades.map((g) => g.courseId));

  for (const eq of equivalences) {
    const programMatch = eq.programId === program.id && eq.programVersion === program.version;
    const yearMatch = Array.isArray(eq.validEnrollYears)
      && eq.validEnrollYears.includes(student.enrollYear);

    if (programMatch && yearMatch) {
      // 仅当学生确实修过源课程时才形成可用替代
      if (taken.has(eq.fromCourse)) {
        if (!map.has(eq.toCourse)) {
          map.set(eq.toCourse, {
            fromCourse: eq.fromCourse,
            equivalence: eq,
            reason: `按等价关系 ${eq.id}（${eq.note}），${eq.fromCourse} 替代 ${eq.toCourse}`,
          });
        }
      }
      continue;
    }

    // 学生修了源课程、目标又是方案要求，但关系不适用于该生 -> 记录拒绝原因
    if (taken.has(eq.fromCourse)) {
      const reasons = [];
      if (!programMatch) {
        reasons.push(`等价关系 ${eq.id} 仅适用于 ${eq.programId}/${eq.programVersion}，当前为 ${program.id}/${program.version}`);
      }
      if (!yearMatch) {
        reasons.push(`等价关系 ${eq.id} 的有效入学年份为 ${(eq.validEnrollYears || []).join('、')}，不含 ${student.enrollYear}`);
      }
      rejected.push({
        equivalenceId: eq.id,
        fromCourse: eq.fromCourse,
        toCourse: eq.toCourse,
        reason: reasons.join('；'),
      });
    }
  }
  return { map, rejected };
}

// 缺口解释时：查某门目标课是否存在“看似可用但被规则拒绝”的等价
export function findRejectedEquivalence(rejected, toCourseId) {
  return rejected.find((r) => r.toCourse === toCourseId) || null;
}
