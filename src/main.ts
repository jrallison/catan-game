import { createScene } from './scene'
import { createStandardBoard } from './board'
import { renderTiles } from './tileRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'
import { createInitialGameState, GameState } from './gameState'
import { getValidSettlementPlacements, getValidRoadPlacements, placeSettlement, placeRoad } from './gameMechanics'
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

  // ─── Game state ────────────────────────────────────────────────────
  let state: GameState = createInitialGameState()
  const hud = createHud()

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
        // Dim all edges during settlement phase
        for (const [id] of graph.edges) {
          const isOccupied = state.players.some(p => p.roads.includes(id))
          if (isOccupied) {
            const owner = state.players.find(p => p.roads.includes(id))!
            overlay.setEdgeState(id, `player-${owner.color}`)
          } else {
            overlay.setEdgeState(id, 'invalid')
          }
        }
        hud.update(`Player ${player.id + 1}`, player.colorHex, 'Place a settlement')
      } else {
        // place-road phase
        const valid = new Set(getValidRoadPlacements(state, graph))
        // Keep vertex states showing settled vertices
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
        hud.update(`Player ${player.id + 1}`, player.colorHex, 'Place a road')
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
      hud.update('Setup complete', '#ffffff', 'Main game coming soon...')
    }
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
