import assert from "node:assert/strict";
import { parseTargetTime } from "./config.js";

// 基准时间：2026-06-07 09:40:00
const now = new Date(2026, 5, 7, 9, 40, 0);

// 1. 今天还没到的时间 → 今天
const t1 = parseTargetTime("10:00", now);
assert.ok(t1);
assert.equal(t1.getDate(), 7);
assert.equal(t1.getHours(), 10);
assert.equal(t1.getMinutes(), 0);
assert.equal(t1.getSeconds(), 0);

// 2. 今天已过的时间 → 顺延明天
const t2 = parseTargetTime("09:00", now);
assert.ok(t2);
assert.equal(t2.getDate(), 8);
assert.equal(t2.getHours(), 9);

// 3. 正好等于当前时刻 → 顺延明天（不能定在过去/当下）
const t3 = parseTargetTime("09:40", now);
assert.ok(t3);
assert.equal(t3.getDate(), 8);

// 4. 边界值合法
assert.ok(parseTargetTime("00:00", now));
assert.ok(parseTargetTime("23:59", now));

// 5. 非法输入 → null
assert.equal(parseTargetTime("24:00", now), null);
assert.equal(parseTargetTime("10:60", now), null);
assert.equal(parseTargetTime("abc", now), null);
assert.equal(parseTargetTime("10", now), null);
assert.equal(parseTargetTime("", now), null);

// 6. 容忍空格与个位小时
const t6 = parseTargetTime(" 9:05 ", now);
assert.ok(t6);
assert.equal(t6.getHours(), 9);
assert.equal(t6.getMinutes(), 5);
assert.equal(t6.getDate(), 8); // 9:05 已过 → 明天

console.log("✅ parseTargetTime 单测全部通过");
