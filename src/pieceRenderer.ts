/**
 * pieceRenderer.ts — Loads settlement and city GLB models and places 3D pieces
 * at board vertices.
 *
 * ## GLB Pipeline (same Z-negation as tileRenderer.ts)
 *
 * Blender coordinates → Game coordinates:
 *   Blender X → Game X
 *   Blender Z → Game Y (height)
 *   Blender Y (negated) → Game Z
 *
 * ## Scale Constants
 *
 * settlements.glb: 15 BU wide (X) × 19.3 BU tall (Z→Y)
 *   → 15 BU wide → 0.40 game units → scale = 0.0267
 *   → height after scale: 19.3 × 0.0267 = 0.515 game units
 *
 * cities.glb: ~16 BU wide (X) × 26.1 BU tall (Z→Y)
 *   → 16 BU wide → 0.40 game units → scale = 0.025
 *   → height after scale: 26.1 × 0.025 = 0.653 game units
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
import { PlayerColor } from './gameState'
import { BoardEdge, BoardGraph } from './boardGraph'

// ─── Constants ───────────────────────────────────────────────────────────────

const SETTLEMENT_SCALE = 0.0267  // 15 BU → 0.40 game units
const CITY_SCALE       = 0.025   // 16 BU → 0.40 game units

// roads.glb: 31.35 BU long → 1.5 game units → scale = 0.0479
// width after scale: 9 × 0.0479 = 0.431 game units
// height after scale: 3.698 × 0.0479 = 0.177 game units
const ROAD_SCALE       = 0.0479

const PIECE_BASE_Y     = 0.10    // = RING_TOP_Y from hexRing.ts

const PLAYER_COLORS: Record<PlayerColor, Color3> = {
  red:  new Color3(0.9, 0.15, 0.15),
  blue: new Color3(0.2, 0.45, 0.85),
}

// ─── PieceRenderer Class ─────────────────────────────────────────────────────

export class PieceRenderer {
  private scene: Scene
  private settlementTemplate: Mesh | null = null
  private cityTemplate: Mesh | null = null
  private roadTemplate: Mesh | null = null
  /** vertexId or edgeId → placed mesh */
  private pieces = new Map<string, Mesh>()

  constructor(scene: Scene) {
    this.scene = scene
  }

  async loadTemplates(): Promise<void> {
    this.settlementTemplate = await this.loadPieceGLB('/assets/settlements.glb', SETTLEMENT_SCALE)
    this.settlementTemplate.setEnabled(false)

    this.cityTemplate = await this.loadPieceGLB('/assets/cities.glb', CITY_SCALE)
    this.cityTemplate.setEnabled(false)

    this.roadTemplate = await this.loadPieceGLB('/assets/roads.glb', ROAD_SCALE)
    this.roadTemplate.setEnabled(false)
  }

  hasPiece(vertexId: string): boolean {
    return this.pieces.has(vertexId)
  }

  placeSettlement(vertexId: string, x: number, z: number, color: PlayerColor): void {
    if (this.pieces.has(vertexId)) return
    const mesh = this.cloneTemplate(this.settlementTemplate!, `settlement_${vertexId}`, x, z, color)
    this.pieces.set(vertexId, mesh)
  }

  upgradeToCity(vertexId: string, x: number, z: number, color: PlayerColor): void {
    // Remove existing settlement mesh
    const existing = this.pieces.get(vertexId)
    if (existing) {
      existing.dispose()
      this.pieces.delete(vertexId)
    }
    const mesh = this.cloneTemplate(this.cityTemplate!, `city_${vertexId}`, x, z, color)
    this.pieces.set(vertexId, mesh)
  }

  placeRoad(edgeId: string, edge: BoardEdge, graph: BoardGraph, color: PlayerColor): void {
    if (this.pieces.has(edgeId)) return

    const mesh = this.roadTemplate!.clone(`road_${edgeId}`)!
    mesh.setEnabled(true)
    mesh.isPickable = false

    // Position at edge midpoint on ring surface
    mesh.position.set(edge.x, PIECE_BASE_Y, edge.z)

    // Rotate to align road's X-axis with the edge direction
    const vA = graph.vertices.get(edge.vertexA)!
    const vB = graph.vertices.get(edge.vertexB)!
    const dx = vB.x - vA.x
    const dz = vB.z - vA.z
    mesh.rotation.y = -Math.atan2(dz, dx)  // negate for Babylon left-handed coords

    const mat = new StandardMaterial(`roadmat_${edgeId}`, this.scene)
    mat.diffuseColor = PLAYER_COLORS[color].clone()
    mat.specularColor = Color3.Black()
    mat.backFaceCulling = true
    mesh.material = mat

    this.pieces.set(edgeId, mesh)
  }

  removePiece(vertexId: string): void {
    const mesh = this.pieces.get(vertexId)
    if (mesh) {
      mesh.dispose()
      this.pieces.delete(vertexId)
    }
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private cloneTemplate(template: Mesh, name: string, x: number, z: number, color: PlayerColor): Mesh {
    const mesh = template.clone(name)!
    mesh.setEnabled(true)
    mesh.isPickable = false
    mesh.position.set(x, PIECE_BASE_Y, z)

    const mat = new StandardMaterial(`piecemat_${name}`, this.scene)
    mat.diffuseColor = PLAYER_COLORS[color].clone()
    mat.specularColor = Color3.Black()
    mat.backFaceCulling = true
    mesh.material = mat

    return mesh
  }

  /**
   * Load a GLB piece model using the same Z-negation pipeline as tileRenderer.ts.
   *
   * 1. Import GLB
   * 2. Read raw vertex data
   * 3. Negate Z (same coordinate fix as tiles)
   * 4. Center in XZ, base at Y=0
   * 5. Apply uniform scale
   * 6. Bake into new template mesh
   */
  private async loadPieceGLB(url: string, scale: number): Promise<Mesh> {
    const result = await SceneLoader.ImportMeshAsync('', '', url, this.scene)

    // Find first mesh with actual geometry (same pattern as tileRenderer)
    let srcMesh: Mesh | null = null
    for (const m of result.meshes) {
      if (m instanceof Mesh && m.getVerticesData(VertexBuffer.PositionKind)) {
        srcMesh = m
        break
      }
    }
    if (!srcMesh) {
      throw new Error(`No mesh with position data in ${url}`)
    }

    const rawPositions = srcMesh.getVerticesData(VertexBuffer.PositionKind)
    const rawNormals = srcMesh.getVerticesData(VertexBuffer.NormalKind)
    const rawColors = srcMesh.getVerticesData(VertexBuffer.ColorKind)
    const indices = srcMesh.getIndices()

    if (!rawPositions || !indices) {
      throw new Error(`Missing positions or indices in ${url}`)
    }

    const positions = new Float32Array(rawPositions)
    const normals = rawNormals ? new Float32Array(rawNormals) : null

    // Z-negation: same pipeline as tileRenderer.ts
    // Blender Z-up → GLTF Y-up → Babylon left-hand = negate Z
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
    let minY = Infinity
    let minZ = Infinity, maxZ = -Infinity
    for (let i = 0; i < positions.length; i += 3) {
      const px = positions[i], py = positions[i + 1], pz = positions[i + 2]
      if (px < minX) minX = px; if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (pz < minZ) minZ = pz; if (pz > maxZ) maxZ = pz
    }

    // Center in XZ, base at Y=0, then scale uniformly
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2
    for (let i = 0; i < positions.length; i += 3) {
      positions[i]     = (positions[i]     - cx) * scale
      positions[i + 1] = (positions[i + 1] - minY) * scale  // base at Y=0
      positions[i + 2] = (positions[i + 2] - cz) * scale
    }
    // Normals: uniform scale doesn't change direction, no rescaling needed

    // Build vertex data
    const fixedIndices = new Int32Array(indices)
    const vd = new VertexData()
    vd.positions = positions
    vd.indices = fixedIndices

    if (normals) {
      vd.normals = normals
    } else {
      // Fallback: compute normals and negate (same as tileRenderer)
      const recomputed = new Float32Array(positions.length)
      VertexData.ComputeNormals(positions, fixedIndices, recomputed)
      for (let i = 0; i < recomputed.length; i++) {
        recomputed[i] = -recomputed[i]
      }
      vd.normals = recomputed
    }

    if (rawColors) vd.colors = new Float32Array(rawColors)

    // Create template mesh
    const template = new Mesh(`template_piece_${url}`, this.scene)
    vd.applyToMesh(template, true)

    // Reset transform — geometry is fully baked
    template.rotationQuaternion = null
    template.rotation.copyFromFloats(0, 0, 0)
    template.scaling.copyFromFloats(1, 1, 1)
    template.position.copyFromFloats(0, 0, 0)

    // Default material for template
    const mat = new StandardMaterial(`template_mat_${url}`, this.scene)
    mat.diffuseColor = Color3.White()
    mat.specularColor = Color3.Black()
    mat.backFaceCulling = true
    template.material = mat

    // Dispose all imported meshes
    for (const m of result.meshes) {
      if (!m.isDisposed()) m.dispose()
    }

    return template
  }
}
