/**
 * tileRenderer.ts — Loads GLB hex tiles (with vertex colors), bakes geometry,
 * and places them on the board.
 *
 * ## GLB Pipeline
 *
 * Tile meshes are exported from Blender as GLB files with baked vertex colors
 * (Z-height-based gradients). The GLTF loader handles Y-up conversion.
 *
 * ## Key Notes
 *
 * 1. **Vertex colors.** GLB files include per-vertex colors painted by the
 *    Blender script (`scripts/add_vertex_colors.py`). These are copied into
 *    the baked VertexData and rendered via self-lit `StandardMaterial`.
 *
 * 2. **Flat-top orientation.** All GLB files are exported from Blender in
 *    canonical flat-top orientation. Any orientation correction for source STLs
 *    is baked in the Blender pipeline (`scripts/add_vertex_colors.py`), not here.
 *
 * 3. **Off-center geometry.** Some GLB files have geometry that is not centered
 *    at the origin. Centering is computed from actual vertex bounds after loading.
 */

import {
  Scene,
  StandardMaterial,
  Color3,
  SceneLoader,
  Mesh,
  VertexBuffer,
  VertexData,
  Vector3,
} from '@babylonjs/core'
import '@babylonjs/loaders'
import { HexTile, TileType } from './types'
import { axialToWorld } from './board'

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Corner-to-corner hex diameter in world units.
 *
 * axialToWorld uses size=2.1, giving adjacent center spacing of 2.1 × √3 ≈ 3.637.
 * A regular flat-top hex with that edge-to-edge width has corner-to-corner ≈ 4.2.
 */
const TARGET_TILE_DIAMETER = 4.2

/** GLB filename per tile type (served from /assets/). */
const TILE_GLB_MAP: Record<TileType, string> = {
  wood:         'wood.glb',
  wool:         'wool.glb',
  wheat:        'wheet.glb',
  brick:        'brick.glb',
  ore:          'ore.glb',
  desert:       'desert.glb',
  water:        'water.glb',
  harbor_water: 'harbor_water.glb',
}

/** Water and harbor tiles get slight transparency. */
const WATER_ALPHA = 0.85

/** Tiles use self-lit StandardMaterial — no PBR needed. */

// ─── Utility ─────────────────────────────────────────────────────────────────

function isWaterType(type: TileType): boolean {
  return type === 'water' || type === 'harbor_water'
}

// ─── Geometry Pipeline ───────────────────────────────────────────────────────
//
// load STL → find geometry mesh → read raw vertices → rotate → compute bounds
// → scale + center → bake into new updatable mesh → dispose STL original
//

/** Cached template meshes keyed by tile type. Hidden; used only for cloning. */
const templateCache: Map<TileType, Mesh> = new Map()

/**
 * Find the first mesh in an import result that actually has position vertex data.
 * The STL loader sometimes returns a root transform node at index 0 with no geometry.
 */
function findGeometryMesh(meshes: ReadonlyArray<import('@babylonjs/core').AbstractMesh>): Mesh | null {
  for (const m of meshes) {
    if (m instanceof Mesh && m.getVerticesData(VertexBuffer.PositionKind)) {
      return m
    }
  }
  return null
}

interface Bounds3D {
  xMin: number; xMax: number
  yMin: number; yMax: number
  zMin: number; zMax: number
}

/** Compute axis-aligned bounding box from packed position data. */
function computeBounds(positions: Float32Array): Bounds3D {
  let xMin = Infinity,  xMax = -Infinity
  let yMin = Infinity,  yMax = -Infinity
  let zMin = Infinity,  zMax = -Infinity

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (x < xMin) xMin = x; if (x > xMax) xMax = x
    if (y < yMin) yMin = y; if (y > yMax) yMax = y
    if (z < zMin) zMin = z; if (z > zMax) zMax = z
  }

  return { xMin, xMax, yMin, yMax, zMin, zMax }
}

/**
 * Scale and center positions in place.
 *
 * - Horizontally centered (X/Z) around origin.
 * - Y base lifted to 0 (terrain features point upward).
 * - Uniform scale so the largest horizontal extent matches `targetDiameter`.
 */
