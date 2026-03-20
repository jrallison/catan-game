/**
 * boardOverlay.ts — Renders hoverable vertex and edge markers on the board.
 *
 * Vertex markers: small spheres at hex corners (settlement spots).
 * Edge markers: thin cylinders at edge midpoints (road spots).
 * Both highlight yellow on hover.
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

const VERTEX_RADIUS = 0.12
const VERTEX_Y = 0.3          // above ground

const EDGE_RADIUS = 0.05
const EDGE_HEIGHT = 0.4
const EDGE_Y = 0.15           // above ground

const COLOR_DEFAULT = new Color3(1, 1, 1)
const COLOR_HOVER = new Color3(1, 0.9, 0)

const ALPHA_VERTEX_DEFAULT = 0.5
const ALPHA_EDGE_DEFAULT = 0.3
const ALPHA_HOVER = 1.0

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
    mat.diffuseColor = COLOR_DEFAULT.clone()
    mat.alpha = ALPHA_VERTEX_DEFAULT
    mat.specularColor = Color3.Black()
    sphere.material = mat

    // Hover interaction
    sphere.actionManager = new ActionManager(scene)
    sphere.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
      })
    )
    sphere.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.diffuseColor = COLOR_DEFAULT.clone()
        mat.alpha = ALPHA_VERTEX_DEFAULT
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
    mat.diffuseColor = COLOR_DEFAULT.clone()
    mat.alpha = ALPHA_EDGE_DEFAULT
    mat.specularColor = Color3.Black()
    cylinder.material = mat

    // Hover interaction
    cylinder.actionManager = new ActionManager(scene)
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
      })
    )
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.diffuseColor = COLOR_DEFAULT.clone()
        mat.alpha = ALPHA_EDGE_DEFAULT
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
        mat.diffuseColor = COLOR_DEFAULT.clone()
        mat.alpha = ALPHA_VERTEX_DEFAULT
        break
      case 'hover':
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
        break
      case 'occupied':
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
        break
    }
  }

  function setEdgeState(id: string, state: MarkerState): void {
    const mat = edgeMaterials.get(id)
    if (!mat) return
    switch (state) {
      case 'empty':
        mat.diffuseColor = COLOR_DEFAULT.clone()
        mat.alpha = ALPHA_EDGE_DEFAULT
        break
      case 'hover':
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
        break
      case 'occupied':
        mat.diffuseColor = COLOR_HOVER.clone()
        mat.alpha = ALPHA_HOVER
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
