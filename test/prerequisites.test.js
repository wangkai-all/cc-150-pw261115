import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkPrerequisiteGraph, checkPrerequisiteTiming } from '../src/prerequisites.js';
import { buildEffectiveGrades } from '../src/grading.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', 'data', f), 'utf8'));
const catalogDoc = load('catalog.json');
const catalogMap = new Map((catalogDoc.courses ?? catalogDoc).map((c) => [c.id, c]));

test('健康先修图：无缺失、无环', () => {
  const pre = load('prerequisites.json').prerequisites;
  const r = checkPrerequisiteGraph(pre, catalogMap);
  assert.equal(r.ok, true);
  assert.deepEqual(r.cycles, []);
  assert.deepEqual(r.missingCourses, []);
});

test('问题先修图：成环与课程缺失先报出来', () => {
  const pre = load('prerequisites-issue.json').prerequisites;
  const r = checkPrerequisiteGraph(pre, catalogMap);
  assert.equal(r.ok, false);
  assert.ok(r.cycles.length >= 1, '应检测到 CS201->CS202->CS303 环');
  const cycleFlat = r.cycles.flat();
  for (const c of ['CS201', 'CS202', 'CS303']) assert.ok(cycleFlat.includes(c));
  assert.ok(r.missingCourses.includes('GHOST101'));
});

test('修读时序：先修未在更早学期通过即违规', () => {
  const pre = load('prerequisites.json').prerequisites;
  const program = { retakePolicy: { scoreRule: 'max' }, makeupPolicy: { cap: 60 } };
  // CS206 要求先通过 CS203；学生先修 CS206 再修 CS203
  const student = {
    id: 'x',
    grades: [
      { term: '2020-2021-1', courseId: 'CS100', score: 80, type: 'normal' },
      { term: '2020-2021-1', courseId: 'CS101', score: 80, type: 'normal' },
      { term: '2020-2021-2', courseId: 'CS206', score: 70, type: 'normal' },
      { term: '2021-2022-1', courseId: 'CS203', score: 75, type: 'normal' },
    ],
  };
  const grades = buildEffectiveGrades(student.grades, program, catalogMap);
  const v = checkPrerequisiteTiming(student, pre, grades);
  const hit = v.find((x) => x.courseId === 'CS206');
  assert.ok(hit);
  assert.deepEqual(hit.missing, ['CS203']);
});

test('先修在更早学期通过则不违规', () => {
  const pre = load('prerequisites.json').prerequisites;
  const program = { retakePolicy: { scoreRule: 'max' }, makeupPolicy: { cap: 60 } };
  // 干净的两级链：CS100(第1学期) -> CS101(第2学期)，CS101 先修为 any(CS100,CS099)
  const student = {
    id: 'y',
    grades: [
      { term: '2020-2021-1', courseId: 'CS100', score: 80, type: 'normal' },
      { term: '2020-2021-2', courseId: 'CS101', score: 80, type: 'normal' },
    ],
  };
  const grades = buildEffectiveGrades(student.grades, program, catalogMap);
  const v = checkPrerequisiteTiming(student, pre, grades);
  assert.equal(v.length, 0);
});

test('同学期通过的先修不算满足（必须更早学期）', () => {
  const pre = load('prerequisites.json').prerequisites;
  const program = { retakePolicy: { scoreRule: 'max' }, makeupPolicy: { cap: 60 } };
  const student = {
    id: 'w',
    grades: [
      { term: '2020-2021-2', courseId: 'CS203', score: 75, type: 'normal' },
      { term: '2020-2021-2', courseId: 'CS206', score: 70, type: 'normal' },
    ],
  };
  const grades = buildEffectiveGrades(student.grades, program, catalogMap);
  const v = checkPrerequisiteTiming(student, pre, grades);
  assert.ok(v.some((x) => x.courseId === 'CS206'));
});

test('any 逻辑：任一先修通过即可', () => {
  const pre = { CS101: [{ logic: 'any', courses: ['CS100', 'CS099'] }] };
  const program = { retakePolicy: { scoreRule: 'max' }, makeupPolicy: { cap: 60 } };
  const student = {
    id: 'z',
    grades: [{ term: '2020-2021-1', courseId: 'CS099', score: 90, type: 'normal' }],
  };
  const grades = buildEffectiveGrades(student.grades, program, catalogMap);
  assert.equal(checkPrerequisiteTiming(student, pre, grades).length, 0);
});
