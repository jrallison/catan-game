import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3, VertexBuffer } from '@babylonjs/core'
import '@babylonjs/loaders/STL'
import { HexTile, TileType } from './types'
import { axialToWorld } from './board'

const TILE_COLORS: Record<TileType, string> = {
  wood:         '#2d5a1b',
  wool:         '#7ecf3f',
  wheat:        '#e8c84a',
  brick:        '#b5432a',
  ore:          '#6b7c8c',
  desert:       '#d4b86a',
  water:        '#1a5fa8',
  harbor_water: '#1a5fa8',
}

const TILE_STL_MAP: Record<TileType, string> = {
  wood:         'wood.stl',
  wool:         'wool.stl',
  wheat:        'wheet.stl',
  brick:        'brick.stl',
  ore:          'ore.stl',
  desert:       'desert.stl',
  water:        'water.stl',
  harbor_water: 'harbor_water.stl',
}

// Tile corner-to-corner diameter in world units.
// axialToWorld size=2.1 → adjacent centers 2.1*sqrt(3) ≈ 3.637 apart (edge-to-edge = inradius*2).
// Circumradius = inradius / (sqrt(3)/2) → circumdiameter (corner-to-corner) = 3.637 / 0.866 ≈ 4.2
const TARGET_TILE_DIAMETER = 4.2

interface TileTemplate {
  mesh: Mesh
  scale: number   // uniform scale to apply on each instance
  cx: number      // X centering offset (in native STL units)
  cy: number      // Y base offset (in native STL units)
  cz: number      // Z centering offset (in native STL units)
}

const meshCache: Map<TileType, TileTemplate> = new Map()

function hexColorToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<TileTemplate> {
  const cached = meshCache.get(tileType)
  if (cached) return cached

  const result = await SceneLoader.ImportMeshAsync('', '/assets/', TILE_STL_MAP[tileType], scene)

  // Find first mesh with actual geometry (may not be index 0)
  let mesh: Mesh = result.meshes[0] as Mesh
  for (const m of result.meshes) {
    const asMesh = m as Mesh
    if (asMesh.getVerticesData?.(VertexBuffer.PositionKind)) {
      mesh = asMesh
      break
    }
  }

  // Read raw vertex positions to compute bounds
  // Babylon's STL loader converts Z-up → Y-up, so the tile is already flat in XZ plane:
  //   X & Z are horizontal (hex face), Y is terrain height
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!
  let xMin = Infinity, xMax = -Infinity
  let yMin = Infinity, yMax = -Infinity
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i]   < xMin) xMin = pos[i];   if (pos[i]   > xMax) xMax = pos[i]
    if (pos[i+1] < yMin) yMin = pos[i+1]; if (pos[i+1] > yMax) yMax = pos[i+1]
    if (pos[i+2] < zMin) zMin = pos[i+2]; if (pos[i+2] > zMax) zMax = pos[i+2]
  }

  // Scale: largest horizontal extent → TARGET_TILE_DIAMETER
  const maxHoriz = Math.max(xMax - xMin, zMax - zMin)
  const scale = TARGET_TILE_DIAMETER / maxHoriz

  // Centering offsets (in native units — applied at placement via position)
  const cx = (xMin + xMax) / 2   // center X
  const cy = yMin                 // Y base at 0 (terrain features point up)
  const cz = (zMin + zMax) / 2   // center Z

  // Leave mesh geometry untouched — updateVerticesData silently fails on
  // STL-imported meshes (non-updatable geometry). Use instance transforms instead.
  mesh.parent = null
  mesh.rotationQuaternion = null
  mesh.rotation.copyFromFloats(0, 0, 0)
  mesh.scaling.copyFromFloats(1, 1, 1)
  mesh.position.copyFromFloats(0, 0, 0)
  mesh.setEnabled(false)
  mesh.name = `template_${tileType}`

  const tmpl: TileTemplate = { mesh, scale, cx, cy, cz }
  meshCache.set(tileType, tmpl)
  return tmpl
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
  await Promise.all(uniqueTypes.map(t => loadTileMesh(scene, t)))

  for (const tile of tiles) {
    const tmpl = meshCache.get(tile.type)
    if (!tmpl) continue

    const inst = tmpl.mesh.clone(`tile_${tile.q}_${tile.r}`)
    if (!inst) continue

    inst.setEnabled(true)
    inst.parent = null
    inst.rotationQuaternion = null
    inst.rotation.copyFromFloats(0, 0, 0)

    // Apply scale + centering via mesh transform (vertex data is non-updatable)
    inst.scaling.setAll(tmpl.scale)
    const { x, z } = axialToWorld(tile.q, tile.r)
    inst.position.set(
      x  - tmpl.cx * tmpl.scale,
      0  - tmpl.cy * tmpl.scale,   // base at y=0
      z  - tmpl.cz * tmpl.scale
    )

    inst.material = getOrCreateMaterial(scene, tile.type)
  }
}
