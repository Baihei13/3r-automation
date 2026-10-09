// Optional integration only. HUD has no imports from another module and its
// native D35E operations work without an automation package installed/enabled.
const AUTOMATION_ID = "samson-3r-automation";

export function automationApi() {
  const module = game.modules.get(AUTOMATION_ID);
  return module?.active ? module.api ?? null : null;
}

export function automationFlag(document, key) {
  if (!game.modules.get(AUTOMATION_ID)?.active) return undefined;
  // getFlag rejects an absent/inactive package scope in Foundry. Read this
  // optional package's stored data without invoking scope validation or writing.
  return foundry.utils.getProperty(document?.flags?.[AUTOMATION_ID], key);
}
