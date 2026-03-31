/**
 * gameController.ts — Game loop handlers and state mutation logic.
 *
 * Owns the mutable GameState and exposes handler functions that the HUD,
 * board overlay, and tile overlay call into.
 */

import { GameState, BuildMode } from './gameState'
import { BoardGraph } from './boardGraph'
import {
  getValidSettlementPlacements, getValidRoadPlacements, placeSettlement, placeRoad,
  distributeResources, BUILD_COSTS, deductCost,
  getValidSettlementBuildLocations, getValidRoadBuildLocations, getValidCityUpgrades,
  calculateVP, totalCards, autoDiscard, getTradeRates, executeTrade,
} from './gameMechanics'
import { ResourceType, HexTile } from './types'
import { MarkerState } from './boardOverlay'
import { HarborDef } from './board'
import { TileOverlay } from './tileOverlay'
import { PieceSync } from './pieceSync'
import { renderRobber } from './robberRenderer'

// ─── Toast helper ───────────────────────────────────────────────────────────

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

// ─── Types ──────────────────────────────────────────────────────────────────

interface Overlay {
  setVertexState: (id: string, state: MarkerState) => void
  setEdgeState: (id: string, state: MarkerState) => void
}

interface Hud {
  update: (state: GameState) => void
  showDiceResult: (dice: [number, number]) => void
}

export interface GameController {
  /** Wire up the overlay click handlers — call once after overlay creation */
  getOverlayCallbacks(): {
    onVertexClick: (id: string) => void
    onEdgeClick: (id: string) => void
  }
  /** Wire up the HUD callbacks — call once before HUD creation */
  getHudCallbacks(): {
    onRoll: () => void
    onEndTurn: () => void
    onBuildMode: (mode: BuildMode) => void
    onTrade: (give: ResourceType, giveCount: number, receive: ResourceType) => void
    getTradeRates: (s: GameState) => Record<ResourceType, 2 | 3 | 4>
  }
  /** Wire up tile overlay click — call once */
  handleTileClick: (q: number, r: number) => void
  /** Set references that are created after the controller */
  setOverlay(overlay: Overlay): void
  setHud(hud: Hud): void
  setTileOverlay(tileOverlay: TileOverlay): void
  setPieceSync(pieceSync: PieceSync): void
  /** Trigger initial render */
  applyGameState(): void
}

export function createGameController(
  graph: BoardGraph,
  board: HexTile[],
  numberTokens: Map<string, number>,
  harborDefs: HarborDef[],
  initialState: GameState,
): GameController {
  let state: GameState = initialState
  let overlay: Overlay
  let hud: Hud
  let tileOverlay: TileOverlay
  let pieceSync: PieceSync

  // ─── State apply ────────────────────────────────────────────────────

  function applyGameState(): void {
    const player = state.players[state.currentPlayerIndex]

    if (state.phase === 'initial-placement') {
      if (state.initialPlacementStep === 'place-settlement') {
        const valid = new Set(getValidSettlementPlacements(state, graph))
        for (const [id] of graph.vertices) {
          const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
          if (isOccupied) {
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
      for (const [id] of graph.vertices) {
        const isOccupied = state.players.some(p => p.settlements.includes(id) || p.cities.includes(id))
        overlay.setVertexState(id, isOccupied ? 'piece-placed' : 'invalid')
      }
      for (const [id] of graph.edges) {
        const isOccupied = state.players.some(p => p.roads.includes(id))
        overlay.setEdgeState(id, isOccupied ? 'road-placed' : 'invalid')
      }
      tileOverlay.show(state.robberQ, state.robberR)
    } else {
      tileOverlay.hide()
    }

    if (state.phase === 'main-game' && state.turnPhase !== 'moving-robber') {
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
          overlay.setVertexState(id, 'piece-placed')
        } else if (settlementOwner) {
          if (state.buildMode === 'city' && validCities.has(id)) {
            overlay.setVertexState(id, 'valid-city')
          } else {
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
    pieceSync.sync(state)
    hud.update(state)
  }

  // ─── Handlers ─────────────────────────────────────────────────────

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
    state = distributeResources(roll, state, graph, numberTokens, board)
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
    state = { ...state, buildMode: state.buildMode === mode ? 'none' : mode }
    applyGameState()
  }

  function handleTrade(give: ResourceType, giveCount: number, receive: ResourceType): void {
    if (state.phase === 'game-over') return
    if (state.phase !== 'main-game' || state.turnPhase !== 'build') return
    state = executeTrade(state, give, giveCount, receive)
    showToast(`Traded ${giveCount} ${give} → 1 ${receive}`)
    applyGameState()
  }

  function handleTileClick(q: number, r: number): void {
    if (state.turnPhase !== 'moving-robber') return
    if (q === state.robberQ && r === state.robberR) return

    // Move robber
    state = { ...state, robberQ: q, robberR: r }
    renderRobber(q, r)

    // Steal check: find opponents with settlements/cities on this tile
    const tileKey = `${q},${r}`
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
    tileOverlay.hide()
    applyGameState()
  }

  function handleVertexClick(id: string): void {
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
  }

  function handleEdgeClick(id: string): void {
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
  }

  return {
    getOverlayCallbacks: () => ({
      onVertexClick: handleVertexClick,
      onEdgeClick: handleEdgeClick,
    }),
    getHudCallbacks: () => ({
      onRoll: handleRoll,
      onEndTurn: handleEndTurn,
      onBuildMode: handleBuildMode,
      onTrade: handleTrade,
      getTradeRates: (s: GameState) => getTradeRates(s.players[s.currentPlayerIndex], graph, harborDefs),
    }),
    handleTileClick,
    setOverlay(o: Overlay) { overlay = o },
    setHud(h: Hud) { hud = h },
    setTileOverlay(to: TileOverlay) { tileOverlay = to },
    setPieceSync(ps: PieceSync) { pieceSync = ps },
    applyGameState,
  }
}
