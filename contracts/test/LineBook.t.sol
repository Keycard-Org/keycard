// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LineBook} from "../src/LineBook.sol";

contract LineBookTest is Test {
    LineBook book;
    address owner = makeAddr("owner");
    address servicer = makeAddr("servicer");
    address borrower = makeAddr("borrower");
    address credit = makeAddr("credit");
    address income = makeAddr("income");
    address guarantor = makeAddr("guarantor");
    address token = makeAddr("usdc");

    function setUp() public {
        vm.warp(1_800_000_000);
        book = new LineBook(owner, servicer);
    }

    function _open(address g, uint128 guaranteed) internal returns (uint256) {
        vm.prank(servicer);
        return book.openLine(
            borrower, credit, income, g, token, 20e6, 5e6, guaranteed, 30 days, uint64(block.timestamp + 180 days)
        );
    }

    function test_open() public {
        uint256 id = _open(guarantor, 10e6);
        assertEq(id, 1);
        LineBook.Line memory l = book.lines(id);
        assertEq(l.borrower, borrower);
        assertEq(l.limit, 20e6);
        assertEq(l.guaranteed, 10e6);
        assertEq(uint8(l.status), uint8(LineBook.Status.Active));
        assertEq(book.activeLineOf(borrower), 1);
    }

    function test_open_onlyServicer() public {
        vm.expectRevert(LineBook.NotServicer.selector);
        book.openLine(borrower, credit, income, address(0), token, 1, 1, 0, 1, uint64(block.timestamp + 1));
    }

    function test_open_badParams() public {
        vm.startPrank(servicer);
        vm.expectRevert(LineBook.BadParams.selector); // zero limit
        book.openLine(borrower, credit, income, address(0), token, 0, 1, 0, 1, uint64(block.timestamp + 1));
        vm.expectRevert(LineBook.BadParams.selector); // guarantor without amount
        book.openLine(borrower, credit, income, guarantor, token, 1, 1, 0, 1, uint64(block.timestamp + 1));
        vm.expectRevert(LineBook.BadParams.selector); // amount without guarantor
        book.openLine(borrower, credit, income, address(0), token, 1, 1, 5, 1, uint64(block.timestamp + 1));
        vm.expectRevert(LineBook.BadParams.selector); // term in the past
        book.openLine(borrower, credit, income, address(0), token, 1, 1, 0, 1, uint64(block.timestamp));
        vm.expectRevert(LineBook.ZeroAddress.selector);
        book.openLine(address(0), credit, income, address(0), token, 1, 1, 0, 1, uint64(block.timestamp + 1));
        vm.stopPrank();
    }

    function test_oneActiveLinePerBorrower() public {
        _open(address(0), 0);
        vm.prank(servicer);
        vm.expectRevert(abi.encodeWithSelector(LineBook.BorrowerHasActiveLine.selector, 1));
        book.openLine(borrower, credit, income, address(0), token, 1, 1, 0, 1, uint64(block.timestamp + 1));
    }

    function test_repayment_onTime_counts() public {
        uint256 id = _open(address(0), 0);
        vm.prank(servicer);
        book.recordRepayment(id, bytes32(uint256(1)), 5e6, true);
        assertEq(book.lines(id).onTimeCount, 1);
    }

    function test_missed_thenRepay_returnsToActive() public {
        uint256 id = _open(address(0), 0);
        vm.startPrank(servicer);
        book.recordMissed(id);
        assertEq(uint8(book.lines(id).status), uint8(LineBook.Status.Grace));
        book.recordRepayment(id, bytes32(uint256(2)), 5e6, false);
        vm.stopPrank();
        assertEq(uint8(book.lines(id).status), uint8(LineBook.Status.Active));
        assertEq(book.lines(id).onTimeCount, 0);
        assertEq(book.lines(id).missedCount, 1);
    }

    function test_freeze_unfreeze() public {
        uint256 id = _open(address(0), 0);
        vm.startPrank(servicer);
        book.recordFreeze(id, LineBook.FreezeReason.MandateRevoked);
        assertEq(uint8(book.lines(id).status), uint8(LineBook.Status.Frozen));
        book.recordUnfreeze(id);
        assertEq(uint8(book.lines(id).status), uint8(LineBook.Status.Active));
        vm.expectRevert(LineBook.BadParams.selector);
        book.recordFreeze(id, LineBook.FreezeReason.None);
        vm.stopPrank();
    }

    function test_guarantorPull_boundedByCap() public {
        uint256 id = _open(guarantor, 10e6);
        vm.startPrank(servicer);
        vm.expectRevert(LineBook.BadParams.selector);
        book.recordGuarantorPull(id, bytes32(0), 10e6 + 1);
        book.recordGuarantorPull(id, bytes32(uint256(3)), 4e6);
        assertEq(book.lines(id).guaranteed, 6e6);
        vm.stopPrank();
    }

    function test_default_isTerminal_andFreesBorrower() public {
        uint256 id = _open(address(0), 0);
        vm.startPrank(servicer);
        book.recordDefault(id);
        assertEq(book.activeLineOf(borrower), 0);
        vm.expectRevert(
            abi.encodeWithSelector(LineBook.IllegalTransition.selector, LineBook.Status.Defaulted, LineBook.Status.Active)
        );
        book.recordUnfreeze(id);
        vm.stopPrank();
    }

    function test_close_isTerminal() public {
        uint256 id = _open(address(0), 0);
        vm.startPrank(servicer);
        book.close(id);
        vm.expectRevert(
            abi.encodeWithSelector(LineBook.IllegalTransition.selector, LineBook.Status.Closed, LineBook.Status.Frozen)
        );
        book.recordFreeze(id, LineBook.FreezeReason.Manual);
        vm.stopPrank();
    }

    function test_graceCannotClose() public {
        uint256 id = _open(address(0), 0);
        vm.startPrank(servicer);
        book.recordMissed(id);
        vm.expectRevert(
            abi.encodeWithSelector(LineBook.IllegalTransition.selector, LineBook.Status.Grace, LineBook.Status.Closed)
        );
        book.close(id);
        vm.stopPrank();
    }

    function test_limitChange() public {
        uint256 id = _open(address(0), 0);
        vm.prank(servicer);
        book.recordLimitChange(id, 50e6);
        assertEq(book.lines(id).limit, 50e6);
    }

    function test_guarantorChange_validation() public {
        uint256 id = _open(guarantor, 10e6);
        vm.startPrank(servicer);
        vm.expectRevert(LineBook.BadParams.selector);
        book.recordGuarantorChange(id, address(0), 5);
        book.recordGuarantorChange(id, address(0), 0);
        vm.stopPrank();
        assertEq(book.lines(id).guarantorWallet, address(0));
    }

    function test_unknownLine() public {
        vm.prank(servicer);
        vm.expectRevert(LineBook.UnknownLine.selector);
        book.recordMissed(42);
    }

    function test_rotateServicer() public {
        address next = makeAddr("next");
        vm.expectRevert(LineBook.NotOwner.selector);
        book.setServicer(next);
        vm.prank(owner);
        book.setServicer(next);
        vm.prank(servicer);
        vm.expectRevert(LineBook.NotServicer.selector);
        book.openLine(borrower, credit, income, address(0), token, 1, 1, 0, 1, uint64(block.timestamp + 1));
    }

    function test_reopenAfterClose() public {
        uint256 id = _open(address(0), 0);
        vm.prank(servicer);
        book.close(id);
        uint256 id2 = _open(address(0), 0);
        assertEq(id2, 2);
    }
}
