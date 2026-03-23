/**
 * boardOverlay.ts — Renders hoverable vertex and edge markers on the board.
 *
 * Vertex markers: flat discs at hex corners (settlement spots).
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
} from '@babylonjs/core'
import { BoardGraph } from './boardGraph'

// ─── Constants ───────────────────────────────────────────────────────────────

const VERTEX_Y = 0.14          // RING_TOP_Y (0.10) + small clearance

const EDGE_RADIUS = 0.08
const EDGE_HEIGHT = 1.9        // vertex-to-vertex (2.6) minus 2 × disc radius (0.35) = 1.9
const EDGE_Y = 0.14            // same level as vertex discs

// Emissive colors — no alpha manipulation, keeps alpha=1.0 for picking
const EMISSIVE_DEFAULT  = new Color3(0.7, 0.7, 0.7)   // soft white glow
const EMISSIVE_HOVER    = new Color3(1.0, 0.85, 0)     // yellow
const EMISSIVE_OCCUPIED = new Color3(0.2, 0.8, 0.2)    // green (legacy)
const EMISSIVE_VALID    = new Color3(0.2, 1.0, 0.2)    // bright green — valid placement
const EMISSIVE_INVALID  = new Color3(0.3, 0.3, 0.3)    // dimmed — can't place here
const EMISSIVE_RED      = new Color3(0.95, 0.1, 0.1)   // player red settlement/road
const EMISSIVE_BLUE     = new Color3(0.15, 0.45, 1.0)  // player blue settlement/road
const EMISSIVE_GOLD     = new Color3(1.0, 0.85, 0.2)   // golden glow for valid city upgrade

// ─── Types ───────────────────────────────────────────────────────────────────

export type MarkerState = 'empty' | 'hover' | 'occupied' | 'valid' | 'invalid'
  | 'player-red' | 'player-blue'
  | 'player-red-city' | 'player-blue-city'
  | 'piece-placed'       // invisible but still pickable for city upgrade
  | 'valid-city'
  | 'road-placed'        // invisible edge bar but still pickable for adjacency

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emissiveForState(state: MarkerState): Color3 {
  switch (state) {
    case 'empty':            return EMISSIVE_DEFAULT.clone()
    case 'hover':            return EMISSIVE_HOVER.clone()
    case 'occupied':         return EMISSIVE_OCCUPIED.clone()
    case 'valid':            return EMISSIVE_VALID.clone()
    case 'invalid':          return EMISSIVE_INVALID.clone()
    case 'player-red':       return EMISSIVE_RED.clone()
    case 'player-blue':      return EMISSIVE_BLUE.clone()
    case 'player-red-city':  return EMISSIVE_RED.clone()
    case 'player-blue-city': return EMISSIVE_BLUE.clone()
    case 'piece-placed':     return Color3.Black()
    case 'valid-city':       return EMISSIVE_GOLD.clone()
    case 'road-placed':      return Color3.Black()
  }
}

/** Returns the scale factor for a vertex marker based on state */
function scaleForState(state: MarkerState): number {
  switch (state) {
    case 'player-red-city':
    case 'player-blue-city':
      return 1.4
    default:
      return 1.0
  }
}

// ─── Overlay Builder ─────────────────────────────────────────────────────────

