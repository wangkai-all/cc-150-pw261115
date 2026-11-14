// 导出：保留使用的规则版本、完整分配与依据；支持 JSON 与 CSV
import { buildEffectiveGrades } from './grading.js';
import { checkPrerequisiteTiming, checkPrerequisiteGraph } from './prerequisites.js';
import { resolveEquivalences } from './equivalences.js';

export function buildExportBundle(auditResults, dataset, prereqCheck) {
  return {
    exportType: 'academic-audit-export',
    ruleVersions: dataset.versions,
    generatedAt: new Date().toISOString(),
    prerequisiteGraphCheck: prereqCheck,
    students: auditResults.map((r) => ({
      studentId: r.studentId,
      studentName: r.studentName,
      enrollYear: r.enrollYear,
      program: r.program,
      policies: r.policies,
      isTrial: r.isTrial,
      totals: r.totals,
      requiredAllocation: r.requiredRows.map((row) => ({
        requirement: row.requirementCourse,
        satisfied: row.satisfied,
        matchedCourse: row.matchedCourse,
        via: row.via,
        equivalenceId: row.equivalenceId,
        reasons: row.reasons,
      })),
      electiveAllocation: r.electiveRows.map((row) => ({
        groupId: row.groupId,
        name: row.name,
        minCredits: row.minCredits,
        earnedCredits: row.earnedCredits,
        satisfied: row.satisfied,
        assigned: row.assigned,
        unusedInGroup: row.unusedInGroup,
        reasons: row.reasons,
      })),
      rejectedEquivalences: r.rejectedEquivalences,
      issues: r.issues,
    })),
  };
}

export function toCSV(auditResults) {
  const header = [
    'studentId', 'studentName', 'enrollYear', 'program', 'programVersion',
    'requirementType', 'requirementId', 'requirementName', 'minCredits',
    'earnedCredits', 'satisfied', 'matchedCourses', 'reasons',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(',')];

  for (const r of auditResults) {
    for (const row of r.requiredRows) {
      lines.push([
        r.studentId, r.studentName, r.enrollYear, r.program.id, r.program.version,
        'required', row.requirementCourse, '', '', '',
        row.satisfied, row.matchedCourse || '',
        row.reasons.map((x) => x.text).join(' | '),
      ].map(esc).join(','));
    }
    for (const row of r.electiveRows) {
      lines.push([
        r.studentId, r.studentName, r.enrollYear, r.program.id, r.program.version,
        'elective', row.groupId, row.name, row.minCredits,
        row.earnedCredits, row.satisfied,
        row.assigned.map((a) => a.courseId).join(';'),
        row.reasons.map((x) => x.text).join(' | '),
      ].map(esc).join(','));
    }
    lines.push([
      r.studentId, r.studentName, r.enrollYear, r.program.id, r.program.version,
      'total', 'TOTAL', '', r.program.totalCredits,
      r.totals.earned, r.totals.earned >= r.program.totalCredits,
      r.totals.countedCourses.join(';'),
      `缺口 ${r.totals.deficit} 学分`,
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

export function runPrerequisiteChecks(dataset, auditInputs) {
  const catalogMap = new Map(dataset.catalog.map((c) => [c.id, c]));
  const graph = checkPrerequisiteGraph(dataset.prerequisites || {}, catalogMap);
  const timing = [];
  if (graph.ok) {
    for (const s of dataset.students) {
      const program = dataset.programs.find(
        (p) => p.id === s.programId && p.effectiveEnrollYears.includes(s.enrollYear),
      ) || dataset.programs.find((p) => p.id === s.programId);
      if (!program) continue;
      const grades = buildEffectiveGrades(s.grades, program, catalogMap);
      const { map: eqMap } = resolveEquivalences(s, program, dataset.equivalences || []);
      timing.push(...checkPrerequisiteTiming(s, dataset.prerequisites || {}, grades, eqMap));
    }
  }
  return { graph, timing };
}
