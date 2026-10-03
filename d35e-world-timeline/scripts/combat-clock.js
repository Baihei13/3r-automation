import { ROUND_SECONDS } from "./time.mjs";

export function installCombatClock() {
  Hooks.on("preUpdateCombat",(combat,change,operation)=> {
    if(game.system.id!=="D35E"||!combat.active||!("round" in change||"turn" in change))return;
    const from=Number(combat.round),to=Number(change.round??combat.round);
    if(!Number.isFinite(from)||!Number.isFinite(to))return;
    // v14 advances world time on the server using this operation option.
    // Replace its delta once: a turn is zero seconds; a whole round is six.
    // Starting/resetting combat changes round 0 but does not elapse a round.
    const delta=from>0&&to>0?(to-from)*ROUND_SECONDS:0;
    operation.worldTime={...(operation.worldTime??{}),delta};
  });
}
