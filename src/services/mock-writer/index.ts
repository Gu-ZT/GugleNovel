/**
 * Mock 流式小说生成器（前端原型专用）。
 * 不发起任何网络请求，按 40~80ms 节奏逐段吐出占位文本，
 * 用于在接入真实 transport 前验证流式渲染、停止与分支交互。
 */

export interface MockWriteCallbacks {
  onChunk(text: string): void;
  onDone(fullText: string): void;
}

export interface MockWriteHandle {
  stop(): void;
}

const OPENING_POOL = [
  "夜色像一块浸了水的绒布，沉沉地压在小镇上空。",
  "雨是在黄昏时分落下的，先是试探性的几滴，继而连成一片灰白的帘幕。",
  "老钟楼的指针停在三点十七分，已经停了整整七年。",
  "风从北方来，翻过山脊时捎来了雪的信件。",
];

const SCENE_POOL = [
  "她推开那扇吱呀作响的木门，门后的黑暗比想象中更浓稠，仿佛有人把整夜的墨都倒进了这间屋子。",
  "街角的灯光在雨幕里晕开，像一枚被水泡软的铜币。他站在灯下，影子被拉得很长，长得能触到巷子另一端。",
  "桌上摊着一封没有署名的信，信纸边缘已经泛黄，字迹却锋利得像刚写上去的一样。",
  "远处的汽笛声穿过浓雾传来，一声，又一声，像是在为某个不肯靠岸的人计数。",
];

const DIALOG_POOL = [
  "“你终于来了。”她说，声音很轻，却让整个房间的温度都降了下来，“我等这句话，等了比一生还要久。”",
  "“别回头。”他压低声音，“无论听到什么，都别回头。”",
  "“真相不在档案里，”老人敲了敲自己的太阳穴，“在这里。可惜，打开它的钥匙早就丢了。”",
];

const NARRATION_POOL = [
  "有些决定一旦做出，就像钉子钉进木头，拔出来时总会留下一个洞。",
  "时间在这一刻变得粘稠，每一秒都被拉长，长到足以让她看清灰尘在光柱里缓缓旋转的轨迹。",
  "他想起很多年前的那个下午，阳光、蝉鸣、还有一句没有说完的话。记忆是最不守信用的证人，总在关键时刻篡改证词。",
  "后来人们提起那一夜，都会不自觉地压低声音，仿佛声音大一点，就会惊动什么沉睡在暗处的东西。",
];

function pick<T>(pool: T[], seed: number): T {
  return pool[Math.abs(seed) % pool.length];
}

/** 依据用户输入与分支序号生成确定中带变化的 Mock 正文段落。 */
export function composeMockNovel(userInput: string, siblingIndex: number): string[] {
  const seed = userInput.length * 31 + siblingIndex * 17 + userInput.charCodeAt(0 || 0);
  const cue = userInput.trim().slice(0, 24);
  const segments = [
    pick(OPENING_POOL, seed),
    pick(SCENE_POOL, seed + 1),
    cue ? `——这一切，都要从“${cue}”说起。` : pick(NARRATION_POOL, seed + 2),
    pick(DIALOG_POOL, seed + 3),
    pick(NARRATION_POOL, seed + 4),
    "（Mock 生成 · 本段为原型占位文本，接入真实模型后由 AI 续写）",
  ];
  return segments;
}

/** 以伪流式方式播放段落，返回可停止的句柄。 */
export function mockStreamWrite(
    userInput: string,
    siblingIndex: number,
    callbacks: MockWriteCallbacks
): MockWriteHandle {
  const segments = composeMockNovel(userInput, siblingIndex);
  let index = 0;
  let buffer = "";
  let timer: number | null = null;
  const tick = () => {
    if (index >= segments.length) {
      callbacks.onDone(buffer);
      return;
    }
    const piece = segments[index++];
    buffer += (buffer ? "\n\n" : "") + piece;
    callbacks.onChunk(buffer);
    timer = window.setTimeout(tick, 40 + Math.random() * 40);
  };
  timer = window.setTimeout(tick, 120);
  return {
    stop() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      callbacks.onDone(buffer);
    },
  };
}
