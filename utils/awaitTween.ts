// Shamelessly stolen (and modified) from @latticexyz/phaserx (Love you all <3)

import { deferred } from "@latticexyz/utils";

export const awaitTween = async (
  config: Phaser.Types.Tweens.TweenBuilderConfig
) => {
  const [resolve, , promise] = deferred<void>();
  const { targets } = config;
  if (!targets.scene || !targets.scene.tweens) return;
  targets.scene.tweens.add({
    ...config,
    onComplete: (tween: Phaser.Tweens.Tween, targets: any[]) => {
      config.onComplete && config.onComplete(tween, targets);
      resolve();
    },
  });
  return promise;
};
