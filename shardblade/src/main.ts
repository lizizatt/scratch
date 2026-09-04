import { CombatTestApp } from "./app/combatTestApp";
import { GameApp } from "./app/gameApp";
import { EditorApp, isEditorPath } from "./editor/editorApp";
import { CombatTestSim, isCombatTestPath } from "./sim/combatTest";
import { parseAppLaunch } from "./sim/scenes/launch";

const canvas = document.getElementById("game") as HTMLCanvasElement;

const pathname = window.location.pathname;
const combatTest = isCombatTestPath(pathname);
const editor = !combatTest && isEditorPath(pathname);
const launch = !combatTest && !editor ? parseAppLaunch(pathname) : null;

type AppLike = {
  tick: (dt: number) => void;
  draw: () => void;
  onClick: (x: number, y: number) => void;
  setStyle: (s: "fast" | "heavy" | "defend") => void;
  onPointerMove?: (x: number, y: number) => void;
};

const app: AppLike = combatTest
  ? new CombatTestApp(canvas, new CombatTestSim())
  : editor
    ? new EditorApp(canvas)
    : new GameApp(canvas, {
        godMode: launch?.godMode ?? false,
        startScene: launch?.startScene ?? "forge",
      });

if (combatTest) {
  document.title = "Shardblade — Combat Test";
} else if (editor) {
  document.title = "Shardblade — Scene Editor";
} else if (launch?.startScene === "castle" && launch.godMode) {
  document.title = "Shardblade — God Mode · Scene 2";
} else if (launch?.startScene === "castle") {
  document.title = "Shardblade — Scene 2";
} else if (launch?.startScene === "chasm" && launch.godMode) {
  document.title = "Shardblade — God Mode · Scene 1";
} else if (launch?.startScene === "chasm") {
  document.title = "Shardblade — Scene 1";
} else {
  document.title = "Shardblade";
}

function canvasCoords(ev: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (ev.clientX - rect.left) * scaleX,
    y: (ev.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("click", (ev) => {
  if (editor) return;
  const { x, y } = canvasCoords(ev);
  app.onClick(x, y);
});

canvas.addEventListener("mousemove", (ev) => {
  if (!app.onPointerMove || editor) return;
  const { x, y } = canvasCoords(ev);
  app.onPointerMove(x, y);
});

window.addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  if (!editor && "onKeyDown" in app && typeof (app as GameApp).onKeyDown === "function") {
    (app as GameApp).onKeyDown(ev.key);
  }
  if (ev.repeat || editor) return;
  if (ev.key === "q" || ev.key === "Q") {
    app.setStyle("fast");
  } else if (ev.key === "e" || ev.key === "E") {
    app.setStyle("heavy");
  } else if (ev.key === "s" || ev.key === "S") {
    app.setStyle("defend");
  }
});

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  app.tick(dt);
  app.draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
