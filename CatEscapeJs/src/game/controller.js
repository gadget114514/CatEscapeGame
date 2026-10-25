/**
 * The turn state machine. No Babylon or DOM dependency — the view and hud are
 * injected so tests can drive it with stubs.
 *
 * Rev. 4: the controller drives a ruleset (`basicRuleset` by default) instead
 * of importing the rules directly, so either game flavor runs through the
 * same phases. New (optional-chained) view/hud calls keep the old stubs
 * working: `hud.setInventory`, `hud.notify`, `hud.setPower`.
 *
 * 14.5 comeback gimmicks (all optional-chained so basic rulesets and old
 * stubs ignore them): `usePower('dash'|'jump')` arms a power action like
 * `useItem` arms the hammer, `stopDash()` is the `ここで止める` button,
 * `hud.setPower(power, features, armKind, dashLeft)` feeds the gauge, and
 * a storm blows (`state.storm`) → `hud.notify('storm')` +
 * `view.animateStorm(indices)`.
 */
import { mulberry32 } from './rng.js';
import { shortestPathToEdge } from './board.js';
import { basicRuleset } from './rulesets.js';
import { KIND_TUNNEL, KIND_ICE, KIND_SPRING } from './gimmick/registry.js';

/**
 * @typedef {import('./rules.js').GameState} GameState
 * @typedef {import('./rules.js').Mode} Mode
 * @typedef {import('./rules.js').Difficulty} Difficulty
 * @typedef {import('./rules.js').Side} Side
 * @typedef {import('./rulesets.js').basicRuleset} Ruleset
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
   *     animateBreak?(i:number):Promise<void>,
   *     animateCatMove(from:number, to:number):Promise<void>,
   *     animateCatPath?(cells:number[], from?:number):Promise<void>,
   *     animatePickup?(i:number):Promise<void>,
   *     animateCrumble?(i:number):Promise<void>,
   *     animateStorm?(indices:number[]):Promise<void>,
   *     syncCats?(state:GameState):void,
   *     animateResult(status:string):Promise<void>,
   *     flashInvalid(i:number):void
   *   },
   *   hud: {
   *     setStatus(text:string):void,
   *     setTurn(side:Side, isPlayer:boolean):void,
   *     showResult(status:string, moveCount:number):void,
   *     setSeed(seed:number):void,
   *     notify?(key:string):void,
   *     setInventory?(items:object, playerSide:Side, armed:boolean):void
   *   },
   *   aiDelayMs?: number,
   *   rngFactory?: (seed:number) => () => number,
   *   ruleset?: typeof basicRuleset,
   *   onGameOver?: (result:{status:string, moveCount:number, state:GameState}) => void
   * }} opts
   */
  constructor({
    view,
    hud,
    aiDelayMs = 350,
    rngFactory = mulberry32,
    ruleset = basicRuleset,
    onGameOver = null,
  }) {
    this.view = view;
    this.hud = hud;
    this.aiDelayMs = aiDelayMs;
    this.rngFactory = rngFactory;
    this.ruleset = ruleset;
    this.onGameOver = onGameOver;
    this._state = null;
    this._phase = 'over';
    this._gen = 0;
    this._rng = null;
    this._playerSide = null;
    this._timer = null;
    this._gameOverFired = false;
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
   * game are discarded via the generation token. `ruleset` defaults to the
   * constructor's (the last one used when only `start({mode, difficulty})`
   * style options are given); the remaining options go to
   * `ruleset.newGame({role, ai, blocks, gimmick, playerItems, seed})`.
   * The legacy `{mode, difficulty}` option names still work.
   * @param {{ruleset?:typeof basicRuleset, mode?:Mode, role?:Side,
   *          difficulty?:Difficulty, ai?:Difficulty, blocks?:number,
   *          gimmick?:object, playerItems?:object, seed?:number}} opts
   */
  start({ ruleset, mode, role, difficulty, ai, blocks, gimmick, playerItems, seed }) {
    this._gen += 1;
    const gen = this._gen;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const rs = ruleset || this.ruleset;
    this.ruleset = rs;
    const pickedRole = role || mode;
    this._state = rs.newGame({
      role: pickedRole,
      ai: ai || difficulty,
      blocks,
      gimmick,
      playerItems,
      seed,
    });
    this._rng = this.rngFactory(this._state.seed);
    // the player's SIDE: trapper role → 'trapper', escape role → 'cat'
    this._playerSide = pickedRole === 'trapper' ? 'trapper' : 'cat';
    this._gameOverFired = false;
    this.view.rebuild(this._state);
    this.hud.setSeed(this._state.seed);
    this._syncInventory();
    this._enterTurn(gen);
  }

  /**
   * Input from picking. Ignored unless phase === 'player'; illegal cells are
   * rejected with `view.flashInvalid`. Any applied move clears the hint.
   * @param {number} index
   * @returns {Promise<void>} resolves when the move (and result) finished
   */
  async onCellClicked(index) {
    if (this._phase !== 'player') return;
    const state = this._state;
    if (!state || state.status !== 'playing') return;
    const gen = this._gen;
    const rs = this.ruleset;

    if (state.turn === 'trapper') {
      if (!rs.legalBlocks(state).includes(index)) {
        this.view.flashInvalid(index);
        return;
      }
      this._phase = 'animating';
      this.view.setHighlights([]);
      rs.applyBlock(state, index);
      this.view.setHint(null);
      this._syncInventory();
      await this.view.animateBlock(index);
      await this._consumeCrumbles(gen);
      await this._consumeStorm(gen);
    } else {
      // multi-cat (13.7): clicking a cat selects it (select-then-move);
      // its moves are re-highlighted and nothing else happens
      const cats = state.cats;
      if (rs.selectCat && cats && cats.length > 1) {
        const j = cats.indexOf(index);
        if (j >= 0) {
          rs.selectCat(state, j);
          this.view.syncCats?.(state); // the ring follows the selection
          this.view.setHighlights(rs.legalCatMoves(state));
          return;
        }
      }
      if (!rs.legalCatMoves(state).includes(index)) {
        this.view.flashInvalid(index);
        return;
      }
      this._phase = 'animating';
      this.view.setHighlights([]);
      const from = state.board.cat;
      const hammersBefore = state.items ? state.items.cat.hammer : 0;
      rs.applyCatMove(state, index);
      const kind = state.history.length ? state.history[state.history.length - 1].kind : null;
      this.view.setHint(null);
      if (state.items && state.items.cat.hammer !== hammersBefore) {
        this.hud.notify?.('pickup');
      }
      this._syncInventory();
      this._notifyGimmickToasts(state);
      // Rev. 4: the block sinks before the hop, the item disappears after it
      if (kind === 'break') await this.view.animateBreak?.(index);
      await this._animateCat(rs, state, from, index);
      if (kind === 'pickup') await this.view.animatePickup?.(index);
      // 18.4: a dried fish landing crumbles the trapper's newest far block
      await this._consumeCrumbles(gen, kind === 'fish' ? 'fish' : 'crumble');
      await this._consumeStorm(gen);
    }
    if (gen !== this._gen) return;
    await this._next(gen);
  }

  /**
   * Toggle the player's armed item. The phase must be 'player' and
   * `canUseItem` must be true (disarming an already armed item is always
   * allowed while it is the player's turn). Arming the hammer refreshes the
   * highlights so the breakable neighbors show up (spec 12.7). A dash or
   * jump armed through `usePower` is *not* toggled from here (a dash in
   * motion can only end via `stopDash`).
   * @returns {boolean} whether the arm state changed
   */
  useItem() {
    if (this._phase !== 'player') return false;
    const state = this._state;
    const rs = this.ruleset;
    if (!state || state.status !== 'playing') return false;
    if (state.armed) {
      const kind = state.armKind;
      if (kind === 'dash' || kind === 'jump') return false; // power ≠ item
      rs.disarmItem(state);
      this._refreshArmHighlights(rs, state);
      this._syncInventory();
      return true;
    }
    if (!rs.canUseItem(state, this._playerSide)) return false;
    rs.armItem(state);
    this.hud.notify?.(state.turn === 'trapper' ? 'doubleArmed' : 'hammerArmed');
    this._refreshArmHighlights(rs, state);
    this._syncInventory();
    return true;
  }

  /**
   * Arm (or cancel) a 14.5 power action — the `ダッシュ` / `ジャンプ`
   * buttons. Arming highlights the legal cells exactly like the hammer;
   * nothing is spent until the first step / the jump itself, so cancelling
   * is free. Rulesets without the power API (basic) are ignored.
   * @param {'dash'|'jump'} kind
   * @returns {boolean} whether the arm state changed
   */
  usePower(kind) {
    if (this._phase !== 'player') return false;
    if (kind !== 'dash' && kind !== 'jump') return false;
    const state = this._state;
    const rs = this.ruleset;
    if (!state || state.status !== 'playing' || !rs.canUsePower) return false;
    if (state.armed) {
      if ((state.armKind || null) !== kind) return false;
      rs.disarmItem(state); // cancel before the first step (free)
      this._refreshArmHighlights(rs, state);
      this._syncInventory();
      return true;
    }
    if (!rs.canUsePower(state, kind)) return false;
    rs.armPower(state, kind);
    this.hud.notify?.(kind === 'dash' ? 'dashArmed' : 'jumpArmed');
    this._refreshArmHighlights(rs, state);
    this._syncInventory();
    return true;
  }

  /**
   * Can the player use the `kind` power right now (14.5)? Lets the HUD
   * enable the `ダッシュ` / `ジャンプ` buttons only when both affordable
   * and legal.
   * @param {'dash'|'jump'} kind
   * @returns {boolean}
   */
  canUsePower(kind) {
    const state = this._state;
    const rs = this.ruleset;
    if (!state || state.status !== 'playing' || !rs.canUsePower) return false;
    return !!rs.canUsePower(state, kind);
  }

  /**
   * The `ここで止める` button (14.5): end an ongoing dash early. Before the
   * first step this only cancels the arm (the turn stays with the player);
   * afterwards the turn passes — unless a dried fish kept it — and the flow
   * continues through `_next`.
   * @returns {Promise<boolean>} whether anything changed
   */
  async stopDash() {
    if (this._phase !== 'player') return false;
    const state = this._state;
    const rs = this.ruleset;
    if (!state || state.status !== 'playing' || !rs.stopDash) return false;
    const gen = this._gen;
    if (!rs.stopDash(state)) return false;
    this._syncInventory();
    if (gen !== this._gen) return true;
    if (state.turn === this._playerSide) {
      // cancelled before the first step (or the dried fish kept the turn)
      this.view.setHighlights(rs.legalCatMoves(state));
      return true;
    }
    this.view.setHighlights([]);
    await this._next(gen);
    return true;
  }

  /**
   * Re-apply the player's highlights after arming/disarming (the cat's move
   * list grows by the break targets while the hammer is armed).
   * @param {typeof import('./rulesets.js').basicRuleset} rs
   * @param {GameState} state
   * @private
   */
  _refreshArmHighlights(rs, state) {
    this.view.setHighlights(this._playerSide === 'cat' ? rs.legalCatMoves(state) : []);
  }

  /**
   * Animate the cat's move (13.5): the view plays the whole recorded path
   * (`ruleset.lastMovePath`) when it supports `animateCatPath` — tunnels
   * shrink/grow, ice slides, springs arc; a hammer break has an empty path
   * and does not move the cat. Views without `animateCatPath` keep the old
   * `animateCatMove(from, to)` hop.
   * @param {typeof import('./rulesets.js').basicRuleset} rs
   * @param {GameState} state
   * @param {number} from
   * @param {number} to
   * @private
   */
  async _animateCat(rs, state, from, to) {
    if (this.view.animateCatPath) {
      const path = rs.lastMovePath ? rs.lastMovePath(state) : null;
      await this.view.animateCatPath(path || [to], from);
      return;
    }
    await this.view.animateCatMove(from, to);
  }

  /**
   * Toasts for the move's gimmick (13.5): tunnel, ice or spring — checked
   * against the cells the move passed over (`state.lastPath`).
   * @param {GameState} state
   * @private
   */
  _notifyGimmickToasts(state) {
    const path = state.lastPath;
    const g = state.g;
    if (!path || path.length === 0 || !g || !g.kind) return;
    if (g.kind[path[0]] === KIND_TUNNEL) this.hud.notify?.('tunnel');
    else if (path.some((c) => g.kind[c] === KIND_ICE)) this.hud.notify?.('ice');
    else if (g.kind[path[0]] === KIND_SPRING && path.length >= 2) this.hud.notify?.('spring');
  }

  /**
   * Toast + `animateCrumble` for blocks that crumbled inside the last
   * rules call (`state.crumbles`, 13.3/13.5 + the 18.4 dried fish): the
   * blocks are gone from the state; the view shakes and sinks each one.
   * `key` selects the toast — `'crumble'` for brittle timers, `'fish'`
   * for the 18.4 fish effect.
   * @param {number} gen
   * @param {'crumble'|'fish'} [key='crumble']
   * @private
   */
  async _consumeCrumbles(gen, key = 'crumble') {
    const state = this._state;
    if (gen !== this._gen || !state || !state.crumbles || state.crumbles.length === 0) return;
    const list = state.crumbles.slice();
    state.crumbles = [];
    for (const i of list) {
      this.hud.notify?.(key);
      await this.view.animateCrumble?.(i);
    }
  }

  /**
   * Show the cat's shortest route to the edge. Multi-cat levels (13.7)
   * show the route of the goal's relevant cat (`ruleset.hintPath`).
   * The hint stays until the next move clears it (`view.setHint(null)` in
   * the move flows).
   */
  showHint() {
    const state = this._state;
    if (!state || state.status !== 'playing') return;
    const rs = this.ruleset;
    this.view.setHint(rs.hintPath ? rs.hintPath(state) : shortestPathToEdge(state.board));
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
    this.view.syncCats?.(state); // positions, escapes, selection ring
    if (state.turn === this._playerSide) {
      this._phase = 'player';
      this.hud.setTurn(state.turn, true);
      this.hud.setStatus('Your turn');
      // the cat player sees its moves; the trapper has no candidates
      this.view.setHighlights(
        this._playerSide === 'cat' ? this.ruleset.legalCatMoves(state) : [],
      );
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
   * Choose and apply the AI move (arming an item first when the ruleset says
   * so), animate it, then continue.
   * @param {number} gen
   * @private
   */
  async _runAI(gen) {
    const state = this._state;
    const rs = this.ruleset;
    if (gen !== this._gen || !state || state.status !== 'playing') return;
    this._phase = 'animating';

    if (state.turn === 'cat') {
      // multi-cat (13.7): the AI picks which cat to move first, then the
      // normal single-cat logic runs on the selected cat
      if (rs.chooseAICat) {
        rs.selectCat?.(state, rs.chooseAICat(state, this._rng));
        this.view.syncCats?.(state);
      }
      // 14.5: a power action (jump/dash) wins over the hammer this turn
      let powered = false;
      if (rs.shouldUsePower && rs.canUsePower) {
        const kind = rs.shouldUsePower(state, this._rng);
        if (kind && rs.canUsePower(state, kind)) {
          rs.armPower(state, kind);
          this.hud.notify?.(kind === 'dash' ? 'aiDash' : 'aiJump');
          powered = true;
          this._syncInventory();
        }
      }
      if (!powered && rs.shouldUseItem(state, this._rng)) {
        rs.armItem(state);
        this.hud.notify?.('aiHammer');
        this._syncInventory();
      }
      const from = state.board.cat;
      const hammersBefore = state.items ? state.items.cat.hammer : 0;
      const to = rs.chooseCatMove(state, this._rng);
      if (to < 0) {
        await this._next(gen);
        return;
      }
      rs.applyCatMove(state, to);
      const kind = state.history.length ? state.history[state.history.length - 1].kind : null;
      this.view.setHint(null);
      if (state.items && state.items.cat.hammer !== hammersBefore) {
        this.hud.notify?.('pickup');
      }
      this._syncInventory();
      this._notifyGimmickToasts(state);
      if (kind === 'break') await this.view.animateBreak?.(to);
      await this._animateCat(rs, state, from, to);
      if (kind === 'pickup') await this.view.animatePickup?.(to);
      // 18.4: a dried fish landing crumbles the trapper's newest far block
      await this._consumeCrumbles(gen, kind === 'fish' ? 'fish' : 'crumble');
      await this._consumeStorm(gen);
    } else {
      if (rs.shouldUseItem(state, this._rng)) {
        rs.armItem(state);
        this.hud.notify?.('aiDouble');
        this._syncInventory();
      }
      const to = rs.chooseBlock(state, this._rng);
      if (to < 0) {
        await this._next(gen);
        return;
      }
      rs.applyBlock(state, to);
      this.view.setHint(null);
      this._syncInventory();
      await this.view.animateBlock(to);
      await this._consumeCrumbles(gen);
      await this._consumeStorm(gen);
    }
    if (gen !== this._gen) return;
    await this._next(gen);
  }

  /**
   * Toast + `animateStorm` for a storm that fired inside the last rules
   * call (14.5): toast first (`あらしだ！`), then the blocks fly off. The
   * transient `state.storm` list is cleared after it was consumed.
   * @param {number} gen
   * @private
   */
  async _consumeStorm(gen) {
    const state = this._state;
    if (gen !== this._gen || !state || !state.storm) return;
    const indices = state.storm;
    state.storm = null;
    this.hud.notify?.('storm');
    await this.view.animateStorm?.(indices);
  }

  /**
   * After a move: finish the game or enter the next turn. On game over the
   * result is shown once and the optional `onGameOver` callback fires once.
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
      if (!this._gameOverFired) {
        this._gameOverFired = true;
        this.onGameOver?.({
          status: state.status,
          moveCount: state.moveCount,
          state,
        });
      }
      return;
    }
    this._enterTurn(gen);
  }

  /**
   * Push the in-game items and the 14.5 power gauge to the hud (gimmick
   * states only).
   * @private
   */
  _syncInventory() {
    const state = this._state;
    if (state && state.items) {
      this.hud.setInventory?.(state.items, this._playerSide, state.armed);
      if (state.features) {
        this.hud.setPower?.(
          state.power,
          state.features,
          state.armed ? state.armKind || 'hammer' : null,
          state.dashLeft,
        );
      }
    }
  }
}
