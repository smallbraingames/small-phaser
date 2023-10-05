import { deferred } from "../utils/deferred";

export const getGameLoadPromise = async (game: Phaser.Game) => {
  const [resolve, , promise] = deferred();
  game.events.on("ready", resolve);
  await promise;
};
