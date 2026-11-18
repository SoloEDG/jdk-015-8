export interface MidiMsg {
  kind: "cc" | "note";
  channel: number;
  number: number;
  /** 归一化到 0–1（CC 值或力度） */
  value: number;
  /** 按键语义：按下 / 松开 */
  pressed: boolean;
}

/** 解析 MIDI 消息，只关心 CC 与 NOTE，其余（时钟、触后等）忽略 */
export function parseMidi(data: Uint8Array | null): MidiMsg | null {
  if (!data || data.length < 3) return null;
  const status = data[0] & 0xf0;
  const channel = data[0] & 0x0f;
  if (status === 0xb0)
    return {
      kind: "cc",
      channel,
      number: data[1],
      value: data[2] / 127,
      pressed: data[2] >= 64,
    };
  if (status === 0x90)
    return {
      kind: "note",
      channel,
      number: data[1],
      value: data[2] / 127,
      pressed: data[2] > 0,
    };
  if (status === 0x80)
    return { kind: "note", channel, number: data[1], value: 0, pressed: false };
  return null;
}

/** 接管判定阈值：约 1.5 个 MIDI 步进 */
export const PICKUP_EPS = 1.5 / 127;

/**
 * 软接管（pickup）：物理位置与屏幕值不一致时，旋钮必须先“贴近或越过”
 * 当前值才取得控制权，避免刚摸一下就跳回旧位置。
 * @param synced 是否已接管
 * @param last   上一次物理值（用于检测越过），未知时为 null
 * @param next   本次物理值
 * @param target 屏幕当前值（均已归一化）
 */
export function pickup(
  synced: boolean,
  last: number | null,
  next: number,
  target: number,
): boolean {
  if (synced) return true;
  if (Math.abs(next - target) <= PICKUP_EPS) return true;
  return last !== null && (last - target) * (next - target) <= 0;
}
