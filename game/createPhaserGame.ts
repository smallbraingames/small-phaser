import Phaser from "phaser";
import createNetwork from "../../network/createNetwork";
import getGameLoadPromise from "./getGameLoadPromise";
import resizePhaserGame from "./resizePhaserGame";

const createPhaserGame = async (config: Phaser.Types.Core.GameConfig) => {
  const game = new Phaser.Game(config);
  await getGameLoadPromise(game);

  resizePhaserGame(game);

  const buildScenes: { [key: string]: Phaser.Scene } = {};
  game.scene.getScenes(false).forEach((scene) => {
    buildScenes[scene.scene.key] = scene;
  });
  const phaserScenes = buildScenes as { [key: string]: Phaser.Scene };

  const context = {
    game,
    scenes: phaserScenes,
  };

  createNetwork();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).game = context;

  return context;
};

export default createPhaserGame;
