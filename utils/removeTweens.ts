// Shamelessly stolen (and modified) from @latticexyz/phaserx (Love you all <3)

export const removeTweens = async (
  gameObject: Phaser.GameObjects.GameObject
) => {
  const tweenManager = gameObject.scene.tweens;
  for (const tween of tweenManager.tweens) {
    if (tween.hasTarget(gameObject)) {
      tween.stop();
    }
  }
};
