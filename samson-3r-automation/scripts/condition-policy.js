import { MODULE_ID } from "./catalog.js";

// A real GM may administer documents and override action restrictions. Keep
// the verified requesting user on delegated commands: running on the GM's
// client is not evidence that the player asked for a GM override.
export function conditionAdmin(options={}) {
  if(!game.user?.isGM||options.threeRRuleOperation)return false;
  const user=options.user??(options.threeRConditionUserId?game.users.get(options.threeRConditionUserId):game.user);
  return Boolean(user?.isGM&&game.users.get(user.id)===user);
}
const itemOperations=new WeakMap();
// Native rollAttack/preUseItem do not receive the original use options.
// Bind only this temporary Item; never change shared Actor or GM state.
export function bindConditionOperation(item,options) {
  itemOperations.set(item,{...options});
}
export function conditionItemOptions(item,options={}) {
  return {...itemOperations.get(item),...options};
}
export function martialConditionOptions(actor,id) {
  const userId=actor.flags?.[MODULE_ID]?.martial?.receipts?.[id]?.userId;
  // Receipts record the verified request author in martial-runtime. Legacy
  // receipts without an author keep rule restrictions on the executing GM.
  return userId?{threeRConditionUserId:userId}:{threeRRuleOperation:true};
}

