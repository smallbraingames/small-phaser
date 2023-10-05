import { Camera } from "../types";

import { pixelCoordToTileCoord } from "./pixelCoordToTileCoord";
import { throttleTime } from "rxjs";
import { Quadtree, QuadtreeLeaf, quadtree } from "d3-quadtree";

const ENCODE_ARGS_SEPARATOR = ":";

type Coord = {
  x: number;
  y: number;
};

// Below two functions copied from @latticexyz/utils

const LOWER_HALF_MASK = 2 ** 16 - 1;

export function coordToKey(coord: Coord) {
  const key = (coord.x << 16) | (coord.y & LOWER_HALF_MASK);
  return key;
}

export function keyToCoord(key: number): Coord {
  const x = key >> 16;
  const y = (key << 16) >> 16;
  return { x, y };
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

const search = <T>(
  quadtree: Quadtree<T>,
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number
) => {
  const results: T[] = [];
  quadtree.visit((node, x1, y1, x2, y2) => {
    const isLeaf = !node.length;
    if (isLeaf) {
      let currentNode: QuadtreeLeaf<T> | undefined = node as QuadtreeLeaf<T>;
      do {
        const d = currentNode!.data;
        const x = quadtree.x()(d);
        const y = quadtree.y()(d);
        if (x >= xmin && x < xmax && y >= ymin && y < ymax) {
          results.push(d);
        }
        currentNode = currentNode!.next;
      } while (currentNode !== undefined);
    }
    return x1 >= xmax || y1 >= ymax || x2 < xmin || y2 < ymin;
  });
  return results;
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

  const indexedEncodedInfo = quadtree<{
    x: number;
    y: number;
    infos: Set<string>;
  }>();

  indexedEncodedInfo.x((coord) => coord.x);
  indexedEncodedInfo.y((coord) => coord.y);

  const coordInfos = new Map<number, Set<string>>();
  const _getInfosAtCoord = (coord: Coord): Set<string> | undefined => {
    const coordKey = coordToKey(coord);
    return coordInfos.get(coordKey);
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
    if (gameObjectGenerators.has(generatorKey)) {
      console.warn(
        `[Lazy Game Object Manager] Generator key ${generatorKey} already registered`
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
    const indexedInfos = _getInfosAtCoord(coord);
    if (indexedInfos !== undefined) {
      infos = indexedInfos;
    } else {
      infos = new Set();
      indexedEncodedInfo.add({
        x: coord.x,
        y: coord.y,
        infos: infos,
      });
      coordInfos.set(coordToKey(coord), infos);
    }
    infos.add(encodeInfo(info));
    if (initialized) {
      refreshCoord(coord);
    }
  };

  const addGameObjects = (
    objects: { coord: Coord; generatorArgs: GameObjectInfo }[]
  ) => {
    const newEncodedInfos: { x: number; y: number; infos: Set<string> }[] = [];

    for (const object of objects) {
      const coordKey = coordToKey(object.coord);
      const indexedInfos = _getInfosAtCoord(object.coord);
      if (indexedInfos) {
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

    indexedEncodedInfo.addAll(newEncodedInfos);

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
    if (!isInitialized()) {
      console.warn(
        "[Lazy Game Object Manager] Not rendering before initialized"
      );
      return;
    }

    const worldView = getTilemapWorldView(rawWorldView);

    // If override is provided, only render the coords, otherwise render the worldview
    const visibleCoords = search(
      indexedEncodedInfo,
      worldView.x - buffer,
      worldView.y - buffer,
      worldView.x + worldView.width + buffer,
      worldView.y + worldView.height + buffer
    );

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
