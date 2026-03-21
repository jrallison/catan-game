import { GameState, ResourceHand } from './gameState'
import { BoardGraph } from './boardGraph'
import { TileType, ResourceType } from './types'
import { createStandardBoard } from './board'

// ─── Build Costs ──────────────────────────────────────────────────────────────

export const BUILD_COSTS = {
  road:       { wood: 1, brick: 1, ore: 0, wheat: 0, wool: 0 },
  settlement: { wood: 1, brick: 1, ore: 0, wheat: 1, wool: 1 },
  city:       { wood: 0, brick: 0, ore: 3, wheat: 2, wool: 0 },
} satisfies Record<string, ResourceHand>

/** Returns vertex ids where a settlement CAN be placed by current player */
export function getValidSettlementPlacements(state: GameState, graph: BoardGraph): string[] {
  const allVertexIds = [...graph.vertices.keys()]
  return allVertexIds.filter(id => isValidSettlementPlacement(id, state, graph))
}

export function isValidSettlementPlacement(vertexId: string, state: GameState, graph: BoardGraph): boolean {
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

// ─── Build Phase Actions ──────────────────────────────────────────────────────

/** Returns true if player can afford the build cost */
export function canAfford(hand: ResourceHand, cost: ResourceHand): boolean {
  return (Object.keys(cost) as ResourceType[]).every(r => hand[r] >= cost[r])
}

/** Deduct resources from hand — assumes canAfford already checked */
export function deductCost(hand: ResourceHand, cost: ResourceHand): ResourceHand {
  const result = { ...hand }
  for (const r of Object.keys(cost) as ResourceType[]) result[r] -= cost[r]
  return result
}

/** Returns valid settlement build locations (distance rule + connected road) */
export function getValidSettlementBuildLocations(state: GameState, graph: BoardGraph): string[] {
  const player = state.players[state.currentPlayerIndex]
  if (!canAfford(player.hand, BUILD_COSTS.settlement)) return []
  return [...graph.vertices.keys()].filter(id => {
    if (!isValidSettlementPlacement(id, state, graph)) return false
    const vertex = graph.vertices.get(id)!
    return vertex.adjacentEdges.some(eid => player.roads.includes(eid))
  })
}

/** Returns valid road build locations (connected to player's network, not occupied) */
export function getValidRoadBuildLocations(state: GameState, graph: BoardGraph): string[] {
  const player = state.players[state.currentPlayerIndex]
  if (!canAfford(player.hand, BUILD_COSTS.road)) return []
  const occupied = state.players.flatMap(p => p.roads)
  return [...graph.edges.keys()].filter(eid => {
    if (occupied.includes(eid)) return false
    const edge = graph.edges.get(eid)!
    const edgeVerts = [edge.vertexA, edge.vertexB]
    return edgeVerts.some(vid =>
      player.settlements.includes(vid) || player.cities.includes(vid) ||
      graph.vertices.get(vid)!.adjacentEdges.some(e => player.roads.includes(e))
    )
  })
}

/** Returns vertices where player can upgrade settlement → city */
export function getValidCityUpgrades(state: GameState): string[] {
  const player = state.players[state.currentPlayerIndex]
  if (!canAfford(player.hand, BUILD_COSTS.city)) return []
  return player.settlements
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
