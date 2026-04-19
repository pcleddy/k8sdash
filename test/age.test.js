import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age } from '../lib/age.js';

const now = Date.now();
const ts = (msAgo) => new Date(now - msAgo).toISOString();

test('missing/null returns ?', () => {
  assert.equal(age(null), '?');
  assert.equal(age(undefined), '?');
  assert.equal(age(''), '?');
});

test('under 60s returns <1m', () => {
  assert.equal(age(ts(30_000)), '<1m');
  assert.equal(age(ts(59_000)), '<1m');
});

test('minutes', () => {
  assert.equal(age(ts(60_000)), '1m');
  assert.equal(age(ts(90_000)), '1m');
  assert.equal(age(ts(59 * 60_000)), '59m');
});

test('hours', () => {
  assert.equal(age(ts(60 * 60_000)), '1h');
  assert.equal(age(ts(23 * 60 * 60_000)), '23h');
});

test('days', () => {
  assert.equal(age(ts(24 * 60 * 60_000)), '1d');
  assert.equal(age(ts(7 * 24 * 60 * 60_000)), '7d');
});

test('accepts Date object', () => {
  assert.equal(age(new Date(now - 120_000)), '2m');
});
