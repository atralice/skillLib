/* eslint-disable @typescript-eslint/consistent-type-assertions */
import prisma from "@/lib/prisma";
import type { PrismaClient } from "generated/prisma/client/client";

type BuildAttributes<TBuild> = () => TBuild;
type CreateAttributes<TCreate, Input> = (attributes: Input) => TCreate | Promise<TCreate>;

type CreateFactoryParams<TBuild, TCreate, Input, Traits = object> = {
  modelName: keyof PrismaClient;
  buildAttributes: BuildAttributes<TBuild>;
  createAttributes: CreateAttributes<TCreate, Input>;
  traits?: Traits;
};

export default function createFactory<
  TBuild,
  TCreate,
  Input,
  Traits extends Record<string, any> = object,
>({
  modelName,
  buildAttributes,
  createAttributes,
  traits,
}: CreateFactoryParams<TBuild, TCreate, Input, Traits>) {
  type FactoryType = {
    build: (overrides?: Partial<TBuild>) => TBuild;
    buildMany: (count: number, overrides?: Partial<TBuild>) => TBuild[];
    createAttributes: (attributes?: Input) => Promise<TCreate>;
    create: (attributes?: Input) => Promise<TBuild>;
    createMany: (attributes: Input[]) => Promise<TBuild[]>;
    reload: (id: string) => Promise<TBuild>;
  };

  const factory: FactoryType = {
    build: (overrides: Partial<TBuild> = {}) => ({
      ...buildAttributes(),
      ...overrides,
    }),

    buildMany: (count: number, overrides: Partial<TBuild> = {}) =>
      Array.from({ length: count }, () => ({
        ...buildAttributes(),
        ...overrides,
      })),

    createAttributes: async (attributes: Input = {} as Input) => await createAttributes(attributes),

    create: async (attributes: Input = {} as Input): Promise<TBuild> => {
      const data = await createAttributes(attributes);
      const model = prisma[modelName] as any;
      return await model.create({ data });
    },

    createMany: async (attributes: Input[]): Promise<TBuild[]> => {
      const model = prisma[modelName] as any;
      const tasks = await Promise.all(attributes.map((attr) => createAttributes(attr)));
      return await Promise.all(tasks.map((task) => model.create({ data: task })));
    },

    reload: async (id: string) => {
      const model = prisma[modelName] as any;
      return await model.findUniqueOrThrow({
        where: { id },
      });
    },
  };

  type ResolvedTraits = {
    [K in keyof Traits]: Traits[K] extends (factory: FactoryType) => infer R ? R : Traits[K];
  };

  const resolvedTraits = {} as ResolvedTraits;

  if (traits) {
    for (const key in traits) {
      const trait = traits[key];
      resolvedTraits[key] = (
        typeof trait === "function" ? trait(factory) : trait
      ) as ResolvedTraits[typeof key];
    }
  }

  return { ...factory, ...resolvedTraits };
}
