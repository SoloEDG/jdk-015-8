import type { StageDocument } from "../../../shared/types";
import type { SceneStore } from "../../scenes/model/sceneStore";
import type { ParamId, SlotDef } from "./types";

export interface ParamDef {
  id: ParamId;
  min: number;
  max: number;
  get(doc: StageDocument, scenes: SceneStore): number;
  set(doc: StageDocument, scenes: SceneStore, value: number): void;
}

/**
 * 连续参数注册表。场景参数（sceneIntensity / sceneSpeed）在读写当下
 * 才解析活动场景，因此切换场景后同一旋钮接管的是新场景的参数，
 * 永远不会写入已经离开的场景。
 */
export const PARAMS: Record<ParamId, ParamDef> = {
  master: {
    id: "master",
    min: 0,
    max: 1,
    get: (d) => d.master,
    set: (d, _s, v) => {
      d.master = v;
    },
  },
  gain: {
    id: "gain",
    min: 0,
    max: 1,
    get: (d) => d.gain,
    set: (d, _s, v) => {
      d.gain = v;
    },
  },
  sensitivity: {
    id: "sensitivity",
    min: 0.3,
    max: 3,
    get: (d) => d.sensitivity,
    set: (d, _s, v) => {
      d.sensitivity = v;
    },
  },
  smoothing: {
    id: "smoothing",
    min: 0,
    max: 0.95,
    get: (d) => d.smoothing,
    set: (d, _s, v) => {
      d.smoothing = v;
    },
  },
  transition: {
    id: "transition",
    min: 0,
    max: 4,
    get: (d) => d.transition,
    set: (d, _s, v) => {
      d.transition = v;
    },
  },
  sceneIntensity: {
    id: "sceneIntensity",
    min: 0.1,
    max: 1.5,
    get: (_d, s) => s.active.value.intensity,
    set: (_d, s, v) => {
      s.active.value.intensity = v;
    },
  },
  sceneSpeed: {
    id: "sceneSpeed",
    min: 0.1,
    max: 2,
    get: (_d, s) => s.active.value.speed,
    set: (_d, s, v) => {
      s.active.value.speed = v;
    },
  },
};

/** 可学习的槽位目录：连续参数用旋钮/推杆（CC），触发动作用按键（NOTE 或 CC） */
export const SLOTS: SlotDef[] = [
  { key: "param:master", label: "舞台亮度", kind: "param", action: { type: "param", param: "master" } },
  { key: "param:gain", label: "监听音量", kind: "param", action: { type: "param", param: "gain" } },
  { key: "param:sensitivity", label: "响应灵敏度", kind: "param", action: { type: "param", param: "sensitivity" } },
  { key: "param:smoothing", label: "频谱平滑", kind: "param", action: { type: "param", param: "smoothing" } },
  { key: "param:transition", label: "场景过渡", kind: "param", action: { type: "param", param: "transition" } },
  { key: "param:sceneIntensity", label: "当前场景 · 视觉强度", kind: "param", action: { type: "param", param: "sceneIntensity" } },
  { key: "param:sceneSpeed", label: "当前场景 · 运动速度", kind: "param", action: { type: "param", param: "sceneSpeed" } },
  { key: "scene:0", label: "场景 1", kind: "trigger", action: { type: "scene", index: 0 } },
  { key: "scene:1", label: "场景 2", kind: "trigger", action: { type: "scene", index: 1 } },
  { key: "scene:2", label: "场景 3", kind: "trigger", action: { type: "scene", index: 2 } },
  { key: "scene:3", label: "场景 4", kind: "trigger", action: { type: "scene", index: 3 } },
  { key: "sceneNext", label: "下一场景", kind: "trigger", action: { type: "sceneNext" } },
  { key: "blackoutHold", label: "按住黑场（松手恢复）", kind: "trigger", action: { type: "blackoutHold" } },
  { key: "blackoutToggle", label: "黑场切换", kind: "trigger", action: { type: "blackoutToggle" } },
  { key: "freezeToggle", label: "冻结切换", kind: "trigger", action: { type: "freezeToggle" } },
  { key: "tap", label: "节拍 TAP", kind: "trigger", action: { type: "tap" } },
  { key: "playToggle", label: "播放 / 暂停", kind: "trigger", action: { type: "playToggle" } },
];

export const slotByKey = (key: string) => SLOTS.find((s) => s.key === key);
