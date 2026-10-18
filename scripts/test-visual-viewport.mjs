/* eslint-disable no-console */
// 逻辑验证：状态栏、导航条和输入法共用一份原生 inset 快照，页面不得重复扣减。

const {applyViewportLayout, calculateViewportLayout} = await import(
    new URL("./viewport-bundle.mjs", import.meta.url).href
);

const emptyInset = {top: 0, right: 0, bottom: 0, left: 0, keyboard: 0};
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
function cssPixel(name) {
  return Number.parseFloat(app.style.getPropertyValue(name) || "0");
}
function assertLayout(layout, expected, message) {
  const matches = Object.entries(expected).every(([key, value]) => layout[key] === value);
  assert(matches, `${message}: ${JSON.stringify(layout)}`);
}

const portrait = calculateViewportLayout({height: 844, offsetTop: 0}, 844, emptyInset);
assertLayout(portrait, {height: 844, top: 0, bottom: 0, left: 0, right: 0}, "无系统栏时使用完整视口");

const statusBar = calculateViewportLayout({height: 844, offsetTop: 0}, 844, {
  ...emptyInset,
  top: 24,
});
assertLayout(statusBar, {height: 844, top: 24, bottom: 0}, "状态栏 inset 作为顶部避让");

const threeButtonNav = calculateViewportLayout({height: 844, offsetTop: 0}, 844, {
  ...emptyInset,
  bottom: 48,
});
assertLayout(threeButtonNav, {height: 844, top: 0, bottom: 48}, "三键导航条作为底部避让");

const bothBars = calculateViewportLayout({height: 844, offsetTop: 0}, 844, {
  ...emptyInset,
  top: 24,
  bottom: 48,
  left: 2,
  right: 3,
});
assertLayout(bothBars, {height: 844, top: 24, bottom: 48, left: 2, right: 3}, "横屏方向 inset 一并应用");

const keyboardWithNav = calculateViewportLayout({height: 450, offsetTop: 394}, 844, {
  ...emptyInset,
  top: 24,
  bottom: 48,
  keyboard: 344,
});
assertLayout(
    keyboardWithNav,
    {height: 450, top: 24, bottom: 344},
    "键盘打开时底部只避让键盘与导航中的较大值",
);
const mobileKeyboardWithNav = calculateViewportLayout({height: 450, offsetTop: 394}, 844, {
  ...emptyInset,
  top: 24,
  bottom: 48,
  keyboard: 420,
});
assertLayout(
    mobileKeyboardWithNav,
    {height: 450, top: 24, bottom: 420},
    "移动端键盘覆盖导航条时使用键盘底部避让",
);

const keyboardAboveNav = calculateViewportLayout({height: 300, offsetTop: 0}, 844, {
  ...emptyInset,
  bottom: 48,
  keyboard: 420,
});
assertLayout(keyboardAboveNav, {height: 300, top: 0, bottom: 420}, "键盘底部与安全区一并上报");

const desktopKeyboard = calculateViewportLayout(
    {height: 500, offsetTop: 0},
    844,
    {...emptyInset, keyboard: 300},
    false,
);
assertLayout(desktopKeyboard, {height: 500, top: 0, bottom: 0}, "桌面窗口不把键盘高度额外写入 Tab Bar");

applyViewportLayout(app, bothBars);
assert(cssPixel("--viewport-height") === 844, "输出统一视口高度变量");
assert(cssPixel("--system-inset-top") === 24, "输出顶部系统栏变量");
assert(cssPixel("--system-inset-right") === 3, "输出右侧方向系统栏变量");
assert(cssPixel("--system-inset-bottom") === 48, "输出底部导航条变量");
assert(cssPixel("--system-inset-left") === 2, "输出左侧方向系统栏变量");

const keyboardClosed = calculateViewportLayout({height: 844, offsetTop: 0}, 844, {
  ...bothBars,
  keyboard: 0,
});
applyViewportLayout(app, keyboardClosed);
assert(cssPixel("--system-inset-bottom") === 48, "键盘收起后恢复导航条避让");
assert(cssPixel("--system-inset-top") === 24, "键盘收起后保留状态栏避让");

console.log(failed ? "SOME TESTS FAILED" : "ALL TESTS PASSED");
process.exit(failed ? 1 : 0);
