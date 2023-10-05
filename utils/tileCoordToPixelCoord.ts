type Coord = {
  x: number;
  y: number;
};

export const tileCoordToPixelCoord = (
  tileCoord: Coord,
  tileWidth: number,
  tileHeight: number
): Coord => {
  return {
    x: tileCoord.x * tileWidth,
    y: tileCoord.y * tileHeight,
  };
};
