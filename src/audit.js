// 学业审计核心：必修抵扣、选修组互斥分配（回溯求一套完整分配）、总学分核算、缺口原因
import { buildEffectiveGrades } from './grading.js';
import { resolveEquivalences, findRejectedEquivalence } from './equivalences.js';

const REASON = {
  NOT_TAKEN: 'not-taken',
  FAILED: 'failed',
  MISSING_COURSE: 'missing-course',
  EQ_REJECTED: 'equivalence-rejected',
  EQ_USED: 'equivalence-used',
  NOT_ENOUGH: 'not-enough',
  OUT_OF_UNIVERSE: 'out-of-universe',
  CONSUMED_ELSEWHERE: 'consumed-elsewhere',
};

function pickProgram(student, programs) {
  const candidates = programs.filter(
    (p) => p.id === student.programId
      && Array.isArray(p.effectiveEnrollYears)
      && p.effectiveEnrollYears.includes(student.enrollYear),
  );
  if (candidates.length > 0) return { program: candidates[0], ambiguous: candidates.length > 1 };
  // 找不到适用版本：回退同专业最新版本并标注（审计中作为数据问题上报）
  const fallback = programs.filter((p) => p.id === student.programId)
    .sort((a, b) => Math.max(...b.effectiveEnrollYears) - Math.max(...a.effectiveEnrollYears))[0]
    || null;
  return { program: fallback, noApplicableVersion: true };
}

// 回溯分配：候选按“可替代程度”排序（出现在越少组里越优先），保证一门课只分给一个组
function allocateElectiveGroups(groups, available) {
  // available: Map courseId -> credits（已剔除必修占用）
  const groupCourses = new Map();
  for (const g of groups) {
    groupCourses.set(g.id, new Set(g.courses));
  }
  const membershipCount = new Map();
  for (const cid of available.keys()) {
    membershipCount.set(cid, [...groupCourses.values()].filter((s) => s.has(cid)).length);
  }

  const allocations = new Map(groups.map((g) => [g.id, []]));
  const used = new Set();

  const candidatesOf = (g) => [...available.entries()]
    .filter(([cid]) => groupCourses.get(g.id).has(cid) && !used.has(cid))
    .sort((a, b) => (membershipCount.get(a[0]) - membershipCount.get(b[0]))
      || b[1] - a[1] || a[0].localeCompare(b[0]));

  // 按候选稀缺度排序处理顺序：可选课程最少的组先分
  const ordered = [...groups].sort(
    (a, b) => candidatesCountStatic(a) - candidatesCountStatic(b) || b.minCredits - a.minCredits,
  );
  function candidatesCountStatic(g) {
    return [...available.keys()].filter((c) => groupCourses.get(g.id).has(c)).length;
  }

  function backtrack(idx) {
    if (idx === ordered.length) return true;
    const g = ordered[idx];
    const cands = candidatesOf(g);
    const solutions = enumerateSolutions(cands, g.minCredits);
    if (solutions.length === 0) {
      // 该组无可行组合（结构性缺口）：留空并继续后续组，保留其余组的分配
      allocations.set(g.id, []);
      return backtrack(idx + 1);
    }
    for (const sol of solutions) {
      for (const cid of sol) used.add(cid);
      allocations.set(g.id, sol);
      if (backtrack(idx + 1)) return true;
      for (const cid of sol) used.delete(cid);
    }
    allocations.set(g.id, []);
    return false;
  }

  backtrack(0);

  // 还原为原始组顺序；标记无法满足的组
  const infeasible = [];
  const result = new Map();
  for (const g of groups) {
    const assigned = allocations.get(g.id) || [];
    const credits = assigned.reduce((s, cid) => s + available.get(cid), 0);
    result.set(g.id, { courses: assigned, credits, satisfied: credits >= g.minCredits });
    if (credits < g.minCredits) {
      infeasible.push({
        groupId: g.id,
        minCredits: g.minCredits,
        earnedCredits: credits,
        deficit: g.minCredits - credits,
      });
    }
  }
  return { allocations: result, infeasible, fullySolved: infeasible.length === 0 };
}

// 枚举所有达到门槛的组合，返回按总学分升序的组合列表（DFS + 学分剪枝）
function enumerateSolutions(cands, minCredits) {
  const solutions = [];
  const cur = [];
  const creditOf = (cid) => cands.find(([x]) => x === cid)[1];
  const dfs = (i, sum) => {
    if (sum >= minCredits) {
      solutions.push([...cur]);
      // 不 return：继续枚举可让后续组回溯时有更多组合可选
    }
    for (let j = i; j < cands.length; j++) {
      cur.push(cands[j][0]);
      dfs(j + 1, sum + cands[j][1]);
      cur.pop();
    }
  };
  dfs(0, 0);
  solutions.sort((a, b) => {
    const sa = a.reduce((s, c) => s + creditOf(c), 0);
    const sb = b.reduce((s, c) => s + creditOf(c), 0);
    return sa - sb || a.length - b.length;
  });
  return solutions;
}

