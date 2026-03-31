/**
 * pieceSync.ts — Synchronises 3D piece meshes with game state.
 *
 * Reads player settlements/cities/roads from GameState and ensures
 * matching 3D models exist via PieceRenderer.
 */

import { GameState, PlayerColor } from './gameState'
import { BoardGraph } from './boardGraph'
import { PieceRenderer } from './pieceRenderer'
import { MarkerState } from './boardOverlay'

export interface PieceSync {
  sync(state: GameState): void
}

export function createPieceSync(
  pieceRenderer: PieceRenderer,
  graph: BoardGraph,
  overlay: { setEdgeState: (id: string, state: MarkerState) => void },
): PieceSync {
  function sync(state: GameState): void {
    const allSettlements = new Map<string, { color: PlayerColor }>()
    const allCities = new Map<string, { color: PlayerColor }>()

    for (const player of state.players) {
      for (const vid of player.settlements) {
        allSettlements.set(vid, { color: player.color })
      }
      for (const vid of player.cities) {
        allCities.set(vid, { color: player.color })
      }
    }

    // Place settlements (only if not already placed)
    for (const [vid, { color }] of allSettlements) {
      if (!pieceRenderer.hasPiece(vid)) {
        const v = graph.vertices.get(vid)
        if (v) pieceRenderer.placeSettlement(vid, v.x, v.z, color)
      }
    }

    // Upgrade cities (upgradeToCity handles removing the old settlement mesh)
    for (const [vid, { color }] of allCities) {
      const v = graph.vertices.get(vid)
      if (v) pieceRenderer.upgradeToCity(vid, v.x, v.z, color)
    }

    // Place road 3D models
    for (const player of state.players) {
      for (const eid of player.roads) {
        if (!pieceRenderer.hasPiece(eid)) {
          const edge = graph.edges.get(eid)!
          pieceRenderer.placeRoad(eid, edge, graph, player.color)
        }
        overlay.setEdgeState(eid, 'road-placed')
      }
    }
  }

  return { sync }
}
