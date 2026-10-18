/* eslint-disable no-console */
// 逻辑验证：键盘打开后，应用壳必须跟随实际可视视口，导航栏不能飞到屏幕上方。

const {applyViewportSnapshot} = await import(
    new URL("./viewport-bundle.mjs", import.meta.url).href
);
const app = {
  style: {
    values: new Map(),
    setProperty(name, value) { this.values.set(name, String(value)); },
    getPropertyValue(name) { return this.values.get(name) ?? ""; },
  },
};

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { failed = true; console.error(`FAIL: ${message}`); }
}
function cssValue(name) {
  return Number.parseFloat(app.style.getPropertyValue(name) || "0");
}

applyViewportSnapshot(app, {height: 844, offsetTop: 0});
assert(cssValue("--visual-viewport-height") === 844, "键盘收起时使用完整视口高度");
assert(cssValue("--visual-viewport-offset-top") === 0, "键盘收起时应用壳顶部对齐");

applyViewportSnapshot(app, {height: 494, offsetTop: 350});
assert(cssValue("--visual-viewport-height") === 494, "键盘展开时当前布局视口未缩短，使用可视视口高度");
assert(cssValue("--visual-viewport-offset-top") === 350, "键盘偏移时向下校正，导航栏不飞出屏幕");

applyViewportSnapshot(app, {height: 844, offsetTop: 0});
assert(cssValue("--visual-viewport-height") === 844, "键盘收起后恢复完整视口高度");
assert(cssValue("--visual-viewport-offset-top") === 0, "键盘收起后恢复顶部对齐");

console.log(failed ? "SOME TESTS FAILED" : "ALL TESTS PASSED");
process.exit(failed ? 1 : 0);
