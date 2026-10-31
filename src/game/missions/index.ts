import { loadMission, type RawMission } from "../mission";
import m01 from "./m01-first-letter.json";
import m02 from "./m02-two-shapes.json";
import m03 from "./m03-low-water.json";
import m04 from "./m04-the-lock.json";
import m05 from "./m05-crossing.json";
import m06 from "./m06-narrow-budget.json";
import m07 from "./m07-spring-tide.json";
import m08 from "./m08-three-villages.json";
import m09 from "./m09-lighthouse.json";

/** The campaign in play order. JSON literals widen to string, hence the cast; loadMission validates everything. */
export const MISSIONS = [m01, m02, m03, m04, m05, m06, m07, m08, m09].map((raw) => loadMission(raw as unknown as RawMission));

/** Campaign missions whose timing (tide or launches) gives the daily remix something to vary. */
export const DAILY_TEMPLATES = MISSIONS.filter((m) => ["m03", "m04", "m07", "m08", "m09"].includes(m.id));
