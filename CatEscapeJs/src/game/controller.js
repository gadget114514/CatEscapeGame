/**
 * The turn state machine. No Babylon or DOM dependency — the view and hud are
 * injected so tests can drive it with stubs.
 */
import { mulberry32 } from './rng.js';
import { newGame, legalBlocks, legalCatMoves, applyBlock, applyCatMove } from './rules.js';
import { chooseCatMove } from './catAI.js';
import { chooseBlock } from './trapperAI.js';

/**
 * @typedef {import('./rules.js').GameState} GameState
 * @typedef {import('./rules.js').Mode} Mode
 * @typedef {import('./rules.js').Difficulty} Difficulty
 * @typedef {import('./rules.js').Side} Side
 * @typedef {'player'|'ai'|'animating'|'over'} Phase
 */
export class GameController {
  /**
   * @param {{
   *   view: {
   *     rebuild(state:GameState):void,
   *     setHighlights(indices:number[]):void,
   *     setHint(path:number[]|null):void,
   *     animateBlock(i:number):Promise<void>,
   *     animateCatMove(from:number, to:number):Promise<void>,
   *     animateResult(status:string):Promise<void>,
   *     flashInvalid(i:number):void
   *   },
   *   hud: {
   *     setStatus(text:string):void,
   *     setTurn(side:Side, isPlayer:boolean):void,
   *     showResult(status:string, moveCount:number):void,
   *     setSeed(seed:number):void
   *   },
   *   aiDelayMs?: number,
   *   rngFactory?: (seed:number) => () => number
   * }} opts
   */
  constructor({ view, hud, aiDelayMs = 350, rngFactory = mulberry32 }) {
    this.view = view;
    this.hud = hud;
    this.aiDelayMs = aiDelayMs;
    this.rngFactory = rngFactory;
    this._state = null;
    this._phase = 'over';
    this._gen = 0;
    this._rng = null;
    this._playerSide = null;
    this._timer = null;
  }

  /** @returns {GameState|null} current GameState (read-only use) */
  get state() {
    return this._state;
  }

  /** @returns {Phase} */
  get phase() {
    return this._phase;
  }

  /**
   * Start a new game. Any pending AI timers and animations from a previous
   * game are discarded via the generation token.
   * @param {{mode:Mode, difficulty:Difficulty, seed?:number}} opts
   */
  start({ mode, difficulty, seed }) {
    this._gen += 1;
    const gen = this._gen;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._state = newGame({ mode, difficulty, seed });
    this._rng = this.rngFactory(this._state.seed);
    this._playerSide = mode === 'trapper' ? 'trapper' : 'cat';
    this.view.rebuild(this._state);
    this.hud.setSeed(this._state.seed);
    this._enterTurn(gen);
  }

  /**
   * Input from picking. Ignored unless phase === 'player'; illegal cells are
   * rejected with `view.flashInvalid`.
   * @param {number} index
   * @returns {Promise<void>} resolves when the move (and result) finished
   */
  async onCellClicked(index) {
    if (this._phase !== 'player') return;
    const state = this._state;
    if (!state || state.status !== 'playing') return;
    const gen = this._gen;

    let from = -1;
    if (state.turn === 'trapper') {
      if (!legalBlocks(state).includes(index)) {
        this.view.flashInvalid(index);
        return;
      }
      this._phase = 'animating';
      this.view.setHighlights([]);
      applyBlock(state, index);
      await this.view.animateBlock(index);
    } else {
      if (!legalCatMoves(state).includes(index)) {
        this.view.flashInvalid(index);
        return;
      }
      this._phase = 'animating';
      this.view.setHighlights([]);
      from = state.board.cat;
      applyCatMove(state, index);
      await this.view.animateCatMove(from, index);
    }
    if (gen !== this._gen) return;
    await this._next(gen);
  }

  /**
   * Enter the turn of whoever is to move: player turn → phase 'player',
   * otherwise schedule the AI.
   * @param {number} gen
   * @private
   */
  _enterTurn(gen) {
    if (gen !== this._gen) return;
    const state = this._state;
    if (state.turn === this._playerSide) {
      this._phase = 'player';
      this.hud.setTurn(state.turn, true);
      this.hud.setStatus('Your turn');
      // escape mode highlights the cat's moves; trapper mode has no candidates
      this.view.setHighlights(state.mode === 'escape' ? legalCatMoves(state) : []);
    } else {
      this._phase = 'ai';
      this.hud.setTurn(state.turn, false);
      this.hud.setStatus('Thinking...');
      this.view.setHighlights([]);
      this._scheduleAI(gen);
    }
  }

  /**
   * @param {number} gen
   * @private
   */
  _scheduleAI(gen) {
    this._timer = setTimeout(() => {
      this._timer = null;
      if (gen !== this._gen) return;
      this._runAI(gen);
    }, this.aiDelayMs);
  }

  /**
   * Choose and apply the AI move, animate it, then continue.
   * @param {number} gen
   * @private
   */
  async _runAI(gen) {
    const state = this._state;
    if (gen !== this._gen || !state || state.status !== 'playing') return;
    this._phase = 'animating';

    let to;
    let from = -1;
    if (state.turn === 'cat') {
      from = state.board.cat;
      to = chooseCatMove(state, this._rng);
      if (to < 0) {
        await this._next(gen);
        return;
      }
      applyCatMove(state, to);
      await this.view.animateCatMove(from, to);
    } else {
      to = chooseBlock(state, this._rng);
      if (to < 0) {
        await this._next(gen);
        return;
      }
      applyBlock(state, to);
      await this.view.animateBlock(to);
    }
    if (gen !== this._gen) return;
    await this._next(gen);
  }

  /**
   * After a move: finish the game or enter the next turn.
   * @param {number} gen
   * @private
   */
  async _next(gen) {
    if (gen !== this._gen) return;
    const state = this._state;
    if (state.status !== 'playing') {
      this._phase = 'over';
      this.view.setHighlights([]);
      await this.view.animateResult(state.status);
      if (gen !== this._gen) return;
      this.hud.showResult(state.status, state.moveCount);
      return;
    }
    this._enterTurn(gen);
  }
}
