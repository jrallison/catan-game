/**
 * boardGraph.ts — Computes the vertex/edge graph for the Catan board.
 *
 * Derives vertex and edge positions from hex tile geometry. Adjacent hexes
 * share vertices and edges; deduplication uses coordinate keys rounded to
 * 2 decimal places.
 *
 * Standard Catan board: 54 vertices, 72 edges.
 */

import { HexTile } from './types'
import { axialToWorld } from './board'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BoardVertex {
  id: string              // "x,z" rounded to 2dp
  x: number
  y: number
  z: number
  adjacentTiles: string[]    // tile keys "q,r" of adjacent hexes (1–3)
  adjacentEdges: string[]    // edge ids
  adjacentVertices: string[] // neighboring vertex ids (distance-1 neighbors)
}

export interface BoardEdge {
  id: string              // "midX,midZ" rounded to 2dp
  x: number               // midpoint
  y: number
  z: number
  vertexA: string         // vertex id
  vertexB: string         // vertex id
  adjacentTiles: string[] // 1 or 2 tile keys
}

export interface BoardGraph {
  vertices: Map<string, BoardVertex>
  edges: Map<string, BoardEdge>
}

// ─── Constants ───────────────────────────────────────────────────────────────

const HEX_RADIUS = 2.6
const VERTEX_Y = 0.05

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeKey(x: number, z: number): string {
  return `${x.toFixed(2)},${z.toFixed(2)}`
}

/**
 * Compute the 6 corner vertices of a flat-top hex centered at (cx, cz).
 * Returns array of {x, z} for i = 0..5, angle = i * 60°.
 */
function hexCorners(cx: number, cz: number): { x: number; z: number }[] {
  const corners: { x: number; z: number }[] = []
  for (let i = 0; i < 6; i++) {
    const angleDeg = i * 60
    const angleRad = angleDeg * Math.PI / 180
    corners.push({
      x: cx + HEX_RADIUS * Math.cos(angleRad),
      z: cz + HEX_RADIUS * Math.sin(angleRad),
    })
  }
  return corners
}

// ─── Graph Builder ───────────────────────────────────────────────────────────

export function buildBoardGraph(tiles: HexTile[]): BoardGraph {
  // Filter to land tiles only (settlements/roads don't go on water)
  const landTiles = tiles.filter(t => t.type !== 'water' && t.type !== 'harbor_water')

  const vertices = new Map<string, BoardVertex>()
  const edges = new Map<string, BoardEdge>()

  // Pass 1: Create all vertices (deduplicated by rounded key)
  // Store per-tile vertex id lists for edge creation in pass 2
  const tileVertexIds: string[][] = []

  for (const tile of landTiles) {
    const tileKey = `${tile.q},${tile.r}`
    const { x: cx, z: cz } = axialToWorld(tile.q, tile.r)
    const corners = hexCorners(cx, cz)

    const vertexIds: string[] = []
    for (const corner of corners) {
      const vid = makeKey(corner.x, corner.z)
      vertexIds.push(vid)

      if (!vertices.has(vid)) {
        vertices.set(vid, {
          id: vid,
          x: corner.x,
          y: VERTEX_Y,
          z: corner.z,
          adjacentTiles: [tileKey],
          adjacentEdges: [],
          adjacentVertices: [],
        })
      } else {
        const v = vertices.get(vid)!
        if (!v.adjacentTiles.includes(tileKey)) {
          v.adjacentTiles.push(tileKey)
        }
      }
    }

    tileVertexIds.push(vertexIds)
  }

  // Pass 2: Create edges using deduplicated vertex positions for midpoint calc.
  // This avoids floating-point drift when the same edge is computed from two
  // different hex centers.
  for (let t = 0; t < landTiles.length; t++) {
    const tile = landTiles[t]
    const tileKey = `${tile.q},${tile.r}`
    const vertexIds = tileVertexIds[t]

    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6
      const vA = vertexIds[i]
      const vB = vertexIds[j]

      // Use canonical vertex positions for consistent midpoint
      const vertA = vertices.get(vA)!
      const vertB = vertices.get(vB)!
      const midX = (vertA.x + vertB.x) / 2
      const midZ = (vertA.z + vertB.z) / 2
      const eid = makeKey(midX, midZ)

      if (!edges.has(eid)) {
        edges.set(eid, {
          id: eid,
          x: midX,
          y: VERTEX_Y,
          z: midZ,
          vertexA: vA,
          vertexB: vB,
          adjacentTiles: [tileKey],
        })
      } else {
        const e = edges.get(eid)!
        if (!e.adjacentTiles.includes(tileKey)) {
          e.adjacentTiles.push(tileKey)
        }
      }
    }
  }

  // Build adjacency: for each edge, link its two vertices as neighbors
  // and register the edge on both vertices
  for (const [eid, edge] of edges) {
    const vA = vertices.get(edge.vertexA)
    const vB = vertices.get(edge.vertexB)

    if (vA) {
      if (!vA.adjacentEdges.includes(eid)) vA.adjacentEdges.push(eid)
      if (!vA.adjacentVertices.includes(edge.vertexB)) vA.adjacentVertices.push(edge.vertexB)
    }
    if (vB) {
      if (!vB.adjacentEdges.includes(eid)) vB.adjacentEdges.push(eid)
      if (!vB.adjacentVertices.includes(edge.vertexA)) vB.adjacentVertices.push(edge.vertexA)
    }
  }

  return { vertices, edges }
}
