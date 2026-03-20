import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3, TransformNode } from '@babylonjs/core'
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

interface TileTemplate {
  mesh: Mesh
  yOffset: number
  scale: number
}

const meshCache: Map<TileType, TileTemplate> = new Map()

const TARGET_TILE_DIAMETER = 4.0

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<TileTemplate> {
  const cached = meshCache.get(tileType)
  if (cached) return cached

  const stlFile = TILE_STL_MAP[tileType]
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', stlFile, scene)

  // Find the mesh with actual geometry (may not be index 0)
  const mesh = (result.meshes.find(m => m instanceof Mesh && (m as Mesh).getTotalVertices() > 0) ?? result.meshes[0]) as Mesh

  // Compute raw bounding box to determine scale and centering
  mesh.refreshBoundingInfo()
  const bb = mesh.getBoundingInfo().boundingBox
  const extents = bb.maximum.subtract(bb.minimum)

  // Tiles from this Thingiverse set are exported Z-up (flat hex in XY plane).
  // After a -90° X rotation the hex face points +Y (flat on floor).
  // We store the rotation and scale as metadata and apply at clone time.
  // Use the largest of X/Y (the pre-rotation horizontal dims) to scale.
  const maxHoriz = Math.max(extents.x, extents.y)
  const scale = maxHoriz > 0 ? TARGET_TILE_DIAMETER / maxHoriz : 1

  // Y offset: after -90° X rotation, old Z becomes new Y.
  // Center of old Z range → needs to sit at y=0 post-rotation.
  const zCenter = (bb.minimum.z + bb.maximum.z) / 2
  const yOffset = -zCenter * scale

  mesh.setEnabled(false)
  mesh.name = `template_${tileType}`

  const template: TileTemplate = { mesh, yOffset, scale }
  meshCache.set(tileType, template)
  return template
}

function createTileMaterial(scene: Scene, tileType: TileType): PBRMaterial {
  const mat = new PBRMaterial(`mat_${tileType}`, scene)
  mat.albedoColor = hexColorToColor3(TILE_COLORS[tileType])
  mat.metallic = 0.1
  mat.roughness = 0.8
  if (tileType === 'water' || tileType === 'harbor_water') mat.alpha = 0.85
  return mat
}

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
  const uniqueTypes = [...new Set(tiles.map(t => t.type))]
  await Promise.all(uniqueTypes.map(type => loadTileMesh(scene, type)))

  for (const tile of tiles) {
    const tmpl = meshCache.get(tile.type)
    if (!tmpl) continue

    const instance = tmpl.mesh.clone(`tile_${tile.q}_${tile.r}`)
    if (!instance) continue

    instance.setEnabled(true)

    // STL loader may set rotationQuaternion; null it out so .rotation is used
    instance.rotationQuaternion = null
    instance.rotation = new Vector3(-Math.PI / 2, 0, 0)
    instance.scaling.setAll(tmpl.scale)

    const { x, z } = axialToWorld(tile.q, tile.r)
    instance.position.x = x
    instance.position.y = tmpl.yOffset
    instance.position.z = z

    instance.material = getOrCreateMaterial(scene, tile.type)
  }
}
