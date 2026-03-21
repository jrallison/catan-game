export function createHud(): {
  update: (playerName: string, playerColorHex: string, action: string) => void
} {
  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.7); color: white; padding: 12px 24px;
    border-radius: 8px; font-family: sans-serif; font-size: 16px;
    pointer-events: none; z-index: 100;
  `
  document.body.appendChild(el)

  return {
    update(playerName: string, playerColorHex: string, action: string) {
      el.innerHTML = `<span style="color:${playerColorHex}">●</span> ${playerName} — ${action}`
    }
  }
}
