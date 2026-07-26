const canvas = document.getElementById("game") as HTMLCanvasElement | null;
if (canvas) {
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#9db7ff";
    ctx.font = "28px Georgia";
    ctx.fillText("Shardblade — Phase 0", 48, 80);
    ctx.font = "16px Georgia";
    ctx.fillText("Sim skeleton ready. Run npm test.", 48, 120);
  }
}
