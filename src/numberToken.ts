import { Scene, MeshBuilder, StandardMaterial, DynamicTexture, Color3 } from '@babylonjs/core'
import { HexTile } from './types'
import { axialToWorld } from './board'
import { DEPRESSION_OFFSET, DEPRESSION_RADIUS } from './tileGeometry'

// Probability dots for each number
const PROBABILITY_DOTS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
  8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
}

/** Small Y offset so the token sits just above the depression surface. */
const TOKEN_Y_LIFT = 0.01

/** Token diameter as a fraction of the depression diameter (slight inset). */
const TOKEN_DIAMETER = DEPRESSION_RADIUS * 2 * 0.9

export function renderNumberTokens(scene: Scene, tiles: HexTile[]): void {
  for (const tile of tiles) {
    if (tile.number === undefined) continue

    const { x, z } = axialToWorld(tile.q, tile.r)

    // Create disc positioned in the tile's depression
    const disc = MeshBuilder.CreateCylinder(`token_${tile.q}_${tile.r}`, {
      diameter: TOKEN_DIAMETER,
      height: 0.05,
      tessellation: 32,
    }, scene)
    disc.position.x = x + DEPRESSION_OFFSET.x
    disc.position.y = DEPRESSION_OFFSET.y + TOKEN_Y_LIFT
    disc.position.z = z + DEPRESSION_OFFSET.z
    disc.rotation.y = Math.PI / 2  // correct UV orientation on cylinder top face

    // Create dynamic texture for number and dots
    const textureSize = 256
    const texture = new DynamicTexture(`tokenTex_${tile.q}_${tile.r}`, textureSize, scene, true)
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D

    // White background
    ctx.fillStyle = '#FFFFFF'
    ctx.beginPath()
    ctx.arc(textureSize / 2, textureSize / 2, textureSize / 2 - 2, 0, Math.PI * 2)
    ctx.fill()

    // Number text
    const isHighProb = tile.number === 6 || tile.number === 8
    const textColor = isHighProb ? '#CC0000' : '#000000'
    const fontSize = isHighProb ? 'bold 90px' : '80px'

    ctx.fillStyle = textColor
    ctx.font = `${fontSize} Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(tile.number), textureSize / 2, textureSize / 2 - 15)

    // Probability dots
    const dots = PROBABILITY_DOTS[tile.number] || 0
    const dotStr = '●'.repeat(dots)
    ctx.font = `${isHighProb ? 'bold ' : ''}24px Arial`
    ctx.fillStyle = textColor
    ctx.fillText(dotStr, textureSize / 2, textureSize / 2 + 45)

    texture.update()

    // Material
    const mat = new StandardMaterial(`tokenMat_${tile.q}_${tile.r}`, scene)
    mat.diffuseTexture = texture
    mat.specularColor = new Color3(0.1, 0.1, 0.1)
    mat.emissiveColor = new Color3(0.3, 0.3, 0.3)

    disc.material = mat
  }
}
