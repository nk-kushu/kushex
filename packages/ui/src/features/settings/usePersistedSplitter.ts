import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { selectSplitterSizes, splitterSizesChanged } from "./settingsSlice";

/**
 * Restores and saves an antd Splitter's panel sizes in the user settings.
 * Spread `splitter` on the Splitter and pass `size(index)` to each panel's `size`.
 * Panels keep their `defaultSize` until sizes are saved for this splitter id.
 */
export function usePersistedSplitter(id: string, panels: number) {
  const dispatch = useAppDispatch();
  const saved = useAppSelector(selectSplitterSizes)[id];
  // Pixel sizes while a drag is in progress; saved as fractions when it ends.
  const [dragging, setDragging] = useState<number[] | null>(null);
  const stored = saved?.length === panels ? saved : undefined;
  return {
    splitter: {
      onResize: setDragging,
      onResizeEnd: (sizes: number[]) => {
        setDragging(null);
        const total = sizes.reduce((sum, size) => sum + size, 0);
        if (total <= 0) return;
        const fractions = sizes.map((size) => Math.round((size / total) * 10_000) / 10_000);
        dispatch(splitterSizesChanged({ id, sizes: fractions }));
      },
    },
    size: (index: number): number | string | undefined =>
      dragging?.[index] ?? (stored ? `${stored[index]! * 100}%` : undefined),
  };
}
