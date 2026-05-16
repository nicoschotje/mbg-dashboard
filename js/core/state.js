// Shared app state + event bus (blueprint §13.5)
//
// Replaces the monkey-patching pattern from the monolith. Modules emit
// events and listen for them rather than reaching into each other.

const bus = new EventTarget();

export const AppState = {
  session: null,
  settings: null,
  categories: [],
  products: [],
  orders: [],
  tiers: {},        // phone -> tier row from customer_tiers

  on(event, handler) {
    const wrapped = (e) => handler(e.detail);
    bus.addEventListener(event, wrapped);
    return () => bus.removeEventListener(event, wrapped);
  },
  emit(event, data) {
    bus.dispatchEvent(new CustomEvent(event, { detail: data }));
  },
};
