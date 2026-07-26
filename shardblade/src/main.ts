import { GameApp } from "./app/gameApp";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const app = new GameApp(canvas);

canvas.addEventListener("click", (ev) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (ev.clientX - rect.left) * scaleX;
  const y = (ev.clientY - rect.top) * scaleY;
  app.onClick(x, y);
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
