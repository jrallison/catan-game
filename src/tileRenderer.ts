import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3, VertexBuffer } from '@babylonjs/core'
import '@babylonjs/loaders/STL'
import { HexTile, TileType } from './types'
import { axialToWorld } from './board'

// Albedo colors per tile type
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

// Map tile type to STL filename (note: wheat -> wheet.stl per Thingiverse naming)
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

function hexColorToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

// Cache for loaded STL meshes (one per tile type)
const meshCache: Map<TileType, Mesh> = new Map()

// Target corner-to-corner diameter for a hex tile.
// axialToWorld(size=2.1) → adjacent centers 2.1*sqrt(3) ≈ 3.637 apart (edge-to-edge).
// For a regular hex, corner-to-corner = edge-to-edge / (sqrt(3)/2) ≈ 3.637 / 0.866 ≈ 4.2
const TARGET_TILE_DIAMETER = 4.2

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<Mesh> {
  const cached = meshCache.get(tileType)
  if (cached) {
    return cached
  }

  const stlFile = TILE_STL_MAP[tileType]
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', stlFile, scene)

  // STL loader may return a parent TransformNode at [0] with geometry in [1]+.
  // Find the first mesh that actually has vertex data.
  let mesh: Mesh | null = null
  for (const m of result.meshes) {
    const asMesh = m as Mesh
    if (asMesh.getVerticesData && asMesh.getVerticesData(VertexBuffer.PositionKind)) {
      mesh = asMesh
      break
    }
  }
  if (!mesh) {
    mesh = result.meshes[0] as Mesh
  }

  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!

  // Compute raw bounds from vertex data
  let xMin = Infinity, xMax = -Infinity
  let yMin = Infinity, yMax = -Infinity
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < pos.length; i += 3) {
    xMin = Math.min(xMin, pos[i]);     xMax = Math.max(xMax, pos[i])
    yMin = Math.min(yMin, pos[i + 1]); yMax = Math.max(yMax, pos[i + 1])
    zMin = Math.min(zMin, pos[i + 2]); zMax = Math.max(zMax, pos[i + 2])
  }

  // Babylon's STL loader already converts Z-up → Y-up.
  // Loaded vertices are already in Y-up: X & Z are horizontal, Y is terrain height.
  // No rotation needed — just scale and center.
  const xExtent = xMax - xMin   // horizontal width (corner-to-corner)
  const zExtent = zMax - zMin   // horizontal depth (edge-to-edge)
  const maxHoriz = Math.max(xExtent, zExtent)
  const s = TARGET_TILE_DIAMETER / maxHoriz

  const cx = (xMin + xMax) / 2
  const cy = yMin               // base of terrain → Y=0
  const cz = (zMin + zMax) / 2

  // Scale and center in one pass (no rotation needed)
  for (let i = 0; i < pos.length; i += 3) {
    pos[i]     = (pos[i] - cx) * s
    pos[i + 1] = (pos[i + 1] - cy) * s
    pos[i + 2] = (pos[i + 2] - cz) * s
  }
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos)

  // Clear any mesh transform — geometry is already transformed
  mesh.rotationQuaternion = null
  mesh.rotation.copyFromFloats(0, 0, 0)
  mesh.scaling.copyFromFloats(1, 1, 1)
  mesh.position.copyFromFloats(0, 0, 0)
  mesh.refreshBoundingInfo()

  // Detach from any parent TransformNode to avoid inheriting transforms
  mesh.parent = null

  // Hide the original — we'll clone it
  mesh.setEnabled(false)
  mesh.name = `template_${tileType}`
  meshCache.set(tileType, mesh)

  return mesh
}

function createTileMaterial(scene: Scene, tileType: TileType): PBRMaterial {
  const mat = new PBRMaterial(`mat_${tileType}`, scene)
  mat.albedoColor = hexColorToColor3(TILE_COLORS[tileType])
  mat.metallic = 0.1
  mat.roughness = 0.8

  if (tileType === 'water' || tileType === 'harbor_water') {
    mat.alpha = 0.85
  }

  return mat
}

// Material cache
const materialCache: Map<TileType, PBRMaterial> = new Map()

function getOrCreateMaterial(scene: Scene, tileType: TileType): PBRMaterial {
  let mat = materialCache.get(tileType)
  if (!mat) {
    mat = createTileMaterial(scene, tileType)
    materialCache.set(tileType, mat)
  }
  return mat
}

export async function renderTiles(scene: Scene, tiles: HexTile[]): Promise<void> {
  // Pre-load all unique tile type meshes
  const uniqueTypes = [...new Set(tiles.map(t => t.type))]
  await Promise.all(uniqueTypes.map(type => loadTileMesh(scene, type)))

  // Place each tile
  for (const tile of tiles) {
    const template = meshCache.get(tile.type)
    if (!template) continue

    const instance = template.clone(`tile_${tile.q}_${tile.r}`)
    if (!instance) continue

    instance.setEnabled(true)
    instance.parent = null
    instance.rotationQuaternion = null
    instance.rotation.copyFromFloats(0, 0, 0)
    instance.scaling.copyFromFloats(1, 1, 1)

    // Position using axial-to-world conversion
    const { x, z } = axialToWorld(tile.q, tile.r)
    instance.position.set(x, 0, z)

    // Apply material
    instance.material = getOrCreateMaterial(scene, tile.type)
  }
}
