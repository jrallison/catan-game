import { Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight, Vector3, Color4, Color3 } from '@babylonjs/core'

export function createScene(canvas: HTMLCanvasElement): { engine: Engine; scene: Scene } {
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
  const scene = new Scene(engine)

  // Sky blue background
  scene.clearColor = new Color4(0.53, 0.81, 0.92, 1.0)

  // ArcRotateCamera - top-down view looking at the board
  const camera = new ArcRotateCamera(
    'camera',
    0,           // alpha - rotation around Y
    0.3,         // beta - angle from top (0.3 = nearly top-down)
    25,          // radius - distance from target
    Vector3.Zero(),
    scene
  )
  camera.lowerBetaLimit = 0.1
  camera.upperBetaLimit = Math.PI / 2.2
  camera.lowerRadiusLimit = 10
  camera.upperRadiusLimit = 25
  camera.attachControl(canvas, true)

  // Hemispheric light for ambient fill
  const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), scene)
  hemiLight.intensity = 0.6
  hemiLight.diffuse = new Color3(1, 1, 1)
  hemiLight.groundColor = new Color3(0.3, 0.3, 0.4)

  // Directional light for shadows and depth
  const dirLight = new DirectionalLight('dirLight', new Vector3(-1, -2, -1), scene)
  dirLight.intensity = 0.8
  dirLight.diffuse = new Color3(1, 0.98, 0.95)

  return { engine, scene }
}
