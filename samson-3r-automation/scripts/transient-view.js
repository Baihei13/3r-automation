// Calculation-only view. Foundry documents can own non-configurable, read-only
// properties (notably Actor.items). Proxying the document itself and replacing
// those values violates the ECMAScript Proxy invariants, even without a write.
// Use an extensible empty target and forward native methods to their real owner
// so private fields and collection internal slots retain the correct receiver.
export function createTransientView(source, overrides) {
  const overridden = property => Object.prototype.hasOwnProperty.call(overrides, property);
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (overridden(property)) return overrides[property];
      const value = Reflect.get(source, property, source);
      return typeof value === "function" && property !== "constructor" ? value.bind(source) : value;
    },
    set(_target, property, value) {
      if (overridden(property)) return false;
      return Reflect.set(source, property, value, source);
    },
    has(_target, property) { return overridden(property) || Reflect.has(source, property); },
    ownKeys() { return [...new Set([...Reflect.ownKeys(source), ...Reflect.ownKeys(overrides)])]; },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
      if (overridden(property)) return {
        value: overrides[property], writable: false,
        enumerable: descriptor?.enumerable ?? true, configurable: true
      };
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf() { return Reflect.getPrototypeOf(source); }
  });
}
