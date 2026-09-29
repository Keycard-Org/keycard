// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title LineBook
/// @notice The public, append-only credit file for KEYCARD credit lines.
/// @dev LineBook RECORDS; it does not enforce. Spending limits, merchant scopes, the repayment mandate and the
///      guarantor cap are enforced by Tempo's AccountKeychain precompile on the borrower's / guarantor's own
///      accounts. The servicer writes here after each on-chain action so anyone can audit a line's history.
contract LineBook {
    enum Status {
        None,
        Active,
        Grace,
        Frozen,
        Defaulted,
        Closed
    }

    enum FreezeReason {
        None,
        MandateRevoked,
        MissedPayment,
        Manual,
        GuarantorWithdrawn
    }

    struct Line {
        address borrower; // borrower's identity wallet (attested in KeycardRegistry)
        address creditAccount; // KEYCARD-funded account the borrower's spend key draws from
        address incomeWallet; // borrower wallet carrying the repayment mandate key
        address guarantorWallet; // zero if unguaranteed
        address token; // TIP-20 the line is denominated in
        uint128 limit; // current per-period spend limit
        uint128 instalment; // per-period repayment amount
        uint128 guaranteed; // guarantor cap (0 if none)
        uint64 period; // seconds
        uint64 openedAt;
        uint64 termEnd;
        uint32 onTimeCount;
        uint32 missedCount;
        Status status;
    }

    address public owner;
    address public servicer;
    uint256 public nextId = 1;
    mapping(uint256 id => Line) internal _lines;
    mapping(address borrower => uint256 id) public activeLineOf;

    event OwnerChanged(address indexed previous, address indexed next);
    event ServicerChanged(address indexed previous, address indexed next);
    event LineOpened(
        uint256 indexed id,
        address indexed borrower,
        address creditAccount,
        address incomeWallet,
        address guarantorWallet,
        address token,
        uint128 limit,
        uint128 instalment,
        uint128 guaranteed,
        uint64 period,
        uint64 termEnd
    );
    event Repaid(uint256 indexed id, bytes32 indexed txHash, uint128 amount, bool onTime);
    event Missed(uint256 indexed id, uint32 missedCount);
    event LimitChanged(uint256 indexed id, uint128 previousLimit, uint128 newLimit);
    event StatusChanged(uint256 indexed id, Status previous, Status next, FreezeReason reason);
    event GuarantorPulled(uint256 indexed id, bytes32 indexed txHash, uint128 amount);
    event GuarantorChanged(uint256 indexed id, address guarantorWallet, uint128 guaranteed);

    error NotOwner();
    error NotServicer();
    error ZeroAddress();
    error BadParams();
    error UnknownLine();
    error BorrowerHasActiveLine(uint256 id);
    error IllegalTransition(Status from, Status to);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyServicer() {
        if (msg.sender != servicer) revert NotServicer();
        _;
    }

    constructor(address owner_, address servicer_) {
        if (owner_ == address(0) || servicer_ == address(0)) revert ZeroAddress();
        owner = owner_;
        servicer = servicer_;
        emit OwnerChanged(address(0), owner_);
        emit ServicerChanged(address(0), servicer_);
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, next);
        owner = next;
    }

    function setServicer(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit ServicerChanged(servicer, next);
        servicer = next;
    }

    function lines(uint256 id) external view returns (Line memory) {
        return _lines[id];
    }

    function openLine(
        address borrower,
        address creditAccount,
        address incomeWallet,
        address guarantorWallet,
        address token,
        uint128 limit,
        uint128 instalment,
        uint128 guaranteed,
        uint64 period,
        uint64 termEnd
    ) external onlyServicer returns (uint256 id) {
        if (borrower == address(0) || creditAccount == address(0) || incomeWallet == address(0) || token == address(0))
        {
            revert ZeroAddress();
        }
        if (limit == 0 || instalment == 0 || period == 0 || termEnd <= block.timestamp) revert BadParams();
        if ((guarantorWallet == address(0)) != (guaranteed == 0)) revert BadParams();
        uint256 existing = activeLineOf[borrower];
        if (existing != 0) revert BorrowerHasActiveLine(existing);

        id = nextId++;
        _lines[id] = Line({
            borrower: borrower,
            creditAccount: creditAccount,
            incomeWallet: incomeWallet,
            guarantorWallet: guarantorWallet,
            token: token,
            limit: limit,
            instalment: instalment,
            guaranteed: guaranteed,
            period: period,
            openedAt: uint64(block.timestamp),
            termEnd: termEnd,
            onTimeCount: 0,
            missedCount: 0,
            status: Status.Active
        });
        activeLineOf[borrower] = id;
        emit LineOpened(
            id, borrower, creditAccount, incomeWallet, guarantorWallet, token, limit, instalment, guaranteed, period, termEnd
        );
        emit StatusChanged(id, Status.None, Status.Active, FreezeReason.None);
    }

    function recordRepayment(uint256 id, bytes32 txHash, uint128 amount, bool onTime) external onlyServicer {
        Line storage l = _get(id);
        if (amount == 0) revert BadParams();
        if (onTime) l.onTimeCount += 1;
        emit Repaid(id, txHash, amount, onTime);
        if (l.status == Status.Grace) _setStatus(id, l, Status.Active, FreezeReason.None);
    }

    function recordMissed(uint256 id) external onlyServicer {
        Line storage l = _get(id);
        l.missedCount += 1;
        emit Missed(id, l.missedCount);
        if (l.status == Status.Active) _setStatus(id, l, Status.Grace, FreezeReason.MissedPayment);
    }

    function recordLimitChange(uint256 id, uint128 newLimit) external onlyServicer {
        Line storage l = _get(id);
        emit LimitChanged(id, l.limit, newLimit);
        l.limit = newLimit;
    }

    function recordGuarantorChange(uint256 id, address guarantorWallet, uint128 guaranteed) external onlyServicer {
        Line storage l = _get(id);
        if ((guarantorWallet == address(0)) != (guaranteed == 0)) revert BadParams();
        l.guarantorWallet = guarantorWallet;
        l.guaranteed = guaranteed;
        emit GuarantorChanged(id, guarantorWallet, guaranteed);
    }

    function recordFreeze(uint256 id, FreezeReason reason) external onlyServicer {
        if (reason == FreezeReason.None) revert BadParams();
        Line storage l = _get(id);
        _setStatus(id, l, Status.Frozen, reason);
    }

    function recordUnfreeze(uint256 id) external onlyServicer {
        Line storage l = _get(id);
        _setStatus(id, l, Status.Active, FreezeReason.None);
    }

    function recordGuarantorPull(uint256 id, bytes32 txHash, uint128 amount) external onlyServicer {
        Line storage l = _get(id);
        if (amount == 0 || amount > l.guaranteed) revert BadParams();
        l.guaranteed -= amount;
        emit GuarantorPulled(id, txHash, amount);
    }

    function recordDefault(uint256 id) external onlyServicer {
        Line storage l = _get(id);
        _setStatus(id, l, Status.Defaulted, FreezeReason.MissedPayment);
        activeLineOf[l.borrower] = 0;
    }

    function close(uint256 id) external onlyServicer {
        Line storage l = _get(id);
        _setStatus(id, l, Status.Closed, FreezeReason.None);
        activeLineOf[l.borrower] = 0;
    }

    function _get(uint256 id) internal view returns (Line storage l) {
        l = _lines[id];
        if (l.status == Status.None) revert UnknownLine();
    }

    /// Legal transitions:
    ///   Active  -> Grace | Frozen | Defaulted | Closed
    ///   Grace   -> Active | Frozen | Defaulted
    ///   Frozen  -> Active | Defaulted | Closed
    ///   Defaulted, Closed -> (terminal)
    function _setStatus(uint256 id, Line storage l, Status next, FreezeReason reason) internal {
        Status prev = l.status;
        bool ok;
        if (prev == Status.Active) {
            ok = next == Status.Grace || next == Status.Frozen || next == Status.Defaulted || next == Status.Closed;
        } else if (prev == Status.Grace) {
            ok = next == Status.Active || next == Status.Frozen || next == Status.Defaulted;
        } else if (prev == Status.Frozen) {
            ok = next == Status.Active || next == Status.Defaulted || next == Status.Closed;
        }
        if (!ok) revert IllegalTransition(prev, next);
        l.status = next;
        emit StatusChanged(id, prev, next, reason);
    }
}
