import { deferred } from "../utils/deferred";

export const getSceneLoadPromise = async (scene: Phaser.Scene) => {
  const [resolve, , promise] = deferred();
  //scene.events.on("create", resolve);
  scene.load.once("complete", resolve);
  await promise;
};
