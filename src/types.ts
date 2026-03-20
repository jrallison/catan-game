export type TileType = 'wood' | 'wool' | 'wheat' | 'brick' | 'ore' | 'desert' | 'water' | 'harbor_water'
export type HarborType = 'wood' | 'wool' | 'wheat' | 'brick' | 'ore' | 'generic'
export type ResourceType = 'wood' | 'wool' | 'wheat' | 'brick' | 'ore'

export interface HexTile {
  q: number   // axial coords
  r: number
  type: TileType
  number?: number    // 2-12 (no 7)
  harbor?: HarborType
}
