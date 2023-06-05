import createCamera from "./createCamera";
import { createInput } from "./createInput";
import createPhaserScene from "./scene/createPhaserScene";

export type Camera = Awaited<ReturnType<typeof createCamera>>;
export type Input = ReturnType<typeof createInput>;
export type Scene = ReturnType<typeof createPhaserScene>;
