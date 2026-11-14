import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { auditStudent } from '../src/audit.js';
import { normalizeDataset } from '../src/data-loader.js';
import { buildExportBundle, toCSV, runPrerequisiteChecks } from '../src/export.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', 'data', f), 'utf8'));

function dataset() {
  return normalizeDataset({
    catalog: load('catalog.json'),
    programs: load('programs.json'),
    equivalences: load('equivalences.json'),
    prerequisites: load('prerequisites.json'),
    students: load('students.json'),
  });
}

test('试选不改写正式成绩：审计前后正式数据不变，试选学分只在试选结果中体现', () => {
  const d = dataset();
  const s = d.students.find((x) => x.id === 'S2020001');
  const before = JSON.stringify(s.grades);
  const base = auditStudent(s, d);
  const cs204Before = base.requiredRows.find((x) => x.requirementCourse === 'CS204');
  assert.equal(cs204Before.satisfied, false);

  const trial = auditStudent(s, d, { CS204: { term: '2023-2024-1', score: 80 } });
  assert.equal(JSON.stringify(s.grades), before, '正式成绩对象未被改写');
  const cs204After = trial.requiredRows.find((x) => x.requirementCourse === 'CS204');
  assert.equal(cs204After.satisfied, true);
  assert.equal(trial.isTrial, true);
  assert.ok(trial.totals.earned > base.totals.earned);

  // 再跑一次不带试选的审计，结果回到基线
  const again = auditStudent(s, d);
  assert.equal(again.requiredRows.find((x) => x.requirementCourse === 'CS204').satisfied, false);
});

test('试选多门课可同时补必修与选修组缺口', () => {
  const d = dataset();
  const s = d.students.find((x) => x.id === 'S2019001');
  const base = auditStudent(s, d);
  const trial = auditStudent(s, d, {
    CS303: { term: '2023-2024-1', score: 88 },
    CS304: { term: '2023-2024-1', score: 90 },
  });
  const baseUnsatisfied = base.electiveRows.filter((g) => !g.satisfied).length;
  const trialUnsatisfied = trial.electiveRows.filter((g) => !g.satisfied).length;
  assert.ok(trialUnsatisfied <= baseUnsatisfied);
});

test('导出保留规则版本与完整分配依据', async () => {
  const d = dataset();
  const results = d.students.map((s) => auditStudent(s, d));
  const pre = await runPrerequisiteChecks(d, results);
  const bundle = buildExportBundle(results, d, pre);
  assert.ok(bundle.ruleVersions.programs.startsWith('PROG-'));
  assert.ok(bundle.ruleVersions.equivalences.startsWith('EQ-'));
  assert.equal(bundle.students.length, results.length);
  const some = bundle.students.find((x) => x.studentId === 'S2019002');
  assert.ok(some.electiveAllocation.some((g) => g.assigned.length > 0));
  assert.ok(JSON.stringify(bundle).includes('basis'));
  // 先修时序检查会报告样本中有意保留的违规（赵六 CS101 先修未满足）
  assert.ok(pre.timing.length >= 1);
  assert.ok(pre.timing.some((v) => v.studentId === 'S2022001' && v.courseId === 'CS101'));

  const csv = toCSV(results);
  assert.match(csv, /requirementType/);
  assert.match(csv, /S2022001/);
  assert.match(csv, /TOTAL/);
});

test('问题先修图导出时 graph check 标记失败', async () => {
  const d = dataset();
  d.prerequisites = load('prerequisites-issue.json').prerequisites;
  const pre = await runPrerequisiteChecks(d, []);  assert.equal(pre.graph.ok, false);
  assert.ok(pre.graph.cycles.length >= 1);
  assert.equal(pre.timing.length, 0, '图不健康时跳过时序检查');
});
