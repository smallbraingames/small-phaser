type Coord = {
  x: number;
  y: number;
};

export const pixelCoordToTileCoord = (
  pixelCoord: Coord,
  tileWidth: number,
  tileHeight: number
): Coord => {
  return {
    x: Math.floor(pixelCoord.x / tileWidth),
    y: Math.floor(pixelCoord.y / tileHeight),
  };
};
