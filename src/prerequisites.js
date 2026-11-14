// 先修要求：先修成环 / 课程信息缺失先报；再检查修读时序是否满足先修
import { termOrder } from './terms.js';

/**
 * 静态检查先修图：缺失课程引用 + 成环
 * @param {Record<string, Array>} prereqMap
 * @param {Map<string, object>} catalogMap
 * @returns {{ missingCourses: string[], cycles: Array<string[]>, ok: boolean }}
 */
export function checkPrerequisiteGraph(prereqMap, catalogMap) {
  const missingCourses = new Set();

  // 先修条款引用的课程不在课程库
  for (const [courseId, rules] of Object.entries(prereqMap)) {
    if (!catalogMap.has(courseId)) missingCourses.add(courseId);
    for (const rule of rules) {
      for (const pre of rule.courses || []) {
        if (!catalogMap.has(pre)) missingCourses.add(pre);
      }
    }
  }

  // 成环检测（DFS 三色法，按 any/all 展开为依赖边）
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];
  const nodes = Object.keys(prereqMap);

  const dfs = (node, stack) => {
    color.set(node, GRAY);
    const rules = prereqMap[node] || [];
    const deps = [...new Set(rules.flatMap((r) => r.courses || []))];
    for (const dep of deps) {
      if (!prereqMap[dep]) continue; // 无先修定义的节点不参与成环
      if (color.get(dep) === GRAY) {
        const idx = stack.indexOf(dep);
        cycles.push([...stack.slice(idx >= 0 ? idx : 0), dep]);
      } else if (color.get(dep) !== BLACK) {
        dfs(dep, [...stack, dep]);
      }
    }
    color.set(node, BLACK);
  };

  for (const n of nodes) {
    if (color.get(n) === undefined) dfs(n, [n]);
  }

  return {
    missingCourses: [...missingCourses].sort(),
    cycles,
    ok: missingCourses.size === 0 && cycles.length === 0,
  };
}

function evaluateRule(rule, passedBefore) {
  const courses = rule.courses || [];
  if (courses.length === 0) return true;
  if (rule.logic === 'any') return courses.some((c) => passedBefore.has(c));
  return courses.every((c) => passedBefore.has(c));
}

/**
 * 时序检查：每次修读（含挂科尝试）发生时，先修课是否已在更早学期通过
 * @param {Map<string,object>} [equivalenceMap] toCourseId -> {fromCourse} 等价替代映射，
 *   通过源课程视同通过目标先修
 * @returns {Array<object>} 违规明细
 */
export function checkPrerequisiteTiming(student, prereqMap, effectiveGrades, equivalenceMap = null) {
  const violations = [];
  // 等价替代：源课程通过后，目标课程也视同通过
  const satisfySet = (set, courseId) => {
    if (set.has(courseId)) return true;
    const eq = equivalenceMap?.get(courseId);
    return !!eq && set.has(eq.fromCourse);
  };
  // 按学期推进：维护“在当前学期之前已通过”的课程集合
  const terms = [...new Set(student.grades.map((g) => g.term))]
    .sort((a, b) => termOrder(a) - termOrder(b));

  const passedBefore = new Set();
  for (const term of terms) {
    const termGrades = student.grades.filter((g) => g.term === term);
    for (const g of termGrades) {
      const rules = prereqMap[g.courseId];
      if (!rules) continue;
      for (const rule of rules) {
        const required = rule.courses || [];
        const missing = required.filter((c) => !satisfySet(passedBefore, c));
        const satisfied = rule.logic === 'any'
          ? required.some((c) => satisfySet(passedBefore, c))
          : required.every((c) => satisfySet(passedBefore, c));
        if (!satisfied) {
          violations.push({
            studentId: student.id,
            term,
            courseId: g.courseId,
            logic: rule.logic || 'all',
            required,
            missing,
            reason: `修读 ${g.courseId} 时先修未满足：${required.join('、')}`
              + `（${rule.logic === 'any' ? '任一' : '全部'}），`
              + `当时尚未通过 ${missing.join('、') || '无'}`,
          });
        }
      }
    }
    // 学期结束后，把本学期有效通过的课程并入（同学期修的先修课不计入“更早通过”）
    for (const g of termGrades) {
      const eff = effectiveGrades.get(g.courseId);
      if (eff?.passed) {
        passedBefore.add(g.courseId);
        // 通过源课程时，其等价目标也视同通过
        if (equivalenceMap) {
          for (const [toCourse, eq] of equivalenceMap) {
            if (eq.fromCourse === g.courseId) passedBefore.add(toCourse);
          }
        }
      }
    }
  }
  return violations;
}
