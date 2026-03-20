import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3 } from '@babylonjs/core'
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

// Target radius for a tile to fit within a hex cell
const TARGET_TILE_DIAMETER = 4.0 // ~2.0 unit radius → 4.0 diameter

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<Mesh> {
  const cached = meshCache.get(tileType)
  if (cached) {
    return cached
  }

  const stlFile = TILE_STL_MAP[tileType]
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', stlFile, scene)
  const mesh = result.meshes[0] as Mesh

  // STL files from 3D printing are typically Z-up; Babylon.js is Y-up.
  // Rotate -90° around X to convert Z-up → Y-up (flat on XZ plane).
  mesh.rotation = new Vector3(-Math.PI / 2, 0, 0)
  // Bake the rotation into vertices so clones inherit correct geometry
  mesh.bakeCurrentTransformIntoVertices()

  // Compute bounding box and auto-scale to fit within hex cell
  mesh.refreshBoundingInfo()
  const bounds = mesh.getBoundingInfo().boundingBox
  const extents = bounds.maximumWorld.subtract(bounds.minimumWorld)
  // Use the largest horizontal dimension (X or Z) to determine scale
  const maxHorizontal = Math.max(extents.x, extents.z)
  const scaleFactor = maxHorizontal > 0 ? TARGET_TILE_DIAMETER / maxHorizontal : 1
  mesh.scaling.setAll(scaleFactor)
  mesh.bakeCurrentTransformIntoVertices()

  // Re-center the mesh so its bounding box center sits at the origin
  mesh.refreshBoundingInfo()
  const newBounds = mesh.getBoundingInfo().boundingBox
  const center = newBounds.centerWorld
  mesh.position = new Vector3(-center.x, -center.y, -center.z)
  mesh.bakeCurrentTransformIntoVertices()

  // Hide the original - we'll clone it
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

    // Position using axial-to-world conversion
    const { x, z } = axialToWorld(tile.q, tile.r)
    instance.position.x = x
    instance.position.z = z
    instance.position.y = 0

    // Apply material
    instance.material = getOrCreateMaterial(scene, tile.type)
  }
}
