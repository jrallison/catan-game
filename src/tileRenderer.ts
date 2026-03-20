import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3, VertexBuffer } from '@babylonjs/core'
import '@babylonjs/loaders/STL'
import { HexTile, TileType } from './types'
import { axialToWorld } from './board'

const TILE_COLORS: Record<TileType, string> = {
  wood: '#2d5a1b',
  wool: '#7ecf3f',
  wheat: '#e8c84a',
  brick: '#b5432a',
  ore: '#6b7c8c',
  desert: '#d4b86a',
  water: '#1a5fa8',
  harbor_water: '#1a5fa8',
}

const TILE_STL_MAP: Record<TileType, string> = {
  wood: 'wood.stl',
  wool: 'wool.stl',
  wheat: 'wheet.stl',
  brick: 'brick.stl',
  ore: 'ore.stl',
  desert: 'desert.stl',
  water: 'water.stl',
  harbor_water: 'harbor_water.stl',
}

// Tile diameter in world units — must match axialToWorld hex circumradius * 2
// axialToWorld size=2.1 → circumradius=2.1 → diameter=4.2
const TARGET_TILE_DIAMETER = 4.2

function hexColorToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

const meshCache: Map<TileType, Mesh> = new Map()

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<Mesh> {
  const cached = meshCache.get(tileType)
  if (cached) return cached

  const result = await SceneLoader.ImportMeshAsync('', '/assets/', TILE_STL_MAP[tileType], scene)
  const mesh = (result.meshes.find(
    m => m instanceof Mesh && (m as Mesh).getTotalVertices() > 0
  ) ?? result.meshes[0]) as Mesh

  // Babylon's STL loader already converts Z-up → Y-up, so tiles are
  // flat in the XZ plane with Y as the terrain-height axis. No manual
  // rotation needed.

  // Reset any loader-applied scaling so vertex data is authoritative
  mesh.scaling.copyFromFloats(1, 1, 1)

  // Compute local-space bounds
  mesh.refreshBoundingInfo()
  const bb  = mesh.getBoundingInfo().boundingBox
  const ext = bb.maximum.subtract(bb.minimum)

  // The two horizontal extents are X and Z; scale the largest to TARGET_TILE_DIAMETER
  const maxHoriz = Math.max(ext.x, ext.z)
  const s = maxHoriz > 0 ? TARGET_TILE_DIAMETER / maxHoriz : 1

  // Centering offsets: X/Z to origin, Y base to 0
  const cx = (bb.minimum.x + bb.maximum.x) / 2
  const cy =  bb.minimum.y                      // base at y=0
  const cz = (bb.minimum.z + bb.maximum.z) / 2

  // Apply scale + center in one vertex pass
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     = (pos[i]     - cx) * s
    pos[i + 1] = (pos[i + 1] - cy) * s
    pos[i + 2] = (pos[i + 2] - cz) * s
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos)

  mesh.setEnabled(false)
  mesh.name = `template_${tileType}`
  meshCache.set(tileType, mesh)
  return mesh
}

const materialCache: Map<TileType, PBRMaterial> = new Map()

function getOrCreateMaterial(scene: Scene, tileType: TileType): PBRMaterial {
  let mat = materialCache.get(tileType)
  if (!mat) {
    mat = new PBRMaterial(`mat_${tileType}`, scene)
    mat.albedoColor = hexColorToColor3(TILE_COLORS[tileType])
    mat.metallic = 0.1
    mat.roughness = 0.8
    if (tileType === 'water' || tileType === 'harbor_water') mat.alpha = 0.85
    materialCache.set(tileType, mat)
  }
  return mat
}

export async function renderTiles(scene: Scene, tiles: HexTile[]): Promise<void> {
  const uniqueTypes = [...new Set(tiles.map(t => t.type))]
  await Promise.all(uniqueTypes.map(type => loadTileMesh(scene, type)))

  for (const tile of tiles) {
    const tmpl = meshCache.get(tile.type)
    if (!tmpl) continue

    const inst = tmpl.clone(`tile_${tile.q}_${tile.r}`)
    if (!inst) continue

    inst.setEnabled(true)
    inst.rotationQuaternion = null
    inst.rotation = Vector3.Zero()
    inst.scaling  = Vector3.One()

    const { x, z } = axialToWorld(tile.q, tile.r)
    inst.position.set(x, 0, z)
    inst.material = getOrCreateMaterial(scene, tile.type)
  }
}
