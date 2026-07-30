import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidXrplClassicAddress } from "../src/xrpl/address.js";

describe("XRPL classic address validation", function () {
  it("requires the account version and an exact Base58Check checksum", function () {
    assert.equal(
      isValidXrplClassicAddress("rUYvHdCmkdVZMEqqa43bxX3gQEc7BSWxb8"),
      true,
    );
    assert.equal(
      isValidXrplClassicAddress("rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p"),
      true,
    );
    assert.equal(
      isValidXrplClassicAddress("rUYvHdCmkdVZMEqqa43bxX3gQEc7BSWxb9"),
      false,
    );
    assert.equal(isValidXrplClassicAddress("rSource"), false);
  });
});
