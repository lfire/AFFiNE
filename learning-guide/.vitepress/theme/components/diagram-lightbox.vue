<script setup lang="ts">
/**
 * 图表放大弹层：双击正文里的 Mermaid 图后打开，可缩放、拖动，Esc 关闭。
 * 通过 Teleport 挂到 body，避免被正文容器的 overflow / transform 裁剪。
 * 弹层尺寸用 transform 缩放，缩放点始终跟随鼠标，平移用 pointer 事件（同时支持触屏拖动）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ open: boolean; svg: string }>();
const emit = defineEmits<{ close: [] }>();

const MIN_SCALE = 0.15;
const MAX_SCALE = 8;
/** 适应窗口时四周留的空白 */
const EDGE_PADDING = 40;
/** 初始"适应窗口"最多放大到这个倍数，避免小图被拉得过大 */
const FIT_MAX_SCALE = 2.5;
/** 双击放大的倍数 */
const DBLCLICK_SCALE = 1.8;

const viewport = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const scale = ref(1);
const tx = ref(0);
const ty = ref(0);
const dragging = ref(false);
const overflowing = ref(false);
/** 图表的自然尺寸（取自 viewBox） */
const natural = ref({ w: 1, h: 1 });
/** 用户是否手动缩放过：没动过就跟着窗口变化重新适应 */
let adjusted = false;
let origin = { x: 0, y: 0 };

const percent = computed(() => Math.round(scale.value * 100));
const transform = computed(
  () => `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`
);

function close() {
  emit('close');
}

/** 读出图表自然尺寸，并解除 mermaid 写在 svg 上的宽度限制，交由 transform 控制 */
function measure() {
  const svg = inner.value?.querySelector('svg') ?? null;
  if (!svg) return;
  const vb = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const w = vb.length === 4 ? vb[2] : 0;
  const h = vb.length === 4 ? vb[3] : 0;
  natural.value =
    w > 0 && h > 0 ? { w, h } : { w: svg.clientWidth || 1, h: svg.clientHeight || 1 };
  svg.style.setProperty('max-width', 'none', 'important');
  svg.style.setProperty('width', `${natural.value.w}px`, 'important');
  svg.style.setProperty('height', 'auto', 'important');
}

/**
 * 摆放图表：放得下就居中；放不下就贴左上角（流程图一般从左到右读），
 * 这样打开时看到的是开头，而不是被截在中间。
 */
function align() {
  const vp = viewport.value;
  if (!vp) return;
  const w = natural.value.w * scale.value;
  const h = natural.value.h * scale.value;
  tx.value =
    w > vp.clientWidth - EDGE_PADDING * 2 ? EDGE_PADDING : (vp.clientWidth - w) / 2;
  ty.value =
    h > vp.clientHeight - EDGE_PADDING * 2 ? EDGE_PADDING : (vp.clientHeight - h) / 2;
  refreshOverflow();
}

/** 缩放到刚好放得下（整图） */
function fit() {
  const vp = viewport.value;
  if (!vp) return;
  const aw = Math.max(vp.clientWidth - EDGE_PADDING * 2, 80);
  const ah = Math.max(vp.clientHeight - EDGE_PADDING * 2, 80);
  const raw = Math.min(aw / natural.value.w, ah / natural.value.h);
  scale.value = Math.min(Math.max(raw, MIN_SCALE), FIT_MAX_SCALE);
  adjusted = false;
  align();
}

/**
 * 打开时的默认比例：整图放得下就放大到适应窗口；放不下就按 100% 显示——
 * 宽图硬缩到整屏会把文字压得看不清，宁可让用户拖动。
 */
function initial() {
  const vp = viewport.value;
  if (!vp) return;
  const aw = Math.max(vp.clientWidth - EDGE_PADDING * 2, 80);
  const ah = Math.max(vp.clientHeight - EDGE_PADDING * 2, 80);
  const raw = Math.min(aw / natural.value.w, ah / natural.value.h);
  scale.value = Math.min(Math.max(raw, 1), FIT_MAX_SCALE);
  adjusted = false;
  align();
}

/** 1:1，即图表原始像素尺寸 */
function actual() {
  zoomAt(1, viewport.value?.clientWidth ?? 0, viewport.value?.clientHeight ?? 0);
}

/** 以视口内的 (px, py) 为不动点缩放到 next */
function zoomAt(next: number, px: number, py: number) {
  const target = Math.min(Math.max(next, MIN_SCALE), MAX_SCALE);
  const ratio = target / scale.value;
  tx.value = px - (px - tx.value) * ratio;
  ty.value = py - (py - ty.value) * ratio;
  scale.value = target;
  adjusted = true;
  refreshOverflow();
}

