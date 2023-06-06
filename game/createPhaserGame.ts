import Phaser from "phaser";
import { getGameLoadPromise } from "./getGameLoadPromise";

export const createPhaserGame = async (
  config: Phaser.Types.Core.GameConfig
) => {
  const game = new Phaser.Game(config);
  await getGameLoadPromise(game);

  const buildScenes: { [key: string]: Phaser.Scene } = {};
  game.scene.getScenes(false).forEach((scene) => {
    buildScenes[scene.scene.key] = scene;
  });
  const phaserScenes = buildScenes as { [key: string]: Phaser.Scene };

  const context = {
    game,
    scenes: phaserScenes,
  };

  return context;
};
