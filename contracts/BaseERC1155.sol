// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import '@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts/utils/Counters.sol';
import './interfaces/IVersionedContract.sol';

/**
 * @dev {ERC1155} token, including:
 *
 *  - ability for holders to burn (destroy) their tokens
 *  - a minter role that allows for token minting (creation)
 *  - a pauser role that allows to stop all token transfers
 *
 * This contract uses {AccessControl} to lock permissioned functions using the
 * different roles - head to its documentation for details.
 *
 * The account that deploys the contract will be granted the minter and pauser
 * roles, as well as the default admin role, which will let it grant both minter
 * and pauser roles to other accounts.
 */
contract BaseERC1155 is
	Initializable,
	ContextUpgradeable,
	AccessControlEnumerableUpgradeable,
	ERC1155PausableUpgradeable,
	ERC1155SupplyUpgradeable,
	IVersionedContract
{
	using Counters for Counters.Counter;

	/*
   =======================================================================
   ======================== Constants ====================================
   =======================================================================
 */
	bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');
	bytes32 public constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

	/*
   =======================================================================
   ======================== Private Variables ============================
   =======================================================================
 */
	Counters.Counter internal tokenCounter;

	/*
   =======================================================================
   ======================== Public Variables ============================
   =======================================================================
 */

	/// @dev tokenId -> totalSupply
	mapping(uint256 => uint256) public tokenTotalSupply;

	/*
   =======================================================================
   ======================== Initializer ==================================
   =======================================================================
 */

	/**
	 * @dev Grants `DEFAULT_ADMIN_ROLE`, `MINTER_ROLE`, and `PAUSER_ROLE` to the account that
	 * deploys the contract.
	 */
	function __BaseERC1155_init(string memory uri) internal initializer {
		__Context_init_unchained();
		__ERC165_init_unchained();
		__AccessControl_init_unchained();
		__AccessControlEnumerable_init_unchained();
		__ERC1155_init_unchained(uri);
		__Pausable_init_unchained();
		__ERC1155Pausable_init_unchained();
		__BaseERC1155_init_unchained();
	}

	function __BaseERC1155_init_unchained() internal initializer {
		_setupRole(DEFAULT_ADMIN_ROLE, _msgSender());

		_setupRole(MINTER_ROLE, _msgSender());
		_setupRole(PAUSER_ROLE, _msgSender());
	}

	/*
   =======================================================================
   ======================== Modifiers ====================================
   =======================================================================
 */

	modifier onlyAdmin() {
		require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), 'BaseERC1155: ONLY_ADMIN_CAN_CALL');
		_;
	}

	modifier onlyMinter() {
		require(hasRole(MINTER_ROLE, _msgSender()), 'BaseERC1155: ONLY_MINTER_CAN_CALL');
		_;
	}

	modifier onlyValidNftId(uint256 _nftId) {
		require(_nftId > 0 && _nftId <= tokenCounter.current(), 'BaseERC1155: INVALID_NFT_ID');
		_;
	}

	/*
   =======================================================================
   ======================== Public Methods ===============================
   =======================================================================
 */

	/**
	 * @dev Creates `amount` new tokens for `to`, of token type `id`.
	 *
	 * See {ERC1155-_mint}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `MINTER_ROLE`.
	 */
	function mint(
		address to,
		uint256 id,
		uint256 amount,
		bytes memory data
	) public virtual onlyMinter onlyValidNftId(id) {
		_mint(to, id, amount, data);
	}

	/**
	 * @notice This function allows minter to burn the tokens
	 * @param _from - indicates the user address from which tokens to removed
	 * @param _id - indicates the ingredient id to burn
	 * @param _amount - indicates the amount of copies of nft type to burn
	 */
	function burn(
		address _from,
		uint256 _id,
		uint256 _amount
	) public virtual onlyMinter onlyValidNftId(_id) {
		_burn(_from, _id, _amount);
	}

	/**
	 * @notice This method allows admin to update base token uri
	 * @param _newUri - indicates the new uri
	 */
	function updateUri(string memory _newUri) external virtual onlyAdmin {
		require(bytes(_newUri).length > 0, 'BaseERC1155: INVALID_URI');
		_setURI(_newUri);
	}

	/**
	 * @dev Pauses all token transfers.
	 *
	 * See {ERC1155Pausable} and {Pausable-_pause}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `PAUSER_ROLE`.
	 */
	function pause() public virtual {
		require(
			hasRole(PAUSER_ROLE, _msgSender()),
			'ERC1155PresetMinterPauser: must have pauser role to pause'
		);
		_pause();
	}

	/**
	 * @dev Unpauses all token transfers.
	 *
	 * See {ERC1155Pausable} and {Pausable-_unpause}.
	 *
	 * Requirements:
	 *
	 * - the caller must have the `PAUSER_ROLE`.
	 */
	function unpause() public virtual {
		require(
			hasRole(PAUSER_ROLE, _msgSender()),
			'ERC1155PresetMinterPauser: must have pauser role to unpause'
		);
		_unpause();
	}

	/*
   =======================================================================
   ======================== Getter Methods ===============================
   =======================================================================
 */
	/**
	 * @notice This method retursn the current nft ID
	 */
	function getCurrentNftId() external view returns (uint256) {
		return tokenCounter.current();
	}

	/**
	 * @dev See {IERC165-supportsInterface}.
	 */
	function supportsInterface(bytes4 interfaceId)
		public
		view
		virtual
		override(AccessControlEnumerableUpgradeable, ERC1155Upgradeable)
		returns (bool)
	{
		return super.supportsInterface(interfaceId);
	}

	/**
	 * @notice Returns the storage, major, minor, and patch version of the contract.
	 * @return The storage, major, minor, and patch version of the contract.
	 */
	function getVersionNumber()
		external
		pure
		virtual
		override
		returns (
			uint256,
			uint256,
			uint256
		)
	{
		return (1, 0, 0);
	}

	/*
   =======================================================================
   ======================== Internal Methods =============================
   =======================================================================
 */

	/**
	 * @dev See {ERC1155-_mint}.
	 */
	function _mint(
		address account,
		uint256 id,
		uint256 amount,
		bytes memory data
	) internal virtual override(ERC1155SupplyUpgradeable, ERC1155Upgradeable) {
		ERC1155SupplyUpgradeable._mint(account, id, amount, data);
	}

	/**
	 * @dev See {ERC1155-_mintBatch}.
	 */
	function _mintBatch(
		address to,
		uint256[] memory ids,
		uint256[] memory amounts,
		bytes memory data
	) internal virtual override(ERC1155SupplyUpgradeable, ERC1155Upgradeable) {
		ERC1155SupplyUpgradeable._mintBatch(to, ids, amounts, data);
	}

	/**
	 * @dev See {ERC1155-_burn}.
	 */
	function _burn(
		address account,
		uint256 id,
		uint256 amount
	) internal virtual override(ERC1155SupplyUpgradeable, ERC1155Upgradeable) {
		ERC1155SupplyUpgradeable._burn(account, id, amount);
	}

	/**
	 * @dev See {ERC1155-_burnBatch}.
	 */
	function _burnBatch(
		address account,
		uint256[] memory ids,
		uint256[] memory amounts
	) internal virtual override(ERC1155SupplyUpgradeable, ERC1155Upgradeable) {
		ERC1155SupplyUpgradeable._burnBatch(account, ids, amounts);
	}

	function _beforeTokenTransfer(
		address operator,
		address from,
		address to,
		uint256[] memory ids,
		uint256[] memory amounts,
		bytes memory data
	) internal virtual override(ERC1155Upgradeable, ERC1155PausableUpgradeable) {
		super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
	}

	uint256[50] private __gap;
}
