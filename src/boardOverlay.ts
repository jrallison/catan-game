/**
 * boardOverlay.ts — Renders hoverable vertex and edge markers on the board.
 *
 * Vertex markers: small spheres at hex corners (settlement spots).
 * Edge markers: thin cylinders at edge midpoints (road spots).
 * Both highlight yellow on hover.
 *
 * Materials use emissiveColor (not alpha) so Babylon's pick system works
 * reliably — meshes with alpha < 1.0 are skipped by the pointer ray.
 */

import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ActionManager,
  ExecuteCodeAction,
  Mesh,
  Vector3,
} from '@babylonjs/core'
import { BoardGraph } from './boardGraph'

// ─── Constants ───────────────────────────────────────────────────────────────

const VERTEX_Y = 0.20          // base_Y(-0.21) + outer_edge_top(0.342) + clearance

const EDGE_RADIUS = 0.08
const EDGE_HEIGHT = 1.9        // vertex-to-vertex (2.6) minus 2 × disc radius (0.35) = 1.9
const EDGE_Y = 0.20            // same level as vertex discs

// Emissive colors — no alpha manipulation, keeps alpha=1.0 for picking
const EMISSIVE_DEFAULT  = new Color3(0.7, 0.7, 0.7)   // soft white glow
const EMISSIVE_HOVER    = new Color3(1.0, 0.85, 0)     // yellow
const EMISSIVE_OCCUPIED = new Color3(0.2, 0.8, 0.2)    // green (for later)

// ─── Types ───────────────────────────────────────────────────────────────────

type MarkerState = 'empty' | 'hover' | 'occupied'

// ─── Overlay Builder ─────────────────────────────────────────────────────────

export function createBoardOverlay(scene: Scene, graph: BoardGraph): {
  dispose: () => void
  setVertexState: (id: string, state: MarkerState) => void
  setEdgeState: (id: string, state: MarkerState) => void
} {
  const vertexMeshes = new Map<string, Mesh>()
  const edgeMeshes = new Map<string, Mesh>()
  const vertexMaterials = new Map<string, StandardMaterial>()
  const edgeMaterials = new Map<string, StandardMaterial>()

  // ─── Create vertex markers ─────────────────────────────────────────

  for (const [id, vertex] of graph.vertices) {
    // Flat disc for settlement spot — lies flat in XZ plane
    const disc = MeshBuilder.CreateCylinder(`vtx_${id}`, {
      diameter: 0.7,       // fills the settlement circle on the border
      height: 0.04,        // flat disc, just thick enough to see
      tessellation: 16,
    }, scene)
    disc.position.set(vertex.x, VERTEX_Y, vertex.z)

    const mat = new StandardMaterial(`vtxMat_${id}`, scene)
    mat.diffuseColor = Color3.Black()
    mat.emissiveColor = EMISSIVE_DEFAULT.clone()
    mat.specularColor = Color3.Black()
    mat.alpha = 1.0  // MUST be 1.0 for picking to work
    disc.material = mat
    disc.isPickable = true

    // Hover interaction
    disc.actionManager = new ActionManager(scene)
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.emissiveColor = EMISSIVE_HOVER.clone()
      })
    )
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.emissiveColor = EMISSIVE_DEFAULT.clone()
      })
    )

    vertexMeshes.set(id, disc)
    vertexMaterials.set(id, mat)
  }

  // ─── Create edge markers ───────────────────────────────────────────

  for (const [id, edge] of graph.edges) {
    const cylinder = MeshBuilder.CreateCylinder(`edge_${id}`, {
      diameter: EDGE_RADIUS * 2,
      height: EDGE_HEIGHT,
      tessellation: 8,
    }, scene)

    cylinder.position.set(edge.x, EDGE_Y, edge.z)

    // Rotate cylinder to lie along the edge direction.
    // Babylon cylinders are vertical (Y-axis) by default.
    // We need to rotate to align with the edge direction in the XZ plane.
    const vA = graph.vertices.get(edge.vertexA)
    const vB = graph.vertices.get(edge.vertexB)
    if (vA && vB) {
      const dx = vB.x - vA.x
      const dz = vB.z - vA.z
      const angle = Math.atan2(dz, dx)
      // Rotate: first tilt cylinder to lie flat (rotate 90° around X),
      // then rotate around Y to match edge direction
      cylinder.rotation.set(0, 0, Math.PI / 2)
      cylinder.rotation.y = -angle
    }

    const mat = new StandardMaterial(`edgeMat_${id}`, scene)
    mat.diffuseColor = Color3.Black()
    mat.emissiveColor = EMISSIVE_DEFAULT.clone()
    mat.specularColor = Color3.Black()
    mat.alpha = 1.0  // MUST be 1.0 for picking to work
    cylinder.material = mat
    cylinder.isPickable = true

    // Hover interaction
    cylinder.actionManager = new ActionManager(scene)
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.emissiveColor = EMISSIVE_HOVER.clone()
      })
    )
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.emissiveColor = EMISSIVE_DEFAULT.clone()
      })
    )

    edgeMeshes.set(id, cylinder)
    edgeMaterials.set(id, mat)
  }

  // ─── State setters ─────────────────────────────────────────────────

  function setVertexState(id: string, state: MarkerState): void {
    const mat = vertexMaterials.get(id)
    if (!mat) return
    switch (state) {
      case 'empty':
        mat.emissiveColor = EMISSIVE_DEFAULT.clone()
        break
      case 'hover':
        mat.emissiveColor = EMISSIVE_HOVER.clone()
        break
      case 'occupied':
        mat.emissiveColor = EMISSIVE_OCCUPIED.clone()
        break
    }
  }

  function setEdgeState(id: string, state: MarkerState): void {
    const mat = edgeMaterials.get(id)
    if (!mat) return
    switch (state) {
      case 'empty':
        mat.emissiveColor = EMISSIVE_DEFAULT.clone()
        break
      case 'hover':
        mat.emissiveColor = EMISSIVE_HOVER.clone()
        break
      case 'occupied':
        mat.emissiveColor = EMISSIVE_OCCUPIED.clone()
        break
    }
  }

  // ─── Dispose ───────────────────────────────────────────────────────

  function dispose(): void {
    for (const mesh of vertexMeshes.values()) mesh.dispose()
    for (const mesh of edgeMeshes.values()) mesh.dispose()
    for (const mat of vertexMaterials.values()) mat.dispose()
    for (const mat of edgeMaterials.values()) mat.dispose()
    vertexMeshes.clear()
    edgeMeshes.clear()
    vertexMaterials.clear()
    edgeMaterials.clear()
  }

  return { dispose, setVertexState, setEdgeState }
}
