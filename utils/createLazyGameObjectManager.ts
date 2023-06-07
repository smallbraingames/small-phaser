import { Coord, coordToKey, keyToCoord } from "@latticexyz/utils";

import { Camera } from "../types";
import RBush from "rbush";
import { pixelCoordToTileCoord } from "./pixelCoordToTileCoord";

class PointRBush<T extends Coord> extends RBush<T> {
  toBBox({ x, y }: Coord) {
    return { minX: x, minY: y, maxX: x, maxY: y };
  }
  compareMinX(a: T, b: T) {
    return a.x - b.x;
  }
  compareMinY(a: T, b: T) {
    return a.y - b.y;
  }
}

export const createLazyGameObjectManager = <
  T extends Phaser.GameObjects.GameObject | Phaser.GameObjects.Group
>(
  camera: Camera,
  createGameObject: (coord: Coord, key: string) => T,
  tilemap?: { tileWidth: number; tileHeight: number }
) => {
  const {
    phaserCamera: { worldView },
    worldView$,
  } = camera;

  let initialized = false;
  let activeCoords = new Set<number>();
  const gameObjects = new Map<number, Set<{ gameObject: T; key: string }>>();

  const gameObjectKeys = new PointRBush<{
    x: number;
    y: number;
    key: Set<string>;
  }>();

  const getKeysAtCoord = (coord: Coord): Set<string> => {
    const keys = gameObjectKeys.search({
      minX: coord.x,
      minY: coord.y,
      maxX: coord.x,
      maxY: coord.y,
    });
    if (keys.length > 0) {
      return keys[0].key;
    }
    throw Error("No keys at coord");
  };

  const hasKeysAtCoord = (coord: Coord): boolean => {
    return (
      gameObjectKeys.search({
        minX: coord.x,
        minY: coord.y,
        maxX: coord.x,
        maxY: coord.y,
      }).length > 0
    );
  };

  const addGameObject = (coord: Coord, key: string) => {
    const coordKey = coordToKey(coord);
    let keys: Set<string>;
    if (!hasKeysAtCoord(coord)) {
      keys = new Set();
      gameObjectKeys.insert({ ...coord, key: keys });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      keys = getKeysAtCoord(coord)!;
    }
    keys.add(key);
    if (initialized) {
      activeCoords.delete(coordKey);
      render(worldView);
    }
  };

  const removeAll = () => {
    gameObjectKeys.clear();
    refresh();
  };

  const removeCoordGameObjects = (coord: Coord) => {
    const coordKey = coordToKey(coord);
    gameObjectKeys.remove(
      { ...coord, key: new Set() },
      (a, b) => coordToKey(a) == coordToKey(b)
    );
    gameObjects.get(coordKey)?.forEach((gameObject) => {
      gameObject.gameObject.destroy();
    });
    gameObjects.delete(coordKey);
    activeCoords.delete(coordKey);
    render(worldView);
  };

  const removeGameObject = (coord: Coord, key: string) => {
    const coordKey = coordToKey(coord);
    const coordObjects = gameObjects.get(coordKey);
    if (!coordObjects) {
      return;
    }
    coordObjects.forEach((gameObject) => {
      if (gameObject.key == key) {
        gameObject.gameObject.destroy();
        coordObjects.delete(gameObject);
      }
    });
    if (hasKeysAtCoord(coord)) {
      getKeysAtCoord(coord).delete(key);
    }
    activeCoords.delete(coordKey);
    render(worldView);
  };

  const hasKey = (coord: Coord, key: string): boolean => {
    if (!hasKeysAtCoord(coord)) {
      return false;
    }
    return getKeysAtCoord(coord).has(key);
  };

  const getGameObject = (coord: Coord, key: string): T | undefined => {
    const coordKey = coordToKey(coord);
    const coordObjects = gameObjects.get(coordKey);
    if (!coordObjects) {
      return;
    }
    for (const coordObject of coordObjects) {
      if (coordObject.key == key) {
        return coordObject.gameObject;
      }
    }
    return;
  };

  const createCoordGameObjects = (coordKey: number) => {
    const coord = keyToCoord(coordKey);

    if (!hasKeysAtCoord(coord)) {
      return;
    }

    // Delete previous game objects at key
    gameObjects
      .get(coordKey)
      ?.forEach((gameObject) => gameObject.gameObject.destroy());
    gameObjects.delete(coordKey);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const keys = getKeysAtCoord(coord);
    let gameObjectSet = gameObjects.get(coordKey);
    if (!gameObjectSet) {
      gameObjectSet = new Set<{ gameObject: T; key: string }>();
    }
    keys.forEach((key) => {
      const gameObject = createGameObject(keyToCoord(coordKey), key);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      gameObjectSet!.add({ gameObject, key });
    });
    gameObjects.set(coordKey, gameObjectSet);
  };

  const refresh = () => {
    activeCoords = new Set();
    [...gameObjects.entries()].forEach((value) => {
      value[1].forEach((gameObject) => {
        gameObject.gameObject.destroy();
      });
    });
    render(worldView);
  };

  const render = (worldView: Phaser.Geom.Rectangle) => {
    const visibleCoords = gameObjectKeys.search({
      minX: worldView.x,
      minY: worldView.y,
      maxX: worldView.x + worldView.width,
      maxY: worldView.y + worldView.height,
    });

    const visibleCoordKeys = new Set(
      visibleCoords.map((coord) => coordToKey(coord))
    );

    const offscreenCoordKeys = [...activeCoords].filter(
      (x) => !visibleCoordKeys.has(x)
    );

    const newVisibleCoordKeys = [...visibleCoordKeys].filter(
      (x) => !activeCoords.has(x)
    );

    offscreenCoordKeys.forEach((key) => {
      gameObjects
        .get(key)
        ?.forEach((gameObject) => gameObject.gameObject.destroy());
      gameObjects.delete(key);
    });

    newVisibleCoordKeys.forEach((key) => {
      createCoordGameObjects(key);
    });

    activeCoords = new Set(visibleCoordKeys);
  };

  const getTilemapWorldView = (worldView: Phaser.Geom.Rectangle) => {
    if (!tilemap) {
      return worldView;
    }

    const tilemapCoord = pixelCoordToTileCoord(
      {
        x: worldView.x,
        y: worldView.y,
      },
      tilemap.tileWidth,
      tilemap.tileHeight
    );

    const tilemapWidth = Math.ceil(worldView.width / tilemap.tileWidth);
    const tilemapHeight = Math.ceil(worldView.height / tilemap.tileHeight);

    return new Phaser.Geom.Rectangle(
      tilemapCoord.x,
      tilemapCoord.y,
      tilemapWidth,
      tilemapHeight
    );
  };

  const initialize = () => {
    render(getTilemapWorldView(worldView));

    worldView$.subscribe((worldView) => {
      render(getTilemapWorldView(worldView));
    });
    initialized = true;
  };

  return {
    addGameObject,
    initialize,
    removeCoordGameObjects,
    removeAll,
    removeGameObject,
    getGameObject,
    hasKey,
    refresh,
  };
};
