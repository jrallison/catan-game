import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  ActionManager,
  ExecuteCodeAction,
  Mesh as BjsMesh,
} from '@babylonjs/core'
import { createScene } from './scene'
import { createStandardBoard, HARBOR_DEFS, axialToWorld } from './board'
import { renderTiles } from './tileRenderer'
import { renderHarbors } from './harborRenderer'
import { createHexRings } from './hexRing'
import { renderNumberTokens } from './numberToken'
import { buildBoardGraph } from './boardGraph'
import { createBoardOverlay } from './boardOverlay'
import { createInitialGameState, GameState, BuildMode } from './gameState'
import {
  getValidSettlementPlacements, getValidRoadPlacements, placeSettlement, placeRoad,
  distributeResources, BUILD_COSTS, deductCost,
  getValidSettlementBuildLocations, getValidRoadBuildLocations, getValidCityUpgrades,
  calculateVP, totalCards, autoDiscard,
} from './gameMechanics'
import { createHud } from './hud'
import { PieceRenderer } from './pieceRenderer'
import { initRobberRenderer, renderRobber } from './robberRenderer'
import { ResourceType } from './types'

function showToast(message: string, durationMs = 3000): void {
  const toast = document.createElement('div')
  toast.textContent = message
  toast.style.cssText = `
    position: fixed; bottom: 32px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.85); color: white; padding: 12px 24px;
    border-radius: 8px; font-family: 'Segoe UI', sans-serif; font-size: 15px;
    z-index: 300; pointer-events: none; transition: opacity 0.4s;
  `
  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 400)
  }, durationMs)
}

