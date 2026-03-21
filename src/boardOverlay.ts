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

const VERTEX_RADIUS = 0.15     // slightly larger for visibility
const VERTEX_Y = 0.55          // above landscape base top (~0.40) + clearance

const EDGE_RADIUS = 0.08
const EDGE_HEIGHT = 0.6        // longer for visibility
const EDGE_Y = 0.50            // above landscape base top

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
    const sphere = MeshBuilder.CreateSphere(`vtx_${id}`, { diameter: VERTEX_RADIUS * 2, segments: 8 }, scene)
    sphere.position.set(vertex.x, VERTEX_Y, vertex.z)

    const mat = new StandardMaterial(`vtxMat_${id}`, scene)
    mat.diffuseColor = Color3.Black()
    mat.emissiveColor = EMISSIVE_DEFAULT.clone()
    mat.specularColor = Color3.Black()
    mat.alpha = 1.0  // MUST be 1.0 for picking to work
    sphere.material = mat
    sphere.isPickable = true

    // Hover interaction
    sphere.actionManager = new ActionManager(scene)
    sphere.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.emissiveColor = EMISSIVE_HOVER.clone()
      })
    )
    sphere.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.emissiveColor = EMISSIVE_DEFAULT.clone()
      })
    )

    vertexMeshes.set(id, sphere)
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
