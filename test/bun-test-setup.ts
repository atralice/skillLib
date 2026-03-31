import fetchMock from "fetch-mock";
import { mock, afterEach } from "bun:test";
import mockCookies from "./testHelpers/mocks/mockCookies";

await (async () => {
  fetchMock.mockGlobal();

  setupTestDb();

  await mockImportServerOnly();
  await mockImportReactCache();
  await mockImportNextCache();
  await mockImportNextImage();
  await mockCookies({});

  afterEach(() => {
    mock.restore();
  });
})();

function setupTestDb() {
  if (!process.env.DATABASE_URL?.match(/test/)) {
    throw new Error("DATABASE_URL must contain 'test'");
  }
}

async function mockImportServerOnly() {
  const noop = () => {};
  await mock.module("server-only", () => noop);
}

async function mockImportReactCache() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const originalReact = require("react");
  const mockCache = (fn: any) => fn;

  await mock.module("react", () => ({
    default: originalReact,
    ...originalReact,
    cache: mockCache,
  }));
}

async function mockImportNextCache() {
  await mock.module("next/cache", () => ({
    revalidatePath: () => {},
  }));
}

async function mockImportNextImage() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");

  const MockImage = (props: Record<string, unknown>) => {
    return React.createElement("img", { ...props });
  };

  await mock.module("next/image", () => ({
    default: MockImage,
  }));
}
