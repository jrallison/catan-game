export type PlayerColor = 'red' | 'blue'

export interface Player {
  id: number
  color: PlayerColor
  colorHex: string
  settlements: string[]  // vertex ids
  roads: string[]        // edge ids
  cities: string[]       // vertex ids (for later)
}

export type GamePhase =
  | 'initial-placement'
  | 'main-game'         // P1-3

export type InitialPlacementStep =
  | 'place-settlement'
  | 'place-road'

export interface GameState {
  phase: GamePhase
  players: Player[]
  currentPlayerIndex: number
  // Initial placement state
  initialPlacementRound: number      // 1 or 2
  initialPlacementStep: InitialPlacementStep
  initialPlacementOrder: number[]    // player indices in placement order
  initialPlacementOrderPos: number   // current position in order
  lastPlacedSettlement: string | null // vertex id — road must connect here
}

export function createInitialGameState(): GameState {
  return {
    phase: 'initial-placement',
    players: [
      { id: 0, color: 'red',  colorHex: '#e63946', settlements: [], roads: [], cities: [] },
      { id: 1, color: 'blue', colorHex: '#457b9d', settlements: [], roads: [], cities: [] },
    ],
    currentPlayerIndex: 0,
    initialPlacementRound: 1,
    initialPlacementStep: 'place-settlement',
    // Standard Catan order: P0, P1, P1, P0
    initialPlacementOrder: [0, 1, 1, 0],
    initialPlacementOrderPos: 0,
    lastPlacedSettlement: null,
  }
}
