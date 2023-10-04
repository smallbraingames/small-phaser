import { Coord, coordToKey, keyToCoord } from "@latticexyz/utils";

import { Camera } from "../types";
import RBush from "rbush";
import { pixelCoordToTileCoord } from "./pixelCoordToTileCoord";
import { Observable, Subject, throttleTime } from "rxjs";

const ENCODE_ARGS_SEPARATOR = ":";

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

type GameObjectInfo = {
  generatorKey: string;
  gameObjectKey: string;
};

type GameObjectGenerator<T extends Phaser.GameObjects.GameObject> = (
  coord: Coord,
  group: Phaser.GameObjects.Group,
  key: string
) => T;

const encodeInfo = (info: GameObjectInfo) => {
  return `${info.generatorKey}${ENCODE_ARGS_SEPARATOR}${info.gameObjectKey}`;
};

const decodeInfo = (encodedArgs: string): GameObjectInfo => {
  const [generatorKey, gameObjectKey] = encodedArgs.split(
    ENCODE_ARGS_SEPARATOR
  );
  return { generatorKey, gameObjectKey };
};

type GameObject = {
  gameObject: Phaser.GameObjects.GameObject;
  info: GameObjectInfo;
};

export const createLazyGameObjectManager = (
  camera: Camera,
  scene: Phaser.Scene,
  tilemap: { tileWidth: number; tileHeight: number } = {
    tileWidth: 1,
    tileHeight: 1,
  },
  buffer: number = 0,
  worldViewThrottle: number = 0
) => {
  const {
    phaserCamera: { worldView },
    worldView$,
  } = camera;

  let initialized = false;
  let activeCoords = new Set<number>();

  const gameObjectGenerators = new Map<
    string,
    GameObjectGenerator<Phaser.GameObjects.GameObject>
  >();
  const generatorTypes = new Map<string, Function>();
  const typeGroups = new Map<Function, Phaser.GameObjects.Group>();

  const gameObjects = new Map<number, Set<GameObject>>();

  const indexedEncodedInfo = new PointRBush<{
    x: number;
    y: number;
    infos: Set<string>;
  }>();

  const _getInfosAtCoord = (coord: Coord): Set<string> | undefined => {
    const args = indexedEncodedInfo.search({
      minX: coord.x,
      minY: coord.y,
      maxX: coord.x,
      maxY: coord.y,
    });
    if (args.length > 0) {
      return args[0].infos;
    }
    return undefined;
  };

  const registerGameObjectGenerator = <T extends Phaser.GameObjects.GameObject>(
    generatorKey: string,
    generator: GameObjectGenerator<T>,
    classType: Function
  ) => {
    if (generatorKey.includes(ENCODE_ARGS_SEPARATOR)) {
      throw Error(
        `[Lazy Game Object Manager] Generator key cannot include ${ENCODE_ARGS_SEPARATOR}`
      );
    }
    gameObjectGenerators.set(generatorKey, generator);
    generatorTypes.set(generatorKey, classType);
    const group = typeGroups.get(classType);
    if (!group) {
      typeGroups.set(classType, scene.add.group({ classType, maxSize: -1 }));
    }
  };

  const _getGameObjectGeneratorGroup = (
    generatorKey: string
  ): Phaser.GameObjects.Group => {
    const typeName = generatorTypes.get(generatorKey);
    const group = typeName && typeGroups.get(typeName);
    if (!group) {
      throw Error("[Lazy Game Object Manager] Generator group not found");
    }
    return group;
  };

  const addGameObject = (coord: Coord, info: GameObjectInfo) => {
    let infos: Set<string>;
    const coordInfos = _getInfosAtCoord(coord);
    if (coordInfos !== undefined) {
      infos = coordInfos;
    } else {
      infos = new Set();
      indexedEncodedInfo.insert({
        x: coord.x,
        y: coord.y,
        infos: infos,
      });
    }
    infos.add(encodeInfo(info));
    if (initialized) {
      refreshCoord(coord);
    }
  };

  const addGameObjects = (
    objects: { coord: Coord; generatorArgs: GameObjectInfo }[]
  ) => {
    const coordInfos = new Map<number, Set<string>>();
    const newEncodedInfos: { x: number; y: number; infos: Set<string> }[] = [];

    for (const object of objects) {
      const coordKey = coordToKey(object.coord);
      const infos = coordInfos.get(coordKey);
      if (infos) {
        continue;
      }
      const indexedInfos = _getInfosAtCoord(object.coord);
      if (indexedInfos) {
        coordInfos.set(coordKey, indexedInfos);
        continue;
      }
      const newInfos = new Set<string>();
      coordInfos.set(coordKey, newInfos);
      newEncodedInfos.push({
        x: object.coord.x,
        y: object.coord.y,
        infos: newInfos,
      });
    }

    indexedEncodedInfo.load(newEncodedInfos);

    for (const object of objects) {
      const coordKey = coordToKey(object.coord);
      const args = coordInfos.get(coordKey);
      if (!args) {
        throw Error("[Lazy Game Object Manager] Generator args not found");
      }
      args.add(encodeInfo(object.generatorArgs));
    }

    if (initialized) {
      _refreshCoords(objects.map((object) => object.coord));
    }
  };

  const hasInfo = (coord: Coord, info: GameObjectInfo) => {
    const coordInfos = _getInfosAtCoord(coord);
    if (coordInfos === undefined) {
      return false;
    }
    return coordInfos.has(encodeInfo(info));
  };

  const removeAll = () => {
    indexedEncodedInfo.clear();
    refresh();
  };

  const removeCoordGameObjects = (coord: Coord) => {
    const coordKey = coordToKey(coord);
    indexedEncodedInfo.remove(
      { ...coord, infos: new Set() },
      (a, b) => coordToKey(a) == coordToKey(b)
    );
    activeCoords.delete(coordKey);
    render(worldView);
  };

  const _destroyGameObject = (gameObject: GameObject) => {
    const group = _getGameObjectGeneratorGroup(gameObject.info.generatorKey);
    group.killAndHide(gameObject.gameObject);
  };

  const removeGameObjects = (
    objects: { coord: Coord; generatorArgs: GameObjectInfo }[]
  ) => {
    for (const object of objects) {
      _getInfosAtCoord(object.coord)?.delete(encodeInfo(object.generatorArgs));
    }
    _refreshCoords(objects.map((object) => object.coord));
  };

  const removeGameObject = (coord: Coord, generatorArgs: GameObjectInfo) => {
    removeGameObjects([{ coord, generatorArgs }]);
  };

  const getGameObject = (
    coord: Coord,
    info: GameObjectInfo
  ): GameObject | undefined => {
    const coordKey = coordToKey(coord);
    const coordObjects = gameObjects.get(coordKey);
    if (!coordObjects) {
      return;
    }
    for (const coordObject of coordObjects) {
      if (
        coordObject.info.gameObjectKey == info.gameObjectKey &&
        coordObject.info.generatorKey == info.generatorKey
      ) {
        return coordObject;
      }
    }
    return;
  };

  const createCoordGameObjects = (coordKey: number) => {
    const coord = keyToCoord(coordKey);

    // Delete previous game objects at coord
    let gameObjectSet = gameObjects.get(coordKey);
    gameObjectSet?.forEach((gameObject) => _destroyGameObject(gameObject));
    gameObjectSet?.clear();

    const infos = _getInfosAtCoord(coord);

    if (infos === undefined || infos.size === 0) {
      return;
    }

    // Add new game objects
    if (gameObjectSet === undefined) {
      gameObjectSet = new Set<GameObject>();
      gameObjects.set(coordKey, gameObjectSet);
    }
    infos.forEach((encodedInfo) => {
      const info = decodeInfo(encodedInfo);
      const group = _getGameObjectGeneratorGroup(info.generatorKey);
      const generator = gameObjectGenerators.get(info.generatorKey);
      if (!generator) {
        throw Error("[Lazy Game Object Manager] Generator not found");
      }
      const gameObject = generator(coord, group, info.gameObjectKey);
      gameObjectSet!.add({ gameObject, info });
    });
  };

  const refresh = () => {
    activeCoords = new Set();
    render(worldView);
  };

  const _refreshCoords = (coords: Coord[]) => {
    if (coords.length === 0) {
      return;
    }
    const overrideCoords = new Set<number>();
    for (const coord of coords) {
      const coordKey = coordToKey(coord);
      activeCoords.delete(coordKey);
      overrideCoords.add(coordKey);
    }
    renderCoords([...overrideCoords]);
  };

  const refreshCoord = (coord: Coord) => {
    _refreshCoords([coord]);
  };

  const renderCoords = (coords: number[]) => {
    coords.forEach((key) => {
      createCoordGameObjects(key);
      activeCoords.add(key);
    });
  };

  const render = (rawWorldView: Phaser.Geom.Rectangle) => {
    console.log("rendering");
    if (!isInitialized()) {
      console.warn(
        "[Lazy Game Object Manager] Not rendering before initialized"
      );
      return;
    }

    const worldView = getTilemapWorldView(rawWorldView);

    // If override is provided, only render the coords, otherwise render the worldview
    const visibleCoords = indexedEncodedInfo.search({
      minX: worldView.x - buffer,
      minY: worldView.y - buffer,
      maxX: worldView.x + worldView.width + buffer,
      maxY: worldView.y + worldView.height + buffer,
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
        ?.forEach((gameObject) => _destroyGameObject(gameObject));
      gameObjects.delete(key);
      activeCoords.delete(key);
    });

    renderCoords(newVisibleCoordKeys);
  };

  const getTilemapWorldView = (worldView: Phaser.Geom.Rectangle) => {
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
    if (isInitialized()) {
      console.warn("[Lazy Game Object Manager] Already initialized");
      return;
    }
    worldView$.pipe(throttleTime(worldViewThrottle)).subscribe((worldView) => {
      render(worldView);
    });

    initialized = true;
  };

  const isInitialized = () => {
    return initialized;
  };

  return {
    addGameObject,
    addGameObjects,
    initialize,
    hasInfo,
    isInitialized,
    registerGameObjectGenerator,
    removeGameObjects,
    removeGameObject,
    getGameObject,
    refresh,
    refreshCoord,
  };
};
