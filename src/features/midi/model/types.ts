export type ParamId =
  | "master"
  | "gain"
  | "sensitivity"
  | "smoothing"
  | "transition"
  | "sceneIntensity"
  | "sceneSpeed";

export type MidiAction =
  | { type: "param"; param: ParamId }
  | { type: "scene"; index: number }
  | { type: "sceneNext" }
  | { type: "blackoutHold" }
  | { type: "blackoutToggle" }
  | { type: "freezeToggle" }
  | { type: "tap" }
  | { type: "playToggle" };

export type BindingKind = "cc" | "note";

export interface MidiBinding {
  /** 设备名。MIDI 端口 id 会随插拔/交换顺序变化，只有名称可跨会话对应 */
  device: string;
  kind: BindingKind;
  channel: number;
  number: number;
}

export interface SlotDef {
  key: string;
  label: string;
  kind: "param" | "trigger";
  action: MidiAction;
}

export type MidiStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "denied"
  | "unsupported";

export interface MidiDevice {
  id: string;
  name: string;
  /** pending = 出现过的绑定指向该名称，需用户确认归属后才响应 */
  state: "pending" | "active";
}
