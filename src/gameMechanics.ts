import { GameState, Player, ResourceHand } from './gameState'
import { BoardGraph } from './boardGraph'
import { TileType, ResourceType } from './types'
import { createStandardBoard, HarborDef, axialToWorld } from './board'

// ─── Victory Points ───────────────────────────────────────────────────────────

export function calculateVP(player: Player): number {
  return player.settlements.length * 1
       + player.cities.length * 2
}

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

// ─── Robber Helpers ──────────────────────────────────────────────────────────

/** Total number of resource cards in a hand */
export function totalCards(hand: ResourceHand): number {
  return hand.wood + hand.brick + hand.ore + hand.wheat + hand.wool
}

/** Auto-discard half the cards (rounded down) randomly */
export function autoDiscard(hand: ResourceHand): ResourceHand {
  const total = totalCards(hand)
  if (total <= 7) return hand
  const toDiscard = Math.floor(total / 2)
  const newHand = { ...hand }
  let discarded = 0
  const types: ResourceType[] = ['wood', 'brick', 'ore', 'wheat', 'wool']
  while (discarded < toDiscard) {
    const available = types.filter(t => newHand[t] > 0)
    if (!available.length) break
    const pick = available[Math.floor(Math.random() * available.length)]
    newHand[pick]--
    discarded++
  }
  return newHand
}

// ─── Trading ─────────────────────────────────────────────────────────────────

/**
 * Returns the best trade rate for each resource the current player can give.
 * 4 = bank rate, 3 = any 3:1 harbor, 2 = matching 2:1 harbor.
 */
export function getTradeRates(
  player: Player,
  graph: BoardGraph,
  harborDefs: HarborDef[],
): Record<ResourceType, 2 | 3 | 4> {
  const rates: Record<ResourceType, 2 | 3 | 4> = {
    wood: 4, brick: 4, ore: 4, wheat: 4, wool: 4,
  }

  const occupied = new Set([...player.settlements, ...player.cities])

  const HEX_SIZE = 2.6
  for (const harbor of harborDefs) {
    const landKey = `${harbor.landQ},${harbor.landR}`
    // Harbor water tiles are excluded from boardGraph, so we can't use adjacentTiles
    // to identify shared-edge vertices. Instead, check geometric proximity:
    // shared-edge vertices sit at distance ~HEX_SIZE from the harbor tile center,
    // while other land vertices are at ~HEX_SIZE*sqrt(3) away.
    const harborWorld = axialToWorld(harbor.q, harbor.r)
    const SHARED_THRESHOLD = HEX_SIZE * 1.5  // ~3.9; shared ≈ 2.6, non-shared ≈ 4.5

    for (const [vid, vertex] of graph.vertices) {
      if (!vertex.adjacentTiles.includes(landKey)) continue
      const dx = vertex.x - harborWorld.x
      const dz = vertex.z - harborWorld.z
      if (Math.sqrt(dx * dx + dz * dz) > SHARED_THRESHOLD) continue
      if (!occupied.has(vid)) continue

      if (harbor.type === '3:1') {
        for (const r of Object.keys(rates) as ResourceType[]) {
          if (rates[r] > 3) rates[r] = 3
        }
      } else {
        const res = harbor.type as ResourceType
        rates[res] = 2
      }
    }
  }

  return rates
}

/** Execute a bank/harbor trade — deduct giveCount of give, gain 1 of receive */
export function executeTrade(
  state: GameState,
  give: ResourceType,
  giveCount: number,
  receive: ResourceType,
): GameState {
  const player = state.players[state.currentPlayerIndex]
  if (player.hand[give] < giveCount) return state
  const newHand = {
    ...player.hand,
    [give]: player.hand[give] - giveCount,
    [receive]: player.hand[receive] + 1,
  }
  const players = [...state.players]
  players[state.currentPlayerIndex] = { ...player, hand: newHand }
  return { ...state, players }
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

    // Robber blocks resource production on its tile
    if (q === state.robberQ && r === state.robberR) continue

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
