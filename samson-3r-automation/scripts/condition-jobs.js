// Status reconciliation reads the newest document once, rather than retaining
// one full calculation for every Item/Actor/icon hook in a burst.
const jobs=new WeakMap();
const deleting=new WeakSet();
const reported=new WeakSet();
let installed=false;

export function conditionActorLive(actor) {
  if(!actor||deleting.has(actor))return false;
  if(actor.isToken) {
    const token=actor.token,scene=token?.parent;
    return Boolean(scene&&game.scenes.get(scene.id)===scene&&scene.tokens.get(token.id)===token&&token.actor===actor&&game.actors.has(token.actorId)&&!deleting.has(game.actors.get(token.actorId)));
  }
  return game.actors.get(actor.id)===actor;
}
export function reconcileConditionJob(actor,key,work) {
  if(!conditionActorLive(actor))return Promise.resolve();
  let entries=jobs.get(actor);
  if(!entries){entries=new Map();jobs.set(actor,entries);}
  const existing=entries.get(key);
  if(existing){existing.dirty=true;return existing.promise;}
  const job={dirty:true,promise:null};
  entries.set(key,job);
  job.promise=Promise.resolve().then(async()=>{
    while(job.dirty&&conditionActorLive(actor)) {
      job.dirty=false;
      try{await work();}catch(error){if(conditionActorLive(actor))throw error;}
    }
  }).finally(()=>{if(entries.get(key)===job)entries.delete(key);});
  return job.promise;
}
export const conditionBookkeepingOptions={threeRConditionBookkeeping:true,updateChanges:false,skipMinions:true,skipToken:true};
export function reportConditionError(prefix,error) {
  if(error&&typeof error==="object") {
    if(reported.has(error))return;
    reported.add(error);
  }
  console.error("samson-3r-automation",error);
  ui.notifications.error(`${prefix}：${error?.message??error}`);
}
// Foundry merges object flags. Explicit removals are required when a condition
// leaves a tracking map; writing {} must not retain all of the old keys.
export function conditionMapUpdate(path,previous,next) {
  const update={};
  for(const key of Object.keys(previous))if(!Object.hasOwn(next,key))update[`${path}.-=${key}`]=null;
  for(const [key,value] of Object.entries(next))if(JSON.stringify(previous[key])!==JSON.stringify(value))update[`${path}.${key}`]=value;
  return update;
}
export function installConditionJobLifecycle() {
  if(installed)return;installed=true;
  const wrap=(prototype,actors)=>{
    const remove=prototype.delete;
    prototype.delete=async function(...args) {
      const affected=actors(this);
      for(const actor of affected){deleting.add(actor);jobs.delete(actor);}
      try{return await remove.apply(this,args);}
      finally{for(const actor of affected)deleting.delete(actor);}
    };
  };
  // Guard from the beginning of a local deletion, including a cancelled or
  // failed deletion. Other clients stop on the actual collection removal.
  wrap(CONFIG.Actor.documentClass.prototype,actor=>[actor]);
  wrap(CONFIG.Token.documentClass.prototype,token=>token.actor&&!token.actorLink?[token.actor]:[]);
  Hooks.on("deleteActor",actor=>jobs.delete(actor));
  Hooks.on("deleteToken",token=>{if(!token.actorLink&&token.actor)jobs.delete(token.actor);});
}
