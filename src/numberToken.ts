import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  SceneLoader,
  VertexBuffer,
  VertexData,
  PBRMaterial,
} from '@babylonjs/core'
import '@babylonjs/loaders'
import { HexTile } from './types'
import { axialToWorld } from './board'
import { DEPRESSION_OFFSET, DEPRESSION_RADIUS } from './tileGeometry'

// Probability dots for each number
const PROBABILITY_DOTS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
  8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
}

/** Small Y offset so the token sits just above the depression surface. */
const TOKEN_Y_LIFT = 0.01

/** Token diameter as a fraction of the depression diameter (slight inset). */
const TOKEN_DIAMETER = DEPRESSION_RADIUS * 2 * 0.9

/** Cached token template mesh (loaded once). */
let tokenTemplate: Mesh | null = null

/**
 * Load the designer's sculpted number token GLB and bake it as a template mesh.
 *
 * Applies the same pipeline as tile GLBs in tileRenderer.ts:
 *   1. Import GLB
 *   2. Z-negation to undo Blender's coordinate conversion
 *   3. Winding order reversal (swap indices 1 & 2 per triangle)
 *   4. Recompute normals
 *   5. Scale to fit the depression radius
 */
async function loadTokenTemplate(scene: Scene): Promise<Mesh> {
  if (tokenTemplate) return tokenTemplate

  // Step 1: Import GLB
  const result = await SceneLoader.ImportMeshAsync('', '/assets/', 'number_tokens.glb', scene)

  // Find meshes with actual geometry
  const srcMeshes: Mesh[] = []
  for (const m of result.meshes) {
    if (m instanceof Mesh && m.getVerticesData(VertexBuffer.PositionKind)) {
      srcMeshes.push(m)
    }
  }
  if (srcMeshes.length === 0) {
    throw new Error('number_tokens.glb has no meshes with position data')
  }

  // Merge all sub-meshes into one (the token has 4 color parts)
  // First, collect all vertex data from all parts
  const allPositions: number[] = []
  const allNormals: number[] = []
  const allColors: number[] = []
  const allIndices: number[] = []
  let vertexOffset = 0

  for (const srcMesh of srcMeshes) {
    const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
    const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
    const rawColors = srcMesh.getVerticesData(VertexBuffer.ColorKind)
    const indices = srcMesh.getIndices()

    if (!rawPositions || !indices) continue

    const vertexCount = rawPositions.length / 3

    // Apply Z-negation
    for (let i = 0; i < rawPositions.length; i += 3) {
      allPositions.push(rawPositions[i], rawPositions[i + 1], -rawPositions[i + 2])
    }
    if (rawNormals) {
      for (let i = 0; i < rawNormals.length; i += 3) {
        allNormals.push(rawNormals[i], rawNormals[i + 1], -rawNormals[i + 2])
      }
    }
    if (rawColors) {
      for (let i = 0; i < rawColors.length; i++) {
        allColors.push(rawColors[i])
      }
    }

    // Fix winding order (swap indices 1 & 2 per triangle) and offset
    for (let i = 0; i < indices.length; i += 3) {
      allIndices.push(
        indices[i] + vertexOffset,
        indices[i + 2] + vertexOffset,
        indices[i + 1] + vertexOffset,
      )
    }

    vertexOffset += vertexCount
  }

  const positions = new Float32Array(allPositions)

  // Compute bounds for scaling
  let xMin = Infinity, xMax = -Infinity
  let yMin = Infinity, yMax = -Infinity
  let zMin = Infinity, zMax = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    const px = positions[i], py = positions[i + 1], pz = positions[i + 2]
    if (px < xMin) xMin = px; if (px > xMax) xMax = px
    if (py < yMin) yMin = py; if (py > yMax) yMax = py
    if (pz < zMin) zMin = pz; if (pz > zMax) zMax = pz
  }

  // Scale to fit the depression: target diameter = DEPRESSION_RADIUS * 2 * 0.9 (slight inset)
  const targetDiameter = TOKEN_DIAMETER
  const maxHorizontalExtent = Math.max(xMax - xMin, zMax - zMin)
  const scale = targetDiameter / maxHorizontalExtent

  const cx = (xMin + xMax) / 2
  const cy = yMin  // base at Y=0
  const cz = (zMin + zMax) / 2

  for (let i = 0; i < positions.length; i += 3) {
    positions[i]     = (positions[i]     - cx) * scale
    positions[i + 1] = (positions[i + 1] - cy) * scale
    positions[i + 2] = (positions[i + 2] - cz) * scale
  }

  // Build template mesh with recomputed normals
  const finalIndices = new Int32Array(allIndices)
  const recomputedNormals = new Float32Array(positions.length)
  VertexData.ComputeNormals(positions, finalIndices, recomputedNormals)

  const templateMesh = new Mesh('template_numberToken', scene)
  const vertexData = new VertexData()
  vertexData.positions = positions
  vertexData.normals = recomputedNormals
  vertexData.indices = finalIndices
  if (allColors.length > 0) {
    vertexData.colors = new Float32Array(allColors)
  }
  vertexData.applyToMesh(templateMesh, true)

  // Reset transform
  templateMesh.rotationQuaternion = null
  templateMesh.rotation.copyFromFloats(0, 0, 0)
  templateMesh.scaling.copyFromFloats(1, 1, 1)
  templateMesh.position.copyFromFloats(0, 0, 0)
  templateMesh.setEnabled(false) // hidden template

  // Dispose imported meshes
  for (const m of result.meshes) {
    if (!m.isDisposed()) m.dispose()
  }

  tokenTemplate = templateMesh
  return templateMesh
}

