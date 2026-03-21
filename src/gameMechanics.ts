import { GameState, ResourceHand } from './gameState'
import { BoardGraph } from './boardGraph'
import { TileType, ResourceType } from './types'
import { createStandardBoard } from './board'

/** Returns vertex ids where a settlement CAN be placed by current player */
export function getValidSettlementPlacements(state: GameState, graph: BoardGraph): string[] {
  const allVertexIds = [...graph.vertices.keys()]
  return allVertexIds.filter(id => isValidSettlementPlacement(id, state, graph))
}

function isValidSettlementPlacement(vertexId: string, state: GameState, graph: BoardGraph): boolean {
  // 1. Not already occupied
  const allSettlements = state.players.flatMap(p => [...p.settlements, ...p.cities])
  if (allSettlements.includes(vertexId)) return false

  // 2. Distance rule: no adjacent vertex has a settlement
  const vertex = graph.vertices.get(vertexId)!
  for (const adjId of vertex.adjacentVertices) {
    if (allSettlements.includes(adjId)) return false
  }

  return true
}

/** Returns edge ids where a road CAN be placed — during initial placement,
 *  must connect to lastPlacedSettlement */
export function getValidRoadPlacements(state: GameState, graph: BoardGraph): string[] {
  if (state.phase === 'initial-placement' && state.lastPlacedSettlement) {
    // Road must connect to the settlement just placed
    const vertex = graph.vertices.get(state.lastPlacedSettlement)
    if (!vertex) return []
    const occupiedRoads = state.players.flatMap(p => p.roads)
    return vertex.adjacentEdges.filter(eid => !occupiedRoads.includes(eid))
  }
  return []
}

/** Place a settlement — returns updated state */
export function placeSettlement(vertexId: string, state: GameState): GameState {
  const updated = {
    ...state,
    players: state.players.map((p, i) =>
      i === state.currentPlayerIndex
        ? { ...p, settlements: [...p.settlements, vertexId] }
        : p
    ),
    initialPlacementStep: 'place-road' as const,
    lastPlacedSettlement: vertexId,
  }
  return updated
}

/** Place a road — returns updated state, advances turn */
export function placeRoad(edgeId: string, state: GameState): GameState {
  const withRoad = {
    ...state,
    players: state.players.map((p, i) =>
      i === state.currentPlayerIndex
        ? { ...p, roads: [...p.roads, edgeId] }
        : p
    ),
  }
  return advanceInitialPlacement(withRoad)
}

function advanceInitialPlacement(state: GameState): GameState {
  const nextPos = state.initialPlacementOrderPos + 1
  if (nextPos >= state.initialPlacementOrder.length) {
    // All initial placements done — transition to main game
    return {
      ...state,
      phase: 'main-game',
      initialPlacementStep: 'place-settlement',
      initialPlacementOrderPos: nextPos,
      lastPlacedSettlement: null,
      turnPhase: 'roll',
      lastRoll: null,
    }
  }
  return {
    ...state,
    currentPlayerIndex: state.initialPlacementOrder[nextPos],
    initialPlacementStep: 'place-settlement',
    initialPlacementOrderPos: nextPos,
    lastPlacedSettlement: null,
  }
}

// ─── Resource Distribution ────────────────────────────────────────────────────

/** TileType → ResourceType mapping */
const TILE_RESOURCE: Partial<Record<TileType, ResourceType>> = {
  wood:  'wood',
  brick: 'brick',
  ore:   'ore',
  wheat: 'wheat',
  wool:  'wool',
}

/**
 * Given a dice roll, distribute resources to all players.
 * Each settlement adjacent to a tile with that number token gets 1 of that resource.
 * Each city gets 2. Desert and 7s produce nothing.
 */
export function distributeResources(
  roll: number,
  state: GameState,
  graph: BoardGraph,
  numberTokens: Map<string, number>
): GameState {
  if (roll === 7) return state  // robber — skip for now

  const board = createStandardBoard()
  const updatedPlayers = state.players.map(p => ({ ...p, hand: { ...p.hand } }))

  for (const [tileKey, tokenValue] of numberTokens) {
    if (tokenValue !== roll) continue

    const [q, r] = tileKey.split(',').map(Number)
    const tile = board.find(t => t.q === q && t.r === r)
    if (!tile) continue
    const resource = TILE_RESOURCE[tile.type]
    if (!resource) continue

    for (const [vertexId, vertex] of graph.vertices) {
      if (!vertex.adjacentTiles.includes(tileKey)) continue

      for (let i = 0; i < updatedPlayers.length; i++) {
        const p = updatedPlayers[i]
        if (p.settlements.includes(vertexId)) {
          updatedPlayers[i] = { ...p, hand: { ...p.hand, [resource]: p.hand[resource] + 1 } }
        } else if (p.cities.includes(vertexId)) {
          updatedPlayers[i] = { ...p, hand: { ...p.hand, [resource]: p.hand[resource] + 2 } }
        }
      }
    }
  }

  return { ...state, players: updatedPlayers }
}
