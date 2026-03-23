import { HexTile, HarborType, TileType } from './types'

// Standard Catan 19-tile hex layout in axial coordinates
// Center, inner ring (6), outer ring (12)
const LAND_POSITIONS: [number, number][] = [
  // Center
  [0, 0],
  // Inner ring (clockwise from east)
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  // Outer ring (clockwise from east-east)
  [2, 0], [2, -1], [2, -2], [1, -2], [0, -2],
  [-1, -1], [-2, 0], [-2, 1], [-2, 2], [-1, 2], [0, 2], [1, 1],
]

// Water ring surrounding the land tiles
const WATER_POSITIONS: [number, number][] = [
  [3, 0], [3, -1], [3, -2], [3, -3],
  [2, -3], [1, -3], [0, -3],
  [-1, -2], [-2, -1], [-3, 0],
  [-3, 1], [-3, 2], [-3, 3],
  [-2, 3], [-1, 3], [0, 3],
  [1, 2], [2, 1],
]

// Standard tile distribution
const TILE_DISTRIBUTION: TileType[] = [
  'desert',  // center traditionally
  'wood', 'wood', 'wood', 'wood',
  'wool', 'wool', 'wool', 'wool',
  'wheat', 'wheat', 'wheat', 'wheat',
  'brick', 'brick', 'brick',
  'ore', 'ore', 'ore',
]

// Number token distribution (spiral placement order)
// Standard Catan uses alphabetical placement: A-R around the spiral
const NUMBER_TOKENS: number[] = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11,
]

export function createStandardBoard(): HexTile[] {
  const tiles: HexTile[] = []

  // Place land tiles
  // Desert goes to center (index 0), rest get shuffled distribution
  const landTypes = [...TILE_DISTRIBUTION]
  // Put desert at center
  const desertIdx = landTypes.indexOf('desert')
  landTypes.splice(desertIdx, 1)
  landTypes.unshift('desert')

  let numberIdx = 0
  for (let i = 0; i < LAND_POSITIONS.length; i++) {
    const [q, r] = LAND_POSITIONS[i]
    const type = landTypes[i]
    const tile: HexTile = { q, r, type }

    if (type !== 'desert') {
      tile.number = NUMBER_TOKENS[numberIdx]
      numberIdx++
    }

    tiles.push(tile)
  }

  // Place water tiles
  for (const [q, r] of WATER_POSITIONS) {
    tiles.push({ q, r, type: 'water' })
  }

  return tiles
}

// ─── Harbor Definitions ──────────────────────────────────────────────────────

export interface HarborDef {
  q: number      // water tile axial q
  r: number      // water tile axial r
  landQ: number  // adjacent land tile q (the tile the dock faces)
  landR: number  // adjacent land tile r
  type: HarborType
  rotation: number  // Y-axis rotation in radians, facing toward adjacent land
}

// Standard Catan harbor positions — clockwise from top-right.
// Rotations computed via atan2(dx, dz) from harbor to midpoint of adjacent land tiles.
export const HARBOR_DEFS: HarborDef[] = [
  { q:  3, r: -2, landQ:  2, landR: -1, type: 'ore',   rotation: -1.5708 },
  { q:  3, r: -3, landQ:  2, landR: -2, type: '3:1',   rotation: -1.0472 },
  { q:  1, r: -3, landQ:  1, landR: -2, type: '3:1',   rotation: -0.5236 },
  { q: -1, r: -2, landQ: -1, landR: -1, type: 'wool',  rotation:  0.5236 },
  { q: -3, r:  0, landQ: -2, landR:  0, type: '3:1',   rotation:  1.0472 },
  { q: -3, r:  2, landQ: -2, landR:  1, type: 'brick', rotation:  1.5708 },
  { q: -1, r:  3, landQ:  0, landR:  2, type: '3:1',   rotation:  2.6180 },
  { q:  1, r:  2, landQ:  1, landR:  1, type: 'wheat', rotation: -2.6180 },
  { q:  2, r:  1, landQ:  2, landR:  0, type: 'wood',  rotation: -2.6180 },
]

// Axial hex coordinate to world position
export function axialToWorld(q: number, r: number, size: number = 2.6): { x: number; z: number } {
  const x = size * (3 / 2 * q)
  const z = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r)
  return { x, z }
}
