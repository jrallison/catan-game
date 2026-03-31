/**
 * tileOverlay.ts — Clickable tile discs for robber placement.
 *
 * Shows orange discs at land tile centers during the moving-robber phase.
 * The player clicks a disc to move the robber there.
 */

import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  ActionManager,
  ExecuteCodeAction,
  Mesh as BjsMesh,
} from '@babylonjs/core'
import { HexTile } from './types'
import { axialToWorld } from './board'

export interface TileOverlay {
  show(robberQ: number, robberR: number): void
  hide(): void
}

export function createTileOverlay(
  scene: Scene,
  board: HexTile[],
  onTileClick: (q: number, r: number) => void,
): TileOverlay {
  const landTiles = board.filter(t => t.type !== 'water' && t.type !== 'harbor_water')
  const tileDiscs = new Map<string, BjsMesh>()

  for (const tile of landTiles) {
    const key = `${tile.q},${tile.r}`
    const world = axialToWorld(tile.q, tile.r)
    const disc = MeshBuilder.CreateCylinder(`tileDisc_${key}`, {
      diameter: 2.0,
      height: 0.06,
      tessellation: 24,
    }, scene)
    disc.position.set(world.x, 0.16, world.z)

    const mat = new StandardMaterial(`tileDiscMat_${key}`, scene)
    mat.diffuseColor = Color3.Black()
    mat.emissiveColor = new Color3(1.0, 0.7, 0.0) // orange
    mat.specularColor = Color3.Black()
    mat.backFaceCulling = true
    mat.alpha = 1.0
    disc.material = mat

    disc.isVisible = false
    disc.isPickable = false

    disc.actionManager = new ActionManager(scene)
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        mat.emissiveColor = new Color3(1.0, 1.0, 0.2) // bright yellow on hover
      })
    )
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        mat.emissiveColor = new Color3(1.0, 0.7, 0.0) // back to orange
      })
    )
    disc.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        onTileClick(tile.q, tile.r)
      })
    )

    tileDiscs.set(key, disc)
  }

  function show(robberQ: number, robberR: number): void {
    for (const tile of landTiles) {
      const key = `${tile.q},${tile.r}`
      const disc = tileDiscs.get(key)
      if (!disc) continue
      const isCurrentRobber = tile.q === robberQ && tile.r === robberR
      disc.isVisible = !isCurrentRobber
      disc.isPickable = !isCurrentRobber
    }
  }

  function hide(): void {
    for (const disc of tileDiscs.values()) {
      disc.isVisible = false
      disc.isPickable = false
    }
  }

  return { show, hide }
}