function scaleAndCenter(positions: Float32Array, bounds: Bounds3D, targetDiameter: number): void {
  const maxHorizontalExtent = Math.max(bounds.xMax - bounds.xMin, bounds.zMax - bounds.zMin)
  const scale = targetDiameter / maxHorizontalExtent

  const cx = (bounds.xMin + bounds.xMax) / 2
  const cy = bounds.yMin   // base of mesh, not center — we want Y=0 at the bottom
  const cz = (bounds.zMin + bounds.zMax) / 2

  for (let i = 0; i < positions.length; i += 3) {
    positions[i]     = (positions[i]     - cx) * scale
    positions[i + 1] = (positions[i + 1] - cy) * scale
    positions[i + 2] = (positions[i + 2] - cz) * scale
  }
}

/**
 * Load an STL file, bake all transforms into vertex data, and return a hidden
 * template mesh ready for cloning.
 *
 * The full pipeline:
 *  1. Import STL via Babylon's SceneLoader
 *  2. Read raw (non-updatable) vertex data from the imported mesh
 *  3. Optionally rotate vertices around Y (water tiles: 30°)
 *  4. Compute bounds, then scale + center the vertices
 *  5. Create a new Mesh with `VertexData.applyToMesh(mesh, true)` — updatable
 *  6. Dispose all imported STL meshes (only the baked template is kept)
 */
async function loadTemplateMesh(scene: Scene, tileType: TileType): Promise<Mesh> {
  const cached = templateCache.get(tileType)
  if (cached) return cached

  // Step 1: Import GLB
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', TILE_GLB_MAP[tileType], scene)

  // Step 2: Find the mesh that actually has geometry
  const srcMesh = findGeometryMesh(result.meshes)
  if (!srcMesh) {
    throw new Error(`GLB for "${tileType}" (${TILE_GLB_MAP[tileType]}) has no mesh with position data`)
  }

  // Read raw vertex data. These are safe to assert non-null because findGeometryMesh
  // already verified that position data exists.
  const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
  if (!rawPositions) {
    // Defensive: shouldn't happen given findGeometryMesh, but satisfies strict null checks
    throw new Error(`Failed to read positions from "${tileType}" GLB`)
  }
  const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
  const rawColors  = srcMesh.getVerticesData(VertexBuffer.ColorKind)
  const indices    = srcMesh.getIndices()

  // Work on Float32Array copies so we can mutate freely
  const positions = new Float32Array(rawPositions)
  const normals   = rawNormals ? new Float32Array(rawNormals) : null

  // Fix Blender→GLTF→Babylon coordinate pipeline:
  // Blender (Z-up right-handed) → GLTF (Y-up right-handed, CCW front faces)
  // Babylon loads GLTF by applying a Z-flip node transform: outward GLTF CCW faces → CW in Babylon.
  // Babylon uses left-handed coordinates where CW = front face.
  //
  // When baking vertex data (reading local positions before the node transform),
  // we manually negate Z to replicate what the node transform would do.
  // After Z-negation: outward faces are CW = front-facing in Babylon. ✓
  //
  // ComputeNormals uses right-hand cross product convention → CW triangles produce
  // inward normals. We negate after computing to restore outward-facing normals.
  //
  // DO NOT swap winding order (i+1 ↔ i+2) — this would flip CW→CCW, making
  // outward faces into back-faces that get culled by backFaceCulling=true.
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 2] = -positions[i + 2]
  }
  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      normals[i + 2] = -normals[i + 2]
    }
  }
  // Copy indices as-is — no winding swap needed (see comment above)
  const fixedIndices = indices ? new Int32Array(indices) : null

  // Step 4: Compute bounds, then scale + center
  const bounds = computeBounds(positions)
  scaleAndCenter(positions, bounds, TARGET_TILE_DIAMETER)
  // Normals don't need centering or scaling for a uniform scale factor.

  // Step 5: Create a fresh updatable mesh with baked vertex data.
  // This is necessary because the STL loader produces non-updatable buffers —
  // updateVerticesData() silently fails on them. Building a new VertexData and
  // applying with updatable=true is the correct workaround.
  const templateMesh = new Mesh(`template_${tileType}`, scene)
  const vertexData = new VertexData()
  vertexData.positions = positions
  // Recompute normals from the corrected geometry — the GLB normals are
  // unreliable after Z-negation (they were for the pre-negation coordinate space).
  const finalIndices = fixedIndices ?? (indices ? new Int32Array(indices) : null)
  if (finalIndices) {
    const recomputedNormals = new Float32Array(positions.length)
    VertexData.ComputeNormals(positions, finalIndices, recomputedNormals)
    // Negate all computed normals. ComputeNormals uses right-hand cross product,
    // which gives inward normals for CW-wound triangles. Negating restores
    // correct outward-facing normals for proper lighting (tops bright, undersides dark).
    for (let i = 0; i < recomputedNormals.length; i++) {
      recomputedNormals[i] = -recomputedNormals[i]
    }
    vertexData.normals = recomputedNormals
    vertexData.indices = finalIndices
  }
  if (rawColors) vertexData.colors = new Float32Array(rawColors)
  vertexData.applyToMesh(templateMesh, /* updatable */ true)

  // Reset transform so the mesh is purely defined by its baked vertex data
  templateMesh.rotationQuaternion = null
  templateMesh.rotation.copyFromFloats(0, 0, 0)
  templateMesh.scaling.copyFromFloats(1, 1, 1)
  templateMesh.position.copyFromFloats(0, 0, 0)
  templateMesh.setEnabled(false) // hidden; only used as a clone source

  // Step 6: Dispose all imported STL meshes — only the baked template is kept
  for (const m of result.meshes) {
    if (!m.isDisposed()) m.dispose()
  }

  templateCache.set(tileType, templateMesh)
  return templateMesh
}

