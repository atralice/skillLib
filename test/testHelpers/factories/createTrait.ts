type Factory<TBuild, Input> = {
  build: (overrides?: Partial<TBuild>) => TBuild;
  create: (attributes?: Input) => Promise<TBuild>;
};

export default function createTrait<TBuild, TCreate, Input>(attributes: Partial<TCreate>) {
  return function (factory: Factory<TBuild, Input>) {
    return {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      create: (attrs: Input = {} as Input) => {
        const traitDefaults = Object.fromEntries(
          Object.entries(attributes).filter(
            // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
            ([key]) => !(key in (attrs as Record<string, any>)),
          ),
        );

        return factory.create({
          ...attrs,
          ...traitDefaults,
        });
      },

      build: (attrs: Partial<TBuild> = {}) => {
        const traitDefaults = Object.fromEntries(
          Object.entries(attributes).filter(([key]) => !(key in attrs)),
        );

        return factory.build({
          ...attrs,
          ...traitDefaults,
        });
      },
    };
  };
}
