import { computed, reactive, watch } from "vue";
import type { StageDocument } from "../../../shared/types";
import type { SceneStore } from "../../scenes/model/sceneStore";
import type { LiveControls } from "../../live/model/controls";
import type { AudioEngine } from "../../audio/model/engine";
import { clamp } from "../../../shared/math";
import { parseMidi, pickup, type MidiMsg } from "../lib/midi";
import { PARAMS, SLOTS, slotByKey } from "./slots";
import type { MidiBinding, MidiDevice, MidiStatus, SlotDef } from "./types";

const STORAGE_KEY = "resonance:midi-map:v1";
const LEARN_TIMEOUT = 15000;

interface StoredMap {
  version: 1;
  bindings: Record<string, MidiBinding>;
}

interface Takeover {
  synced: boolean;
  last: number | null;
}

export function createMidiStore(
  doc: StageDocument,
  scenes: SceneStore,
  controls: LiveControls,
  audio: AudioEngine,
) {
  const state = reactive({
    status: "idle" as MidiStatus,
    devices: [] as MidiDevice[],
    learnSlot: null as string | null,
    notice: "",
  });

  /** 映射表：槽位 → 绑定（null = 未绑定），整套自动持久化到本机 */
  const bindings = reactive<Record<string, MidiBinding | null>>(
    Object.fromEntries(SLOTS.map((s) => [s.key, null])) as Record<
      string,
      MidiBinding | null
    >,
  );

  /** 每个连续参数槽位的软接管状态 */
  const takeover = new Map<string, Takeover>();
  function tk(key: string): Takeover {
    let t = takeover.get(key);
    if (!t) {
      t = { synced: false, last: null };
      takeover.set(key, t);
    }
    return t;
  }
  function resetTakeover(key: string) {
    const t = tk(key);
    t.synced = false;
    t.last = null;
  }

  /** 按住黑场：槽位 → 按下前的黑场状态（松手恢复） */
  const holds = new Map<string, boolean>();

  let access: MIDIAccess | null = null;
  let noticeTimer = 0;
  let learnTimer = 0;
  /** 标记当前写入来自设备，用于区分“外部输入”，实现最后输入获胜 */
  let midiWriting = false;

  function notice(text: string) {
    state.notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      state.notice = "";
    }, 3200);
  }

  /* ---------- 映射持久化：保存一套映射供下次使用 ---------- */

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as StoredMap;
      if (data?.version !== 1 || typeof data.bindings !== "object") return;
      for (const s of SLOTS) {
        const b = data.bindings[s.key];
        if (
          b &&
          typeof b.device === "string" &&
          (b.kind === "cc" || b.kind === "note") &&
          Number.isInteger(b.channel) &&
          Number.isInteger(b.number)
        )
          bindings[s.key] = {
            device: b.device,
            kind: b.kind,
            channel: b.channel,
            number: b.number,
          };
      }
    } catch {
      /* 存档损坏时忽略，从空白映射开始 */
    }
  }

  function save() {
    try {
      const out: StoredMap = { version: 1, bindings: {} };
      for (const s of SLOTS)
        if (bindings[s.key]) out.bindings[s.key] = bindings[s.key]!;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      /* 存储不可用时静默，映射仍在本会话内有效 */
    }
  }
  watch(bindings, save, { deep: true });

  /* ---------- 输入仲裁：屏幕 / 键盘 / 设备同时操作，最后有效输入获胜 ---------- */

  // 屏幕拖动（或任何非设备来源）改变参数后，对应旋钮立即退回“待接管”，
  // 必须重新越过新值才能再控制，杜绝跳回旧位置。
  for (const s of SLOTS) {
    if (s.action.type !== "param") continue;
    const def = PARAMS[s.action.param];
    watch(
      () => def.get(doc, scenes),
      () => {
        if (!midiWriting) resetTakeover(s.key);
      },
      { flush: "sync" },
    );
  }
  // 切换场景后，场景参数的目标值随之改变：旋钮重新待接管，
  // 且写入始终解析当下活动场景，不会写入已离开的场景。
  watch(
    () => doc.activeId,
    () => {
      resetTakeover("param:sceneIntensity");
      resetTakeover("param:sceneSpeed");
    },
    { flush: "sync" },
  );

  /* ---------- 设备归属：拔出 / 重插 / 同型号交换后需用户确认 ---------- */

  function boundNames(): Set<string> {
    const names = new Set<string>();
    for (const s of SLOTS) {
      const b = bindings[s.key];
      if (b) names.add(b.device);
    }
    return names;
  }

  function refresh() {
    if (!access) return;
    const online = new Map(state.devices.map((d) => [d.id, d]));
    const names = boundNames();
    const next: MidiDevice[] = [];
    access.inputs.forEach((input) => {
      const name = input.name ?? "未知设备";
      // 仍在列表中的保持状态；新出现的设备：若已有映射指向该名称，
      // 一律先挂起待确认，避免重插或交换顺序后误控。
      const prev = online.get(input.id);
      next.push({
        id: input.id,
        name,
        state: prev ? prev.state : names.has(name) ? "pending" : "active",
      });
      input.onmidimessage = (e) => onMessage(input.id, e);
    });
    // 已拔出的设备：释放其按住状态，相关旋钮回到待接管
    for (const old of state.devices) {
      if (next.some((d) => d.id === old.id)) continue;
      releaseHolds(old.name);
      for (const s of SLOTS)
        if (bindings[s.key]?.device === old.name) resetTakeover(s.key);
    }
    state.devices = next;
  }

  function confirm(id: string) {
    const d = state.devices.find((d) => d.id === id);
    if (!d || d.state === "active") return;
    d.state = "active";
    // 物理位置未知，全部重新软接管
    for (const s of SLOTS)
      if (bindings[s.key]?.device === d.name) resetTakeover(s.key);
    notice(`已接管：${d.name}`);
  }

  async function connect() {
    if (!("requestMIDIAccess" in navigator)) {
      state.status = "unsupported";
      return;
    }
    state.status = "connecting";
    try {
      access = await navigator.requestMIDIAccess();
      access.onstatechange = () => refresh();
      state.status = "ready";
      refresh();
    } catch {
      // 拒绝授权：仅停用设备控制，键盘快捷键等原有操作完全不受影响
      access = null;
      state.status = "denied";
    }
  }

  /* ---------- 学习：学习状态不触发任何正式演出动作 ---------- */

  function onEscape(e: KeyboardEvent) {
    if (e.key === "Escape") stopLearn("学习已取消");
  }

  function startLearn(key: string) {
    if (state.learnSlot === key) {
      stopLearn("学习已取消");
      return;
    }
    if (!slotByKey(key)) return;
    state.learnSlot = key;
    clearTimeout(learnTimer);
    learnTimer = window.setTimeout(
      () => stopLearn("学习超时，已取消"),
      LEARN_TIMEOUT,
    );
    window.addEventListener("keydown", onEscape);
  }

  function stopLearn(message?: string) {
    if (!state.learnSlot) return;
    state.learnSlot = null;
    clearTimeout(learnTimer);
    window.removeEventListener("keydown", onEscape);
    if (message) notice(message);
  }

  function capture(slotKey: string, device: string, msg: MidiMsg) {
    const slot = slotByKey(slotKey);
    if (!slot) return;
    if (slot.kind === "param" && msg.kind !== "cc") {
      notice("连续参数请使用旋钮 / 推杆（CC）");
      return;
    }
    if (slot.kind === "trigger" && !msg.pressed) return; // 只记录按下沿
    bindings[slotKey] = {
      device,
      kind: msg.kind,
      channel: msg.channel,
      number: msg.number,
    };
    resetTakeover(slotKey);
    stopLearn();
    notice(
      `已学习：${slot.label} ← ${msg.kind === "cc" ? "CC" : "NOTE"} ${msg.number}`,
    );
  }

  /* ---------- 消息分发 ---------- */

  function onMessage(inputId: string, e: MIDIMessageEvent) {
    const device = state.devices.find((d) => d.id === inputId);
    if (!device || device.state !== "active") return; // 未确认设备一律不响应
    const msg = parseMidi(e.data);
    if (!msg) return;
    if (state.learnSlot) {
      capture(state.learnSlot, device.name, msg);
      return;
    }
    for (const s of SLOTS) {
      const b = bindings[s.key];
      if (!b || b.device !== device.name || b.kind !== msg.kind) continue;
      if (b.channel !== msg.channel || b.number !== msg.number) continue;
      execute(s, msg);
    }
  }

  function execute(slot: SlotDef, msg: MidiMsg) {
    const a = slot.action;
    switch (a.type) {
      case "param": {
        const def = PARAMS[a.param];
        const t = tk(slot.key);
        const target = clamp(
          (def.get(doc, scenes) - def.min) / (def.max - def.min),
        );
        if (!pickup(t.synced, t.last, msg.value, target)) {
          t.last = msg.value;
          return;
        }
        t.synced = true;
        t.last = msg.value;
        midiWriting = true;
        try {
          def.set(doc, scenes, def.min + clamp(msg.value) * (def.max - def.min));
        } finally {
          midiWriting = false;
        }
        break;
      }
      // 以下为触发动作：不做软接管，按下立即响应（紧急黑场同理）
      case "scene":
        if (msg.pressed) {
          const s = doc.scenes[a.index];
          if (s) scenes.select(s.id);
        }
        break;
      case "sceneNext":
        if (msg.pressed) scenes.next();
        break;
      case "blackoutHold":
        if (msg.pressed) {
          if (!holds.has(slot.key)) {
            holds.set(slot.key, doc.blackout);
            doc.blackout = true;
          }
        } else if (holds.has(slot.key)) {
          doc.blackout = holds.get(slot.key)!;
          holds.delete(slot.key);
        }
        break;
      case "blackoutToggle":
        if (msg.pressed) controls.blackout();
        break;
      case "freezeToggle":
        if (msg.pressed) controls.freeze();
        break;
      case "tap":
        if (msg.pressed) controls.tap();
        break;
      case "playToggle":
        if (msg.pressed)
          void (audio.state.playing ? audio.pause() : audio.play());
        break;
    }
  }

  function releaseHolds(device: string) {
    for (const s of SLOTS) {
      if (s.action.type !== "blackoutHold") continue;
      if (bindings[s.key]?.device === device && holds.has(s.key)) {
        doc.blackout = holds.get(s.key)!;
        holds.delete(s.key);
      }
    }
  }

  /* ---------- 映射管理 ---------- */

  function clearSlot(key: string) {
    if (!bindings[key]) return;
    bindings[key] = null;
    resetTakeover(key);
    holds.delete(key);
    notice("已清除该映射");
  }

  function clearAll() {
    for (const s of SLOTS) bindings[s.key] = null;
    takeover.clear();
    holds.clear();
    notice("已清除全部映射");
  }

  function dispose() {
    stopLearn();
    clearTimeout(noticeTimer);
    if (access) {
      access.onstatechange = null;
      access.inputs.forEach((i) => (i.onmidimessage = null));
    }
    holds.clear();
  }

  const activeCount = computed(
    () => state.devices.filter((d) => d.state === "active").length,
  );
  const offlineDevices = computed(() => {
    const online = new Set(state.devices.map((d) => d.name));
    return [...boundNames()].filter((n) => !online.has(n));
  });
  const boundCount = computed(
    () => SLOTS.filter((s) => bindings[s.key]).length,
  );

  load();

  return {
    state,
    bindings,
    activeCount,
    offlineDevices,
    boundCount,
    connect,
    confirm,
    startLearn,
    stopLearn,
    clearSlot,
    clearAll,
    dispose,
  };
}

export type MidiStore = ReturnType<typeof createMidiStore>;
