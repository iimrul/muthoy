import { beforeEach, describe, expect, it } from "vitest";
import {
  armRouteRestore,
  rememberRoute,
  resetRouteMemoryForTests,
  routeSessionKey,
  takeRouteToRestore,
} from "./lastRoute";

const SESSION = routeSessionKey(4, "owner-1", "shop-1");

beforeEach(() => resetRouteMemoryForTests());

describe("route memory across the authority gate", () => {
  it("returns the last route once after a re-check of the same session", () => {
    rememberRoute(SESSION, "/reports/sales-history");
    armRouteRestore(SESSION);
    expect(takeRouteToRestore(SESSION)).toBe("/reports/sales-history");
    expect(takeRouteToRestore(SESSION)).toBeNull();
  });

  it("returns nothing without a gate re-check", () => {
    rememberRoute(SESSION, "/inventory");
    expect(takeRouteToRestore(SESSION)).toBeNull();
  });

  it("never carries a route into another session: new epoch, user or shop", () => {
    rememberRoute(SESSION, "/inventory");
    for (const other of [
      routeSessionKey(5, "owner-1", "shop-1"),
      routeSessionKey(4, "staff-1", "shop-1"),
      routeSessionKey(4, "owner-1", "shop-2"),
    ]) {
      armRouteRestore(other);
      expect(takeRouteToRestore(other)).toBeNull();
    }
  });

  it("an arming is used up even when there is nothing to restore", () => {
    armRouteRestore(SESSION);
    expect(takeRouteToRestore(SESSION)).toBeNull();
    rememberRoute(SESSION, "/inventory");
    expect(takeRouteToRestore(SESSION)).toBeNull();
  });
});