/** Shared PBR material for token meshes (vertex colors). */
let tokenMaterial: PBRMaterial | null = null

function getTokenMaterial(scene: Scene): PBRMaterial {
  if (tokenMaterial) return tokenMaterial
  const mat = new PBRMaterial('mat_numberToken', scene)
  mat.albedoColor = new Color3(1, 1, 1)  // vertex colors provide color
  mat.metallic = 0.1
  mat.roughness = 0.8
  mat.backFaceCulling = false
  tokenMaterial = mat
  return mat
}

export async function renderNumberTokens(scene: Scene, tiles: HexTile[]): Promise<void> {
  // Load the token GLB template
  const template = await loadTokenTemplate(scene)

  for (const tile of tiles) {
    if (tile.number === undefined) continue

    const { x, z } = axialToWorld(tile.q, tile.r)

    // Clone the 3D sculpted token
    const tokenMesh = template.clone(`token3d_${tile.q}_${tile.r}`)
    if (!tokenMesh) continue
    tokenMesh.setEnabled(true)
    tokenMesh.parent = null
    tokenMesh.rotationQuaternion = null
    tokenMesh.rotation.copyFromFloats(0, 0, 0)
    tokenMesh.scaling.copyFromFloats(1, 1, 1)
    tokenMesh.position.x = x + DEPRESSION_OFFSET.x
    tokenMesh.position.y = DEPRESSION_OFFSET.y + TOKEN_Y_LIFT
    tokenMesh.position.z = z + DEPRESSION_OFFSET.z
    tokenMesh.useVertexColors = true
    tokenMesh.material = getTokenMaterial(scene)

    // Create DynamicTexture number overlay on a flat disc above the 3D token
    const textureSize = 256
    const texture = new DynamicTexture(`tokenTex_${tile.q}_${tile.r}`, textureSize, scene, true)
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D

    // Transparent background — only the number and dots render
    ctx.clearRect(0, 0, textureSize, textureSize)

    // Number text
    const isHighProb = tile.number === 6 || tile.number === 8
    const textColor = isHighProb ? '#CC0000' : '#000000'
    const fontSize = isHighProb ? 'bold 90px' : '80px'

    ctx.fillStyle = textColor
    ctx.font = `${fontSize} Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(tile.number), textureSize / 2, textureSize / 2 - 15)

    // Probability dots
    const dots = PROBABILITY_DOTS[tile.number] || 0
    const dotStr = '●'.repeat(dots)
    ctx.font = `${isHighProb ? 'bold ' : ''}24px Arial`
    ctx.fillStyle = textColor
    ctx.fillText(dotStr, textureSize / 2, textureSize / 2 + 45)

    texture.update()

    // Overlay disc — slightly above the 3D token
    const overlayDisc = MeshBuilder.CreateDisc(`tokenOverlay_${tile.q}_${tile.r}`, {
      radius: TOKEN_DIAMETER / 2 * 0.75,
      tessellation: 32,
    }, scene)
    overlayDisc.position.x = x + DEPRESSION_OFFSET.x
    overlayDisc.position.y = DEPRESSION_OFFSET.y + TOKEN_Y_LIFT + 0.08
    overlayDisc.position.z = z + DEPRESSION_OFFSET.z
    overlayDisc.rotation.x = Math.PI / 2  // lay flat (disc is created in XY plane)

    const overlayMat = new StandardMaterial(`tokenOverlayMat_${tile.q}_${tile.r}`, scene)
    overlayMat.diffuseTexture = texture
    overlayMat.useAlphaFromDiffuseTexture = true
    texture.hasAlpha = true
    overlayMat.specularColor = new Color3(0, 0, 0)
    overlayMat.emissiveColor = new Color3(0.5, 0.5, 0.5) // ensure text is visible
    overlayMat.backFaceCulling = false
    overlayDisc.material = overlayMat
  }
}
