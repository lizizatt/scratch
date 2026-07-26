import { CombatTestApp } from "./app/combatTestApp";
import { GameApp } from "./app/gameApp";
import { CombatTestSim, isCombatTestPath } from "./sim/combatTest";

const canvas = document.getElementById("game") as HTMLCanvasElement;

const combatTest = isCombatTestPath(window.location.pathname);
const app = combatTest
  ? new CombatTestApp(canvas, new CombatTestSim())
  : new GameApp(canvas);

if (combatTest) {
  document.title = "Shardblade — Combat Test";
}

canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (ev.clientX - rect.left) * scaleX;
  const y = (ev.clientY - rect.top) * scaleY;
  app.onClick(x, y);
});

window.addEventListener("keydown", (ev) => {
  if (ev.repeat) return;
  if (ev.key === "q" || ev.key === "Q") {
    app.setStyle("fast");
  } else if (ev.key === "e" || ev.key === "E") {
    app.setStyle("heavy");
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
