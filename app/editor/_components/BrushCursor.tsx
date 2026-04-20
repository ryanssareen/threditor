import type { ToolId } from '@/lib/editor/store';

/**
 * Produce the CSS `cursor` string for the given tool. Callers set it as
 * an inline `style={{ cursor }}` on the 2D-canvas wrapper element.
 *
 * The SVGs and hot-spots are adopted verbatim from docs/plans/
 * m3-paint-canvas.md §B.2 (Gemini round 5).
 */
export function cursorForTool(tool: ToolId): string {
  switch (tool) {
    case 'pencil':
      return svgCursor(PENCIL_SVG, 16, 16);
    case 'eraser':
      return svgCursor(ERASER_SVG, 16, 16);
    case 'picker':
      return svgCursor(PICKER_SVG, 16, 16);
    case 'bucket':
      return svgCursor(BUCKET_SVG, 10, 22);
  }
}

function svgCursor(svg: string, hx: number, hy: number): string {
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${hx} ${hy}, auto`;
}

const PENCIL_SVG = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 16H20M16 12V20" stroke="white" stroke-width="3"/><path d="M12 16H20M16 12V20" stroke="black" stroke-width="1"/></svg>`;

const ERASER_SVG = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="12" height="12" stroke="white" stroke-width="3"/><rect x="10" y="10" width="12" height="12" stroke="black" stroke-width="1" stroke-dasharray="2 2"/></svg>`;

const PICKER_SVG = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="16" cy="16" r="8" stroke="white" stroke-width="3"/><circle cx="16" cy="16" r="8" stroke="black" stroke-width="1"/><path d="M16 8V12M16 20V24M8 16H12M20 16H24" stroke="white" stroke-width="2"/></svg>`;

const BUCKET_SVG = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 22L22 10M12 10L10 12" stroke="white" stroke-width="3"/><path d="M10 22L22 10M12 10L10 12" stroke="black" stroke-width="1"/></svg>`;
