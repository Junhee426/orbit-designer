// Satellite/link/orbit color palette and marker geometry shared by the Cesium renderer
// (viewer.js), the canvas fallback renderer (rendering.js), and the legend (app.js).
export const SAT_COLORS = {
  selected: '#ffffff', best: '#ffb55d', GNSS: '#e3ad65', REGIONAL: '#b4a0ff',
  navUsed: '#47dacb', linked: '#74b6ff', idle: '#53657a',
};
export const LEO_MARKER = '#48d4f0'; // categorical "this is LEO" marker (sky plot), not the state cascade below
export const ORBIT_LINE = '#344f6a';
export const ISL_LINE = '#36685f';
export const FOOTPRINT_LINE = '#84e5df';
export const GROUND_TRACK_LINE = '#e8db91';
export const HEATMAP_EMPTY = '#c45259';
export const HEATMAP_HUE = 172, HEATMAP_SAT = 70; // degrees, percent

// The satellite fill color cascade: selected > best link > GNSS/regional > LEO nav/link state.
// Identical logic in both renderers; kept here once so a color change never drifts between them.
export function satelliteColor({ selected, chosen, group, navUsed, link }) {
  if (selected) return SAT_COLORS.selected;
  if (chosen) return SAT_COLORS.best;
  if (group === 'GNSS') return SAT_COLORS.GNSS;
  if (group === 'REGIONAL') return SAT_COLORS.REGIONAL;
  return navUsed ? SAT_COLORS.navUsed : link ? SAT_COLORS.linked : SAT_COLORS.idle;
}
// Lightness percent for a heatmap cell, 30-60% as visible-satellite count rises to 12+.
export function heatmapLightness(count) {
  return 30 + Math.min(count, 12) / 40 * 100;
}
// CSS rgba() for a shared solid hex color, for the canvas renderer (Cesium takes alpha separately via withAlpha()).
export function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
// Traces a circle/square/diamond marker path centered at (cx,cy) with "radius" r.
// Caller owns beginPath()/fillStyle/fill() so it can set style around the shape as needed.
export function tracePath(ctx, shape, cx, cy, r) {
  if (shape === 'square') ctx.rect(cx - r, cy - r, r * 2, r * 2);
  else if (shape === 'diamond') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath(); }
  else ctx.arc(cx, cy, r, 0, 2 * Math.PI);
}
