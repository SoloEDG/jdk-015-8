<script setup lang="ts">
import { ref } from "vue";
import type { MidiStore } from "../model/midiStore";
import { SLOTS } from "../model/slots";

const props = defineProps<{ midi: MidiStore }>();

const paramSlots = SLOTS.filter((s) => s.kind === "param");
const triggerSlots = SLOTS.filter((s) => s.kind === "trigger");

function bindingLabel(key: string) {
  const b = props.midi.bindings[key];
  if (!b) return "未绑定";
  return `${b.kind === "cc" ? "CC" : "NOTE"} ${b.number} · CH${b.channel + 1}`;
}
function bindingTitle(key: string) {
  const b = props.midi.bindings[key];
  return b ? `来自 ${b.device}` : "";
}

const armingClear = ref(false);
let clearTimer = 0;
function clearAll() {
  if (!armingClear.value) {
    armingClear.value = true;
    clearTimer = window.setTimeout(() => (armingClear.value = false), 3000);
    return;
  }
  clearTimeout(clearTimer);
  armingClear.value = false;
  props.midi.clearAll();
}
</script>

<template>
  <section class="panel midi-panel">
    <div class="panel-heading">
      <span>05 / MIDI CONTROL</span>
      <span class="dot" :class="{ on: midi.activeCount.value > 0 }"></span>
    </div>

    <template v-if="midi.state.status === 'idle'">
      <p class="muted midi-status-line">
        接入旋钮 / 推杆 / 按键控制器，学习后即可驱动演出。
        <template v-if="midi.boundCount.value > 0"
          >本机已保存 {{ midi.boundCount.value }} 条映射，连接后生效。</template
        >
      </p>
      <button class="midi-connect" @click="midi.connect">连接控制器</button>
    </template>

    <p v-else-if="midi.state.status === 'connecting'" class="muted midi-status-line">
      正在请求 MIDI 访问…
    </p>

    <template v-else-if="midi.state.status === 'denied'">
      <p role="alert" class="midi-status-line">
        MIDI 访问被拒绝。键盘快捷键不受影响，可继续演出。
      </p>
      <button class="midi-connect" @click="midi.connect">重试连接</button>
    </template>

    <p v-else-if="midi.state.status === 'unsupported'" role="alert" class="midi-status-line">
      此浏览器不支持 Web MIDI，键盘快捷键仍可正常使用。
    </p>

    <template v-else>
      <div
        v-for="d in midi.state.devices"
        :key="d.id"
        class="midi-device"
        :class="{ pending: d.state === 'pending' }"
      >
        <span class="dot" :class="{ on: d.state === 'active' }"></span>
        <div>
          <strong>{{ d.name }}</strong>
          <small>{{ d.state === "active" ? "已接管" : "待确认 · 暂不响应" }}</small>
        </div>
        <button v-if="d.state === 'pending'" @click="midi.confirm(d.id)">
          确认
        </button>
      </div>
      <p v-if="midi.state.devices.length === 0" class="muted midi-status-line">
        未发现设备，请接入控制器。
      </p>
      <p v-if="midi.offlineDevices.value.length" class="muted midi-offline">
        离线：{{ midi.offlineDevices.value.join("、") }}
      </p>

      <h3>连续参数<small>旋钮 / 推杆</small></h3>
      <div
        v-for="s in paramSlots"
        :key="s.key"
        class="midi-map-row"
        :class="{ armed: midi.state.learnSlot === s.key }"
      >
        <div>
          <span>{{ s.label }}</span>
          <em :title="bindingTitle(s.key)">{{
            midi.state.learnSlot === s.key
              ? "转动旋钮或推杆…"
              : bindingLabel(s.key)
          }}</em>
        </div>
        <button @click="midi.startLearn(s.key)">
          {{ midi.state.learnSlot === s.key ? "取消" : "学习" }}
        </button>
        <button
          v-if="midi.bindings[s.key]"
          class="clear-btn"
          aria-label="清除映射"
          @click="midi.clearSlot(s.key)"
        >
          ×
        </button>
      </div>

      <h3>演出动作<small>按键 · 按下即响应</small></h3>
      <div
        v-for="s in triggerSlots"
        :key="s.key"
        class="midi-map-row"
        :class="{ armed: midi.state.learnSlot === s.key }"
      >
        <div>
          <span>{{ s.label }}</span>
          <em :title="bindingTitle(s.key)">{{
            midi.state.learnSlot === s.key
              ? "按下控制器按键…"
              : bindingLabel(s.key)
          }}</em>
        </div>
        <button @click="midi.startLearn(s.key)">
          {{ midi.state.learnSlot === s.key ? "取消" : "学习" }}
        </button>
        <button
          v-if="midi.bindings[s.key]"
          class="clear-btn"
          aria-label="清除映射"
          @click="midi.clearSlot(s.key)"
        >
          ×
        </button>
      </div>

      <p v-if="midi.state.notice" class="midi-notice">{{ midi.state.notice }}</p>

      <div class="midi-foot">
        <small>映射自动保存于本机 · 学习中不触发演出动作</small>
        <button v-if="midi.boundCount.value > 0" @click="clearAll">
          {{ armingClear ? "确认清除？" : "全部清除" }}
        </button>
      </div>
    </template>
  </section>
</template>
