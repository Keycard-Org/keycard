// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KeycardRegistry
/// @notice Identity attestations (from Self Protocol, verified off-chain) and the merchant allow-list mirror.
/// @dev Holds no funds. Enforcement of spending happens in Tempo's AccountKeychain, not here.
///      This contract records who is eligible and which merchants a spend key may pay, publicly.
contract KeycardRegistry {
    uint8 public constant FLAG_ADULT = 1;
    uint8 public constant FLAG_NOT_EXCLUDED_COUNTRY = 2;
    uint8 public constant FLAG_OFAC_CLEAR = 4;
    uint8 public constant FLAG_GUARANTOR = 8;

    struct Attestation {
        bytes32 nullifierHash;
        uint64 expiresAt;
        uint8 flags;
    }

    address public owner;
    address public attester;

    mapping(address wallet => Attestation) public attestationOf;
    mapping(bytes32 nullifierHash => address wallet) public walletOfNullifier;
    mapping(address merchant => bool) public isMerchant;

    event OwnerChanged(address indexed previous, address indexed next);
    event AttesterChanged(address indexed previous, address indexed next);
    event Attested(address indexed wallet, bytes32 indexed nullifierHash, uint8 flags, uint64 expiresAt);
    event AttestationRevoked(address indexed wallet, bytes32 indexed nullifierHash);
    event MerchantSet(address indexed merchant, bool allowed, string label);

    error NotOwner();
    error NotAttester();
    error ZeroAddress();
    error NullifierBoundToOtherWallet(address existing);
    error WalletBoundToOtherNullifier(bytes32 existing);
    error ExpiryInPast();
    error NotAttested();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttester() {
        if (msg.sender != attester) revert NotAttester();
        _;
    }

    constructor(address owner_, address attester_) {
        if (owner_ == address(0) || attester_ == address(0)) revert ZeroAddress();
        owner = owner_;
        attester = attester_;
        emit OwnerChanged(address(0), owner_);
        emit AttesterChanged(address(0), attester_);
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit OwnerChanged(owner, next);
        owner = next;
    }

    function setAttester(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit AttesterChanged(attester, next);
        attester = next;
    }

    /// @notice Record that `wallet` belongs to one verified human. One human (nullifier) maps to one wallet.
    /// @dev Re-attesting the same wallet+nullifier (e.g. renewing expiry or adding FLAG_GUARANTOR) is allowed.
    function attest(address wallet, bytes32 nullifierHash, uint8 flags, uint64 expiresAt) external onlyAttester {
        if (wallet == address(0)) revert ZeroAddress();
        if (expiresAt <= block.timestamp) revert ExpiryInPast();

        address boundWallet = walletOfNullifier[nullifierHash];
        if (boundWallet != address(0) && boundWallet != wallet) revert NullifierBoundToOtherWallet(boundWallet);

        bytes32 boundNullifier = attestationOf[wallet].nullifierHash;
        if (boundNullifier != bytes32(0) && boundNullifier != nullifierHash) {
            revert WalletBoundToOtherNullifier(boundNullifier);
        }

        walletOfNullifier[nullifierHash] = wallet;
        attestationOf[wallet] = Attestation({nullifierHash: nullifierHash, expiresAt: expiresAt, flags: flags});
        emit Attested(wallet, nullifierHash, flags, expiresAt);
    }

    /// @notice Remove an attestation. The nullifier stays bound to the wallet so the human cannot re-enter
    ///         with a fresh wallet (e.g. after a default).
    function revokeAttestation(address wallet) external onlyAttester {
        Attestation memory a = attestationOf[wallet];
        if (a.nullifierHash == bytes32(0)) revert NotAttested();
        attestationOf[wallet].expiresAt = 0;
        attestationOf[wallet].flags = 0;
        emit AttestationRevoked(wallet, a.nullifierHash);
    }

    function setMerchant(address merchant, bool allowed, string calldata label) external onlyOwner {
        if (merchant == address(0)) revert ZeroAddress();
        isMerchant[merchant] = allowed;
        emit MerchantSet(merchant, allowed, label);
    }

    /// @return true if `wallet` holds a live attestation carrying every bit in `requiredFlags`.
    function isEligible(address wallet, uint8 requiredFlags) external view returns (bool) {
        Attestation memory a = attestationOf[wallet];
        return a.expiresAt > block.timestamp && (a.flags & requiredFlags) == requiredFlags;
    }
}
