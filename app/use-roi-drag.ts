"use client";

import { useRef, type PointerEvent } from "react";
import type { NormalizedBBox } from "@/lib/review-schema";

type Drag = {
  mode: "move" | "resize" | "draw";
  startX: number;
  startY: number;
  origin: NormalizedBBox;
};

const clamp = (n: number, lower = 0, upper = 1) => Math.max(lower, Math.min(upper, n));

function localPoint(event: PointerEvent<SVGSVGElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp((event.clientY - rect.top) / Math.max(1, rect.height))
  };
}

function moved(a: NormalizedBBox, b: NormalizedBBox) {
  return [a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h].some((n) => Math.abs(n) > 0.000001);
}

/** A click without movement leaves the user's previous confirmation intact. */
export function useRoiDrag(options: {
  roi: NormalizedBBox;
  disabled: boolean;
  onChange: (next: NormalizedBBox) => void;
  onCommit: () => void;
}) {
  const drag = useRef<Drag | null>(null);
  const latest = useRef(options.roi);
  latest.current = options.roi;

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (options.disabled) return;
    event.preventDefault();
    const p = localPoint(event);
    const roi = latest.current;
    const corner = Math.abs(p.x - roi.x - roi.w) < 0.035 && Math.abs(p.y - roi.y - roi.h) < 0.035;
    const inside = p.x >= roi.x && p.x <= roi.x + roi.w && p.y >= roi.y && p.y <= roi.y + roi.h;
    drag.current = {
      mode: corner ? "resize" : inside ? "move" : "draw",
      startX: p.x, startY: p.y, origin: { ...roi }
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || options.disabled) return;
    const p = localPoint(event);
    let next: NormalizedBBox;
    if (current.mode === "move") {
      next = {
        ...current.origin,
        x: clamp(current.origin.x + p.x - current.startX, 0, 1 - current.origin.w),
        y: clamp(current.origin.y + p.y - current.startY, 0, 1 - current.origin.h)
      };
    } else if (current.mode === "resize") {
      next = {
        ...current.origin,
        w: clamp(p.x - current.origin.x, 0.02, 1 - current.origin.x),
        h: clamp(p.y - current.origin.y, 0.02, 1 - current.origin.y)
      };
    } else {
      const x = Math.min(p.x, current.startX);
      const y = Math.min(p.y, current.startY);
      next = {
        x, y,
        w: clamp(Math.abs(p.x - current.startX), 0.02, 1 - x),
        h: clamp(Math.abs(p.y - current.startY), 0.02, 1 - y)
      };
    }
    if (moved(next, latest.current)) {
      latest.current = next;
      options.onChange(next);
    }
  }

  function onPointerUp(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (moved(current.origin, latest.current)) options.onCommit();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onPointerCancel(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (moved(current.origin, latest.current)) options.onChange(current.origin);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}
