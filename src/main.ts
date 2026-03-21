import { createScene } from './scene'
import { createStandardBoard } from './board'
import { renderTiles } from './tileRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'
import { createInitialGameState, GameState } from './gameState'
import { getValidSettlementPlacements, getValidRoadPlacements, placeSettlement, placeRoad, distributeResources } from './gameMechanics'
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
    }
    applyGameState()
  }

  const hud = createHud({ onRoll: handleRoll, onEndTurn: handleEndTurn })

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
      // Show all placed pieces, dim everything else
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
          overlay.setEdgeState(id, 'invalid')
        }
      }
    }

    hud.update(state)
  }

  // Create overlay with click handlers
  const overlay = createBoardOverlay(scene, graph, {
    onVertexClick(id: string) {
      if (state.phase !== 'initial-placement') return
      if (state.initialPlacementStep !== 'place-settlement') return
      const valid = getValidSettlementPlacements(state, graph)
      if (!valid.includes(id)) return
      state = placeSettlement(id, state)
      applyGameState()
    },
    onEdgeClick(id: string) {
      if (state.phase !== 'initial-placement') return
      if (state.initialPlacementStep !== 'place-road') return
      const valid = getValidRoadPlacements(state, graph)
      if (!valid.includes(id)) return
      state = placeRoad(id, state)
      applyGameState()
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