function zoomBy(factor: number) {
  const vp = viewport.value;
  if (!vp) return;
  zoomAt(scale.value * factor, vp.clientWidth / 2, vp.clientHeight / 2);
}

function zoomIn() {
  zoomBy(1.25);
}

function zoomOut() {
  zoomBy(1 / 1.25);
}

function onWheel(event: WheelEvent) {
  const vp = viewport.value;
  if (!vp) return;
  const rect = vp.getBoundingClientRect();
  zoomAt(
    scale.value * Math.exp(-event.deltaY * 0.0015),
    event.clientX - rect.left,
    event.clientY - rect.top
  );
}

/** 图表当前是否超出可视区（超出时提示可以拖动） */
function refreshOverflow() {
  const vp = viewport.value;
  if (!vp) return;
  overflowing.value =
    natural.value.w * scale.value > vp.clientWidth ||
    natural.value.h * scale.value > vp.clientHeight;
}

function pan(dx: number, dy: number) {
  tx.value += dx;
  ty.value += dy;
  adjusted = true;
  refreshOverflow();
}

/** 双击：未动过就按光标位置放大，已经放大过就还原到打开时的比例 */
function onDoubleClick(event: MouseEvent) {
  const vp = viewport.value;
  if (!vp) return;
  if (adjusted) {
    initial();
    return;
  }
  const rect = vp.getBoundingClientRect();
  zoomAt(
    scale.value * DBLCLICK_SCALE,
    event.clientX - rect.left,
    event.clientY - rect.top
  );
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  dragging.value = true;
  origin = { x: event.clientX, y: event.clientY };
  viewport.value?.setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return;
  tx.value += event.clientX - origin.x;
  ty.value += event.clientY - origin.y;
  origin = { x: event.clientX, y: event.clientY };
  adjusted = true;
  refreshOverflow();
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  viewport.value?.releasePointerCapture(event.pointerId);
}

function onKey(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomIn();
  } else if (event.key === '-') {
    event.preventDefault();
    zoomOut();
  } else if (event.key === '0') {
    event.preventDefault();
    fit();
  } else if (event.key.startsWith('Arrow')) {
    event.preventDefault();
    const step = 60;
    if (event.key === 'ArrowLeft') pan(step, 0);
    else if (event.key === 'ArrowRight') pan(-step, 0);
    else if (event.key === 'ArrowUp') pan(0, step);
    else pan(0, -step);
  }
}

function onResize() {
  if (props.open && !adjusted) initial();
}

/** 弹层打开时锁住页面滚动，关闭时恢复（补上滚动条宽度，避免页面横向跳动） */
function lockScroll(on: boolean) {
  const root = document.documentElement;
  if (on) {
    const barWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (barWidth > 0) root.style.paddingRight = `${barWidth}px`;
  } else {
    root.style.overflow = '';
    root.style.paddingRight = '';
  }
}

watch(
  () => props.open,
  open => {
    lockScroll(open);
    if (!open) return;
    void nextTick(() => {
      measure();
      initial();
    });
  }
);

// 明暗主题切换会重新生成 svg，尺寸可能变化
watch(
  () => props.svg,
  () => {
    if (!props.open) return;
    void nextTick(() => {
      measure();
      if (!adjusted) initial();
    });
  }
);

onMounted(() => {
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  if (props.open) lockScroll(true);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  lockScroll(false);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="dl">
      <div
        v-if="open"
        class="dl"
        role="dialog"
        aria-modal="true"
        aria-label="图表放大预览"
        @click.self="close"
      >
        <div class="dl__bar">
          <span class="dl__title">图表放大预览</span>
          <div class="dl__tools">
            <button type="button" aria-label="缩小" title="缩小（-）" @click="zoomOut">
              −
            </button>
            <span class="dl__pct">{{ percent }}%</span>
            <button type="button" aria-label="放大" title="放大（+）" @click="zoomIn">
              +
            </button>
            <button type="button" title="适应窗口（0）" @click="fit">适应窗口</button>
            <button type="button" title="原始大小" @click="actual">1:1</button>
            <button
              type="button"
              class="dl__close"
              aria-label="关闭"
              title="关闭（Esc）"
              @click="close"
            >
              ✕
            </button>
          </div>
        </div>

        <div
          ref="viewport"
          class="dl__viewport"
          :class="{ 'is-dragging': dragging }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel.prevent="onWheel"
          @dblclick="onDoubleClick"
        >
          <div ref="inner" class="dl__inner" :style="{ transform }" v-html="svg" />
        </div>

        <div class="dl__hint">
          <template v-if="overflowing">
            图表超出屏幕：按住拖动或按方向键移动，点「适应窗口」看全貌 · 滚轮或双击缩放 · Esc 关闭
          </template>
          <template v-else>滚轮或双击缩放 · 按住拖动 · Esc 关闭</template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
