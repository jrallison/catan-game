/**
 * tileGeometry.ts — Shared geometric constants derived from STL analysis.
 *
 * The land tile STLs have a flat circular depression designed to hold a number
 * token. This depression was located by analyzing vertex data across all tile
 * types (see scripts/find_depression_final.py).
 *
 * In raw STL coordinates (X/Y horizontal, Z up):
 *   Center: (9.0, 15.0)   Z surface: 2.4   Radius: 14.0
 *
 * After Babylon's Z→Y conversion and our scaleAndCenter baking:
 *   STL X → world X,  STL Y → world Z,  STL Z → world Y
 *   Scale factor: 4.2 / 74.0 ≈ 0.056757
 */

/** Scale factor applied during vertex baking (TARGET_TILE_DIAMETER / maxHoriz). */
const TILE_SCALE = 4.2 / 74.0

/**
 * Offset from a tile's world position to the center of its number-token
 * depression, in baked world units.
 *
 *   x = raw STL X offset * scale
 *   y = raw STL Z (height) * scale  — the depression surface height
 *   z = raw STL Y offset * scale
 */
export const DEPRESSION_OFFSET = {
  x: 9.0 * TILE_SCALE,   // ≈ 0.5108
  y: 2.4 * TILE_SCALE,   // ≈ 0.1362
  z: 15.0 * TILE_SCALE,  // ≈ 0.8514
} as const

/** Radius of the depression in world units. */
export const DEPRESSION_RADIUS = 14.0 * TILE_SCALE  // ≈ 0.7946
