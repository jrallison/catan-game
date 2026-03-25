import { GameState, Player, BuildMode } from './gameState'
import { BUILD_COSTS, canAfford, calculateVP } from './gameMechanics'
import { ResourceType } from './types'

const RESOURCE_ICONS: Record<string, string> = {
  wood:  '🪵',
  brick: '🧱',
  ore:   '⛏',
  wheat: '🌾',
  wool:  '🐑',
}

export function createHud(opts: {
  onRoll: () => void
  onEndTurn: () => void
  onBuildMode: (mode: BuildMode) => void
  onTrade: (give: ResourceType, giveCount: number, receive: ResourceType) => void
  getTradeRates: (state: GameState) => Record<ResourceType, 2 | 3 | 4>
}): {
  update: (state: GameState) => void
  showDiceResult: (dice: [number, number]) => void
} {
  // ─── Container ──────────────────────────────────────────────────────
  const container = document.createElement('div')
  container.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.8); color: white; padding: 0;
    border-radius: 12px; font-family: 'Segoe UI', sans-serif; font-size: 14px;
    z-index: 100; min-width: 420px; overflow: hidden;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  `
  document.body.appendChild(container)

  // ─── Top bar: dice + turn info ──────────────────────────────────────
  const topBar = document.createElement('div')
  topBar.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.15);
  `
  container.appendChild(topBar)

  const turnInfo = document.createElement('span')
  turnInfo.style.cssText = 'flex: 1;'
  topBar.appendChild(turnInfo)

  const diceDisplay = document.createElement('span')
  diceDisplay.style.cssText = 'margin: 0 12px; font-size: 15px; min-width: 110px; text-align: center;'
  topBar.appendChild(diceDisplay)

  const rollBtn = document.createElement('button')
  rollBtn.textContent = '🎲 Roll Dice'
  rollBtn.style.cssText = `
    background: #e63946; color: white; border: none; padding: 6px 14px;
    border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;
    transition: opacity 0.2s;
  `
  rollBtn.addEventListener('click', () => opts.onRoll())
  topBar.appendChild(rollBtn)

  const endTurnBtn = document.createElement('button')
  endTurnBtn.textContent = '⏭ End Turn'
  endTurnBtn.style.cssText = `
    background: #457b9d; color: white; border: none; padding: 6px 14px;
    border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;
    margin-left: 8px; transition: opacity 0.2s;
  `
  endTurnBtn.addEventListener('click', () => opts.onEndTurn())
  topBar.appendChild(endTurnBtn)

  // ─── Build panel ─────────────────────────────────────────────────────
  const buildPanel = document.createElement('div')
  buildPanel.style.cssText = `
    display: none; padding: 6px 16px 8px; flex-wrap: wrap; gap: 6px;
    border-bottom: 1px solid rgba(255,255,255,0.15);
  `
  container.appendChild(buildPanel)

  function makeBuildButton(label: string, costText: string, mode: BuildMode): HTMLButtonElement {
    const btn = document.createElement('button')
    btn.innerHTML = `${label} <span style="font-size:12px;opacity:0.8">${costText}</span>`
    btn.style.cssText = `
      background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.2);
      padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
      margin-right: 6px; transition: opacity 0.2s, background 0.2s;
    `
    btn.addEventListener('click', () => opts.onBuildMode(mode))
    return btn
  }

  const roadBtn = makeBuildButton('🛤 Road', '🪵1 🧱1', 'road')
  const settlementBtn = makeBuildButton('🏠 Settlement', '🪵1 🧱1 🌾1 🐑1', 'settlement')
  const cityBtn = makeBuildButton('🏙 City', '⛏3 🌾2', 'city')
  buildPanel.appendChild(roadBtn)
  buildPanel.appendChild(settlementBtn)
  buildPanel.appendChild(cityBtn)

  function updateBuildButtons(state: GameState): void {
    const player = state.players[state.currentPlayerIndex]
    const canRoad = canAfford(player.hand, BUILD_COSTS.road)
    const canSettlement = canAfford(player.hand, BUILD_COSTS.settlement)
    const canCity = canAfford(player.hand, BUILD_COSTS.city)

    roadBtn.disabled = !canRoad
    roadBtn.style.opacity = canRoad ? '1' : '0.35'
    roadBtn.style.cursor = canRoad ? 'pointer' : 'default'

    settlementBtn.disabled = !canSettlement
    settlementBtn.style.opacity = canSettlement ? '1' : '0.35'
    settlementBtn.style.cursor = canSettlement ? 'pointer' : 'default'

    cityBtn.disabled = !canCity
    cityBtn.style.opacity = canCity ? '1' : '0.35'
    cityBtn.style.cursor = canCity ? 'pointer' : 'default'

    // Highlight active build mode
    const activeBg = 'rgba(32,200,100,0.3)'
    const normalBg = 'rgba(255,255,255,0.12)'
    roadBtn.style.background = state.buildMode === 'road' ? activeBg : normalBg
    settlementBtn.style.background = state.buildMode === 'settlement' ? activeBg : normalBg
    cityBtn.style.background = state.buildMode === 'city' ? activeBg : normalBg
  }

  // ─── Trade button (in build panel) ──────────────────────────────────
  const tradeBtn = document.createElement('button')
  tradeBtn.innerHTML = '🔄 Trade'
  tradeBtn.style.cssText = `
    background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.2);
    padding: 5px 12px; border-radius: 6px; cursor: pointer; font-size: 13px;
    margin-right: 6px; transition: opacity 0.2s, background 0.2s;
  `
  buildPanel.appendChild(tradeBtn)

  // ─── Trade panel (give/receive selection) ─────────────────────────
  const tradePanel = document.createElement('div')
  tradePanel.style.cssText = `
    display: none; padding: 8px 16px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.15);
  `
  container.appendChild(tradePanel)

  let tradeStep: 'closed' | 'give' | 'receive' = 'closed'
  let tradeGiveResource: ResourceType | null = null
  let tradeGiveCount = 0
  let latestState: GameState | null = null

  function closeTrade(): void {
    tradeStep = 'closed'
    tradeGiveResource = null
    tradeGiveCount = 0
    tradePanel.style.display = 'none'
  }

  function renderTradeGive(state: GameState): void {
    const player = state.players[state.currentPlayerIndex]
    const rates = opts.getTradeRates(state)
    const resources: ResourceType[] = ['wood', 'brick', 'ore', 'wheat', 'wool']

    tradePanel.innerHTML = ''
    const label = document.createElement('div')
    label.textContent = 'Give which resource?'
    label.style.cssText = 'margin-bottom: 6px; font-size: 13px; color: rgba(255,255,255,0.7);'
    tradePanel.appendChild(label)

    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;'
    tradePanel.appendChild(row)

    for (const res of resources) {
      const rate = rates[res]
      const canTrade = player.hand[res] >= rate
      const btn = document.createElement('button')
      btn.textContent = `Give ${rate} ${RESOURCE_ICONS[res]} ${res}`
      btn.style.cssText = `
        background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.2);
        padding: 5px 10px; border-radius: 6px; font-size: 12px;
        cursor: ${canTrade ? 'pointer' : 'default'};
        opacity: ${canTrade ? '1' : '0.35'};
      `
      btn.disabled = !canTrade
      if (canTrade) {
        btn.addEventListener('click', () => {
          tradeGiveResource = res
          tradeGiveCount = rate
          tradeStep = 'receive'
          renderTradeReceive()
        })
      }
      row.appendChild(btn)
    }

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '✕ Cancel'
    cancelBtn.style.cssText = `
      background: rgba(255,60,60,0.25); color: white; border: 1px solid rgba(255,60,60,0.3);
      padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
    `
    cancelBtn.addEventListener('click', closeTrade)
    row.appendChild(cancelBtn)
  }

  function renderTradeReceive(): void {
    const resources: ResourceType[] = ['wood', 'brick', 'ore', 'wheat', 'wool']

    tradePanel.innerHTML = ''
    const label = document.createElement('div')
    label.textContent = `Giving ${tradeGiveCount} ${tradeGiveResource} → Receive which?`
    label.style.cssText = 'margin-bottom: 6px; font-size: 13px; color: rgba(255,255,255,0.7);'
    tradePanel.appendChild(label)

    const row = document.createElement('div')
    row.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;'
    tradePanel.appendChild(row)

    for (const res of resources) {
      if (res === tradeGiveResource) continue
      const btn = document.createElement('button')
      btn.textContent = `${RESOURCE_ICONS[res]} ${res}`
      btn.style.cssText = `
        background: rgba(255,255,255,0.12); color: white; border: 1px solid rgba(255,255,255,0.2);
        padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
      `
      btn.addEventListener('click', () => {
        opts.onTrade(tradeGiveResource!, tradeGiveCount, res)
        closeTrade()
      })
      row.appendChild(btn)
    }

    const cancelBtn = document.createElement('button')
    cancelBtn.textContent = '✕ Cancel'
    cancelBtn.style.cssText = `
      background: rgba(255,60,60,0.25); color: white; border: 1px solid rgba(255,60,60,0.3);
      padding: 5px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
    `
    cancelBtn.addEventListener('click', closeTrade)
    row.appendChild(cancelBtn)
  }

  tradeBtn.addEventListener('click', () => {
    if (tradeStep === 'closed' && latestState) {
      tradeStep = 'give'
      tradePanel.style.display = 'block'
      renderTradeGive(latestState)
    } else {
      closeTrade()
    }
  })

  // ─── Player panels ──────────────────────────────────────────────────
  const playersRow = document.createElement('div')
  playersRow.style.cssText = `
    display: flex; padding: 8px 16px 12px;
  `
  container.appendChild(playersRow)

  function renderPlayerPanel(player: Player, isActive: boolean): string {
    const h = player.hand
    const vp = calculateVP(player)
    const border = isActive ? `border: 2px solid ${player.colorHex};` : 'border: 2px solid transparent;'
    return `
      <div style="flex:1; ${border} border-radius: 8px; padding: 8px 10px; margin: 0 4px; background: rgba(255,255,255,0.06);">
        <div style="font-weight: bold; color: ${player.colorHex}; margin-bottom: 4px;">
          ● Player ${player.id + 1} (${player.color})${isActive ? ' ◀' : ''} — ${vp} VP
        </div>
        <div style="font-size: 13px; line-height: 1.6;">
          ${RESOURCE_ICONS.wood} ${h.wood} &nbsp;
          ${RESOURCE_ICONS.brick} ${h.brick} &nbsp;
          ${RESOURCE_ICONS.ore} ${h.ore}<br>
          ${RESOURCE_ICONS.wheat} ${h.wheat} &nbsp;
          ${RESOURCE_ICONS.wool} ${h.wool}
        </div>
      </div>
    `
  }

  // ─── Status bar (for initial placement messages) ────────────────────
  const statusBar = document.createElement('div')
  statusBar.style.cssText = `
    padding: 8px 16px; text-align: center; font-size: 13px;
    color: rgba(255,255,255,0.7); border-top: 1px solid rgba(255,255,255,0.1);
    display: none;
  `
  container.appendChild(statusBar)

  // ─── Win overlay ─────────────────────────────────────────────────────
  const winOverlay = document.createElement('div')
  winOverlay.style.cssText = `
    display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(0,0,0,0.75); z-index: 200;
    display: none; justify-content: center; align-items: center;
    font-family: 'Segoe UI', sans-serif;
  `
  document.body.appendChild(winOverlay)

  function showWinScreen(state: GameState): void {
    const winner = state.players.find(p => p.color === state.winner)!
    const vp = calculateVP(winner)
    winOverlay.style.display = 'flex'
    winOverlay.innerHTML = `
      <div style="
        background: rgba(20,20,30,0.95); border-radius: 16px; padding: 48px 64px;
        text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        border: 2px solid ${winner.colorHex};
      ">
        <div style="font-size: 48px; margin-bottom: 12px;">🏆</div>
        <div style="font-size: 28px; font-weight: bold; color: ${winner.colorHex}; margin-bottom: 8px;">
          Player ${winner.id + 1} Wins!
        </div>
        <div style="font-size: 18px; color: rgba(255,255,255,0.8); margin-bottom: 28px;">
          Final score: ${vp} VP
        </div>
        <button id="play-again-btn" style="
          background: ${winner.colorHex}; color: white; border: none;
          padding: 12px 32px; border-radius: 8px; font-size: 16px;
          font-weight: bold; cursor: pointer;
        ">Play Again</button>
      </div>
    `
    document.getElementById('play-again-btn')!.addEventListener('click', () => {
      window.location.reload()
    })
  }

  // ─── Public API ─────────────────────────────────────────────────────
  return {
    update(state: GameState) {
      latestState = state
      // ─── Game over ─────────────────────────────────────────────
      if (state.phase === 'game-over') {
        container.style.display = 'none'
        showWinScreen(state)
        return
      }

      const player = state.players[state.currentPlayerIndex]

      if (state.phase === 'initial-placement') {
        // Hide main-game controls during placement
        rollBtn.style.display = 'none'
        endTurnBtn.style.display = 'none'
        buildPanel.style.display = 'none'
        diceDisplay.textContent = ''
        playersRow.style.display = 'none'
        statusBar.style.display = 'block'
        closeTrade()

        const action = state.initialPlacementStep === 'place-settlement'
          ? 'Place a settlement'
          : 'Place a road'
        turnInfo.innerHTML = `<span style="color:${player.colorHex}">●</span> Player ${player.id + 1} — ${action}`
        statusBar.textContent = `Initial placement round ${state.initialPlacementRound}`
        return
      }

      // ─── Main game phase ───────────────────────────────────────────
      playersRow.style.display = 'flex'
      statusBar.style.display = 'none'

      // Turn info
      turnInfo.innerHTML = `<span style="color:${player.colorHex}">●</span> Player ${player.id + 1}'s turn`

      // Buttons
      if (state.turnPhase === 'roll') {
        rollBtn.style.display = 'inline-block'
        rollBtn.style.opacity = '1'
        rollBtn.disabled = false
        endTurnBtn.style.display = 'none'
        buildPanel.style.display = 'none'
        statusBar.style.display = 'none'
        closeTrade()
      } else if (state.turnPhase === 'moving-robber') {
        rollBtn.style.display = 'inline-block'
        rollBtn.style.opacity = '0.4'
        rollBtn.disabled = true
        endTurnBtn.style.display = 'none'
        buildPanel.style.display = 'none'
        statusBar.style.display = 'block'
        statusBar.textContent = 'Roll was 7 — click a tile to move the robber'
        closeTrade()
      } else if (state.turnPhase === 'build') {
        rollBtn.style.display = 'inline-block'
        rollBtn.style.opacity = '0.4'
        rollBtn.disabled = true
        endTurnBtn.style.display = 'inline-block'
        buildPanel.style.display = 'flex'
        statusBar.style.display = 'none'
        updateBuildButtons(state)
        // Show trade button only for human player (player 0)
        tradeBtn.style.display = state.currentPlayerIndex === 0 ? 'inline-block' : 'none'
        // Update trade panel if open
        if (tradeStep === 'give') {
          tradePanel.style.display = 'block'
          renderTradeGive(state)
        } else if (tradeStep === 'receive') {
          tradePanel.style.display = 'block'
        }
      } else {
        rollBtn.style.display = 'none'
        endTurnBtn.style.display = 'none'
        buildPanel.style.display = 'none'
        statusBar.style.display = 'none'
      }

      // Player resource panels
      playersRow.innerHTML = state.players.map((p, i) =>
        renderPlayerPanel(p, i === state.currentPlayerIndex)
      ).join('')
    },

    showDiceResult(dice: [number, number]) {
      const [d1, d2] = dice
      diceDisplay.textContent = `${d1} + ${d2} = ${d1 + d2}`
    },
  }
}
