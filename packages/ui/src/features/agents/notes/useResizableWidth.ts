import { useState, type KeyboardEvent, type PointerEvent } from "react";

const MIN = 260;
const STEP = 24;

const read = (key: string, fallback: number) => {
  try {
    const value = Number(localStorage.getItem(key));
    return value >= MIN ? value : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: number) => {
  try {
    localStorage.setItem(key, String(Math.round(value)));
  } catch {
    /* Storage may be unavailable; the width then lasts for the session. */
  }
};

/**
 * Width of a panel on the right of a row, resized by dragging (or arrow keys on) the handle
 * on its left edge. Remembered per browser.
 */
export function useResizableWidth(key: string, initial: number) {
  const [width, setWidth] = useState(() => read(key, initial));
  const clamp = (value: number, row: HTMLElement | null) =>
    Math.max(MIN, Math.min(value, (row?.clientWidth ?? 1200) * 0.6));

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const row = handle.parentElement;
    const startX = event.clientX;
    const startWidth = width;
    let last = width;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: globalThis.PointerEvent) => {
      last = clamp(startWidth + startX - moved.clientX, row);
      setWidth(last);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      write(key, last);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const delta = { ArrowLeft: STEP, ArrowRight: -STEP }[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = clamp(width + delta, event.currentTarget.parentElement);
    setWidth(next);
    write(key, next);
  };
  return { width, handleProps: { onPointerDown, onKeyDown } };
}