export function createBoardOverlay(
  scene: Scene,
  graph: BoardGraph,
  options: {
    onVertexClick?: (id: string) => void
    onEdgeClick?: (id: string) => void
  } = {}
): {
  dispose: () => void
  setVertexState: (id: string, state: MarkerState) => void
  setEdgeState: (id: string, state: MarkerState) => void
} {
  const vertexMeshes = new Map<string, Mesh>()
  const edgeMeshes = new Map<string, Mesh>()
  const vertexMaterials = new Map<string, StandardMaterial>()
  const edgeMaterials = new Map<string, StandardMaterial>()

  // Track current state per marker so hover can restore correctly
  const vertexStates = new Map<string, MarkerState>()
  const edgeStates = new Map<string, MarkerState>()

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
    mat.backFaceCulling = true
    mat.alpha = 1.0  // MUST be 1.0 for picking to work
    disc.material = mat
    disc.isPickable = true

    vertexStates.set(id, 'empty')

    // Hover + click interaction
    disc.actionManager = new ActionManager(scene)
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        const currentState = vertexStates.get(id) || 'empty'
        // Only hover-highlight if it's a valid placement or city upgrade
        if (currentState === 'valid' || currentState === 'valid-city') {
          mat.emissiveColor = EMISSIVE_HOVER.clone()
        }
      })
    )
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        const currentState = vertexStates.get(id) || 'empty'
        mat.emissiveColor = emissiveForState(currentState)
      })
    )
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        options.onVertexClick?.(id)
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
    const vA = graph.vertices.get(edge.vertexA)
    const vB = graph.vertices.get(edge.vertexB)
    if (vA && vB) {
      const dx = vB.x - vA.x
      const dz = vB.z - vA.z
      const angle = Math.atan2(dz, dx)
      cylinder.rotation.set(0, 0, Math.PI / 2)
      cylinder.rotation.y = -angle
    }

    const mat = new StandardMaterial(`edgeMat_${id}`, scene)
    mat.diffuseColor = Color3.Black()
    mat.emissiveColor = EMISSIVE_DEFAULT.clone()
    mat.specularColor = Color3.Black()
    mat.backFaceCulling = true
    mat.alpha = 1.0  // MUST be 1.0 for picking to work
    cylinder.material = mat
    cylinder.isPickable = true

    edgeStates.set(id, 'empty')

    // Hover + click interaction
    cylinder.actionManager = new ActionManager(scene)
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        const currentState = edgeStates.get(id) || 'empty'
        if (currentState === 'valid') {
          mat.emissiveColor = EMISSIVE_HOVER.clone()
        }
      })
    )
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        const currentState = edgeStates.get(id) || 'empty'
        mat.emissiveColor = emissiveForState(currentState)
      })
    )
    cylinder.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        options.onEdgeClick?.(id)
      })
    )

    edgeMeshes.set(id, cylinder)
    edgeMaterials.set(id, mat)
  }

  // ─── State setters ─────────────────────────────────────────────────

  function setVertexState(id: string, state: MarkerState): void {
    const mat = vertexMaterials.get(id)
    const mesh = vertexMeshes.get(id)
    if (!mat || !mesh) return
    vertexStates.set(id, state)
    mat.emissiveColor = emissiveForState(state)
    const s = scaleForState(state)
    mesh.scaling.set(s, 1, s)  // scale XZ only (diameter), keep Y (height)

    // piece-placed: invisible but pickable (city upgrade clicks)
    // valid: visible and pickable (player can click)
    // everything else (empty, invalid, occupied): visible but NOT pickable (no hand cursor)
    if (state === 'piece-placed') {
      mesh.isVisible = false
      mesh.isPickable = true
    } else if (state === 'valid' || state === 'valid-city') {
      mesh.isVisible = true
      mesh.isPickable = true
    } else {
      mesh.isVisible = true
      mesh.isPickable = false
    }
  }

  function setEdgeState(id: string, state: MarkerState): void {
    const mat = edgeMaterials.get(id)
    const mesh = edgeMeshes.get(id)
    if (!mat || !mesh) return
    edgeStates.set(id, state)
    mat.emissiveColor = emissiveForState(state)

    // road-placed: invisible but pickable (adjacency checks)
    // valid: visible and pickable
    // everything else: visible but NOT pickable (no hand cursor)
    if (state === 'road-placed') {
      mesh.isVisible = false
      mesh.isPickable = true
    } else if (state === 'valid') {
      mesh.isVisible = true
      mesh.isPickable = true
    } else {
      mesh.isVisible = true
      mesh.isPickable = false
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
