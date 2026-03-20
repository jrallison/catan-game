/**
 * tileRenderer.ts — Loads STL hex tiles, bakes geometry, and places them on the board.
 *
 * ## STL Loader Gotchas (Babylon.js)
 *
 * 1. **Non-updatable geometry.** The Babylon.js STL loader produces meshes whose
 *    vertex buffers are non-updatable. Calling `updateVerticesData()` on them
 *    *silently fails* — no error, no effect. The workaround is to read the raw
 *    vertex data, transform it in JS, then apply it to a *new* mesh via
 *    `VertexData.applyToMesh(mesh, true)` (updatable = true).
 *
 * 2. **Automatic Z-up → Y-up conversion.** The STL loader converts from STL's
 *    Z-up convention to Babylon's Y-up. After loading, X and Z are the horizontal
 *    plane and Y is height. No manual axis rotation is needed for land tiles.
 *
 * 3. **Pointy-top vs flat-top orientation.** Water/harbor STL files are modeled
 *    as pointy-top hexagons, while land tiles are flat-top. Water tiles need a
 *    30° Y-axis rotation baked into their vertex data to match the board layout.
 *
 * 4. **Off-center geometry.** Some STL files (e.g. wood.stl, water.stl) have
 *    geometry that is not centered at the origin. Centering must be computed from
 *    the actual vertex bounds after loading — never assume (0,0,0) is the center.
 */

import {
  Scene,
  PBRMaterial,
  Color3,
  SceneLoader,
  Mesh,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core'
import '@babylonjs/loaders/STL'
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

/**
 * Y-axis rotation (radians) to bake into tile geometry before placement.
 *
 * Water and harbor STLs are pointy-top hexagons; the board expects flat-top.
 * A 30° (π/6) rotation converts pointy-top → flat-top.
 */
const WATER_ROTATION_RAD = Math.PI / 6

/** Per-tile-type Y rotation. Land tiles need none; water/harbor need 30°. */
const TILE_Y_ROTATION: Partial<Record<TileType, number>> = {
  water:        WATER_ROTATION_RAD,
  harbor_water: WATER_ROTATION_RAD,
}

/** Albedo colors per tile type (hex strings). */
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

/** STL filename per tile type (served from /assets/). */
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

/** Water and harbor tiles get slight transparency. */
const WATER_ALPHA = 0.85

/** PBR material defaults for all tiles. */
const MAT_METALLIC  = 0.1
const MAT_ROUGHNESS = 0.8

// ─── Utility ─────────────────────────────────────────────────────────────────

function hexColorToColor3(hex: string): Color3 {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return new Color3(r, g, b)
}

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

/**
 * Rotate an array of 3D vectors (packed as [x,y,z,x,y,z,...]) around the Y axis
 * by `angle` radians, in place.
 */
function rotateVectorsAroundY(data: Float32Array, angle: number): void {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let i = 0; i < data.length; i += 3) {
    const x = data[i]
    const z = data[i + 2]
    data[i]     = x * cos - z * sin
    data[i + 2] = x * sin + z * cos
  }
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

  // Step 1: Import STL
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', TILE_STL_MAP[tileType], scene)

  // Step 2: Find the mesh that actually has geometry
  const srcMesh = findGeometryMesh(result.meshes)
  if (!srcMesh) {
    throw new Error(`STL for "${tileType}" (${TILE_STL_MAP[tileType]}) has no mesh with position data`)
  }

  // Read raw vertex data. These are safe to assert non-null because findGeometryMesh
  // already verified that position data exists.
  const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
  if (!rawPositions) {
    // Defensive: shouldn't happen given findGeometryMesh, but satisfies strict null checks
    throw new Error(`Failed to read positions from "${tileType}" STL`)
  }
  const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
  const indices    = srcMesh.getIndices()

  // Work on Float32Array copies so we can mutate freely
  const positions = new Float32Array(rawPositions)
  const normals   = rawNormals ? new Float32Array(rawNormals) : null

  // Step 3: Bake Y rotation into vertex data (water/harbor: pointy-top → flat-top)
  const yRotation = TILE_Y_ROTATION[tileType] ?? 0
  if (yRotation !== 0) {
    rotateVectorsAroundY(positions, yRotation)
    if (normals) {
      rotateVectorsAroundY(normals, yRotation)
    }
  }

  // Step 4: Compute bounds after rotation, then scale + center
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
  if (normals) vertexData.normals = normals
  if (indices) vertexData.indices = indices
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

/** Cached PBR materials keyed by tile type. */
const materialCache: Map<TileType, PBRMaterial> = new Map()

function getOrCreateMaterial(scene: Scene, tileType: TileType): PBRMaterial {
  const existing = materialCache.get(tileType)
  if (existing) return existing

  const mat = new PBRMaterial(`mat_${tileType}`, scene)
  mat.albedoColor = hexColorToColor3(TILE_COLORS[tileType])
  mat.metallic  = MAT_METALLIC
  mat.roughness = MAT_ROUGHNESS

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
