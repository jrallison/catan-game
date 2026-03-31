import { createScene } from './scene'
import { createStandardBoard, HARBOR_DEFS } from './board'
import { renderTiles } from './tileRenderer'
import { renderHarbors } from './harborRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'
import { createInitialGameState } from './gameState'
import { createHud } from './hud'
import { PieceRenderer } from './pieceRenderer'
import { initRobberRenderer, renderRobber } from './robberRenderer'
import { createTileOverlay } from './tileOverlay'
import { createPieceSync } from './pieceSync'
import { createGameController } from './gameController'

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const { engine, scene } = createScene(canvas)

  // Create the standard Catan board
  const board = createStandardBoard()

  // Render hex tiles, rings, harbors, number tokens
  await renderTiles(scene, board)
  createHexRings(scene, board)
  await renderHarbors(scene, HARBOR_DEFS)
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

  // Load 3D piece templates and robber
  const pieceRenderer = new PieceRenderer(scene)
  await pieceRenderer.loadTemplates()
  await initRobberRenderer(scene)

  // Game state
  const state = createInitialGameState(board)
  renderRobber(state.robberQ, state.robberR)

  // Game controller (owns mutable state + all handlers)
  const controller = createGameController(graph, board, numberTokens, HARBOR_DEFS, state)

  // Tile overlay (robber placement discs)
  const tileOvl = createTileOverlay(scene, board, controller.handleTileClick)
  controller.setTileOverlay(tileOvl)

  // HUD
  const hud = createHud(controller.getHudCallbacks())
  controller.setHud(hud)

  // Board overlay (vertex/edge markers with click handlers)
  const overlay = createBoardOverlay(scene, graph, controller.getOverlayCallbacks())
  controller.setOverlay(overlay)

  // Piece sync (3D settlement/city/road models)
  const ps = createPieceSync(pieceRenderer, graph, overlay)
  controller.setPieceSync(ps)

  // Apply initial game state
  controller.applyGameState()

  // Start render loop
  engine.runRenderLoop(() => scene.render())
  window.addEventListener('resize', () => engine.resize())

  console.log('Catan board rendered successfully!')
}

main().catch(console.error)
