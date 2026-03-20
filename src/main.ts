import { createScene } from './scene'
import { createStandardBoard } from './board'
import { renderTiles } from './tileRenderer'
import { renderNumberTokens } from './numberToken'

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const { engine, scene } = createScene(canvas)


  // Create the standard Catan board
  const board = createStandardBoard()

  // Render hex tiles from STL models
  await renderTiles(scene, board)

  // Render number tokens on land tiles
  renderNumberTokens(scene, board)

  // Start render loop
  engine.runRenderLoop(() => scene.render())
  window.addEventListener('resize', () => engine.resize())

  console.log('Catan board rendered successfully!')
}

main().catch(console.error)
