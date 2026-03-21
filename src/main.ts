import { createScene } from './scene'
import { createStandardBoard } from './board'
import { renderTiles } from './tileRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'

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

  // Build vertex/edge graph and render overlay
  const graph = buildBoardGraph(board)
  console.log(`Vertices: ${graph.vertices.size}`)
  console.log(`Edges: ${graph.edges.size}`)
  const overlay = createBoardOverlay(scene, graph)

  // Start render loop
  engine.runRenderLoop(() => scene.render())
  window.addEventListener('resize', () => engine.resize())

  console.log('Catan board rendered successfully!')
}

main().catch(console.error)
