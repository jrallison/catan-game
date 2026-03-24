/**
 * robberRenderer.ts — Loads sandstorm.glb and renders the robber at a tile's
 * number-token depression.
 *
 * Uses the same Z-negation + VertexData pipeline as tileRenderer.ts and
 * pieceRenderer.ts.
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
import { DEPRESSION_OFFSET } from './tileGeometry'
import { axialToWorld } from './board'

// Target max horizontal extent for the robber mesh
const ROBBER_TARGET_SIZE = 1.2

let robberMesh: Mesh | null = null
let scene: Scene

export async function initRobberRenderer(s: Scene): Promise<void> {
  scene = s

  const result = await SceneLoader.ImportMeshAsync('', '/assets/', 'sandstorm.glb', scene)

  // Find first mesh with geometry
  let srcMesh: Mesh | null = null
  for (const m of result.meshes) {
    if (m instanceof Mesh && m.getVerticesData(VertexBuffer.PositionKind)) {
      srcMesh = m
      break
    }
  }
  if (!srcMesh) {
    throw new Error('No mesh with position data in sandstorm.glb')
  }

  const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
  const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
  const rawColors = srcMesh.getVerticesData(VertexBuffer.ColorKind)
  const indices = srcMesh.getIndices()

  if (!rawPositions || !indices) {
    throw new Error('Missing positions or indices in sandstorm.glb')
  }

  const positions = new Float32Array(rawPositions)
  const normals = rawNormals ? new Float32Array(rawNormals) : null

  // Z-negation (Blender → Babylon pipeline)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 2] = -positions[i + 2]
  }
  if (normals) {
    for (let i = 0; i < normals.length; i += 3) {
      normals[i + 2] = -normals[i + 2]
    }
  }

  // Compute bounds
  let minX = Infinity, maxX = -Infinity
  let minY = Infinity
  let minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2]
    if (px < minX) minX = px; if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
  }

  // Scale so max horizontal extent = ROBBER_TARGET_SIZE
  const maxHoriz = Math.max(maxX - minX, maxZ - minZ)
  const scale = ROBBER_TARGET_SIZE / maxHoriz
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2

  for (let i = 0; i < positions.length; i += 3) {
    positions[i]     = (positions[i]     - cx) * scale
    positions[i + 1] = (positions[i + 1] - minY) * scale  // base at Y=0
    positions[i + 2] = (positions[i + 2] - cz) * scale
  }

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
    for (let i = 0; i < recomputed.length; i++) {
      recomputed[i] = -recomputed[i]
    }
    vd.normals = recomputed
  }

  if (rawColors) vd.colors = new Float32Array(rawColors)

  // Create the robber mesh
  robberMesh = new Mesh('robber', scene)
  vd.applyToMesh(robberMesh, false)

  robberMesh.rotationQuaternion = null
  robberMesh.rotation.copyFromFloats(0, 0, 0)
  robberMesh.scaling.copyFromFloats(1, 1, 1)
  robberMesh.isPickable = false

  // Material: self-lit with vertex colors
  const mat = new StandardMaterial('robber_mat', scene)
  if (rawColors) {
    mat.diffuseColor = Color3.White()
    robberMesh.useVertexColors = true
  } else {
    mat.diffuseColor = new Color3(0.85, 0.75, 0.45) // sandy color fallback
  }
  mat.specularColor = Color3.Black()
  mat.backFaceCulling = true
  robberMesh.material = mat

  // Dispose imported meshes
  for (const m of result.meshes) {
    if (!m.isDisposed()) m.dispose()
  }
}

export function renderRobber(q: number, r: number): void {
  if (!robberMesh) return

  const world = axialToWorld(q, r)
  const x = world.x + DEPRESSION_OFFSET.x
  const y = DEPRESSION_OFFSET.y
  const z = world.z + DEPRESSION_OFFSET.z

  robberMesh.position.set(x, y, z)
  robberMesh.setEnabled(true)
}
