import { loadMission, type RawMission } from "../mission";
import m01 from "./m01-first-letter.json";
import m02 from "./m02-two-shapes.json";
import m03 from "./m03-low-water.json";
import m04 from "./m04-the-lock.json";

/** The campaign in play order. JSON literals widen to string, hence the cast; loadMission validates everything. */
export const MISSIONS = [m01, m02, m03, m04].map((raw) => loadMission(raw as unknown as RawMission));