// ─── Material Pipeline ───────────────────────────────────────────────────────

/** Cached self-lit materials keyed by tile type. */
const materialCache: Map<TileType, StandardMaterial> = new Map()

function getOrCreateMaterial(scene: Scene, tileType: TileType): StandardMaterial {
  const existing = materialCache.get(tileType)
  if (existing) return existing

  const mat = new StandardMaterial(`mat_${tileType}`, scene)
  mat.disableLighting = false                      // lighting on — needed for depth on 3D geometry
  mat.diffuseColor = Color3.White()                // vertex colors drive the diffuse response
  mat.emissiveColor = new Color3(0.35, 0.35, 0.35) // lifts color floor — shadows don't crush vibrancy
  mat.specularColor = Color3.Black()               // no specular highlights (stylized look)
  mat.backFaceCulling = true                       // correct: Z-negation gives CW winding = front-face in Babylon's left-handed system

  if (isWaterType(tileType)) {
    mat.alpha = WATER_ALPHA
  }

  materialCache.set(tileType, mat)
  return mat
}

// ─── Placement ───────────────────────────────────────────────────────────────

/**
 * Place a single tile instance on the board by cloning the template mesh.
 *
 * To add per-instance Y rotation (e.g. visual variety), apply it to
 * `instance.rotation.y` after cloning — the baked geometry is orientation-
 * neutral within its tile type, so any additional Y spin is purely cosmetic.
 */
function placeTileInstance(scene: Scene, tile: HexTile, template: Mesh): void {
  const instance = template.clone(`tile_${tile.q}_${tile.r}`)
  if (!instance) return // clone can return null if mesh has no geometry

  instance.setEnabled(true)
  instance.parent = null

  // Reset transform — all geometry is baked; only position varies
  instance.rotationQuaternion = null
  instance.rotation.copyFromFloats(0, 0, 0)
  instance.scaling.copyFromFloats(1, 1, 1)

  const { x, z } = axialToWorld(tile.q, tile.r)
  instance.position.set(x, 0, z)

  // Enable vertex color rendering on the mesh
  instance.useVertexColors = true

  instance.material = getOrCreateMaterial(scene, tile.type)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render all hex tiles onto the scene.
 *
 * 1. Pre-loads all unique tile type STLs in parallel (cached after first call).
 * 2. Clones and positions each tile instance on the board.
 */
export async function renderTiles(scene: Scene, tiles: HexTile[]): Promise<void> {
  // Pre-load all unique tile types in parallel
  const uniqueTypes = [...new Set(tiles.map(t => t.type))]
  await Promise.all(uniqueTypes.map(type => loadTemplateMesh(scene, type)))

  // Place each tile
  for (const tile of tiles) {
    const template = templateCache.get(tile.type)
    if (!template) continue
    placeTileInstance(scene, tile, template)
  }
}
