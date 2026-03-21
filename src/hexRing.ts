/**
 * hexRing.ts — Procedural flat-top hexagonal ring mesh for each board tile.
 *
 * Replaces the old landscape base GLBs with geometry we own,
 * so rings tessellate perfectly with no height/geometry mismatches.
 */

import { Scene, Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core'
import { HexTile, TileType } from './types'
import { axialToWorld } from './board'

// ── Geometry constants ────────────────────────────────────────────────────────
const RING_INNER_RADIUS = 2.1   // matches tile hex outer radius (TARGET_TILE_DIAMETER/2)
const RING_OUTER_RADIUS = 2.6   // matches axialToWorld size — rings tessellate at corners
const RING_TOP_Y        = 0.10  // slightly below tile outer rim (0.136) — tiles stand out
const RING_BOTTOM_Y     = 0.0   // flush with board floor

// Bevel: inner edge slopes from tile rim height (0.136) down to RING_TOP_Y (0.10)
const BEVEL_WIDTH = 0.12   // radial width of the slope on the inner edge
const BEVEL_TOP_Y = 0.136  // matches terrain tile outer rim height

// ── Colors per tile type ──────────────────────────────────────────────────────
const RING_COLORS: Partial<Record<TileType, string>> = {
  wood:         '#5d9435',   // forest green
  brick:        '#9e4a28',   // terracotta
  ore:          '#808080',   // medium gray
  wheat:        '#E6B200',   // darker gold — matches wheet tile base (palette 16)
  wool:         '#66FF33',   // light green — matches wool tile base (palette 6)
  desert:       '#FFD966',   // warm sand
  water:        '#1a5a6b',   // deep water blue
  harbor_water: '#1a5a6b',
}

function hexToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

// ── Ring builder ──────────────────────────────────────────────────────────────

function createOneRing(scene: Scene, cx: number, cz: number, colorHex: string, name: string): Mesh {
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []

  // Pre-compute the 6 corner points for each radial ring
  const SIDES = 6
  const outerPts: { x: number; z: number }[] = []
  const bevelPts: { x: number; z: number }[] = []
  const innerPts: { x: number; z: number }[] = []

  for (let i = 0; i < SIDES; i++) {
    const angle = i * Math.PI / 3  // flat-top hex: 0°, 60°, 120°, …
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    outerPts.push({ x: RING_OUTER_RADIUS * cos, z: RING_OUTER_RADIUS * sin })
    bevelPts.push({ x: (RING_INNER_RADIUS + BEVEL_WIDTH) * cos, z: (RING_INNER_RADIUS + BEVEL_WIDTH) * sin })
    innerPts.push({ x: RING_INNER_RADIUS * cos, z: RING_INNER_RADIUS * sin })
  }

  let vi = 0 // vertex index counter

  /**
   * Push a quad (two triangles) with given 4 vertices and a uniform normal.
   * Vertices ordered CW when viewed from the normal direction (Babylon left-handed front face).
   * v0 → v1 → v2 → v3 produces triangles (v0,v1,v2) and (v0,v2,v3).
   */
  function pushQuad(
    v0: [number, number, number],
    v1: [number, number, number],
    v2: [number, number, number],
    v3: [number, number, number],
    n: [number, number, number],
  ): void {
    const base = vi
    positions.push(...v0, ...v1, ...v2, ...v3)
    normals.push(...n, ...n, ...n, ...n)
    // CW in Babylon left-handed (flip from CCW): (0,2,1) and (0,3,2)
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
    vi += 4
  }

  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES

    const o0 = outerPts[i], o1 = outerPts[j]
    const b0 = bevelPts[i], b1 = bevelPts[j]
    const n0 = innerPts[i], n1 = innerPts[j]

    // 1. Flat top quad (outer → bevel outer edge), Y = RING_TOP_Y
    //    Viewed from above (+Y), CW order: o0, b0, b1, o1
    pushQuad(
      [cx + o0.x, RING_TOP_Y, cz + o0.z],
      [cx + b0.x, RING_TOP_Y, cz + b0.z],
      [cx + b1.x, RING_TOP_Y, cz + b1.z],
      [cx + o1.x, RING_TOP_Y, cz + o1.z],
      [0, 1, 0],
    )

    // 2. Bevel quad (slopes from RING_TOP_Y at bevel edge up to BEVEL_TOP_Y at inner edge)
    //    Viewed from above, CW: b0, n0, n1, b1
    //    Normal: approximate as blend of up + outward. Compute outward direction for this segment.
    const midX = (n0.x + n1.x) / 2
    const midZ = (n0.z + n1.z) / 2
    const outLen = Math.sqrt(midX * midX + midZ * midZ) || 1
    const outNx = midX / outLen
    const outNz = midZ / outLen
    // Bevel slopes inward-upward: normal points outward + up
    const bevelNy = 0.7
    const bevelHoriz = 0.714 // √(1 - 0.7²) ≈ 0.714
    const bnx = -outNx * bevelHoriz  // points inward (toward center) since bevel slopes up toward center
    const bnz = -outNz * bevelHoriz
    // Actually the bevel slopes UP toward the inner edge (BEVEL_TOP_Y > RING_TOP_Y),
    // so the face normal points outward + upward from the slope surface.
    // The slope goes from bevel (low, outer) to inner (high, closer to center).
    // Surface normal for an inward-rising slope points outward-and-up.
    const bevelNormal: [number, number, number] = [outNx * bevelHoriz, bevelNy, outNz * bevelHoriz]

    pushQuad(
      [cx + b0.x, RING_TOP_Y, cz + b0.z],
      [cx + n0.x, BEVEL_TOP_Y, cz + n0.z],
      [cx + n1.x, BEVEL_TOP_Y, cz + n1.z],
      [cx + b1.x, RING_TOP_Y, cz + b1.z],
      bevelNormal,
    )

    // 3. Outer wall quad (vertical drop, RING_TOP_Y → RING_BOTTOM_Y)
    //    Viewed from outside, CW: o0 top, o1 top, o1 bottom, o0 bottom
    const wallMidX = (o0.x + o1.x) / 2
    const wallMidZ = (o0.z + o1.z) / 2
    const wallLen = Math.sqrt(wallMidX * wallMidX + wallMidZ * wallMidZ) || 1
    const wallNormal: [number, number, number] = [wallMidX / wallLen, 0, wallMidZ / wallLen]

    pushQuad(
      [cx + o0.x, RING_TOP_Y, cz + o0.z],
      [cx + o1.x, RING_TOP_Y, cz + o1.z],
      [cx + o1.x, RING_BOTTOM_Y, cz + o1.z],
      [cx + o0.x, RING_BOTTOM_Y, cz + o0.z],
      wallNormal,
    )
  }

  // Build mesh
  const mesh = new Mesh(name, scene)
  const vd = new VertexData()
  vd.positions = new Float32Array(positions)
  vd.indices = new Int32Array(indices)
  vd.normals = new Float32Array(normals)
  vd.applyToMesh(mesh, false)

  // Material
  const mat = new StandardMaterial(`ringMat_${name}`, scene)
  mat.diffuseColor = hexToColor3(colorHex)
  mat.specularColor = Color3.Black()
  mat.backFaceCulling = true
  mesh.material = mat

  return mesh
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createHexRings(scene: Scene, tiles: HexTile[]): void {
  for (const tile of tiles) {
    const { x, z } = axialToWorld(tile.q, tile.r)
    const colorHex = RING_COLORS[tile.type] ?? '#888888'
    createOneRing(scene, x, z, colorHex, `ring_${tile.q}_${tile.r}`)
  }
}
