import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEffectiveGrades } from '../src/grading.js';

const catalogMap = new Map([['C1', { id: 'C1', credits: 3 }]]);
const programMax = { retakePolicy: { scoreRule: 'max' }, makeupPolicy: { cap: 60 } };
const programLast = { retakePolicy: { scoreRule: 'last' }, makeupPolicy: { cap: 60 } };

test('补考通过按封顶 60 计，即使卷面更高', () => {
  const g = buildEffectiveGrades([
    { term: '2020-2021-1', courseId: 'C1', score: 55, type: 'normal' },
    { term: '2020-2021-2', courseId: 'C1', score: 78, type: 'makeup' },
  ], programMax, catalogMap);
  assert.equal(g.get('C1').effectiveScore, 60);
  assert.equal(g.get('C1').passed, true);
});

test('max 规则：重修取历次最高分', () => {
  const g = buildEffectiveGrades([
    { term: '2020-2021-1', courseId: 'C1', score: 40, type: 'normal' },
    { term: '2021-2022-1', courseId: 'C1', score: 55, type: 'retake' },
    { term: '2022-2023-1', courseId: 'C1', score: 72, type: 'retake' },
  ], programMax, catalogMap);
  assert.equal(g.get('C1').effectiveScore, 72);
  assert.equal(g.get('C1').basis, 'max-attempt');
  assert.equal(g.get('C1').hasRetake, true);
});

test('last 规则：重修按最近一次成绩计（最近一次更低也取它）', () => {
  const g = buildEffectiveGrades([
    { term: '2020-2021-1', courseId: 'C1', score: 85, type: 'normal' },
    { term: '2022-2023-1', courseId: 'C1', score: 65, type: 'retake' },
  ], programLast, catalogMap);
  assert.equal(g.get('C1').effectiveScore, 65);
  assert.equal(g.get('C1').basis, 'last-attempt');
});

test('全部挂科时有效成绩不通过', () => {
  const g = buildEffectiveGrades([
    { term: '2020-2021-1', courseId: 'C1', score: 30, type: 'normal' },
    { term: '2021-2022-1', courseId: 'C1', score: 59, type: 'retake' },
  ], programMax, catalogMap);
  assert.equal(g.get('C1').passed, false);
  assert.equal(g.get('C1').failedAttempts, 2);
});
