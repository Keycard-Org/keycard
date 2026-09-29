// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KeycardRegistry} from "../src/KeycardRegistry.sol";

contract KeycardRegistryTest is Test {
    KeycardRegistry reg;
    address owner = makeAddr("owner");
    address attester = makeAddr("attester");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 nA = keccak256("nullifier-alice");
    bytes32 nB = keccak256("nullifier-bob");
    uint8 constant BORROWER_FLAGS = 1 | 2 | 4;

    function setUp() public {
        vm.warp(1_800_000_000);
        reg = new KeycardRegistry(owner, attester);
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(KeycardRegistry.ZeroAddress.selector);
        new KeycardRegistry(address(0), attester);
        vm.expectRevert(KeycardRegistry.ZeroAddress.selector);
        new KeycardRegistry(owner, address(0));
    }

    function test_attest_and_eligible() public {
        vm.prank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 365 days));
        assertTrue(reg.isEligible(alice, BORROWER_FLAGS));
        assertFalse(reg.isEligible(alice, BORROWER_FLAGS | 8));
        assertEq(reg.walletOfNullifier(nA), alice);
    }

    function test_attest_onlyAttester() public {
        vm.expectRevert(KeycardRegistry.NotAttester.selector);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
    }

    function test_oneHumanOneWallet() public {
        vm.startPrank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.expectRevert(abi.encodeWithSelector(KeycardRegistry.NullifierBoundToOtherWallet.selector, alice));
        reg.attest(bob, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_walletCannotSwitchHuman() public {
        vm.startPrank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.expectRevert(abi.encodeWithSelector(KeycardRegistry.WalletBoundToOtherNullifier.selector, nA));
        reg.attest(alice, nB, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_reattest_sameHuman_updatesFlags() public {
        vm.startPrank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        reg.attest(alice, nA, BORROWER_FLAGS | 8, uint64(block.timestamp + 2 days));
        vm.stopPrank();
        assertTrue(reg.isEligible(alice, BORROWER_FLAGS | 8));
    }

    function test_expiry() public {
        vm.prank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days);
        assertFalse(reg.isEligible(alice, BORROWER_FLAGS));
    }

    function test_attest_rejectsPastExpiry() public {
        vm.prank(attester);
        vm.expectRevert(KeycardRegistry.ExpiryInPast.selector);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp));
    }

    function test_revoke_keepsNullifierBound() public {
        vm.startPrank(attester);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        reg.revokeAttestation(alice);
        assertFalse(reg.isEligible(alice, BORROWER_FLAGS));
        // the same human cannot come back with a fresh wallet
        vm.expectRevert(abi.encodeWithSelector(KeycardRegistry.NullifierBoundToOtherWallet.selector, alice));
        reg.attest(bob, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function test_revoke_unknown() public {
        vm.prank(attester);
        vm.expectRevert(KeycardRegistry.NotAttested.selector);
        reg.revokeAttestation(alice);
    }

    function test_merchants() public {
        address m = makeAddr("merchant");
        vm.expectRevert(KeycardRegistry.NotOwner.selector);
        reg.setMerchant(m, true, "demo");
        vm.prank(owner);
        reg.setMerchant(m, true, "demo");
        assertTrue(reg.isMerchant(m));
        vm.prank(owner);
        reg.setMerchant(m, false, "demo");
        assertFalse(reg.isMerchant(m));
    }

    function test_rotateAttesterAndOwner() public {
        address next = makeAddr("next");
        vm.prank(owner);
        reg.setAttester(next);
        vm.prank(attester);
        vm.expectRevert(KeycardRegistry.NotAttester.selector);
        reg.attest(alice, nA, BORROWER_FLAGS, uint64(block.timestamp + 1 days));
        vm.prank(owner);
        reg.setOwner(next);
        assertEq(reg.owner(), next);
    }

    function testFuzz_eligibleRequiresAllFlags(uint8 have, uint8 need) public {
        vm.prank(attester);
        reg.attest(alice, nA, have, uint64(block.timestamp + 1 days));
        assertEq(reg.isEligible(alice, need), (have & need) == need);
    }
}
