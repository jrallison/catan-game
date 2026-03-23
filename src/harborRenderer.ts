/**
 * harborRenderer.ts — Loads harbor GLB models (base + resource top) and places
 * them at harbor water tile positions, oriented toward adjacent land.
 *
 * Uses the same Z-negation + vertex-data baking pipeline as tileRenderer.ts
 * and pieceRenderer.ts.
 *
 * ## GLB Assets
 *
 * harbor_base.glb:     27.71 × 18.90 × 40.01 BU (X × Y × Z), off-center
 * Resource tops:       12.00 × varies × 12.00 BU, off-center
 *
 * Both are centered, Z-negated, and uniformly scaled during loading.
 */

import {
  Scene,
  Mesh,
  VertexData,
  VertexBuffer,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader'
import '@babylonjs/loaders/glTF'
import { HarborType } from './types'
import { HarborDef, axialToWorld } from './board'

// ─── Constants ───────────────────────────────────────────────────────────────

/** Target diameter for harbor base mesh (max horizontal extent in game units). */
const BASE_TARGET_DIAMETER = 3.2

/** Target diameter for resource top mesh. */
const TOP_TARGET_DIAMETER = 0.9

/** Y position for harbor base (same as tile surface). */
const BASE_Y = 0.0

/** Height of the flat dock platform surface (tuned constant for resource top placement). */
const DOCK_PLATFORM_HEIGHT = 0.32

/** GLB path for the dock structure. */
const HARBOR_BASE_GLB = '/assets/harbor_base.glb'

/** GLB paths for each harbor resource type. */
const HARBOR_TOP_GLB: Record<HarborType, string> = {
  '3:1':  '/assets/harbor_resources/harbor_3_for_1.glb',
  ore:    '/assets/harbor_resources/harbor_ore.glb',
  wool:   '/assets/harbor_resources/harbor_wool.glb',
  brick:  '/assets/harbor_resources/harbor_brick.glb',
  wheat:  '/assets/harbor_resources/harbor_wheet.glb',
  wood:   '/assets/harbor_resources/harbor_wood.glb',
}

// ─── Template cache ──────────────────────────────────────────────────────────

interface HarborTemplate {
  mesh: Mesh
  bakedHeight: number  // Y extent after scaling, for stacking tops
}

const templateCache = new Map<string, HarborTemplate>()

// ─── GLB Loading Pipeline ────────────────────────────────────────────────────

/**
 * Load a GLB, bake vertex data with Z-negation, center, and scale.
 * Same pipeline as pieceRenderer.loadPieceGLB.
 */
async function loadHarborGLB(
  scene: Scene,
  url: string,
  targetDiameter: number,
): Promise<HarborTemplate> {
  const cached = templateCache.get(url)
  if (cached) return cached

  const result = await SceneLoader.ImportMeshAsync('', '', url, scene)

  // Find first mesh with geometry
  let srcMesh: Mesh | null = null
  for (const m of result.meshes) {
    if (m instanceof Mesh && m.getVerticesData(VertexBuffer.PositionKind)) {
      srcMesh = m
      break
    }
  }
  if (!srcMesh) throw new Error(`No mesh with position data in ${url}`)

  const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
  const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
  const rawColors = srcMesh.getVerticesData(VertexBuffer.ColorKind)
  const indices = srcMesh.getIndices()

  if (!rawPositions || !indices) throw new Error(`Missing positions or indices in ${url}`)

  const positions = new Float32Array(rawPositions)
  const normals = rawNormals ? new Float32Array(rawNormals) : null

  // Z-negation: Blender Z-up → GLTF Y-up → Babylon left-hand = negate Z
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 2] = -positions[i + 2]
  }
  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      normals[i + 2] = -normals[i + 2]
    }
  }

  // Compute bounds after Z-negation
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity, maxY = -Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2]
    if (px < minX) minX = px; if (px > maxX) maxX = px
    if (py < minY) minY = py; if (py > maxY) maxY = py
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
  }

  // Uniform scale: fit max horizontal extent to targetDiameter
  const maxHorizontalExtent = Math.max(maxX - minX, maxZ - minZ)
  const scale = targetDiameter / maxHorizontalExtent

  // Center in XZ, base at Y=0, then scale
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]     = (positions[i]     - cx) * scale
    positions[i + 1] = (positions[i + 1] - minY) * scale
    positions[i + 2] = (positions[i + 2] - cz) * scale
  }

  const bakedHeight = (maxY - minY) * scale

  // Build vertex data
  const fixedIndices = new Int32Array(indices)
  const vd = new VertexData()
  vd.positions = positions
  vd.indices = fixedIndices

  if (normals) {
    vd.normals = normals
  } else {
    const recomputed = new Float32Array(positions.length)
    VertexData.ComputeNormals(positions, fixedIndices, recomputed)
    for (let i = 0; i < recomputed.length; i++) recomputed[i] = -recomputed[i]
    vd.normals = recomputed
  }

  if (rawColors) vd.colors = new Float32Array(rawColors)

  const template = new Mesh(`template_harbor_${url}`, scene)
  vd.applyToMesh(template, false)

  template.rotationQuaternion = null
  template.rotation.copyFromFloats(0, 0, 0)
  template.scaling.copyFromFloats(1, 1, 1)
  template.position.copyFromFloats(0, 0, 0)
  template.setEnabled(false)

  // Dispose imported meshes
  for (const m of result.meshes) {
    if (!m.isDisposed()) m.dispose()
  }

  const entry: HarborTemplate = { mesh: template, bakedHeight }
  templateCache.set(url, entry)
  return entry
}

