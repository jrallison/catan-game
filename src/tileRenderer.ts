import { Scene, PBRMaterial, Color3, SceneLoader, Mesh, Vector3, VertexBuffer, VertexData } from '@babylonjs/core'
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

// Corner-to-corner hex diameter in world units.
// axialToWorld size=2.1 → adjacent centers 2.1*sqrt(3) ≈ 3.637 apart.
// Regular hex: corner-to-corner = edge-to-edge / (sqrt(3)/2) ≈ 4.2
const TARGET_TILE_DIAMETER = 4.2

function hexColorToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

// Cache of ready-to-clone template meshes (geometry already baked)
const meshCache: Map<TileType, Mesh> = new Map()

// Water tiles are pointy-top in the STL; land tiles are flat-top. Bake a 30° Y rotation.
const TILE_Y_ROTATION: Partial<Record<TileType, number>> = {
  water:        Math.PI / 6,
  harbor_water: Math.PI / 6,
}

async function loadTileMesh(scene: Scene, tileType: TileType): Promise<Mesh> {
  const cached = meshCache.get(tileType)
  if (cached) return cached

  const result = await SceneLoader.ImportMeshAsync('', '/assets/', TILE_STL_MAP[tileType], scene)

  // Find the mesh with actual geometry
  let srcMesh: Mesh = result.meshes[0] as Mesh
  for (const m of result.meshes) {
    const asMesh = m as Mesh
    if (asMesh.getVerticesData?.(VertexBuffer.PositionKind)) {
      srcMesh = asMesh
      break
    }
  }

  // Read raw vertex data from the (non-updatable) STL mesh
  const rawPos = srcMesh.getVerticesData(VertexBuffer.PositionKind)!
  const rawNor = srcMesh.getVerticesData(VertexBuffer.NormalKind)
  const indices = srcMesh.getIndices()

  // Apply Y rotation to raw positions (baked in — avoids transform centering issues)
  const yRot = TILE_Y_ROTATION[tileType] ?? 0
  if (yRot !== 0) {
    const cosY = Math.cos(yRot), sinY = Math.sin(yRot)
    for (let i = 0; i < rawPos.length; i += 3) {
      const rx = rawPos[i], rz = rawPos[i + 2]
      rawPos[i]     = rx * cosY - rz * sinY
      rawPos[i + 2] = rx * sinY + rz * cosY
    }
    if (rawNor) {
      for (let i = 0; i < rawNor.length; i += 3) {
        const nx = rawNor[i], nz = rawNor[i + 2]
        rawNor[i]     = nx * cosY - nz * sinY
        rawNor[i + 2] = nx * sinY + nz * cosY
      }
    }
  }

  // Compute bounds after rotation
  let xMin = Infinity, xMax = -Infinity
  let yMin = Infinity, yMax = -Infinity
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < rawPos.length; i += 3) {
    if (rawPos[i]   < xMin) xMin = rawPos[i];   if (rawPos[i]   > xMax) xMax = rawPos[i]
    if (rawPos[i+1] < yMin) yMin = rawPos[i+1]; if (rawPos[i+1] > yMax) yMax = rawPos[i+1]
    if (rawPos[i+2] < zMin) zMin = rawPos[i+2]; if (rawPos[i+2] > zMax) zMax = rawPos[i+2]
  }

  // Scale: largest horizontal extent → TARGET_TILE_DIAMETER
  // Babylon STL loader converts Z-up → Y-up, so X & Z are horizontal, Y is height
  const maxHoriz = Math.max(xMax - xMin, zMax - zMin)
  const s = TARGET_TILE_DIAMETER / maxHoriz

  // Centering: X/Z to origin, Y base at 0 (terrain features point up)
  const cx = (xMin + xMax) / 2
  const cy = yMin
  const cz = (zMin + zMax) / 2

  // Build transformed positions — baked into a NEW updatable mesh
  const newPos = new Float32Array(rawPos.length)
  for (let i = 0; i < rawPos.length; i += 3) {
    newPos[i]     = (rawPos[i]     - cx) * s
    newPos[i + 1] = (rawPos[i + 1] - cy) * s
    newPos[i + 2] = (rawPos[i + 2] - cz) * s
  }

  let newNor: Float32Array | null = null
  if (rawNor) {
    newNor = new Float32Array(rawNor.length)
    newNor.set(rawNor) // normals don't need centering or scaling for uniform scale
  }

  // Create a fresh updatable mesh and apply the baked vertex data
  const tmplMesh = new Mesh(`template_${tileType}`, scene)
  const vd = new VertexData()
  vd.positions = newPos
  if (newNor) vd.normals = newNor
  if (indices) vd.indices = indices
  vd.applyToMesh(tmplMesh, true) // true = updatable

  // Clean transform, hide template
  tmplMesh.rotationQuaternion = null
  tmplMesh.rotation.copyFromFloats(0, 0, 0)
  tmplMesh.scaling.copyFromFloats(1, 1, 1)
  tmplMesh.position.copyFromFloats(0, 0, 0)
  tmplMesh.setEnabled(false)

  // Dispose the original STL mesh — we no longer need it
  srcMesh.dispose()
  for (const m of result.meshes) {
    if (m !== srcMesh && !m.isDisposed()) m.dispose()
  }

  meshCache.set(tileType, tmplMesh)
  return tmplMesh
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

    const inst = tmpl.clone(`tile_${tile.q}_${tile.r}`)
    if (!inst) continue

    inst.setEnabled(true)
    inst.parent = null
    inst.rotationQuaternion = null
    inst.rotation.copyFromFloats(0, 0, 0)
    inst.scaling.copyFromFloats(1, 1, 1)

    const { x, z } = axialToWorld(tile.q, tile.r)
    inst.position.set(x, 0, z)
    inst.material = getOrCreateMaterial(scene, tile.type)
  }
}
