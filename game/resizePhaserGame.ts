export const resizePhaserGame = (game: Phaser.Game) => {
  const resize = () => {
    let w = window.innerWidth * window.devicePixelRatio;
    let h = window.innerHeight * window.devicePixelRatio;
    game.scale.resize(w, h);
    for (let scene of game.scene.scenes) {
      if (scene.scene.settings.active) {
        scene.cameras.main.setViewport(0, 0, w, h);
      }
    }
  };
  window.addEventListener("resize", resize.bind(this));
};
