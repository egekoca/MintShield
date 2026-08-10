import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { keccak256, parseEventLogs, stringToHex, zeroHash } from "viem";
import { network } from "hardhat";

describe("MintShield core", async function () {
  const { viem, networkHelpers } = await network.create();
  const publicClient = await viem.getPublicClient();
  const wallets = await viem.getWalletClients();
  const [owner, user, other] = wallets;

  const ADAPTER_ID = keccak256(stringToHex("ERC4626_DEMO_V1"));
  const OTHER_ADAPTER_ID = keccak256(stringToHex("NO_SPEND_V1"));
  const AMOUNT = 1_000n;
  const CAP = 10_000n;
  const FUTURE_DEADLINE = 4_000_000_000n;

  let fxrp: any;
  let registry: any;
  let router: any;
  let vault: any;
  let adapter: any;

  beforeEach(async function () {
    fxrp = await viem.deployContract("MockERC20", ["Mock FXRP", "FXRP"]);
    registry = await viem.deployContract("AdapterRegistry", [
      owner.account.address,
    ]);
    router = await viem.deployContract("MintShieldRouter", [
      owner.account.address,
      registry.address,
      fxrp.address,
    ]);
    vault = await viem.deployContract("FailureVault", [fxrp.address]);
    adapter = await viem.deployContract("ERC4626DepositAdapter", [
      router.address,
      fxrp.address,
      vault.address,
    ]);
    await registry.write.configureAdapter([
      ADAPTER_ID,
      adapter.address,
      fxrp.address,
      CAP,
      true,
    ]);
  });

  function makeIntent(overrides: Record<string, unknown> = {}) {
    return {
      personalAccount: user.account.address,
      asset: fxrp.address,
      inputAmount: AMOUNT,
      adapterId: ADAPTER_ID,
      adapterData: "0x",
      minOutput: AMOUNT,
      deadline: FUTURE_DEADLINE,
      nonce: 1n,
      ...overrides,
    };
  }

  async function fundAndApprove(amount = AMOUNT) {
    await fxrp.write.mint([user.account.address, amount]);
    await fxrp.write.approve([router.address, amount], {
      account: user.account,
    });
  }

  async function execute(intent = makeIntent(), account = user.account) {
    const hash = await router.write.execute([intent], { account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt;
  }

  function eventFrom(receipt: any, eventName: string) {
    const events = parseEventLogs({
      abi: router.abi,
      logs: receipt.logs,
      eventName,
      strict: true,
    });
    assert.equal(events.length, 1);
    return events[0] as any;
  }

  async function executeFallback(
    expectedCode: number,
    intent = makeIntent(),
  ) {
    const receipt = await execute(intent);
    const event = eventFrom(receipt, "IntentSettledFallback");
    assert.equal(event.args.failureCode, expectedCode);
    return event;
  }

  it("settles a valid ERC-4626 deposit", async function () {
    await fundAndApprove();

    const receipt = await execute();
    const event = eventFrom(receipt, "IntentSettledSuccess");

    assert.equal(event.args.amountIn, AMOUNT);
    assert.equal(event.args.amountOut, AMOUNT);
    assert.equal(await fxrp.read.balanceOf([user.account.address]), 0n);
    assert.equal(await vault.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([vault.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
    assert.equal(await fxrp.read.balanceOf([adapter.address]), 0n);
    assert.equal(
      await fxrp.read.allowance([router.address, adapter.address]),
      0n,
    );
    assert.equal(
      await fxrp.read.allowance([adapter.address, vault.address]),
      0n,
    );
  });

  it("isolates a target revert and returns the full input", async function () {
    await vault.write.setMode([1]);
    await fundAndApprove();

    const event = await executeFallback(5);

    assert.equal(event.args.returnedAmount, AMOUNT);
    assert.notEqual(event.args.revertDataHash, zeroHash);
    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([vault.address]), 0n);
    assert.equal(await vault.read.balanceOf([user.account.address]), 0n);
  });

  it("rolls back target state when the vault lies about returned shares", async function () {
    await vault.write.setMode([2]);
    await fundAndApprove();

    await executeFallback(7);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([vault.address]), 0n);
    assert.equal(await vault.read.balanceOf([user.account.address]), 0n);
    assert.equal(await vault.read.totalSupply(), 0n);
  });

  for (const scenario of [
    { mode: 5, label: "large vault revert data", failureCode: 5 },
    { mode: 6, label: "malformed vault success data", failureCode: 7 },
    { mode: 7, label: "large vault success data", failureCode: 7 },
    { mode: 8, label: "vault gas exhaustion", failureCode: 5 },
  ]) {
    it(`bounds ${scenario.label} inside the adapter`, async function () {
      await vault.write.setMode([scenario.mode]);
      await fundAndApprove();

      const receipt = await execute();
      const event = eventFrom(receipt, "IntentSettledFallback");

      assert.equal(event.args.failureCode, scenario.failureCode);
      assert.equal(event.args.returnedAmount, AMOUNT);
      assert.notEqual(event.args.revertDataHash, zeroHash);
      assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
      assert.equal(await fxrp.read.balanceOf([vault.address]), 0n);
      assert.equal(await vault.read.balanceOf([user.account.address]), 0n);
      assert.ok(receipt.gasUsed < 700_000n);
    });
  }

  it("rolls back a below-minimum partial output", async function () {
    await vault.write.setMode([3]);
    await fundAndApprove();

    await executeFallback(6);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([vault.address]), 0n);
    assert.equal(await vault.read.balanceOf([user.account.address]), 0n);
  });

  it("accepts partial output when it satisfies the signed minimum", async function () {
    await vault.write.setMode([3]);
    await fundAndApprove();

    const intent = makeIntent({ minOutput: AMOUNT / 2n });
    const receipt = await execute(intent);
    const event = eventFrom(receipt, "IntentSettledSuccess");

    assert.equal(event.args.amountOut, AMOUNT / 2n);
    assert.equal(
      await vault.read.balanceOf([user.account.address]),
      AMOUNT / 2n,
    );
    assert.equal(await fxrp.read.balanceOf([vault.address]), AMOUNT);
  });

  it("treats an expired deadline as a funded safe fallback", async function () {
    await fundAndApprove();

    await executeFallback(1, makeIntent({ deadline: 1n }));

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(
      await fxrp.read.allowance([user.account.address, router.address]),
      0n,
    );
  });

  it("treats router pause as a safe fallback instead of a revert", async function () {
    await router.write.setPaused([true]);
    await fundAndApprove();

    await executeFallback(9);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
  });

  it("treats a disabled adapter as a safe fallback", async function () {
    await registry.write.setAdapterEnabled([ADAPTER_ID, false]);
    await fundAndApprove();

    await executeFallback(2);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
  });

  it("enforces the per-intent amount cap without trapping funds", async function () {
    const lowCapId = keccak256(stringToHex("LOW_CAP_V1"));
    await registry.write.configureAdapter([
      lowCapId,
      adapter.address,
      fxrp.address,
      AMOUNT - 1n,
      true,
    ]);
    await fundAndApprove();

    await executeFallback(11, makeIntent({ adapterId: lowCapId }));

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
  });

  it("keeps FXRP in the personal account when funding cannot be pulled", async function () {
    await fundAndApprove(AMOUNT - 1n);
    await fxrp.write.approve([router.address, AMOUNT], {
      account: user.account,
    });

    const event = await executeFallback(4);

    assert.equal(event.args.returnedAmount, 0n);
    assert.equal(
      await fxrp.read.balanceOf([user.account.address]),
      AMOUNT - 1n,
    );
    assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
  });

  it("settles a replay as fallback and consumes the fresh allowance", async function () {
    const intent = makeIntent();
    await fundAndApprove();
    await execute(intent);

    await fundAndApprove();
    await executeFallback(10, intent);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(
      await fxrp.read.allowance([user.account.address, router.address]),
      0n,
    );
  });

  it("rejects malformed caller binding without touching user funds", async function () {
    await fundAndApprove();
    const intent = makeIntent({ personalAccount: other.account.address });

    await executeFallback(12, intent);

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await router.read.usedIntents([
      await router.read.hashIntent([intent]),
    ]), false);
  });

  it("rejects an unsupported asset without moving it", async function () {
    const otherAsset = await viem.deployContract("MockERC20", [
      "Other",
      "OTHER",
    ]);
    await otherAsset.write.mint([user.account.address, AMOUNT]);
    await otherAsset.write.approve([router.address, AMOUNT], {
      account: user.account,
    });

    const intent = makeIntent({ asset: otherAsset.address });
    await executeFallback(12, intent);

    assert.equal(
      await otherAsset.read.balanceOf([user.account.address]),
      AMOUNT,
    );
    assert.equal(await otherAsset.read.balanceOf([router.address]), 0n);
  });

  it("preserves donated router dust using balance-delta accounting", async function () {
    const dust = 77n;
    await fxrp.write.mint([router.address, dust]);
    await fundAndApprove();

    await execute();

    assert.equal(await fxrp.read.balanceOf([router.address]), dust);
    assert.equal(await vault.read.balanceOf([user.account.address]), AMOUNT);
  });

  it("catches a lying adapter that does not spend the input", async function () {
    const noSpend = await viem.deployContract("NoSpendAdapter");
    await registry.write.configureAdapter([
      OTHER_ADAPTER_ID,
      noSpend.address,
      fxrp.address,
      CAP,
      true,
    ]);
    await fundAndApprove();

    await executeFallback(7, makeIntent({ adapterId: OTHER_ADAPTER_ID }));

    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
  });

  for (const scenario of [
    { mode: 0, label: "large revert data", failureCode: 255 },
    { mode: 1, label: "31-byte malformed success data", failureCode: 7 },
    { mode: 2, label: "large success data", failureCode: 7 },
    { mode: 3, label: "adapter reentrancy", failureCode: 255 },
    { mode: 4, label: "adapter gas exhaustion", failureCode: 255 },
  ]) {
    it(`bounds ${scenario.label} and preserves the fallback`, async function () {
      const adversarial = await viem.deployContract("AdversarialAdapter", [
        router.address,
        scenario.mode,
      ]);
      const adversarialId = keccak256(
        stringToHex(`ADVERSARIAL_${scenario.mode}`),
      );
      await registry.write.configureAdapter([
        adversarialId,
        adversarial.address,
        fxrp.address,
        CAP,
        true,
      ]);
      await fundAndApprove();

      const receipt = await execute(
        makeIntent({ adapterId: adversarialId }),
      );
      const event = eventFrom(receipt, "IntentSettledFallback");

      assert.equal(event.args.failureCode, scenario.failureCode);
      assert.notEqual(event.args.revertDataHash, zeroHash);
      assert.equal(event.args.returnedAmount, AMOUNT);
      assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
      assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
      assert.ok(receipt.gasUsed < 700_000n);
    });
  }

  it("fails closed before mutation when execution gas is below the safe floor", async function () {
    await fundAndApprove();
    await assert.rejects(
      router.write.execute([makeIntent()], {
        account: user.account,
        gas: 400_000n,
      }),
      /InsufficientExecutionGas/,
    );
    assert.equal(await fxrp.read.balanceOf([user.account.address]), AMOUNT);
    assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
  });

  it("blocks token callback reentrancy without breaking valid settlement", async function () {
    const reentrantToken = await viem.deployContract("ReentrantERC20");
    const reentrantRegistry = await viem.deployContract("AdapterRegistry", [
      owner.account.address,
    ]);
    const reentrantRouter = await viem.deployContract("MintShieldRouter", [
      owner.account.address,
      reentrantRegistry.address,
      reentrantToken.address,
    ]);
    const reentrantVault = await viem.deployContract("FailureVault", [
      reentrantToken.address,
    ]);
    const reentrantAdapter = await viem.deployContract(
      "ERC4626DepositAdapter",
      [
        reentrantRouter.address,
        reentrantToken.address,
        reentrantVault.address,
      ],
    );
    await reentrantRegistry.write.configureAdapter([
      ADAPTER_ID,
      reentrantAdapter.address,
      reentrantToken.address,
      CAP,
      true,
    ]);
    await reentrantToken.write.setRouter([reentrantRouter.address]);
    await reentrantToken.write.setReentryEnabled([true]);
    await reentrantToken.write.mint([user.account.address, AMOUNT]);
    await reentrantToken.write.approve([reentrantRouter.address, AMOUNT], {
      account: user.account,
    });

    const intent = makeIntent({ asset: reentrantToken.address });
    const hash = await reentrantRouter.write.execute([intent], {
      account: user.account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const successEvents = parseEventLogs({
      abi: reentrantRouter.abi,
      logs: receipt.logs,
      eventName: "IntentSettledSuccess",
      strict: true,
    });

    assert.equal(successEvents.length, 1);
    assert.equal(await reentrantToken.read.attempted(), true);
    assert.equal(await reentrantToken.read.reentrySucceeded(), false);
    assert.equal(
      await reentrantVault.read.balanceOf([user.account.address]),
      AMOUNT,
    );
    assert.equal(
      await reentrantToken.read.balanceOf([reentrantRouter.address]),
      0n,
    );
  });

  it("preserves FXRP conservation across a stateful success/fallback sequence", async function () {
    const cases = [
      { amount: 1n, mode: 0 },
      { amount: 2n, mode: 1 },
      { amount: 17n, mode: 2 },
      { amount: 128n, mode: 3 },
      { amount: 999n, mode: 0 },
      { amount: 1_337n, mode: 1 },
      { amount: 5_000n, mode: 2 },
      { amount: 10_000n, mode: 3 },
    ];

    for (const [index, testCase] of cases.entries()) {
      await vault.write.setMode([testCase.mode]);
      await fundAndApprove(testCase.amount);
      const receipt = await execute(
        makeIntent({
          inputAmount: testCase.amount,
          minOutput: testCase.amount,
          nonce: BigInt(index + 100),
        }),
      );
      const expectedEvent =
        testCase.mode === 0
          ? "IntentSettledSuccess"
          : "IntentSettledFallback";
      eventFrom(receipt, expectedEvent);

      const totalSupply = await fxrp.read.totalSupply();
      const accounted =
        (await fxrp.read.balanceOf([user.account.address])) +
        (await fxrp.read.balanceOf([router.address])) +
        (await fxrp.read.balanceOf([adapter.address])) +
        (await fxrp.read.balanceOf([vault.address]));
      assert.equal(accounted, totalSupply);
      assert.equal(await fxrp.read.balanceOf([router.address]), 0n);
      assert.equal(await fxrp.read.balanceOf([adapter.address]), 0n);
      assert.equal(
        await fxrp.read.allowance([router.address, adapter.address]),
        0n,
      );
      assert.equal(
        await fxrp.read.allowance([adapter.address, vault.address]),
        0n,
      );
    }
  });

  it("prevents direct calls to the adapter", async function () {
    await assert.rejects(
      adapter.write.execute([
        user.account.address,
        fxrp.address,
        AMOUNT,
        AMOUNT,
        "0x",
      ], { account: user.account }),
    );
  });

  it("stores the runtime code hash and applies the first configuration immediately", async function () {
    const first = await registry.read.getAdapter([ADAPTER_ID]);
    assert.notEqual(first.codeHash, zeroHash);
    assert.equal(first.version, 1n);
  });

  it("delays a change to an already-live adapter behind a timelock", async function () {
    await registry.write.configureAdapter([
      ADAPTER_ID,
      adapter.address,
      fxrp.address,
      CAP + 1n,
      true,
    ]);

    const unchanged = await registry.read.getAdapter([ADAPTER_ID]);
    assert.equal(unchanged.version, 1n);
    assert.equal(unchanged.maxAmount, CAP);

    const pending = await registry.read.getPendingAdapter([ADAPTER_ID]);
    assert.equal(pending.maxAmount, CAP + 1n);
    assert.notEqual(pending.effectiveAt, 0n);

    await assert.rejects(
      registry.write.activateAdapter([ADAPTER_ID]),
      /AdapterTimelockNotElapsed/,
    );

    await networkHelpers.time.increase(15 * 60);
    await registry.write.activateAdapter([ADAPTER_ID], {
      account: other.account,
    });

    const activated = await registry.read.getAdapter([ADAPTER_ID]);
    assert.equal(activated.version, 2n);
    assert.equal(activated.maxAmount, CAP + 1n);
  });

  it("lets the owner cancel a pending adapter change before it activates", async function () {
    await registry.write.configureAdapter([
      ADAPTER_ID,
      adapter.address,
      fxrp.address,
      CAP + 1n,
      true,
    ]);
    await registry.write.cancelAdapterChange([ADAPTER_ID]);

    await networkHelpers.time.increase(15 * 60);
    await assert.rejects(
      registry.write.activateAdapter([ADAPTER_ID]),
      /NoPendingAdapterChange/,
    );
    const config = await registry.read.getAdapter([ADAPTER_ID]);
    assert.equal(config.version, 1n);
    assert.equal(config.maxAmount, CAP);
  });

  it("disables an already-live adapter immediately, without a timelock", async function () {
    await registry.write.setAdapterEnabled([ADAPTER_ID, false]);
    const config = await registry.read.getAdapter([ADAPTER_ID]);
    assert.equal(config.enabled, false);
  });

  it("restricts registry administration to the owner", async function () {
    await assert.rejects(
      registry.write.setAdapterEnabled([ADAPTER_ID, false], {
        account: other.account,
      }),
    );
    const config = await registry.read.getAdapter([ADAPTER_ID]);
    assert.equal(config.enabled, true);
  });

  it("restricts emergency pause to the router owner", async function () {
    await assert.rejects(
      router.write.setPaused([true], { account: other.account }),
    );
    assert.equal(await router.read.paused(), false);
  });

  it("domain-separates intent hashes by nonce and adapter data", async function () {
    const base = makeIntent();
    const hash = await router.read.hashIntent([base]);
    const nonceHash = await router.read.hashIntent([
      makeIntent({ nonce: 2n }),
    ]);
    const dataHash = await router.read.hashIntent([
      makeIntent({ adapterData: "0x01" }),
    ]);

    assert.notEqual(hash, nonceHash);
    assert.notEqual(hash, dataHash);
  });
});
