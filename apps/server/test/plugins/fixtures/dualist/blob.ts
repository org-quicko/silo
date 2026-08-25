// The provider half, named by `contributes.providers[0].entry`. Constructed, not
// dispatched — so it default-exports a factory rather than a plugin definition,
// and it imports nothing from `silo:api`.
export default {
  create(config: any) {
    return {
      driver: "memo",
      config,
      async put() {
        throw new Error("not implemented");
      },
    };
  },
};
