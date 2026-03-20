import { Engine, Scene } from '@babylonjs/core'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine = new Engine(canvas, true)
const scene = new Scene(engine)

engine.runRenderLoop(() => scene.render())
window.addEventListener('resize', () => engine.resize())
