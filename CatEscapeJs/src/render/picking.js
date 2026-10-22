/**
 * Pointer input: hover highlight while the player thinks, tap to play.
 * Works for both mouse and touch; drags (camera rotation) are ignored.
 */
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents.js';

const DRAG_SLOP_PX = 10;

/**
 * @param {import('@babylonjs/core/scene.js').Scene} scene
 * @param {import('../game/controller.js').GameController} controller
 * @param {{setHover(i:number|null):void, isCellEmpty(i:number):boolean}} view
 */
export function setupPicking(scene, controller, view) {
  let downX = 0;
  let downY = 0;

  function pickCell() {
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => {
      return !!(mesh && mesh.metadata && mesh.metadata.index !== undefined);
    });
    if (pick && pick.hit && pick.pickedMesh) return pick.pickedMesh.metadata.index;
    return -1;
  }

  scene.onPointerObservable.add((pointerInfo) => {
    switch (pointerInfo.type) {
      case PointerEventTypes.POINTERDOWN: {
        const e = pointerInfo.event;
        downX = e.clientX;
        downY = e.clientY;
        break;
      }
      case PointerEventTypes.POINTERMOVE: {
        if (controller.phase !== 'player') {
          view.setHover(null);
          break;
        }
        const i = pickCell();
        view.setHover(i >= 0 && view.isCellEmpty(i) ? i : null);
        break;
      }
      case PointerEventTypes.POINTERTAP: {
        const e = pointerInfo.event;
        const dx = e.clientX - downX;
        const dy = e.clientY - downY;
        if (dx * dx + dy * dy > DRAG_SLOP_PX * DRAG_SLOP_PX) break; // drag, not a tap
        const i = pickCell();
        if (i >= 0) controller.onCellClicked(i);
        break;
      }
      default:
        break;
    }
  });
}
