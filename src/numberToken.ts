import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  PBRMaterial,
} from '@babylonjs/core'
import { HexTile } from './types'
import { axialToWorld } from './board'
import { DEPRESSION_OFFSET, DEPRESSION_RADIUS } from './tileGeometry'

// Disc uses BILLBOARDMODE_Y — rotates around Y to face viewer, stays flat on board.
// Canvas needs no pre-rotation; text reads upright from any camera angle.

// Probability dots for each number
const PROBABILITY_DOTS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
  8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
}

/** Small Y offset so the token sits just above the depression surface. */
const TOKEN_Y_LIFT = 0.01

/** Token diameter: fits inside the depression with a slight inset. */
const TOKEN_DIAMETER = DEPRESSION_RADIUS * 2 * 0.9

/** Token height in world units (slight 3D depth). */
const TOKEN_HEIGHT = 0.04

/** Cached materials (created once per scene). */
let bodyMaterial: PBRMaterial | null = null
function getBodyMaterial(scene: Scene): PBRMaterial {
  if (bodyMaterial) return bodyMaterial
  const mat = new PBRMaterial('mat_tokenBody', scene)
  mat.albedoColor = Color3.FromHexString('#BFBFBF')
  mat.metallic = 0.05
  mat.roughness = 0.85
  bodyMaterial = mat
  return mat
}

export async function renderNumberTokens(scene: Scene, tiles: HexTile[]): Promise<void> {
  for (const tile of tiles) {
    if (tile.number === undefined) continue

    const { x, z } = axialToWorld(tile.q, tile.r)
    const posX = x + DEPRESSION_OFFSET.x
    const posY = DEPRESSION_OFFSET.y + TOKEN_Y_LIFT + TOKEN_HEIGHT / 2
    const posZ = z + DEPRESSION_OFFSET.z

    // --- Grey body cylinder ---
    const body = MeshBuilder.CreateCylinder(`tokenBody_${tile.q}_${tile.r}`, {
      diameter: TOKEN_DIAMETER,
      height: TOKEN_HEIGHT,
      tessellation: 32,
    }, scene)
    body.position.set(posX, posY, posZ)
    body.material = getBodyMaterial(scene)

    // --- White top face disc with number + dots via DynamicTexture ---
    const textureSize = 512
    const texture = new DynamicTexture(`tokenTex_${tile.q}_${tile.r}`, textureSize, scene, true)
    texture.hasAlpha = true
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D

    // White circular background (drawn before rotation so it stays centered)
    ctx.clearRect(0, 0, textureSize, textureSize)
    ctx.beginPath()
    ctx.arc(textureSize / 2, textureSize / 2, textureSize / 2 - 4, 0, Math.PI * 2)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()

    // Number text
    const isHighProb = tile.number === 6 || tile.number === 8
    const textColor = isHighProb ? '#C00000' : '#000000'

    ctx.fillStyle = textColor
    ctx.font = `bold ${isHighProb ? 280 : 240}px Arial`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(tile.number), textureSize / 2, textureSize / 2 - 50)

    // Probability dots
    const dots = PROBABILITY_DOTS[tile.number] || 0
    const dotRadius = 16
    const dotSpacing = 44
    const dotsStartX = textureSize / 2 - ((dots - 1) * dotSpacing) / 2
    const dotsY = textureSize / 2 + 110

    ctx.fillStyle = textColor
    for (let i = 0; i < dots; i++) {
      ctx.beginPath()
      ctx.arc(dotsStartX + i * dotSpacing, dotsY, dotRadius, 0, Math.PI * 2)
      ctx.fill()
    }

    texture.update()

    const topDisc = MeshBuilder.CreateDisc(`tokenFace_${tile.q}_${tile.r}`, {
      radius: TOKEN_DIAMETER / 2 * 0.95,
      tessellation: 32,
    }, scene)
    topDisc.position.set(posX, posY + TOKEN_HEIGHT / 2 + 0.001, posZ)
    topDisc.rotation.x = -Math.PI / 2  // face up (BILLBOARDMODE_Y preserves this; only Y rotates)
    topDisc.billboardMode = Mesh.BILLBOARDMODE_Y  // rotate around Y to face viewer, stay flat

    const faceMat = new StandardMaterial(`tokenFaceMat_${tile.q}_${tile.r}`, scene)
    faceMat.diffuseTexture = texture
    faceMat.useAlphaFromDiffuseTexture = true
    faceMat.specularColor = new Color3(0, 0, 0)
    faceMat.emissiveColor = new Color3(0.6, 0.6, 0.6)
    faceMat.backFaceCulling = false
    topDisc.material = faceMat
  }
}