// ─── Instance Placement ──────────────────────────────────────────────────────

function createHarborMesh(
  scene: Scene,
  template: Mesh,
  name: string,
  x: number,
  y: number,
  z: number,
  rotationY: number,
  hasVertexColors: boolean,
): Mesh {
  // Fresh mesh from template vertex data (no clone — shared buffers issue)
  const mesh = new Mesh(name, scene)
  const vd = new VertexData()
  vd.positions = template.getVerticesData(VertexBuffer.PositionKind)
  vd.normals = template.getVerticesData(VertexBuffer.NormalKind)
  vd.indices = template.getIndices()
  const colors = template.getVerticesData(VertexBuffer.ColorKind)
  if (colors) vd.colors = new Float32Array(colors)
  vd.applyToMesh(mesh, false)

  mesh.position.set(x, y, z)
  mesh.rotation.y = rotationY
  mesh.isPickable = false
  // renderingGroupId left at default (0) — group 1 caused bleed-through over mountains

  const mat = new StandardMaterial(`mat_${name}`, scene)
  mat.diffuseColor = Color3.White()
  mat.specularColor = Color3.Black()
  mat.backFaceCulling = true
  if (hasVertexColors) mesh.useVertexColors = true
  mesh.material = mat

  return mesh
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render all harbor structures (base + resource top) on the board.
 */
export async function renderHarbors(scene: Scene, harbors: HarborDef[]): Promise<void> {
  // Pre-load all unique GLBs in parallel
  const topUrls = [...new Set(harbors.map(h => HARBOR_TOP_GLB[h.type]))]
  const [baseTemplate, ...topTemplates] = await Promise.all([
    loadHarborGLB(scene, HARBOR_BASE_GLB, BASE_TARGET_DIAMETER),
    ...topUrls.map(url => loadHarborGLB(scene, url, TOP_TARGET_DIAMETER)),
  ])

  // Build url→template map for tops
  const topTemplateMap = new Map<string, HarborTemplate>()
  topUrls.forEach((url, i) => topTemplateMap.set(url, topTemplates[i]))

  // Place each harbor at the water-land edge
  for (const harbor of harbors) {
    const water = axialToWorld(harbor.q, harbor.r)
    const land = axialToWorld(harbor.landQ, harbor.landR)
    const dx = land.x - water.x
    const dz = land.z - water.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const apothem = 2.6 * Math.sqrt(3) / 2  // ≈ 2.25 — center-to-edge distance
    // Offset dock center back into the water so its land-facing flat edge
    // sits flush with the hex boundary between water and land.
    const DOCK_DEPTH_OFFSET = 1.2
    const x = water.x + (dx / dist) * (apothem - DOCK_DEPTH_OFFSET)
    const z = water.z + (dz / dist) * (apothem - DOCK_DEPTH_OFFSET)

    // Rotation: dock flat edge faces the land tile (from land toward water)
    const rotation = Math.atan2(dx, dz) + Math.PI / 2

    // Base dock structure
    createHarborMesh(
      scene,
      baseTemplate.mesh,
      `harbor_base_${harbor.q}_${harbor.r}`,
      x, BASE_Y, z,
      rotation,
      true,
    )

    // Resource top — billboards to always face viewer
    const topUrl = HARBOR_TOP_GLB[harbor.type]
    const topTemplate = topTemplateMap.get(topUrl)!
    const topMesh = createHarborMesh(
      scene,
      topTemplate.mesh,
      `harbor_top_${harbor.q}_${harbor.r}`,
      x, BASE_Y + DOCK_PLATFORM_HEIGHT, z,
      0,
      true,
    )
    topMesh.billboardMode = Mesh.BILLBOARDMODE_Y  // rotate around Y to face viewer, don't tilt
  }
}
