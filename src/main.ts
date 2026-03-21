import { createScene } from './scene'
import { createStandardBoard } from './board'
import { renderTiles } from './tileRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'
import { createInitialGameState, GameState } from './gameState'
import {
  getValidSettlementPlacements, getValidRoadPlacements, placeSettlement, placeRoad,
  distributeResources, BUILD_COSTS, deductCost,
  getValidSettlementBuildLocations, getValidRoadBuildLocations, getValidCityUpgrades,
} from './gameMechanics'
import { BuildMode } from './gameState'
import { createHud } from './hud'

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const { engine, scene } = createScene(canvas)

  // Create the standard Catan board
  const board = createStandardBoard()

  // Render hex tiles from GLB models
  await renderTiles(scene, board)

  // Create procedural hex rings around each tile
  createHexRings(scene, board)

  // Render number tokens on land tiles
  await renderNumberTokens(scene, board)

  // Build vertex/edge graph
  const graph = buildBoardGraph(board)
  console.log(`Vertices: ${graph.vertices.size}`)
  console.log(`Edges: ${graph.edges.size}`)

  // Build number token map for resource distribution
  const numberTokens = new Map<string, number>()
  for (const tile of board) {
    if (tile.number) {
      numberTokens.set(`${tile.q},${tile.r}`, tile.number)
    }
  }

  // ─── Game state ────────────────────────────────────────────────────
  let state: GameState = createInitialGameState()

  function handleRoll(): void {
    if (state.phase !== 'main-game' || state.turnPhase !== 'roll') return
    const d1 = Math.ceil(Math.random() * 6)
    const d2 = Math.ceil(Math.random() * 6)
    const roll = d1 + d2
    state = {
      ...state,
      lastRoll: [d1, d2],
      turnPhase: 'build',
    }
    state = distributeResources(roll, state, graph, numberTokens)
    hud.showDiceResult([d1, d2])
    applyGameState()
  }

  function handleEndTurn(): void {
    if (state.phase !== 'main-game' || state.turnPhase !== 'build') return
    const nextPlayer = (state.currentPlayerIndex + 1) % state.players.length
    state = {
      ...state,
      currentPlayerIndex: nextPlayer,
      turnPhase: 'roll',
      lastRoll: null,
      buildMode: 'none',
    }
    applyGameState()
  }

  function handleBuildMode(mode: BuildMode): void {
    if (state.phase !== 'main-game' || state.turnPhase !== 'build') return
    // Toggle: clicking same mode cancels it
    state = { ...state, buildMode: state.buildMode === mode ? 'none' : mode }
    applyGameState()
  }

  const hud = createHud({ onRoll: handleRoll, onEndTurn: handleEndTurn, onBuildMode: handleBuildMode })

  function applyGameState(): void {
    const player = state.players[state.currentPlayerIndex]

    if (state.phase === 'initial-placement') {
      if (state.initialPlacementStep === 'place-settlement') {
        const valid = new Set(getValidSettlementPlacements(state, graph))
        for (const [id] of graph.vertices) {
          const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
          if (isOccupied) {
            const owner = state.players.find(p => p.settlements.includes(id) || p.cities.includes(id))!
            overlay.setVertexState(id, `player-${owner.color}`)
          } else {
            overlay.setVertexState(id, valid.has(id) ? 'valid' : 'invalid')
          }
        }
        for (const [id] of graph.edges) {
          const isOccupied = state.players.some(p => p.roads.includes(id))
          if (isOccupied) {
            const owner = state.players.find(p => p.roads.includes(id))!
            overlay.setEdgeState(id, `player-${owner.color}`)
          } else {
            overlay.setEdgeState(id, 'invalid')
          }
        }
      } else {
        // place-road phase
        const valid = new Set(getValidRoadPlacements(state, graph))
        for (const [id] of graph.vertices) {
          const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
          if (isOccupied) {
            const owner = state.players.find(p => p.settlements.includes(id) || p.cities.includes(id))!
            overlay.setVertexState(id, `player-${owner.color}`)
          } else {
            overlay.setVertexState(id, 'invalid')
          }
        }
        for (const [id] of graph.edges) {
          const isOccupied = state.players.some(p => p.roads.includes(id))
          if (isOccupied) {
            const owner = state.players.find(p => p.roads.includes(id))!
            overlay.setEdgeState(id, `player-${owner.color}`)
          } else {
            overlay.setEdgeState(id, valid.has(id) ? 'valid' : 'invalid')
          }
        }
      }
    }

    if (state.phase === 'main-game') {
      // Compute valid placements for build mode
      const validSettlements = state.buildMode === 'settlement'
        ? new Set(getValidSettlementBuildLocations(state, graph)) : new Set<string>()
      const validRoads = state.buildMode === 'road'
        ? new Set(getValidRoadBuildLocations(state, graph)) : new Set<string>()
      const validCities = state.buildMode === 'city'
        ? new Set(getValidCityUpgrades(state)) : new Set<string>()

      for (const [id] of graph.vertices) {
        const settlementOwner = state.players.find(p => p.settlements.includes(id))
        const cityOwner = state.players.find(p => p.cities.includes(id))
        if (cityOwner) {
          overlay.setVertexState(id, `player-${cityOwner.color}-city`)
        } else if (settlementOwner) {
          // If in city build mode and this is a valid upgrade target, show golden
          if (state.buildMode === 'city' && validCities.has(id)) {
            overlay.setVertexState(id, 'valid-city')
          } else {
            overlay.setVertexState(id, `player-${settlementOwner.color}`)
          }
        } else if (state.buildMode === 'settlement' && validSettlements.has(id)) {
          overlay.setVertexState(id, 'valid')
        } else {
          overlay.setVertexState(id, 'invalid')
        }
      }
      for (const [id] of graph.edges) {
        const roadOwner = state.players.find(p => p.roads.includes(id))
        if (roadOwner) {
          overlay.setEdgeState(id, `player-${roadOwner.color}`)
        } else if (state.buildMode === 'road' && validRoads.has(id)) {
          overlay.setEdgeState(id, 'valid')
        } else {
          overlay.setEdgeState(id, 'invalid')
        }
      }
    }

    hud.update(state)
  }

  // Create overlay with click handlers
  const overlay = createBoardOverlay(scene, graph, {
    onVertexClick(id: string) {
      // ─── Initial placement ─────────────────────────────────────
      if (state.phase === 'initial-placement') {
        if (state.initialPlacementStep !== 'place-settlement') return
        const valid = getValidSettlementPlacements(state, graph)
        if (!valid.includes(id)) return
        state = placeSettlement(id, state)
        applyGameState()
        return
      }
      // ─── Build mode: settlement ────────────────────────────────
      if (state.buildMode === 'settlement') {
        const valid = getValidSettlementBuildLocations(state, graph)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? { ...p, settlements: [...p.settlements, id], hand: deductCost(p.hand, BUILD_COSTS.settlement) }
            : p),
          buildMode: 'none',
        }
        applyGameState()
        return
      }
      // ─── Build mode: city upgrade ──────────────────────────────
      if (state.buildMode === 'city') {
        const valid = getValidCityUpgrades(state)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? {
                ...p,
                settlements: p.settlements.filter(s => s !== id),
                cities: [...p.cities, id],
                hand: deductCost(p.hand, BUILD_COSTS.city),
              }
            : p),
          buildMode: 'none',
        }
        applyGameState()
        return
      }
    },
    onEdgeClick(id: string) {
      // ─── Initial placement ─────────────────────────────────────
      if (state.phase === 'initial-placement') {
        if (state.initialPlacementStep !== 'place-road') return
        const valid = getValidRoadPlacements(state, graph)
        if (!valid.includes(id)) return
        state = placeRoad(id, state)
        applyGameState()
        return
      }
      // ─── Build mode: road ──────────────────────────────────────
      if (state.buildMode === 'road') {
        const valid = getValidRoadBuildLocations(state, graph)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? { ...p, roads: [...p.roads, id], hand: deductCost(p.hand, BUILD_COSTS.road) }
            : p),
          buildMode: 'none',
        }
        applyGameState()
        return
      }
    },
  })

  // Apply initial game state
  applyGameState()

  // Start render loop
  engine.runRenderLoop(() => scene.render())
  window.addEventListener('resize', () => engine.resize())

  console.log('Catan board rendered successfully!')
}

main().catch(console.error)
