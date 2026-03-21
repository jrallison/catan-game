import { GameState, Player } from './gameState'

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

  // ─── Player panels ──────────────────────────────────────────────────
  const playersRow = document.createElement('div')
  playersRow.style.cssText = `
    display: flex; padding: 8px 16px 12px;
  `
  container.appendChild(playersRow)

  function renderPlayerPanel(player: Player, isActive: boolean): string {
    const h = player.hand
    const border = isActive ? `border: 2px solid ${player.colorHex};` : 'border: 2px solid transparent;'
    return `
      <div style="flex:1; ${border} border-radius: 8px; padding: 8px 10px; margin: 0 4px; background: rgba(255,255,255,0.06);">
        <div style="font-weight: bold; color: ${player.colorHex}; margin-bottom: 4px;">
          ● Player ${player.id + 1}${isActive ? ' ◀' : ''}
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

  // ─── Public API ─────────────────────────────────────────────────────
  return {
    update(state: GameState) {
      const player = state.players[state.currentPlayerIndex]

      if (state.phase === 'initial-placement') {
        // Hide main-game controls during placement
        rollBtn.style.display = 'none'
        endTurnBtn.style.display = 'none'
        diceDisplay.textContent = ''
        playersRow.style.display = 'none'
        statusBar.style.display = 'block'

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
      } else if (state.turnPhase === 'build') {
        rollBtn.style.display = 'inline-block'
        rollBtn.style.opacity = '0.4'
        rollBtn.disabled = true
        endTurnBtn.style.display = 'inline-block'
      } else {
        rollBtn.style.display = 'none'
        endTurnBtn.style.display = 'none'
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