async function main(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
  const { engine, scene } = createScene(canvas)

  // Create the standard Catan board
  const board = createStandardBoard()

  // Render hex tiles from GLB models
  await renderTiles(scene, board)

  // Create procedural hex rings around each tile
  createHexRings(scene, board)

  // Render harbor structures on water tiles
  await renderHarbors(scene, HARBOR_DEFS)

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

  // ─── Piece renderer (3D settlement/city models) ─────────────────────
  const pieceRenderer = new PieceRenderer(scene)
  await pieceRenderer.loadTemplates()

  // ─── Robber renderer ───────────────────────────────────────────────
  await initRobberRenderer(scene)

  // ─── Game state ────────────────────────────────────────────────────
  let state: GameState = createInitialGameState(board)

  // Render robber at initial position (desert)
  renderRobber(state.robberQ, state.robberR)

  // ─── Tile click discs for robber placement ────────────────────────
  // Clickable discs at land tile centers, shown only during moving-robber phase
  const landTiles = board.filter(t => t.type !== 'water' && t.type !== 'harbor_water')
  const tileDiscs = new Map<string, BjsMesh>()
  const tileMats = new Map<string, StandardMaterial>()

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
        handleTileClick(tile.q, tile.r)
      })
    )

    tileDiscs.set(key, disc)
    tileMats.set(key, mat)
  }

  function showTileOverlay(): void {
    for (const tile of landTiles) {
      const key = `${tile.q},${tile.r}`
      const disc = tileDiscs.get(key)
      if (!disc) continue
      // Show all land tiles except current robber tile
      const isCurrentRobber = tile.q === state.robberQ && tile.r === state.robberR
      disc.isVisible = !isCurrentRobber
      disc.isPickable = !isCurrentRobber
    }
  }

  function hideTileOverlay(): void {
    for (const disc of tileDiscs.values()) {
      disc.isVisible = false
      disc.isPickable = false
    }
  }

  function handleTileClick(q: number, r: number): void {
    if (state.turnPhase !== 'moving-robber') return
    if (q === state.robberQ && r === state.robberR) return

    // Move robber
    state = { ...state, robberQ: q, robberR: r }
    renderRobber(q, r)

    // Steal check: find opponents with settlements/cities on this tile
    const tileKey = `${q},${r}`
    const currentPlayer = state.players[state.currentPlayerIndex]
    const opponents: number[] = []

    for (const [vertexId, vertex] of graph.vertices) {
      if (!vertex.adjacentTiles.includes(tileKey)) continue
      for (let i = 0; i < state.players.length; i++) {
        if (i === state.currentPlayerIndex) continue
        const p = state.players[i]
        if (p.settlements.includes(vertexId) || p.cities.includes(vertexId)) {
          if (!opponents.includes(i)) opponents.push(i)
        }
      }
    }

    if (opponents.length > 0) {
      // Pick a random opponent
      const victimIdx = opponents[Math.floor(Math.random() * opponents.length)]
      const victim = state.players[victimIdx]
      const types: ResourceType[] = ['wood', 'brick', 'ore', 'wheat', 'wool']
      const available = types.filter(t => victim.hand[t] > 0)

      if (available.length > 0) {
        const stolen = available[Math.floor(Math.random() * available.length)]
        state = {
          ...state,
          players: state.players.map((p, i) => {
            if (i === victimIdx) {
              return { ...p, hand: { ...p.hand, [stolen]: p.hand[stolen] - 1 } }
            }
            if (i === state.currentPlayerIndex) {
              return { ...p, hand: { ...p.hand, [stolen]: p.hand[stolen] + 1 } }
            }
            return p
          }),
        }
        showToast(`You stole ${stolen} from ${victim.color}!`)
      } else {
        showToast(`${victim.color} had no resources to steal`)
      }
    } else {
      showToast('No opponents on this tile')
    }

    // Transition to build phase
    state = { ...state, turnPhase: 'build' }
    hideTileOverlay()
    applyGameState()
  }

  function checkWin(): void {
    for (const player of state.players) {
      if (calculateVP(player) >= 10) {
        state = { ...state, phase: 'game-over', winner: player.color }
        return
      }
    }
  }

  function handleRoll(): void {
    if (state.phase === 'game-over') return
    if (state.phase !== 'main-game' || state.turnPhase !== 'roll') return
    const d1 = Math.ceil(Math.random() * 6)
    const d2 = Math.ceil(Math.random() * 6)
    const roll = d1 + d2

    if (roll === 7) {
      // Auto-discard for players with > 7 cards
      const updatedPlayers = state.players.map(p =>
        totalCards(p.hand) > 7
          ? { ...p, hand: autoDiscard(p.hand) }
          : p
      )
      state = {
        ...state,
        lastRoll: [d1, d2],
        players: updatedPlayers,
        turnPhase: 'moving-robber',
      }
      hud.showDiceResult([d1, d2])
      showToast('Roll was 7 — move the robber')
      applyGameState()
      return
    }

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
    if (state.phase === 'game-over') return
    if (state.phase !== 'main-game' || state.turnPhase !== 'build') return
    const nextPlayer = (state.currentPlayerIndex + 1) % state.players.length
    state = {
      ...state,
      currentPlayerIndex: nextPlayer,
      turnPhase: 'roll',
      lastRoll: null,
      buildMode: 'none',
    }
    applyGameState()
  }

  function handleBuildMode(mode: BuildMode): void {
    if (state.phase === 'game-over') return
    if (state.phase !== 'main-game' || state.turnPhase !== 'build') return
    // Toggle: clicking same mode cancels it
    state = { ...state, buildMode: state.buildMode === mode ? 'none' : mode }
    applyGameState()
  }

  const hud = createHud({ onRoll: handleRoll, onEndTurn: handleEndTurn, onBuildMode: handleBuildMode })

  /** Sync 3D piece meshes to match current game state */
  function syncPieces(): void {
    // Collect all vertex ids that should have pieces
    const allSettlements = new Map<string, { color: import('./gameState').PlayerColor }>()
    const allCities = new Map<string, { color: import('./gameState').PlayerColor }>()

    for (const player of state.players) {
      for (const vid of player.settlements) {
        allSettlements.set(vid, { color: player.color })
      }
      for (const vid of player.cities) {
        allCities.set(vid, { color: player.color })
      }
    }

    // Place settlements (only if not already placed)
    for (const [vid, { color }] of allSettlements) {
      if (!pieceRenderer.hasPiece(vid)) {
        const v = graph.vertices.get(vid)
        if (v) pieceRenderer.placeSettlement(vid, v.x, v.z, color)
      }
    }

    // Upgrade cities (upgradeToCity handles removing the old settlement mesh)
    for (const [vid, { color }] of allCities) {
      const v = graph.vertices.get(vid)
      if (v) pieceRenderer.upgradeToCity(vid, v.x, v.z, color)
    }

    // Place road 3D models
    for (const player of state.players) {
      for (const eid of player.roads) {
        if (!pieceRenderer.hasPiece(eid)) {
          const edge = graph.edges.get(eid)!
          pieceRenderer.placeRoad(eid, edge, graph, player.color)
        }
        overlay.setEdgeState(eid, 'road-placed')
      }
    }
  }

  function applyGameState(): void {
    const player = state.players[state.currentPlayerIndex]

    if (state.phase === 'initial-placement') {
      if (state.initialPlacementStep === 'place-settlement') {
        const valid = new Set(getValidSettlementPlacements(state, graph))
        for (const [id] of graph.vertices) {
          const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
          if (isOccupied) {
            // 3D model is rendered; hide the disc but keep it pickable
            overlay.setVertexState(id, 'piece-placed')
          } else {
            overlay.setVertexState(id, valid.has(id) ? 'valid' : 'invalid')
          }
        }
        for (const [id] of graph.edges) {
          const isOccupied = state.players.some(p => p.roads.includes(id))
          if (isOccupied) {
            overlay.setEdgeState(id, 'road-placed')
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
            overlay.setVertexState(id, 'piece-placed')
          } else {
            overlay.setVertexState(id, 'invalid')
          }
        }
        for (const [id] of graph.edges) {
          const isOccupied = state.players.some(p => p.roads.includes(id))
          if (isOccupied) {
            overlay.setEdgeState(id, 'road-placed')
          } else {
            overlay.setEdgeState(id, valid.has(id) ? 'valid' : 'invalid')
          }
        }
      }
    }

    if (state.phase === 'main-game' && state.turnPhase === 'moving-robber') {
      // During moving-robber, hide vertex/edge overlays and show tile discs
      for (const [id] of graph.vertices) {
        const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
        overlay.setVertexState(id, isOccupied ? 'piece-placed' : 'invalid')
      }
      for (const [id] of graph.edges) {
        const isOccupied = state.players.some(p => p.roads.includes(id))
        overlay.setEdgeState(id, isOccupied ? 'road-placed' : 'invalid')
      }
      showTileOverlay()
    } else {
      hideTileOverlay()
    }

    if (state.phase === 'main-game' && state.turnPhase !== 'moving-robber') {
      // Compute valid placements for build mode
      const validSettlements = state.buildMode === 'settlement'
        ? new Set(getValidSettlementBuildLocations(state, graph)) : new Set<string>()
      const validRoads = state.buildMode === 'road'
        ? new Set(getValidRoadBuildLocations(state, graph)) : new Set<string>()
      const validCities = state.buildMode === 'city'
        ? new Set(getValidCityUpgrades(state)) : new Set<string>()

      for (const [id] of graph.vertices) {
        const settlementOwner = state.players.find(p => p.settlements.includes(id))
        const cityOwner = state.players.find(p => p.cities.includes(id))
        if (cityOwner) {
          // 3D city model is rendered; hide disc but keep pickable
          overlay.setVertexState(id, 'piece-placed')
        } else if (settlementOwner) {
          // If in city build mode and this is a valid upgrade target, show golden ring
          if (state.buildMode === 'city' && validCities.has(id)) {
            overlay.setVertexState(id, 'valid-city')
          } else {
            // 3D settlement model is rendered; hide disc but keep pickable
            overlay.setVertexState(id, 'piece-placed')
          }
        } else if (state.buildMode === 'settlement' && validSettlements.has(id)) {
          overlay.setVertexState(id, 'valid')
        } else {
          overlay.setVertexState(id, 'invalid')
        }
      }
      for (const [id] of graph.edges) {
        const roadOwner = state.players.find(p => p.roads.includes(id))
        if (roadOwner) {
          overlay.setEdgeState(id, 'road-placed')
        } else if (state.buildMode === 'road' && validRoads.has(id)) {
          overlay.setEdgeState(id, 'valid')
        } else {
          overlay.setEdgeState(id, 'invalid')
        }
      }
    }

    // Sync 3D piece meshes after overlay state
    syncPieces()

    hud.update(state)
  }

  // Create overlay with click handlers
  const overlay = createBoardOverlay(scene, graph, {
    onVertexClick(id: string) {
      if (state.phase === 'game-over') return
      // ─── Initial placement ─────────────────────────────────────
      if (state.phase === 'initial-placement') {
        if (state.initialPlacementStep !== 'place-settlement') return
        const valid = getValidSettlementPlacements(state, graph)
        if (!valid.includes(id)) return
        state = placeSettlement(id, state)
        applyGameState()
        return
      }
      // ─── Build mode: settlement ────────────────────────────────
      if (state.buildMode === 'settlement') {
        const valid = getValidSettlementBuildLocations(state, graph)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? { ...p, settlements: [...p.settlements, id], hand: deductCost(p.hand, BUILD_COSTS.settlement) }
            : p),
          buildMode: 'none',
        }
        checkWin()
        applyGameState()
        return
      }
      // ─── Build mode: city upgrade ──────────────────────────────
      if (state.buildMode === 'city') {
        const valid = getValidCityUpgrades(state)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? {
                ...p,
                settlements: p.settlements.filter(s => s !== id),
                cities: [...p.cities, id],
                hand: deductCost(p.hand, BUILD_COSTS.city),
              }
            : p),
          buildMode: 'none',
        }
        checkWin()
        applyGameState()
        return
      }
    },
    onEdgeClick(id: string) {
      if (state.phase === 'game-over') return
      // ─── Initial placement ─────────────────────────────────────
      if (state.phase === 'initial-placement') {
        if (state.initialPlacementStep !== 'place-road') return
        const valid = getValidRoadPlacements(state, graph)
        if (!valid.includes(id)) return
        state = placeRoad(id, state)
        applyGameState()
        return
      }
      // ─── Build mode: road ──────────────────────────────────────
      if (state.buildMode === 'road') {
        const valid = getValidRoadBuildLocations(state, graph)
        if (!valid.includes(id)) return
        state = {
          ...state,
          players: state.players.map((p, i) => i === state.currentPlayerIndex
            ? { ...p, roads: [...p.roads, id], hand: deductCost(p.hand, BUILD_COSTS.road) }
            : p),
          buildMode: 'none',
        }
        applyGameState()
        return
      }
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
