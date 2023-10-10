import { tileCoordToPixelCoord } from "./tileCoordToPixelCoord";

type Coord = {
  x: number;
  y: number;
};

export const getCenterPixelCoord = (
  tileCoord: Coord,
  tileWidth: number,
  tileHeight: number
): Coord => {
  const topLeftCoord = tileCoordToPixelCoord(tileCoord, tileWidth, tileHeight);
  return {
    x: topLeftCoord.x + tileWidth / 2,
    y: topLeftCoord.y + tileHeight / 2,
  };
};