/**
 * 审计一名学生
 * @param {object} student
 * @param {{catalog:object[], programs:object[], equivalences:object[], prerequisites:object}} data
 * @param {object} [trialCourses] 试选课程 { [courseId]: {term, score} }，不写入正式成绩
 */
export function auditStudent(student, data, trialCourses = null) {
  const catalogMap = new Map(data.catalog.map((c) => [c.id, c]));
  const { program, noApplicableVersion, ambiguous } = pickProgram(student, data.programs);

  const issues = [];
  if (!program) {
    return {
      studentId: student.id,
      fatal: true,
      issues: [{ type: REASON.NOT_TAKEN, message: `找不到专业 ${student.programId} 的任何培养方案` }],
    };
  }
  if (noApplicableVersion) {
    issues.push({
      type: 'no-applicable-version',
      message: `入学年份 ${student.enrollYear} 没有适用的 ${student.programId} 方案版本，已回退到 ${program.version}，结果仅供参考`,
    });
  }
  if (ambiguous) issues.push({ type: 'ambiguous-version', message: '存在多个同届适用方案，已取第一个' });

  const programLabel = `${program.id} ${program.version}`;
  const universe = new Set([
    ...program.required,
    ...program.electiveGroups.flatMap((g) => g.courses),
  ]);

  // 试选课程：构造临时成绩副本，绝不改写正式数据
  const effectiveStudent = trialCourses
    ? {
        ...student,
        grades: [
          ...student.grades,
          ...Object.entries(trialCourses).map(([courseId, v]) => ({
            courseId,
            term: v.term,
            score: v.score ?? 85,
            type: 'trial',
          })),
        ],
      }
    : student;

  const grades = buildEffectiveGrades(effectiveStudent.grades, program, catalogMap);
  const { map: eqMap, rejected } = resolveEquivalences(student, program, data.equivalences || []);

  // 成绩中引用了课程库不存在的课程
  const unknownCourses = [...grades.values()]
    .filter((g) => !g.inCatalog)
    .map((g) => g.courseId)
    .sort();
  for (const cid of unknownCourses) {
    issues.push({ type: REASON.MISSING_COURSE, courseId: cid, message: `成绩中的课程 ${cid} 在课程库中不存在，无法计入任何要求` });
  }

  // ---- 必修抵扣（一门课至多占用一个要求；等价替代同样互斥）----
  const requiredRows = [];
  const consumed = new Set(); // 已被占用的学生实修课程
  for (const reqCourse of program.required) {
    const row = { requirementCourse: reqCourse, satisfied: false, matchedCourse: null, via: null, equivalenceId: null, reasons: [] };
    const direct = grades.get(reqCourse);
    if (direct && direct.passed && catalogMap.has(reqCourse)) {
      row.satisfied = true;
      row.matchedCourse = reqCourse;
      row.via = 'direct';
      consumed.add(reqCourse);
    } else {
      const eq = eqMap.get(reqCourse);
      const eqGrade = eq && grades.get(eq.fromCourse);
      if (eq && eqGrade?.passed && !consumed.has(eq.fromCourse)) {
        row.satisfied = true;
        row.matchedCourse = eq.fromCourse;
        row.via = 'equivalence';
        row.equivalenceId = eq.equivalence.id;
        consumed.add(eq.fromCourse);
      } else {
        // 组装缺口原因（点击缺口可见）
        const reasons = [];
        if (!catalogMap.has(reqCourse)) {
          reasons.push({ code: REASON.MISSING_COURSE, text: `要求课程 ${reqCourse} 在课程库中信息缺失` });
        }
        if (direct && !direct.passed) {
          reasons.push({
            code: REASON.FAILED,
            text: `已修读但未通过：有效成绩 ${direct.effectiveScore} 分（规则 ${direct.scoreRule}），共 ${direct.attempts.length} 次尝试`,
          });
        } else if (!direct) {
          const rej = findRejectedEquivalence(rejected, reqCourse);
          if (rej) {
            reasons.push({ code: REASON.EQ_REJECTED, text: rej.reason });
          } else if (eq) {
            reasons.push({ code: REASON.FAILED, text: `替代源课程 ${eq.fromCourse} 未通过` });
          } else {
            reasons.push({ code: REASON.NOT_TAKEN, text: `未修读 ${reqCourse}，且无适用的等价课程` });
          }
        }
        if (eq && eqGrade?.passed && consumed.has(eq.fromCourse)) {
          reasons.push({ code: REASON.CONSUMED_ELSEWHERE, text: `替代源 ${eq.fromCourse} 已被其他互斥要求占用` });
        }
        row.reasons = reasons;
      }
    }
    requiredRows.push(row);
  }

  // ---- 选修组：剩余通过且在方案域内的课程进入候选池，回溯互斥分配 ----
  const available = new Map();
  const surplusDirect = [];
  for (const [cid, g] of grades) {
    if (!g.passed || !catalogMap.has(cid)) continue;
    if (consumed.has(cid)) continue;
    if (universe.has(cid)) available.set(cid, catalogMap.get(cid).credits);
  }
  const { allocations, infeasible } = allocateElectiveGroups(program.electiveGroups, available);

  const electiveRows = program.electiveGroups.map((g) => {
    const alloc = allocations.get(g.id);
    const usedHere = new Set(alloc.courses);
    for (const cid of alloc.courses) consumed.add(cid);
    // 组内未被选用的通过课程（解释为什么没算进本组）
    const unusedInGroup = g.courses
      .filter((c) => grades.has(c) && grades.get(c).passed && !usedHere.has(c))
      .map((c) => {
        const elsewhere = consumed.has(c) && !usedHere.has(c);
        return {
          courseId: c,
          reason: elsewhere
            ? `已分配给其他互斥要求/选修组，本组不重复计学分`
            : `已被其他选修组优先占用或为满足门槛后的冗余学分`,
        };
      });
    const row = {
      groupId: g.id,
      name: g.name,
      minCredits: g.minCredits,
      satisfied: alloc.satisfied,
      earnedCredits: alloc.credits,
      assigned: alloc.courses.map((cid) => ({
        courseId: cid,
        credits: catalogMap.get(cid).credits,
        basis: `回溯分配：该课程属于本组且未被其他要求占用`,
      })),
      reasons: [],
      unusedInGroup,
    };
    if (!alloc.satisfied) {
      row.reasons.push({
        code: REASON.NOT_ENOUGH,
        text: `本组至少需要 ${g.minCredits} 学分，互斥分配后仅得 ${alloc.credits} 学分，缺口 ${g.minCredits - alloc.credits} 学分`,
      });
      // 组内挂科/未修课程提示
      for (const c of g.courses) {
        const gg = grades.get(c);
        if (gg && !gg.passed) {
          row.reasons.push({ code: REASON.FAILED, text: `${c} 已修读但未通过（有效成绩 ${gg.effectiveScore}）` });
        }
      }
    }
    return row;
  });

  // ---- 总学分：方案域内通过课程的“去重学分”，每门课只计一次 ----
  const countedCourses = new Set(consumed);
  // 选修组已分配的也在 consumed 内；补充：方案域内通过但未被任何要求消耗的课程（冗余学分）
  const extraInUniverse = [];
  for (const cid of available.keys()) {
    if (!countedCourses.has(cid)) {
      extraInUniverse.push(cid);
      countedCourses.add(cid); // 冗余课程同样计入总学分，但只计一次
    }
  }
  const outOfUniverse = [];
  for (const [cid, g] of grades) {
    if (!g.passed || !catalogMap.has(cid)) continue;
    if (!universe.has(cid)) {
      outOfUniverse.push({
        courseId: cid,
        credits: catalogMap.get(cid).credits,
        reason: `${cid} 不在 ${programLabel} 的必修或选修组内，不计入毕业学分`,
      });
    }
  }
  const creditOf = (cid) => catalogMap.get(cid)?.credits ?? 0;
  const earnedCredits = [...countedCourses].reduce((s, c) => s + creditOf(c), 0)
    + extraInUniverse.reduce((s, c) => s + creditOf(c), 0);

  return {
    studentId: student.id,
    studentName: student.name,
    enrollYear: student.enrollYear,
    program: { id: program.id, name: program.name, version: program.version, totalCredits: program.totalCredits },
    policies: { retake: program.retakePolicy, makeup: program.makeupPolicy },
    ruleVersions: data.versions,
    isTrial: !!trialCourses,
    requiredRows,
    electiveRows,
    totals: {
      required: program.totalCredits,
      earned: earnedCredits,
      deficit: Math.max(0, program.totalCredits - earnedCredits),
      countedCourses: [...countedCourses].sort(),
      extraInUniverse: extraInUniverse.sort(),
      outOfUniverse,
      unknownCourses,
    },
    infeasibleGroups: infeasible,
    rejectedEquivalences: rejected,
    issues,
  };
}

export { REASON };
